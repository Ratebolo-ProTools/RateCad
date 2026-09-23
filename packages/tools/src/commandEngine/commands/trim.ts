import type { CommandBus } from '@ratecad/commands';
import {
  DeleteEntitiesCommand,
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
  applyTrimExtend,
  canTrimEntity,
  entitiesCrossedByFence,
  fencePickPoint,
  trimEntityMulti,
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

type TrimPhase =
  | 'cutting-edges'
  | 'targets'
  | 'fence'
  | 'crossing'
  | 'erase'
  | 'mode'
  | 'edge'
  | 'project';

type TrimState = {
  bus: CommandBus;
  mode: TrimMode;
  edgeMode: EdgeMode;
  projectMode: ProjectMode;
  eraseUntrimmable: boolean;
  cuttingIds: EntityId[];
  /** All-objects cutters when Quick or Standard+Enter with empty selection. */
  useAllCutters: boolean;
  phase: TrimPhase;
  fence: Vec2[];
  crossingCorner: Vec2 | null;
  /** Successful trim count in this session (for in-command Undo). */
  sessionTrimCount: number;
  shiftExtend: boolean;
};

const TRIM_OPTIONS: CadCommandOption[] = [
  { id: 'cutting', label: 'Cutting edges', aliases: ['CE', 'CUTTING'] },
  { id: 'fence', label: 'Fence', aliases: ['F', 'FENCE'] },
  { id: 'crossing', label: 'Crossing', aliases: ['C', 'CROSSING'] },
  { id: 'mode', label: 'Mode', aliases: ['M', 'MODE'] },
  { id: 'project', label: 'Project', aliases: ['P', 'PROJECT'] },
  { id: 'edge', label: 'Edge', aliases: ['E', 'EDGE'] },
  { id: 'erase', label: 'Erase', aliases: ['ER', 'ERASE'] },
  { id: 'undo', label: 'Undo', aliases: ['U', 'UNDO'] },
];

function modeLabel(mode: TrimMode): string {
  return mode === 'quick' ? 'QUICK' : 'STANDARD';
}

function targetPrompt(s: TrimState): CadPromptDefinition {
  return {
    id: 'targets',
    message: `Select object to trim or [Fence/Crossing/Mode/Project/Edge/Erase/Undo]:`,
    inputType: 'point',
    options: TRIM_OPTIONS,
    optional: true,
  };
}

function cuttingPrompt(): CadPromptDefinition {
  return {
    id: 'cutting',
    message: 'Select cutting edges or [Mode/Project/Edge]:',
    inputType: 'entities',
    options: [
      { id: 'mode', label: 'Mode', aliases: ['M', 'MODE'] },
      { id: 'project', label: 'Project', aliases: ['P', 'PROJECT'] },
      { id: 'edge', label: 'Edge', aliases: ['E', 'EDGE'] },
    ],
    optional: true,
  };
}

function statusPrefix(s: TrimState): string {
  return `TRIM — ${modeLabel(s.mode)}`;
}

function readSettings(bus: CommandBus): {
  mode: TrimMode;
  edgeMode: EdgeMode;
  projectMode: ProjectMode;
  eraseUntrimmable: boolean;
} {
  const settings = bus.getDocument().settings;
  return {
    mode: settings.trimMode === 'standard' ? 'standard' : 'quick',
    edgeMode: settings.edgeMode === 'extend' ? 'extend' : 'no-extend',
    projectMode:
      settings.projectMode === 'ucs' || settings.projectMode === 'view'
        ? settings.projectMode
        : 'none',
    eraseUntrimmable: !!settings.trimEraseUntrimmable,
  };
}

function persistTrimSettings(s: TrimState): void {
  const doc = s.bus.getDocument();
  // Reuse units command pattern via direct settings patch without history noise —
  // use updateWithoutHistory for mode toggles during the session.
  s.bus.updateWithoutHistory((d) => ({
    ...d,
    settings: {
      ...d.settings,
      trimMode: s.mode,
      edgeMode: s.edgeMode,
      projectMode: s.projectMode,
      trimEraseUntrimmable: s.eraseUntrimmable,
    },
    meta: { ...d.meta, updatedAt: new Date().toISOString() },
  }));
  void doc;
}

function allVisibleCutters(bus: CommandBus): Entity[] {
  const doc = bus.getDocument();
  return doc.entities.filter((e) => {
    if (!e.visible) return false;
    const layer = doc.layers.find((l) => l.id === e.layerId);
    if (layer && !layer.visible) return false;
    return (
      e.type === 'line' ||
      e.type === 'polyline' ||
      e.type === 'rectangle' ||
      e.type === 'circle' ||
      e.type === 'wall'
    );
  });
}

function resolveCutters(s: TrimState): Entity[] {
  if (s.useAllCutters || s.mode === 'quick') {
    return allVisibleCutters(s.bus);
  }
  const doc = s.bus.getDocument();
  return s.cuttingIds
    .map((id) => getEntity(doc, id))
    .filter((e): e is Entity => !!e);
}

function pickEntityAt(
  bus: CommandBus,
  point: Vec2,
): Entity | null {
  const grid = bus.getDocument().settings.gridSize || 1;
  const tol = Math.max(grid * 0.35, 0.05);
  const id = hitTestDocument(bus.getDocument(), point, tol);
  if (!id) return null;
  return getEntity(bus.getDocument(), id) ?? null;
}

function beginTargets(
  s: TrimState,
  message?: string,
): ReturnType<CadEngineCommand['onText']> {
  s.phase = 'targets';
  s.fence = [];
  s.crossingCorner = null;
  return {
    kind: 'continue',
    prompt: targetPrompt(s),
    status: `${statusPrefix(s)}: Select object to trim:`,
    message: message ?? undefined,
    preview: null,
    dynamic: { label: statusPrefix(s) },
  };
}

function runTrimOrExtend(
  s: TrimState,
  target: Entity,
  pickPoint: Vec2,
  extend: boolean,
): ReturnType<CadEngineCommand['onPoint']> {
  if (!isEntityModifiable(s.bus.getDocument(), target)) {
    return {
      kind: 'reject',
      message: 'Locked layer — cannot trim',
      prompt: targetPrompt(s),
    };
  }

  const cutters = resolveCutters(s);
  if (!cutters.length) {
    return {
      kind: 'reject',
      message: 'No cutting edges available',
      prompt: targetPrompt(s),
    };
  }

  if (extend) {
    try {
      s.bus.execute(
        new ExtendEntityCommand(target, cutters, pickPoint, {
          edgeMode: s.edgeMode === 'no-extend' ? 'no-extend' : 'extend',
        }),
      );
      s.sessionTrimCount += 1;
      return {
        kind: 'continue',
        prompt: targetPrompt(s),
        status: `${statusPrefix(s)}: Extended — select next (Shift=extend):`,
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

  if (!canTrimEntity(target)) {
    if (s.eraseUntrimmable || s.phase === 'erase') {
      s.bus.execute(new DeleteEntitiesCommand([target.id]));
      s.sessionTrimCount += 1;
      return {
        kind: 'continue',
        prompt: targetPrompt(s),
        status: `${statusPrefix(s)}: Erased untrimmable object`,
        message: 'Object cannot be trimmed — erased',
        preview: null,
        dynamic: { label: statusPrefix(s) },
      };
    }
    return {
      kind: 'reject',
      message: 'Object cannot be trimmed. Use Erase option or enable trimEraseUntrimmable.',
      prompt: targetPrompt(s),
    };
  }

  const preview = trimEntityMulti(target, cutters, pickPoint, {
    edgeMode: s.edgeMode,
    projectMode: s.projectMode,
    allowSelfAsCutter: true,
  });
  if (!preview.ok) {
    return {
      kind: 'reject',
      message: preview.reason,
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
    s.sessionTrimCount += 1;
    return {
      kind: 'continue',
      prompt: targetPrompt(s),
      status: `${statusPrefix(s)}: Trimmed — select next (Esc to finish):`,
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
  s: TrimState,
  optionId: string,
): ReturnType<CadEngineCommand['onText']> {
  switch (optionId) {
    case 'cutting':
      s.phase = 'cutting-edges';
      s.useAllCutters = false;
      s.mode = 'standard';
      persistTrimSettings(s);
      s.bus.updateWithoutHistory((d) => setSelection(d, []));
      return {
        kind: 'continue',
        prompt: cuttingPrompt(),
        status: `${statusPrefix(s)}: Select cutting edges:`,
        message: 'Select cutting edges, then Enter',
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
        status: `${statusPrefix(s)}: Fence — specify points (Enter to trim):`,
        message: 'Fence selection (open path)',
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
      };
    case 'mode':
      s.phase = 'mode';
      return {
        kind: 'continue',
        prompt: {
          id: 'mode',
          message: 'Enter trim mode [Quick/Standard] <Quick>:',
          inputType: 'option',
          options: [
            { id: 'quick', label: 'Quick', aliases: ['Q', 'QUICK'] },
            { id: 'standard', label: 'Standard', aliases: ['S', 'STANDARD'] },
          ],
          defaultValue: s.mode === 'standard' ? 'Standard' : 'Quick',
          optional: true,
        },
        status: `${statusPrefix(s)}: Mode`,
      };
    case 'edge':
      s.phase = 'edge';
      return {
        kind: 'continue',
        prompt: {
          id: 'edge',
          message: 'Enter edge mode [Extend/No extend] <No extend>:',
          inputType: 'option',
          options: [
            { id: 'extend', label: 'Extend', aliases: ['E', 'EXTEND'] },
            { id: 'no-extend', label: 'No extend', aliases: ['N', 'NO'] },
          ],
          defaultValue: s.edgeMode === 'extend' ? 'Extend' : 'No extend',
          optional: true,
        },
        status: `${statusPrefix(s)}: Edge mode`,
      };
    case 'project':
      s.phase = 'project';
      return {
        kind: 'continue',
        prompt: {
          id: 'project',
          message: 'Enter projection mode [None/Ucs/View] <None>:',
          inputType: 'option',
          options: [
            { id: 'none', label: 'None', aliases: ['N', 'NONE'] },
            { id: 'ucs', label: 'Ucs', aliases: ['U', 'UCS'] },
            { id: 'view', label: 'View', aliases: ['V', 'VIEW'] },
          ],
          defaultValue: 'None',
          optional: true,
        },
        status: `${statusPrefix(s)}: Project mode (2D uses None)`,
      };
    case 'erase':
      s.phase = 'erase';
      return {
        kind: 'continue',
        prompt: {
          id: 'erase',
          message: 'Select objects to erase:',
          inputType: 'point',
          options: [{ id: 'undo', label: 'Undo', aliases: ['U', 'UNDO'] }],
          optional: true,
        },
        status: `${statusPrefix(s)}: Erase — select objects (Enter to return):`,
        message: 'Erase mode inside TRIM',
      };
    case 'undo':
      if (s.sessionTrimCount <= 0) {
        return {
          kind: 'reject',
          message: 'Nothing to undo in this TRIM session',
          prompt: targetPrompt(s),
        };
      }
      if (s.bus.canUndo()) {
        s.bus.undo();
        s.sessionTrimCount -= 1;
      }
      return {
        kind: 'continue',
        prompt: targetPrompt(s),
        status: `${statusPrefix(s)}: Undid last trim`,
        message: 'Undo',
      };
    default:
      return {
        kind: 'reject',
        message: `Unknown option: ${optionId}`,
        prompt: targetPrompt(s),
      };
  }
}

function finishFence(s: TrimState): ReturnType<CadEngineCommand['onText']> {
  const cutters = resolveCutters(s);
  const targets = entitiesCrossedByFence(
    s.bus.getDocument().entities,
    s.fence,
  );
  let count = 0;
  for (const target of targets) {
    if (!isEntityModifiable(s.bus.getDocument(), target)) continue;
    const pick = fencePickPoint(target, s.fence);
    if (!pick) continue;
    // Refresh entity from doc (prior trims may have changed it)
    const live = getEntity(s.bus.getDocument(), target.id);
    if (!live) continue;
    try {
      s.bus.execute(
        new TrimEntityCommand(live, cutters, pick, {
          edgeMode: s.edgeMode,
          projectMode: s.projectMode,
        }),
      );
      count += 1;
      s.sessionTrimCount += 1;
    } catch {
      // skip failures
    }
  }
  s.fence = [];
  return beginTargets(s, count ? `Fence trimmed ${count} object(s)` : 'Fence: nothing trimmed');
}

/** TRIM — AutoCAD-style Quick / Standard with shared TrimExtendEngine. */
export const trimCommand: CadEngineCommand = {
  id: 'trim',
  name: 'TRIM',
  aliases: ['TR'],
  description: 'Trim objects at cutting edges',
  tool: 'trim',
  category: 'Modify',
  keywords: ['trim', 'cut', 'shorten'],
  bootstrap: (bus) => {
    const init = initTrimCommandState(bus);
    if (init.mode === 'standard') {
      return {
        state: init,
        prompt: cuttingPrompt(),
        status: 'TRIM — STANDARD: Select cutting edges:',
      };
    }
    return {
      state: init,
      prompt: targetPrompt(init as TrimState),
      status: 'TRIM — QUICK: Select object to trim:',
    };
  },
  start: (_ctx) => {
    return {
      prompt: {
        id: 'targets',
        message:
          'Select object to trim or [Fence/Crossing/Mode/Project/Edge/Erase/Undo]:',
        inputType: 'point',
        options: TRIM_OPTIONS,
        optional: true,
      },
      status: 'TRIM — QUICK: Select object to trim:',
    };
  },
  onPoint: (point, prompt, _ctx, state) => {
    const s = state as TrimState;
    // Lazy-init settings on first interaction
    if (!s.mode) {
      const cfg = readSettings(s.bus);
      s.mode = cfg.mode;
      s.edgeMode = cfg.edgeMode;
      s.projectMode = cfg.projectMode;
      s.eraseUntrimmable = cfg.eraseUntrimmable;
      s.cuttingIds = s.cuttingIds ?? [];
      s.useAllCutters = s.mode === 'quick';
      s.sessionTrimCount = s.sessionTrimCount ?? 0;
      s.fence = s.fence ?? [];
      s.phase = s.mode === 'standard' ? 'cutting-edges' : 'targets';
    }

    // Shift+click → extend (set by engine submitPoint modifiers when available)
    const extend = !!(state as { shiftKey?: boolean }).shiftKey || s.shiftExtend;
    s.shiftExtend = false;

    if (prompt.id === 'cutting' || s.phase === 'cutting-edges') {
      // Selection clicks handled by App awaiting-entities path; point click also adds
      const ent = pickEntityAt(s.bus, point);
      if (ent) {
        if (!s.cuttingIds.includes(ent.id)) s.cuttingIds.push(ent.id);
        s.bus.updateWithoutHistory((d) => setSelection(d, s.cuttingIds));
        return {
          kind: 'continue',
          prompt: cuttingPrompt(),
          status: `${statusPrefix(s)}: ${s.cuttingIds.length} cutting edge(s) — Enter when done:`,
          message: `Added cutting edge`,
        };
      }
      return {
        kind: 'reject',
        message: 'Select a cutting edge',
        prompt: cuttingPrompt(),
      };
    }

    if (prompt.id === 'fence' || s.phase === 'fence') {
      s.fence.push(point);
      return {
        kind: 'continue',
        prompt: {
          id: 'fence',
          message: 'Specify next fence point (Enter to trim):',
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
      const b = point;
      s.crossingCorner = null;
      const minX = Math.min(a.x, b.x);
      const maxX = Math.max(a.x, b.x);
      const minY = Math.min(a.y, b.y);
      const maxY = Math.max(a.y, b.y);
      const cutters = resolveCutters(s);
      const doc = s.bus.getDocument();
      let count = 0;
      for (const e of doc.entities) {
        if (!canTrimEntity(e)) continue;
        if (!isEntityModifiable(doc, e)) continue;
        // Crossing: AABB intersects box
        const segs =
          e.type === 'circle'
            ? null
            : e.type === 'line' || e.type === 'wall'
              ? [{ a: e.geometry.start, b: e.geometry.end }]
              : null;
        let hit = false;
        if (e.type === 'circle') {
          const { center, radius } = e.geometry;
          const cx = Math.max(minX, Math.min(maxX, center.x));
          const cy = Math.max(minY, Math.min(maxY, center.y));
          hit =
            (center.x - cx) ** 2 + (center.y - cy) ** 2 <= radius * radius;
        } else if (segs) {
          for (const seg of segs) {
            const sx0 = Math.min(seg.a.x, seg.b.x);
            const sx1 = Math.max(seg.a.x, seg.b.x);
            const sy0 = Math.min(seg.a.y, seg.b.y);
            const sy1 = Math.max(seg.a.y, seg.b.y);
            if (!(sx1 < minX || sx0 > maxX || sy1 < minY || sy0 > maxY)) {
              hit = true;
              break;
            }
          }
        } else if (e.type === 'polyline' || e.type === 'rectangle') {
          // Approximate via entity presence in box using pick at box center projection
          hit = true; // refined below via trim attempt with pick at box center
        }
        if (!hit && e.type !== 'polyline' && e.type !== 'rectangle') continue;
        const live = getEntity(s.bus.getDocument(), e.id);
        if (!live) continue;
        const pick = {
          x: (minX + maxX) / 2,
          y: (minY + maxY) / 2,
        };
        // Prefer a point on the entity near the box
        const tryPick =
          live.type === 'line' || live.type === 'wall'
            ? {
                x: Math.max(
                  minX,
                  Math.min(maxX, (live.geometry.start.x + live.geometry.end.x) / 2),
                ),
                y: Math.max(
                  minY,
                  Math.min(maxY, (live.geometry.start.y + live.geometry.end.y) / 2),
                ),
              }
            : pick;
        try {
          s.bus.execute(
            new TrimEntityCommand(live, cutters, tryPick, {
              edgeMode: s.edgeMode,
              projectMode: s.projectMode,
            }),
          );
          count += 1;
          s.sessionTrimCount += 1;
        } catch {
          // skip
        }
      }
      return beginTargets(
        s,
        count ? `Crossing trimmed ${count} object(s)` : 'Crossing: nothing trimmed',
      );
    }

    if (prompt.id === 'erase' || s.phase === 'erase') {
      const ent = pickEntityAt(s.bus, point);
      if (!ent) {
        return {
          kind: 'reject',
          message: 'Select object to erase',
          prompt: {
            id: 'erase',
            message: 'Select objects to erase:',
            inputType: 'point',
            optional: true,
          },
        };
      }
      if (!isEntityModifiable(s.bus.getDocument(), ent)) {
        return {
          kind: 'reject',
          message: 'Locked — cannot erase',
          prompt: {
            id: 'erase',
            message: 'Select objects to erase:',
            inputType: 'point',
            optional: true,
          },
        };
      }
      s.bus.execute(new DeleteEntitiesCommand([ent.id]));
      s.sessionTrimCount += 1;
      return {
        kind: 'continue',
        prompt: {
          id: 'erase',
          message: 'Select objects to erase (Enter to return):',
          inputType: 'point',
          optional: true,
        },
        status: `${statusPrefix(s)}: Erased — select next:`,
        message: 'Erased',
      };
    }

    // Default: trim target
    const target = pickEntityAt(s.bus, point);
    if (!target) {
      return {
        kind: 'reject',
        message: 'Select object to trim',
        prompt: targetPrompt(s),
      };
    }
    return runTrimOrExtend(s, target, point, extend);
  },
  onText: (text, prompt, _ctx, state) => {
    const s = state as TrimState;
    if (!s.mode) {
      const cfg = readSettings(s.bus);
      Object.assign(s, {
        ...cfg,
        cuttingIds: [],
        useAllCutters: cfg.mode === 'quick',
        sessionTrimCount: 0,
        fence: [],
        phase: cfg.mode === 'standard' ? 'cutting-edges' : 'targets',
      });
    }

    const trimmed = text.trim();
    const upper = trimmed.toUpperCase();

    // Option ids from engine matchOption
    if (
      [
        'cutting',
        'fence',
        'crossing',
        'mode',
        'project',
        'edge',
        'erase',
        'undo',
      ].includes(trimmed)
    ) {
      return handleOption(s, trimmed);
    }

    if (prompt.id === 'mode') {
      if (!trimmed || upper === 'Q' || upper === 'QUICK') {
        s.mode = 'quick';
        s.useAllCutters = true;
        persistTrimSettings(s);
        return beginTargets(s, 'Mode: Quick');
      }
      if (upper === 'S' || upper === 'STANDARD') {
        s.mode = 'standard';
        s.useAllCutters = false;
        persistTrimSettings(s);
        s.phase = 'cutting-edges';
        return {
          kind: 'continue',
          prompt: cuttingPrompt(),
          status: `${statusPrefix(s)}: Select cutting edges:`,
          message: 'Mode: Standard',
        };
      }
      return {
        kind: 'reject',
        message: 'Enter Quick or Standard',
        prompt,
      };
    }

    if (prompt.id === 'edge') {
      if (!trimmed || upper === 'N' || upper.startsWith('NO')) {
        s.edgeMode = 'no-extend';
        persistTrimSettings(s);
        return beginTargets(s, 'Edge: No extend');
      }
      if (upper === 'E' || upper === 'EXTEND') {
        s.edgeMode = 'extend';
        persistTrimSettings(s);
        return beginTargets(s, 'Edge: Extend');
      }
      return { kind: 'reject', message: 'Enter Extend or No extend', prompt };
    }

    if (prompt.id === 'project') {
      if (!trimmed || upper === 'N' || upper === 'NONE') {
        s.projectMode = 'none';
      } else if (upper === 'U' || upper === 'UCS') {
        s.projectMode = 'ucs';
      } else if (upper === 'V' || upper === 'VIEW') {
        s.projectMode = 'view';
      } else {
        return { kind: 'reject', message: 'Enter None, Ucs, or View', prompt };
      }
      persistTrimSettings(s);
      return beginTargets(
        s,
        `Project: ${s.projectMode} (2D uses world XY)`,
      );
    }

    if (prompt.id === 'cutting') {
      if (!trimmed) {
        // Sync selection from document (canvas selection while awaiting entities)
        const sel = s.bus.getDocument().selection;
        if (sel.length) {
          s.cuttingIds = [...sel];
        }
        if (s.cuttingIds.length === 0) {
          s.useAllCutters = true;
          return beginTargets(s, 'All objects used as cutting edges');
        }
        s.useAllCutters = false;
        return beginTargets(
          s,
          `${s.cuttingIds.length} cutting edge(s)`,
        );
      }
      return handleOption(s, trimmed.toLowerCase());
    }

    if (prompt.id === 'fence') {
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

    if (prompt.id === 'erase') {
      if (!trimmed) return beginTargets(s, 'Returned from Erase');
      if (trimmed === 'undo') return handleOption(s, 'undo');
      return { kind: 'reject', message: 'Click objects to erase, or Enter', prompt };
    }

    if (prompt.id === 'targets') {
      if (!trimmed) {
        // Enter finishes TRIM
        return {
          kind: 'complete',
          status: `TRIM complete (${s.sessionTrimCount} operation(s))`,
        };
      }
      return handleOption(s, trimmed.toLowerCase());
    }

    return { kind: 'reject', message: 'Invalid input', prompt };
  },
  onMove: (point, prompt, _ctx, state) => {
    const s = state as TrimState;
    if (!s.mode) {
      const cfg = readSettings(s.bus);
      Object.assign(s, {
        ...cfg,
        cuttingIds: [],
        useAllCutters: cfg.mode === 'quick',
        sessionTrimCount: 0,
        fence: [],
        phase: 'targets',
      });
    }

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

    if (prompt.id !== 'targets' && s.phase !== 'targets') {
      return {
        preview: null,
        previewEntities: null,
        dynamic: { label: statusPrefix(s) },
        status: `${statusPrefix(s)}`,
      };
    }

    const target = pickEntityAt(s.bus, point);
    if (!target || !canTrimEntity(target)) {
      return {
        preview: null,
        previewEntities: null,
        hideEntityIds: [],
        dynamic: { label: statusPrefix(s) },
        status: `${statusPrefix(s)}: Select object to trim`,
      };
    }

    const cutters = resolveCutters(s);
    const result = applyTrimExtend(
      target,
      cutters,
      { objectId: target.id, worldPoint: point },
      {
        operation: 'trim',
        edgeMode: s.edgeMode,
        projectMode: s.projectMode,
        allowSelfAsCutter: true,
      },
    );
    const removal = trimRemovalPreviewMulti(target, cutters, point, {
      edgeMode: s.edgeMode,
      projectMode: s.projectMode,
    });

    if (!result.ok) {
      return {
        preview: null,
        previewEntities: removal ? [removal] : null,
        hideEntityIds: [],
        dynamic: { label: statusPrefix(s) },
        status: `${statusPrefix(s)}: ${result.reason}`,
      };
    }

    return {
      preview: null,
      previewEntities: [
        ...(removal ? [removal] : []),
        ...result.entities.map(
          (e) =>
            ({
              ...e,
              properties: { ...e.properties, color: '#7eb6ff' },
            }) as Entity,
        ),
      ],
      hideEntityIds: [target.id],
      dynamic: { label: `${statusPrefix(s)} · Click to trim` },
      status: `${statusPrefix(s)}: Click to trim`,
    };
  },
  onCancel: (state) => {
    const s = state as TrimState;
    s.fence = [];
    s.crossingCorner = null;
    s.bus.updateWithoutHistory((d) => setSelection(d, []));
  },
};

/** Seed TrimState when the engine starts the command. */
export function initTrimCommandState(bus: CommandBus): Partial<TrimState> {
  const cfg = readSettings(bus);
  return {
    bus,
    ...cfg,
    cuttingIds: [],
    useAllCutters: cfg.mode === 'quick',
    phase: cfg.mode === 'standard' ? 'cutting-edges' : 'targets',
    fence: [],
    crossingCorner: null,
    sessionTrimCount: 0,
    shiftExtend: false,
  };
}
