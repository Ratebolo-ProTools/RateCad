import type { CommandBus } from '@ratecad/commands';
import {
  BatchCommand,
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
  CIRCLE_TRIM_UNSUPPORTED,
  applyTrimExtend,
  canExtendEntity,
  canTrimEntity,
  crossingTrimPick,
  distance,
  resolveRectSelectMode,
  entitiesCrossedByFence,
  extendPreviewMulti,
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
  | 'hover-preview'
  | 'fence'
  | 'crossing'
  | 'freehand'
  | 'erase'
  | 'untrimmable'
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
  /** First empty click of a two-point fence. Not stored on the document. */
  pendingFence: Vec2 | null;
  /** In-progress freehand path. Not stored on the document. */
  freehand: Vec2[];
  hoveredEntityId: EntityId | null;
  pickPosition: Vec2 | null;
  crossingCorner: Vec2 | null;
  /** Successful trim operations in this session (a batch counts as one). */
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
  { id: 'untrimmable', label: 'Untrimmable', aliases: ['UT'] },
  { id: 'undo', label: 'Undo', aliases: ['U', 'UNDO'] },
];

function modeLabel(mode: TrimMode): string {
  return mode === 'quick' ? 'QUICK' : 'STANDARD';
}

function targetPrompt(s: TrimState): CadPromptDefinition {
  return {
    id: 'targets',
    message:
      'Select object to trim, drag freehand, or [Fence/Crossing/Mode/Project/Edge/Erase/Untrimmable/Undo]:',
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

/** Keep rejects and Undo on the prompt for the current phase. */
function promptForPhase(s: TrimState): CadPromptDefinition {
  if (s.phase === 'cutting-edges') return cuttingPrompt();
  if (s.phase === 'fence') {
    return {
      id: 'fence',
      message: 'Specify next fence point:',
      inputType: 'point',
      optional: true,
    };
  }
  if (s.phase === 'crossing') {
    return {
      id: 'crossing',
      message: s.crossingCorner
        ? 'Specify opposite corner:'
        : 'Specify first corner:',
      inputType: 'point',
    };
  }
  return targetPrompt(s);
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
  if (target.type === 'block') {
    return {
      kind: 'reject',
      message: extend
        ? 'Block references cannot be extended'
        : 'Block references cannot be trimmed',
      prompt: targetPrompt(s),
    };
  }
  if (!isEntityModifiable(s.bus.getDocument(), target)) {
    const layer = s.bus.getDocument().layers.find((l) => l.id === target.layerId);
    return {
      kind: 'reject',
      message:
        layer && !layer.visible
          ? 'Hidden layer — cannot trim'
          : 'Locked layer — cannot trim',
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
    if (shouldEraseFailedTrim(s, preview.reason)) {
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
      message: trimFailureMessage(preview.reason),
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
    case 'untrimmable':
      s.phase = 'untrimmable';
      return {
        kind: 'continue',
        prompt: {
          id: 'untrimmable',
          message: 'Erase objects that cannot be trimmed? [Yes/No] <No>:',
          inputType: 'option',
          options: [
            { id: 'yes', label: 'Yes', aliases: ['Y', 'YES'] },
            { id: 'no', label: 'No', aliases: ['N', 'NO'] },
          ],
          defaultValue: s.eraseUntrimmable ? 'Yes' : 'No',
          optional: true,
        },
        status: `${statusPrefix(s)}: Erase non-trimmable objects`,
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
        prompt: promptForPhase(s),
        status: `${statusPrefix(s)}: Undid last trim`,
        message: 'Undo',
      };
    default:
      return {
        kind: 'reject',
        message: `Unknown option: ${optionId}`,
        prompt: promptForPhase(s),
      };
  }
}

function boundaryMiss(reason: string): boolean {
  return /no intersection|no cutting|parallel|collinear|no valid trim/i.test(
    reason,
  );
}

function trimFailureMessage(reason: string): string {
  return boundaryMiss(reason) ? `No valid trim boundary. ${reason}` : reason;
}

function shouldEraseFailedTrim(s: TrimState, reason: string): boolean {
  return s.mode === 'quick' && s.eraseUntrimmable && boundaryMiss(reason);
}

function ensureTrimState(state: Record<string, unknown>): TrimState {
  const s = state as TrimState;
  if (!s.mode) {
    const cfg = readSettings(s.bus);
    s.mode = cfg.mode;
    s.edgeMode = cfg.edgeMode;
    s.projectMode = cfg.projectMode;
    s.eraseUntrimmable = cfg.eraseUntrimmable;
    s.cuttingIds = [];
    s.useAllCutters = s.mode === 'quick';
    s.sessionTrimCount = 0;
    s.fence = [];
    s.phase = s.mode === 'standard' ? 'cutting-edges' : 'targets';
  }
  s.cuttingIds = s.cuttingIds ?? [];
  s.fence = s.fence ?? [];
  s.freehand = s.freehand ?? [];
  s.pendingFence = s.pendingFence ?? null;
  s.hoveredEntityId = s.hoveredEntityId ?? null;
  s.sessionTrimCount = s.sessionTrimCount ?? 0;
  return s;
}

/** One undo step for every object changed by a fence, crossing, or freehand pass. */
function commitTrimBatch(
  s: TrimState,
  jobs: Array<{ target: Entity; pick: Vec2 }>,
): number {
  const cutters = resolveCutters(s);
  const commands: Array<TrimEntityCommand | DeleteEntitiesCommand> = [];
  const seen = new Set<EntityId>();
  for (const job of jobs) {
    if (seen.has(job.target.id)) continue;
    seen.add(job.target.id);
    const live = getEntity(s.bus.getDocument(), job.target.id) ?? job.target;
    if (live.type === 'block') continue;
    if (!isEntityModifiable(s.bus.getDocument(), live)) continue;
    if (!canTrimEntity(live)) {
      if (shouldEraseFailedTrim(s, 'No intersection with cutting edge')) {
        commands.push(new DeleteEntitiesCommand([live.id]));
      }
      continue;
    }
    try {
      commands.push(
        new TrimEntityCommand(live, cutters, job.pick, {
          edgeMode: s.edgeMode,
          projectMode: s.projectMode,
        }),
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'Trim failed';
      if (shouldEraseFailedTrim(s, reason)) {
        commands.push(new DeleteEntitiesCommand([live.id]));
      }
    }
  }
  if (!commands.length) return 0;
  s.bus.execute(
    commands.length === 1 ? commands[0]! : new BatchCommand(commands),
  );
  s.sessionTrimCount += 1;
  return commands.length;
}

function finishFence(s: TrimState): ReturnType<CadEngineCommand['onText']> {
  const targets = entitiesCrossedByFence(
    s.bus.getDocument().entities,
    s.fence,
  );
  const jobs: Array<{ target: Entity; pick: Vec2 }> = [];
  for (const target of targets) {
    const pick = fencePickPoint(target, s.fence);
    if (!pick) continue;
    jobs.push({ target, pick });
  }
  s.fence = [];
  s.freehand = [];
  s.pendingFence = null;
  const count = commitTrimBatch(s, jobs);
  return beginTargets(
    s,
    count
      ? `Fence trimmed ${count} object(s)`
      : 'No valid trim boundary. Fence: nothing trimmed',
  );
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
      status: 'TRIM — QUICK: Click, drag freehand, or pick two empty points:',
    };
  },
  start: (_ctx) => {
    return {
      prompt: {
        id: 'targets',
        message: targetPrompt({} as TrimState).message,
        inputType: 'point',
        options: TRIM_OPTIONS,
        optional: true,
      },
      status: 'TRIM — QUICK: Click, drag freehand, or pick two empty points:',
    };
  },
  onPoint: (point, prompt, _ctx, state) => {
    const s = ensureTrimState(state);

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
      const mode = resolveRectSelectMode(a, b);
      const doc = s.bus.getDocument();
      const jobs: Array<{ target: Entity; pick: Vec2 }> = [];
      let sawCircle = false;
      for (const e of doc.entities) {
        if (!canTrimEntity(e)) continue;
        if (!isEntityModifiable(doc, e)) continue;
        const pick = crossingTrimPick(e, a, b, mode);
        if (!pick) continue;
        if (e.type === 'circle') {
          sawCircle = true;
          continue;
        }
        const live = getEntity(s.bus.getDocument(), e.id);
        if (!live || live.type === 'circle') continue;
        jobs.push({ target: live, pick });
      }
      const count = commitTrimBatch(s, jobs);
      const message = count
        ? mode === 'window'
          ? `Window trimmed ${count} object(s)`
          : `Crossing trimmed ${count} object(s)`
        : sawCircle
          ? CIRCLE_TRIM_UNSUPPORTED
          : mode === 'window'
            ? 'Window: nothing fully inside'
            : 'No valid trim boundary. Crossing: nothing trimmed';
      return beginTargets(s, message);
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

    // Default: trim target. Two clicks in empty space define a fence.
    const target = pickEntityAt(s.bus, point);
    if (!target) {
      if (extend) {
        return {
          kind: 'reject',
          message: 'Select object to extend',
          prompt: targetPrompt(s),
        };
      }
      if (!s.pendingFence) {
        s.pendingFence = point;
        return {
          kind: 'continue',
          prompt: targetPrompt(s),
          status: `${statusPrefix(s)}: Specify second fence point:`,
          message: 'Two-point fence',
          lastPoint: point,
        };
      }
      const first = s.pendingFence;
      s.pendingFence = null;
      s.fence = [first, point];
      return finishFence(s);
    }
    s.pendingFence = null;
    return runTrimOrExtend(s, target, point, extend);
  },
  onText: (text, prompt, _ctx, state) => {
    const s = ensureTrimState(state);

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
        'untrimmable',
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

    if (prompt.id === 'untrimmable') {
      if (!trimmed || upper === 'N' || upper.startsWith('NO')) {
        s.eraseUntrimmable = false;
        persistTrimSettings(s);
        return beginTargets(s, 'Erase non-trimmable objects: Off');
      }
      if (upper === 'Y' || upper.startsWith('YES')) {
        s.eraseUntrimmable = true;
        persistTrimSettings(s);
        return beginTargets(s, 'Erase non-trimmable objects: On');
      }
      return {
        kind: 'reject',
        message: 'Enter Yes or No',
        prompt,
      };
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
  acceptsPointerStroke: (prompt) => prompt.id === 'targets',
  onStrokeStart: (point, _prompt, _ctx, state) => {
    const s = ensureTrimState(state);
    s.freehand = [point];
    s.phase = 'targets';
  },
  onStrokeMove: (point, _prompt, _ctx, state) => {
    const s = ensureTrimState(state);
    const last = s.freehand[s.freehand.length - 1];
    if (!last || distance(last, point) > 1e-6) s.freehand.push(point);
    s.phase = 'freehand';
    const start = s.freehand[0] ?? point;
    return {
      preview: {
        kind: 'polyline',
        start,
        end: point,
        vertices: s.freehand,
      },
      previewEntities: null,
      hideEntityIds: [],
      dynamic: { label: `${statusPrefix(s)} · Freehand` },
      status: `${statusPrefix(s)}: Freehand — release to trim`,
    };
  },
  onStrokeEnd: (point, _prompt, _ctx, state) => {
    const s = ensureTrimState(state);
    const last = s.freehand[s.freehand.length - 1];
    if (!last || distance(last, point) > 1e-6) s.freehand.push(point);
    s.fence = s.freehand.length >= 2 ? [...s.freehand] : [];
    s.freehand = [];
    s.phase = 'targets';
    if (s.fence.length < 2) {
      return {
        kind: 'reject',
        message: 'Select object to trim',
        prompt: targetPrompt(s),
      };
    }
    return finishFence(s);
  },
  onMove: (point, prompt, _ctx, state) => {
    const s = ensureTrimState(state);

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

    const shiftExtend =
      !!(state as { shiftKey?: boolean }).shiftKey || s.shiftExtend;
    const cutters = resolveCutters(s);

    // Shift+hover → temporary EXTEND preview (same planners as commit).
    if (shiftExtend) {
      const target = pickEntityAt(s.bus, point);
      if (!target || !canExtendEntity(target)) {
        return {
          preview: null,
          previewEntities: null,
          hideEntityIds: [],
          dynamic: { label: `${statusPrefix(s)} · SHIFT=EXTEND` },
          status: `${statusPrefix(s)}: Shift — select object to extend`,
        };
      }
      const boundaries = cutters.filter((c) => c.id !== target.id);
      const preview = extendPreviewMulti(target, boundaries, point, {
        edgeMode: s.edgeMode === 'no-extend' ? 'no-extend' : 'extend',
        projectMode: s.projectMode,
      });
      if (!preview) {
        return {
          preview: null,
          previewEntities: null,
          hideEntityIds: [],
          dynamic: { label: `${statusPrefix(s)} · SHIFT=EXTEND` },
          status: `${statusPrefix(s)}: Shift — no valid extension`,
        };
      }
      return {
        preview: null,
        previewEntities: [preview],
        hideEntityIds: [target.id],
        dynamic: { label: `${statusPrefix(s)} · SHIFT=EXTEND` },
        status: `${statusPrefix(s)}: Shift — click to extend`,
      };
    }

    const target = pickEntityAt(s.bus, point);
    s.pickPosition = point;
    if (!target || !canTrimEntity(target)) {
      s.hoveredEntityId = null;
      if (s.phase === 'hover-preview') s.phase = 'targets';
      return {
        preview: null,
        previewEntities: null,
        hideEntityIds: [],
        dynamic: { label: statusPrefix(s) },
        status: `${statusPrefix(s)}: Select object to trim`,
      };
    }
    s.hoveredEntityId = target.id;
    s.phase = 'hover-preview';

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
        status: `${statusPrefix(s)}: ${trimFailureMessage(result.reason)}`,
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
    s.freehand = [];
    s.pendingFence = null;
    s.hoveredEntityId = null;
    s.pickPosition = null;
    s.crossingCorner = null;
    s.phase = 'targets';
    if (s.bus) s.bus.updateWithoutHistory((d) => setSelection(d, []));
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
    pendingFence: null,
    freehand: [],
    hoveredEntityId: null,
    pickPosition: null,
    crossingCorner: null,
    sessionTrimCount: 0,
    shiftExtend: false,
  };
}
