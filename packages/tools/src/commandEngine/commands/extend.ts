/**
 * EXTEND — CadCommandEngine command (P4-B3 geometry + P4-B4 interaction).
 *
 * Quick: all visible geometry as boundaries; click targets immediately.
 * Standard: select boundary edges → Enter → select targets.
 * Options: Mode / Fence / Crossing / Undo / Boundary.
 * Shift+click/hover temporarily performs TRIM (shared planners).
 */
import type { CommandBus } from '@ratecad/commands';
import {
  ExtendEntityCommand,
  TrimEntityCommand,
} from '@ratecad/commands';
import {
  getEntity,
  isEntityModifiable,
  setSelection,
  type Entity,
  type EntityId,
  type Vec2,
} from '@ratecad/core';
import {
  canExtendEntity,
  canTrimEntity,
  entitiesCrossedByFence,
  extendPreviewMulti,
  fencePickPoint,
  trimRemovalPreviewMulti,
  type EdgeMode,
  type ProjectMode,
  type TrimMode,
} from '@ratecad/geometry';
import { hitTestDocument } from '@ratecad/viewport';
import type {
  CadCommandOption,
  CadEngineCommand,
  CadPromptDefinition,
} from '../types.js';

type ExtendPhase =
  | 'boundaries'
  | 'targets'
  | 'fence'
  | 'crossing'
  | 'mode';

type ExtendState = {
  bus: CommandBus;
  mode: TrimMode;
  edgeMode: EdgeMode;
  projectMode: ProjectMode;
  boundaryIds: EntityId[];
  /** Quick, or Standard+Enter with empty selection. */
  useAllBoundaries: boolean;
  phase: ExtendPhase;
  fence: Vec2[];
  crossingCorner: Vec2 | null;
  sessionExtendCount: number;
};

const EXTEND_TARGET_OPTIONS: CadCommandOption[] = [
  { id: 'boundary', label: 'Boundary edges', aliases: ['B', 'BOUNDARY'] },
  { id: 'fence', label: 'Fence', aliases: ['F', 'FENCE'] },
  { id: 'crossing', label: 'Crossing', aliases: ['C', 'CROSSING'] },
  { id: 'mode', label: 'Mode', aliases: ['M', 'MODE'] },
  { id: 'undo', label: 'Undo', aliases: ['U', 'UNDO'] },
];

function modeLabel(mode: TrimMode): string {
  return mode === 'quick' ? 'QUICK' : 'STANDARD';
}

function statusPrefix(s: ExtendState): string {
  return `EXTEND — ${modeLabel(s.mode)}`;
}

function boundaryPrompt(): CadPromptDefinition {
  return {
    id: 'boundaries',
    message: 'Select boundary edges or [Mode]:',
    inputType: 'entities',
    options: [{ id: 'mode', label: 'Mode', aliases: ['M', 'MODE'] }],
    optional: true,
  };
}

function targetPrompt(_s: ExtendState): CadPromptDefinition {
  return {
    id: 'targets',
    message:
      'Select object to extend or [Fence/Crossing/Mode/Undo/Boundary]:',
    inputType: 'point',
    options: EXTEND_TARGET_OPTIONS,
    optional: true,
  };
}

function readSettings(bus: CommandBus): {
  mode: TrimMode;
  edgeMode: EdgeMode;
  projectMode: ProjectMode;
} {
  const settings = bus.getDocument().settings;
  return {
    // Shared Quick/Standard preference with TRIM (no new file-format field).
    mode: settings.trimMode === 'standard' ? 'standard' : 'quick',
    edgeMode: settings.edgeMode === 'no-extend' ? 'no-extend' : 'extend',
    projectMode:
      settings.projectMode === 'ucs' || settings.projectMode === 'view'
        ? settings.projectMode
        : 'none',
  };
}

function persistModeSettings(s: ExtendState): void {
  s.bus.updateWithoutHistory((d) => ({
    ...d,
    settings: {
      ...d.settings,
      trimMode: s.mode,
      edgeMode: s.edgeMode,
      projectMode: s.projectMode,
    },
    meta: { ...d.meta, updatedAt: new Date().toISOString() },
  }));
}

function isBoundaryEntity(e: Entity): boolean {
  return (
    e.visible &&
    (e.type === 'line' ||
      e.type === 'polyline' ||
      e.type === 'rectangle' ||
      e.type === 'circle' ||
      e.type === 'wall')
  );
}

function allVisibleBoundaries(bus: CommandBus): Entity[] {
  const doc = bus.getDocument();
  return doc.entities.filter((e) => {
    if (!isBoundaryEntity(e)) return false;
    const layer = doc.layers.find((l) => l.id === e.layerId);
    if (layer && !layer.visible) return false;
    return true;
  });
}

function resolveBoundaries(s: ExtendState): Entity[] {
  if (s.useAllBoundaries || s.mode === 'quick') {
    return allVisibleBoundaries(s.bus);
  }
  const doc = s.bus.getDocument();
  const seen = new Set<EntityId>();
  const out: Entity[] = [];
  for (const id of s.boundaryIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const e = getEntity(doc, id);
    if (e && isBoundaryEntity(e)) out.push(e);
  }
  return out;
}

function pickEntityAt(bus: CommandBus, point: Vec2): Entity | null {
  const grid = bus.getDocument().settings.gridSize || 1;
  const tol = Math.max(grid * 0.35, 0.05);
  const id = hitTestDocument(bus.getDocument(), point, tol);
  if (!id) return null;
  return getEntity(bus.getDocument(), id) ?? null;
}

function beginTargets(
  s: ExtendState,
  message?: string,
): ReturnType<CadEngineCommand['onText']> {
  s.phase = 'targets';
  s.fence = [];
  s.crossingCorner = null;
  const n = resolveBoundaries(s).length;
  return {
    kind: 'continue',
    prompt: targetPrompt(s),
    status: `${statusPrefix(s)}: Select object to extend (${n} boundary edge(s)):`,
    message: message ?? undefined,
    preview: null,
    dynamic: { label: statusPrefix(s) },
  };
}

function ensureState(state: unknown): ExtendState {
  const s = state as Partial<ExtendState>;
  if (s.bus && s.mode && s.phase != null && Array.isArray(s.boundaryIds)) {
    s.fence = s.fence ?? [];
    s.crossingCorner = s.crossingCorner ?? null;
    s.sessionExtendCount = s.sessionExtendCount ?? 0;
    return s as ExtendState;
  }
  if (!s.bus) throw new Error('EXTEND state missing CommandBus');
  const cfg = readSettings(s.bus);
  return {
    bus: s.bus,
    mode: s.mode ?? cfg.mode,
    edgeMode: s.edgeMode ?? cfg.edgeMode,
    projectMode: s.projectMode ?? cfg.projectMode,
    boundaryIds: s.boundaryIds ?? [],
    useAllBoundaries: s.useAllBoundaries ?? cfg.mode === 'quick',
    phase:
      s.phase ?? (cfg.mode === 'standard' ? 'boundaries' : 'targets'),
    fence: s.fence ?? [],
    crossingCorner: s.crossingCorner ?? null,
    sessionExtendCount: s.sessionExtendCount ?? 0,
  };
}

function restoreBoundaryHighlight(s: ExtendState): void {
  s.bus.updateWithoutHistory((d) =>
    setSelection(d, s.useAllBoundaries || s.mode === 'quick' ? [] : [...s.boundaryIds]),
  );
}

function runExtend(
  s: ExtendState,
  target: Entity,
  pickPoint: Vec2,
): ReturnType<CadEngineCommand['onPoint']> {
  if (!canExtendEntity(target)) {
    return {
      kind: 'reject',
      message:
        target.type === 'polyline' && target.geometry.closed
          ? 'Closed polyline cannot be extended'
          : `Cannot extend ${target.type}`,
      prompt: targetPrompt(s),
    };
  }
  if (!isEntityModifiable(s.bus.getDocument(), target)) {
    return {
      kind: 'reject',
      message: 'Locked layer — cannot extend',
      prompt: targetPrompt(s),
    };
  }

  const boundaries = resolveBoundaries(s).filter((b) => b.id !== target.id);
  if (!boundaries.length) {
    return {
      kind: 'reject',
      message: 'No boundary edges available',
      prompt: targetPrompt(s),
    };
  }

  try {
    s.bus.execute(
      new ExtendEntityCommand(target, boundaries, pickPoint, {
        edgeMode: s.edgeMode,
      }),
    );
    s.sessionExtendCount += 1;
    restoreBoundaryHighlight(s);
    return {
      kind: 'continue',
      prompt: targetPrompt(s),
      status: `${statusPrefix(s)}: Extended — select next (Shift=trim, Enter to finish):`,
      message: 'Extended',
      preview: null,
      dynamic: { label: statusPrefix(s) },
    };
  } catch (err) {
    return {
      kind: 'reject',
      message: err instanceof Error ? err.message : 'Extend failed',
      prompt: targetPrompt(s),
    };
  }
}

function runShiftTrim(
  s: ExtendState,
  target: Entity,
  pickPoint: Vec2,
): ReturnType<CadEngineCommand['onPoint']> {
  if (!canTrimEntity(target)) {
    return {
      kind: 'reject',
      message: `Cannot trim ${target.type}`,
      prompt: targetPrompt(s),
    };
  }
  if (!isEntityModifiable(s.bus.getDocument(), target)) {
    return {
      kind: 'reject',
      message: 'Locked layer — cannot trim',
      prompt: targetPrompt(s),
    };
  }
  const cutters = resolveBoundaries(s).filter((b) => b.id !== target.id);
  if (!cutters.length) {
    return {
      kind: 'reject',
      message: 'No cutting edges available',
      prompt: targetPrompt(s),
    };
  }
  try {
    s.bus.execute(
      new TrimEntityCommand(target, cutters, pickPoint, {
        edgeMode: s.edgeMode,
        projectMode: s.projectMode,
      }),
    );
    s.sessionExtendCount += 1;
    restoreBoundaryHighlight(s);
    return {
      kind: 'continue',
      prompt: targetPrompt(s),
      status: `${statusPrefix(s)}: Trimmed (Shift) — select next:`,
      message: 'Trimmed',
      preview: null,
      dynamic: { label: statusPrefix(s) },
    };
  } catch (err) {
    return {
      kind: 'reject',
      message: err instanceof Error ? err.message : 'Trim failed',
      prompt: targetPrompt(s),
    };
  }
}

function handleOption(
  s: ExtendState,
  optionId: string,
): ReturnType<CadEngineCommand['onText']> {
  switch (optionId) {
    case 'boundary':
      s.phase = 'boundaries';
      s.useAllBoundaries = false;
      s.mode = 'standard';
      persistModeSettings(s);
      s.bus.updateWithoutHistory((d) => setSelection(d, []));
      return {
        kind: 'continue',
        prompt: boundaryPrompt(),
        status: `${statusPrefix(s)}: Select boundary edges:`,
        message: 'Select boundary edges, then Enter',
        preview: null,
      };
    case 'fence':
      s.phase = 'fence';
      s.fence = [];
      return {
        kind: 'continue',
        prompt: {
          id: 'fence',
          message: 'Specify first fence point:',
          inputType: 'point',
          optional: true,
        },
        status: `${statusPrefix(s)}: Fence — specify points (Enter to extend):`,
        message: 'Fence selection (open path)',
        preview: null,
      };
    case 'crossing':
      s.phase = 'crossing';
      s.crossingCorner = null;
      return {
        kind: 'continue',
        prompt: {
          id: 'crossing',
          message: 'Specify first corner:',
          inputType: 'point',
        },
        status: `${statusPrefix(s)}: Crossing — specify opposite corners:`,
        preview: null,
      };
    case 'mode':
      s.phase = 'mode';
      return {
        kind: 'continue',
        prompt: {
          id: 'mode',
          message: 'Enter extend mode [Quick/Standard] <Quick>:',
          inputType: 'option',
          options: [
            { id: 'quick', label: 'Quick', aliases: ['Q', 'QUICK'] },
            { id: 'standard', label: 'Standard', aliases: ['S', 'STANDARD'] },
          ],
          defaultValue: s.mode === 'standard' ? 'Standard' : 'Quick',
          optional: true,
        },
        status: `${statusPrefix(s)}: Mode`,
        preview: null,
      };
    case 'undo':
      if (s.sessionExtendCount <= 0 || !s.bus.canUndo()) {
        return {
          kind: 'reject',
          message: 'Nothing to undo in this EXTEND session',
          prompt: targetPrompt(s),
        };
      }
      s.bus.undo();
      s.sessionExtendCount -= 1;
      restoreBoundaryHighlight(s);
      return {
        kind: 'continue',
        prompt: targetPrompt(s),
        status: `${statusPrefix(s)}: Undid last extend`,
        message: 'Undo',
        preview: null,
      };
    default:
      return {
        kind: 'reject',
        message: `Unknown option: ${optionId}`,
        prompt: targetPrompt(s),
      };
  }
}

function finishFence(s: ExtendState): ReturnType<CadEngineCommand['onText']> {
  const boundaries = resolveBoundaries(s);
  const crossed = entitiesCrossedByFence(
    s.bus.getDocument().entities,
    s.fence,
  );
  const seen = new Set<EntityId>();
  let count = 0;
  let skipped = 0;
  for (const target of crossed) {
    if (seen.has(target.id)) continue;
    seen.add(target.id);
    if (!canExtendEntity(target)) {
      skipped += 1;
      continue;
    }
    if (!isEntityModifiable(s.bus.getDocument(), target)) {
      skipped += 1;
      continue;
    }
    // Standard mode: never extend an explicitly selected boundary edge.
    // Quick mode uses all geometry as boundaries — do not skip targets for that.
    if (!s.useAllBoundaries && s.boundaryIds.includes(target.id)) {
      skipped += 1;
      continue;
    }
    const pick = fencePickPoint(target, s.fence);
    if (!pick) {
      skipped += 1;
      continue;
    }
    const live = getEntity(s.bus.getDocument(), target.id);
    if (!live) {
      skipped += 1;
      continue;
    }
    try {
      s.bus.execute(
        new ExtendEntityCommand(live, boundaries.filter((b) => b.id !== live.id), pick, {
          edgeMode: s.edgeMode,
        }),
      );
      count += 1;
      s.sessionExtendCount += 1;
    } catch {
      skipped += 1;
    }
  }
  s.fence = [];
  const msg =
    count > 0
      ? `Fence extended ${count} object(s)${skipped ? `, skipped ${skipped}` : ''}`
      : 'Fence: nothing extended';
  return beginTargets(s, msg);
}

function entityIntersectsBox(
  e: Entity,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): boolean {
  if (e.type === 'line' || e.type === 'wall') {
    const { start: a, end: b } = e.geometry;
    const sx0 = Math.min(a.x, b.x);
    const sx1 = Math.max(a.x, b.x);
    const sy0 = Math.min(a.y, b.y);
    const sy1 = Math.max(a.y, b.y);
    return !(sx1 < minX || sx0 > maxX || sy1 < minY || sy0 > maxY);
  }
  if (e.type === 'polyline') {
    const v = e.geometry.vertices;
    for (let i = 0; i < v.length - (e.geometry.closed ? 0 : 1); i += 1) {
      const a = v[i]!;
      const b = v[(i + 1) % v.length]!;
      const sx0 = Math.min(a.x, b.x);
      const sx1 = Math.max(a.x, b.x);
      const sy0 = Math.min(a.y, b.y);
      const sy1 = Math.max(a.y, b.y);
      if (!(sx1 < minX || sx0 > maxX || sy1 < minY || sy0 > maxY)) return true;
    }
    return false;
  }
  return false;
}

/** Ordered endpoint picks for Crossing EXTEND (near box center first, then other). */
function crossingPicksForExtend(e: Entity, boxCenter: Vec2): Vec2[] {
  if (e.type === 'line' || e.type === 'wall') {
    const { start, end } = e.geometry;
    return distance2(boxCenter, start) <= distance2(boxCenter, end)
      ? [{ ...start }, { ...end }]
      : [{ ...end }, { ...start }];
  }
  if (e.type === 'polyline' && e.geometry.vertices.length >= 2) {
    const v = e.geometry.vertices;
    const first = v[0]!;
    const last = v[v.length - 1]!;
    return distance2(boxCenter, first) <= distance2(boxCenter, last)
      ? [{ ...first }, { ...last }]
      : [{ ...last }, { ...first }];
  }
  return [{ ...boxCenter }];
}

function distance2(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function finishCrossing(
  s: ExtendState,
  a: Vec2,
  b: Vec2,
): ReturnType<CadEngineCommand['onPoint']> {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  const boxCenter = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  const boundaries = resolveBoundaries(s);
  // Only exclude explicitly selected Standard-mode boundaries (not Quick all-geometry).
  const selectedBoundaryIds = new Set(
    s.useAllBoundaries ? [] : s.boundaryIds,
  );
  const doc = s.bus.getDocument();
  let count = 0;
  let skipped = 0;
  const seen = new Set<EntityId>();
  for (const e of doc.entities) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    if (!canExtendEntity(e)) {
      if (entityIntersectsBox(e, minX, minY, maxX, maxY)) skipped += 1;
      continue;
    }
    if (selectedBoundaryIds.has(e.id)) continue;
    if (!isEntityModifiable(doc, e)) {
      skipped += 1;
      continue;
    }
    if (!entityIntersectsBox(e, minX, minY, maxX, maxY)) continue;
    const live = getEntity(s.bus.getDocument(), e.id);
    if (!live) {
      skipped += 1;
      continue;
    }
    const bounds = boundaries.filter((x) => x.id !== live.id);
    let extended = false;
    // Try nearer endpoint first, then the other — Crossing windows often cover
    // the whole short segment so a single midpoint pick is ambiguous.
    for (const pick of crossingPicksForExtend(live, boxCenter)) {
      try {
        s.bus.execute(
          new ExtendEntityCommand(live, bounds, pick, {
            edgeMode: s.edgeMode,
          }),
        );
        count += 1;
        s.sessionExtendCount += 1;
        extended = true;
        break;
      } catch {
        // try alternate endpoint
      }
    }
    if (!extended) skipped += 1;
  }
  s.crossingCorner = null;
  const msg =
    count > 0
      ? `Crossing extended ${count} object(s)${skipped ? `, skipped ${skipped}` : ''}`
      : 'Crossing: nothing extended';
  return beginTargets(s, msg) as ReturnType<CadEngineCommand['onPoint']>;
}

export function initExtendCommandState(bus: CommandBus): Partial<ExtendState> {
  const cfg = readSettings(bus);
  return {
    bus,
    ...cfg,
    boundaryIds: [],
    useAllBoundaries: cfg.mode === 'quick',
    phase: cfg.mode === 'standard' ? 'boundaries' : 'targets',
    fence: [],
    crossingCorner: null,
    sessionExtendCount: 0,
  };
}

/** EXTEND — Quick/Standard interaction via CadCommandEngine. */
export const extendCommand: CadEngineCommand = {
  id: 'extend',
  name: 'EXTEND',
  aliases: ['EX'],
  description: 'Extend objects to meet boundary edges',
  tool: 'extend',
  category: 'Modify',
  keywords: ['extend', 'lengthen'],
  bootstrap: (bus) => {
    const init = initExtendCommandState(bus);
    if (init.mode === 'standard') {
      return {
        state: init,
        prompt: boundaryPrompt(),
        status: 'EXTEND — STANDARD: Select boundary edges:',
      };
    }
    return {
      state: init,
      prompt: targetPrompt(init as ExtendState),
      status: 'EXTEND — QUICK: Select object to extend:',
    };
  },
  start: () => ({
    prompt: {
      id: 'targets',
      message:
        'Select object to extend or [Fence/Crossing/Mode/Undo/Boundary]:',
      inputType: 'point',
      options: EXTEND_TARGET_OPTIONS,
      optional: true,
    },
    status: 'EXTEND — QUICK: Select object to extend:',
  }),
  onPoint: (point, prompt, _ctx, state) => {
    const s = ensureState(state);
    const shiftTrim = !!(state as { shiftKey?: boolean }).shiftKey;

    if (prompt.id === 'boundaries' || s.phase === 'boundaries') {
      const ent = pickEntityAt(s.bus, point);
      if (!ent || !isBoundaryEntity(ent)) {
        return {
          kind: 'reject',
          message: 'Select a supported boundary edge',
          prompt: boundaryPrompt(),
        };
      }
      if (!s.boundaryIds.includes(ent.id)) {
        s.boundaryIds.push(ent.id);
      }
      s.useAllBoundaries = false;
      s.bus.updateWithoutHistory((d) => setSelection(d, [...s.boundaryIds]));
      return {
        kind: 'continue',
        prompt: boundaryPrompt(),
        status: `${statusPrefix(s)}: ${s.boundaryIds.length} boundary edge(s) — Enter when done:`,
        message: 'Added boundary edge',
      };
    }

    if (prompt.id === 'fence' || s.phase === 'fence') {
      s.fence.push(point);
      return {
        kind: 'continue',
        prompt: {
          id: 'fence',
          message: 'Specify next fence point (Enter to extend):',
          inputType: 'point',
          optional: true,
        },
        status: `${statusPrefix(s)}: Fence point ${s.fence.length}`,
        lastPoint: point,
        preview: {
          kind: 'polyline',
          start: s.fence[0]!,
          end: point,
          vertices: s.fence,
        },
      };
    }

    if (prompt.id === 'crossing' || s.phase === 'crossing') {
      if (!s.crossingCorner) {
        s.crossingCorner = point;
        return {
          kind: 'continue',
          prompt: {
            id: 'crossing',
            message: 'Specify opposite corner:',
            inputType: 'point',
          },
          status: `${statusPrefix(s)}: Crossing — opposite corner:`,
          lastPoint: point,
        };
      }
      const a = s.crossingCorner;
      s.crossingCorner = null;
      return finishCrossing(s, a, point);
    }

    const target = pickEntityAt(s.bus, point);
    if (!target) {
      return {
        kind: 'reject',
        message: 'Select object to extend',
        prompt: targetPrompt(s),
      };
    }
    if (shiftTrim) {
      return runShiftTrim(s, target, point);
    }
    return runExtend(s, target, point);
  },
  onText: (text, prompt, _ctx, state) => {
    const s = ensureState(state);
    const trimmed = text.trim();
    const upper = trimmed.toUpperCase();

    if (
      ['boundary', 'fence', 'crossing', 'mode', 'undo'].includes(trimmed)
    ) {
      return handleOption(s, trimmed);
    }

    if (prompt.id === 'mode' || s.phase === 'mode') {
      if (!trimmed || upper === 'Q' || upper === 'QUICK') {
        s.mode = 'quick';
        s.useAllBoundaries = true;
        s.boundaryIds = [];
        persistModeSettings(s);
        s.bus.updateWithoutHistory((d) => setSelection(d, []));
        return beginTargets(s, 'Mode: Quick');
      }
      if (upper === 'S' || upper === 'STANDARD') {
        s.mode = 'standard';
        s.useAllBoundaries = false;
        persistModeSettings(s);
        s.phase = 'boundaries';
        s.bus.updateWithoutHistory((d) => setSelection(d, []));
        return {
          kind: 'continue',
          prompt: boundaryPrompt(),
          status: `${statusPrefix(s)}: Select boundary edges:`,
          message: 'Mode: Standard',
          preview: null,
        };
      }
      return {
        kind: 'reject',
        message: 'Enter Quick or Standard',
        prompt,
      };
    }

    if (prompt.id === 'boundaries' || s.phase === 'boundaries') {
      if (!trimmed) {
        const sel = s.bus.getDocument().selection;
        if (sel.length) {
          const seen = new Set<EntityId>();
          s.boundaryIds = [];
          for (const id of sel) {
            if (seen.has(id)) continue;
            const e = getEntity(s.bus.getDocument(), id);
            if (e && isBoundaryEntity(e)) {
              seen.add(id);
              s.boundaryIds.push(id);
            }
          }
        }
        if (s.boundaryIds.length === 0) {
          s.useAllBoundaries = true;
          return beginTargets(s, 'All objects used as boundary edges');
        }
        s.useAllBoundaries = false;
        return beginTargets(s, `${s.boundaryIds.length} boundary edge(s)`);
      }
      if (upper === 'M' || upper === 'MODE') return handleOption(s, 'mode');
      return {
        kind: 'reject',
        message: 'Select boundary edges, then press Enter',
        prompt: boundaryPrompt(),
      };
    }

    if (prompt.id === 'fence' || s.phase === 'fence') {
      if (!trimmed) {
        if (s.fence.length < 2) {
          return {
            kind: 'reject',
            message: 'Fence needs at least two points',
            prompt,
          };
        }
        return finishFence(s);
      }
      return handleOption(s, trimmed.toLowerCase());
    }

    if (prompt.id === 'targets' || s.phase === 'targets') {
      if (!trimmed) {
        return {
          kind: 'complete',
          status: `EXTEND complete (${s.sessionExtendCount} operation(s))`,
        };
      }
      return handleOption(s, trimmed.toLowerCase());
    }

    return { kind: 'reject', message: 'Invalid input', prompt };
  },
  onMove: (point, prompt, _ctx, state) => {
    const s = ensureState(state);
    const shiftTrim = !!(state as { shiftKey?: boolean }).shiftKey;

    if (prompt.id === 'fence' && s.fence.length) {
      return {
        preview: {
          kind: 'polyline',
          start: s.fence[0]!,
          end: point,
          vertices: [...s.fence, point],
        },
        previewEntities: null,
        dynamic: { label: `${statusPrefix(s)} · Fence` },
        status: `${statusPrefix(s)}: Fence point ${s.fence.length + 1}`,
      };
    }

    if (prompt.id === 'boundaries' || s.phase === 'boundaries') {
      return {
        preview: null,
        previewEntities: null,
        hideEntityIds: [],
        dynamic: { label: statusPrefix(s) },
        status: `${statusPrefix(s)}: Select boundary edges`,
      };
    }

    if (prompt.id !== 'targets' && s.phase !== 'targets') {
      return {
        preview: null,
        previewEntities: null,
        hideEntityIds: [],
        dynamic: { label: statusPrefix(s) },
        status: `${statusPrefix(s)}`,
      };
    }

    const boundaries = resolveBoundaries(s);

    if (shiftTrim) {
      const target = pickEntityAt(s.bus, point);
      if (!target || !canTrimEntity(target)) {
        return {
          preview: null,
          previewEntities: null,
          hideEntityIds: [],
          dynamic: { label: `${statusPrefix(s)} · SHIFT=TRIM` },
          status: `${statusPrefix(s)}: Shift — select object to trim`,
        };
      }
      const cutters = boundaries.filter((b) => b.id !== target.id);
      const removal = trimRemovalPreviewMulti(target, cutters, point, {
        edgeMode: s.edgeMode,
        projectMode: s.projectMode,
      });
      if (!removal) {
        return {
          preview: null,
          previewEntities: null,
          hideEntityIds: [],
          dynamic: { label: `${statusPrefix(s)} · SHIFT=TRIM` },
          status: `${statusPrefix(s)}: Shift — no valid trim`,
        };
      }
      return {
        preview: null,
        previewEntities: [removal],
        hideEntityIds: [target.id],
        dynamic: { label: `${statusPrefix(s)} · SHIFT=TRIM` },
        status: `${statusPrefix(s)}: Shift — click to trim`,
      };
    }

    const target = pickEntityAt(s.bus, point);
    if (!target || !canExtendEntity(target)) {
      return {
        preview: null,
        previewEntities: null,
        hideEntityIds: [],
        dynamic: { label: statusPrefix(s) },
        status: `${statusPrefix(s)}: Select object to extend`,
      };
    }

    const preview = extendPreviewMulti(
      target,
      boundaries.filter((b) => b.id !== target.id),
      point,
      { edgeMode: s.edgeMode, projectMode: s.projectMode },
    );

    if (!preview) {
      return {
        preview: null,
        previewEntities: null,
        hideEntityIds: [],
        dynamic: { label: statusPrefix(s) },
        status: `${statusPrefix(s)}: No valid extension`,
      };
    }

    return {
      preview: null,
      previewEntities: [preview],
      hideEntityIds: [target.id],
      dynamic: { label: `${statusPrefix(s)} · Click to extend` },
      status: `${statusPrefix(s)}: Click to extend`,
    };
  },
  onCancel: (state) => {
    const s = state as Partial<ExtendState>;
    s.fence = [];
    s.crossingCorner = null;
    if (s.bus) {
      s.bus.updateWithoutHistory((d) => setSelection(d, []));
    }
  },
};
