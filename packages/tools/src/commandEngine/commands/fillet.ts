import type { CommandBus } from '@ratecad/commands';
import { FilletEntitiesCommand } from '@ratecad/commands';
import {
  createEntityId,
  getEntity,
  isEntityModifiable,
  setSelection,
  type Entity,
  type EntityId,
  type Vec2,
} from '@ratecad/core';
import {
  computeFillet,
  filletPolylineAll,
  formatWorldLength,
  parseLength,
  validateFilletResult,
  type FilletComputeResult,
} from '@ratecad/geometry';
import { hitTestDocument } from '@ratecad/viewport';
import type {
  CadCommandOption,
  CadEngineCommand,
  CadPromptDefinition,
} from '../types.js';

type FilletPhase =
  | 'first'
  | 'second'
  | 'radius'
  | 'trim'
  | 'polyline';

type FilletState = {
  bus: CommandBus;
  radius: number;
  trim: boolean;
  multiple: boolean;
  phase: FilletPhase;
  first: { id: EntityId; point: Vec2 } | null;
  sessionCount: number;
  shiftZero: boolean;
};

const FILLET_OPTIONS: CadCommandOption[] = [
  { id: 'radius', label: 'Radius', aliases: ['R', 'RADIUS'] },
  { id: 'polyline', label: 'Polyline', aliases: ['P', 'POLYLINE'] },
  { id: 'trim', label: 'Trim', aliases: ['T', 'TRIM'] },
  { id: 'multiple', label: 'Multiple', aliases: ['M', 'MULTIPLE'] },
  { id: 'undo', label: 'Undo', aliases: ['U', 'UNDO'] },
];

function fmtRadius(bus: CommandBus, radius: number): string {
  const s = bus.getDocument().settings;
  return formatWorldLength(radius, s.worldUnit ?? 'ft', s.units, {
    precision: s.precision ?? 2,
    fractionDenominator: ([1, 2, 4, 8, 16, 32].includes(s.fractionDenominator)
      ? s.fractionDenominator
      : 16) as 1 | 2 | 4 | 8 | 16 | 32,
  });
}

function statusPrefix(s: FilletState): string {
  const trimLabel = s.trim ? 'Trim' : 'No trim';
  return `FILLET · r=${fmtRadius(s.bus, s.radius)} · ${trimLabel}${s.multiple ? ' · Multiple' : ''}`;
}

function firstPrompt(): CadPromptDefinition {
  return {
    id: 'first',
    message: 'Select first object or [Radius/Polyline/Trim/Multiple/Undo]:',
    inputType: 'point',
    options: FILLET_OPTIONS,
    optional: true,
  };
}

function secondPrompt(): CadPromptDefinition {
  return {
    id: 'second',
    message: 'Select second object or [Radius/Polyline/Trim/Multiple/Undo]:',
    inputType: 'point',
    options: FILLET_OPTIONS,
    optional: true,
  };
}

function readSettings(bus: CommandBus): { radius: number; trim: boolean } {
  const s = bus.getDocument().settings;
  return {
    radius:
      typeof s.filletRadius === 'number' && s.filletRadius >= 0
        ? s.filletRadius
        : 0,
    trim: s.filletTrim !== false,
  };
}

function persistSettings(s: FilletState): void {
  s.bus.updateWithoutHistory((d) => ({
    ...d,
    settings: {
      ...d.settings,
      filletRadius: s.radius,
      filletTrim: s.trim,
    },
    meta: { ...d.meta, updatedAt: new Date().toISOString() },
  }));
}

function pickEntityAt(bus: CommandBus, point: Vec2): Entity | null {
  const grid = bus.getDocument().settings.gridSize || 1;
  const tol = Math.max(grid * 0.35, 0.05);
  const id = hitTestDocument(bus.getDocument(), point, tol);
  if (!id) return null;
  return getEntity(bus.getDocument(), id) ?? null;
}

function parseRadiusText(
  text: string,
  bus: CommandBus,
): { ok: true; value: number } | { ok: false; error: string } {
  const doc = bus.getDocument();
  const parsed = parseLength(
    text,
    doc.settings.worldUnit ?? 'ft',
    doc.settings.units,
  );
  if (!parsed || !(parsed.worldValue >= 0) || !Number.isFinite(parsed.worldValue)) {
    return { ok: false, error: 'Enter a non-negative length (e.g. 0.5, 500mm, 1\')' };
  }
  return { ok: true, value: parsed.worldValue };
}

function commitResult(
  s: FilletState,
  result: FilletComputeResult,
): ReturnType<CadEngineCommand['onPoint']> {
  if (!result.ok) {
    return {
      kind: 'reject',
      message: result.reason,
      prompt: s.first ? secondPrompt() : firstPrompt(),
    };
  }
  if (!validateFilletResult(result)) {
    return {
      kind: 'reject',
      message: 'Fillet validation failed — geometry unchanged',
      prompt: s.first ? secondPrompt() : firstPrompt(),
    };
  }
  try {
    // Ensure created arcs have stable ids
    const withIds: FilletComputeResult = result.ok
      ? {
          ...result,
          created: result.created.map((e) => ({
            ...e,
            id: createEntityId('fillet'),
          })),
        }
      : result;
    s.bus.execute(
      new FilletEntitiesCommand(withIds, s.bus.getDocument().entities),
    );
    s.sessionCount += 1;
    s.first = null;
    s.phase = 'first';
    s.bus.updateWithoutHistory((d) => setSelection(d, []));
    const msg = result.ok ? result.message : undefined;
    if (s.multiple) {
      return {
        kind: 'continue',
        prompt: firstPrompt(),
        status: `${statusPrefix(s)}: Select first object:`,
        message: msg ?? 'Fillet created',
        preview: null,
        dynamic: { label: statusPrefix(s) },
      };
    }
    return {
      kind: 'complete',
      status: msg ?? `FILLET complete (${s.sessionCount})`,
      message: msg ?? 'Fillet created',
    };
  } catch (err) {
    return {
      kind: 'reject',
      message: err instanceof Error ? err.message : 'Fillet failed',
      prompt: firstPrompt(),
    };
  }
}

function runFillet(
  s: FilletState,
  firstId: EntityId,
  firstPt: Vec2,
  secondId: EntityId,
  secondPt: Vec2,
  forceZero: boolean,
): ReturnType<CadEngineCommand['onPoint']> {
  const doc = s.bus.getDocument();
  const a = getEntity(doc, firstId);
  const b = getEntity(doc, secondId);
  if (!a || !b) {
    return {
      kind: 'reject',
      message: 'Object lost',
      prompt: firstPrompt(),
    };
  }
  if (!isEntityModifiable(doc, a) || !isEntityModifiable(doc, b)) {
    // Circle may be non-modifiable? still allow as reference — only lines need mod
    if (
      (a.type !== 'circle' && !isEntityModifiable(doc, a)) ||
      (b.type !== 'circle' && !isEntityModifiable(doc, b))
    ) {
      return {
        kind: 'reject',
        message: 'Locked layer — cannot fillet',
        prompt: firstPrompt(),
      };
    }
  }

  const radius = forceZero ? 0 : s.radius;
  const result = computeFillet(
    { entity: a, worldPoint: firstPt },
    { entity: b, worldPoint: secondPt },
    { radius, trim: s.trim },
    createEntityId('fillet'),
  );
  return commitResult(s, result);
}

function handleOption(
  s: FilletState,
  optionId: string,
): ReturnType<CadEngineCommand['onText']> {
  switch (optionId) {
    case 'radius':
      s.phase = 'radius';
      return {
        kind: 'continue',
        prompt: {
          id: 'radius',
          message: `Specify fillet radius <${fmtRadius(s.bus, s.radius)}>:`,
          inputType: 'distance',
          defaultValue: fmtRadius(s.bus, s.radius),
          optional: true,
        },
        status: `${statusPrefix(s)}: Radius`,
      };
    case 'trim':
      s.phase = 'trim';
      return {
        kind: 'continue',
        prompt: {
          id: 'trim',
          message: 'Enter trim mode [Trim/No trim] <Trim>:',
          inputType: 'option',
          options: [
            { id: 'trim-on', label: 'Trim', aliases: ['T', 'TRIM'] },
            { id: 'trim-off', label: 'No trim', aliases: ['N', 'NO'] },
          ],
          defaultValue: s.trim ? 'Trim' : 'No trim',
          optional: true,
        },
        status: `${statusPrefix(s)}: Trim mode`,
      };
    case 'multiple':
      s.multiple = true;
      s.first = null;
      s.phase = 'first';
      return {
        kind: 'continue',
        prompt: firstPrompt(),
        status: `${statusPrefix(s)}: Select first object:`,
        message: 'Multiple mode — Enter/Esc to finish',
      };
    case 'polyline':
      s.phase = 'polyline';
      return {
        kind: 'continue',
        prompt: {
          id: 'polyline',
          message: 'Select 2D polyline:',
          inputType: 'point',
        },
        status: `${statusPrefix(s)}: Select polyline:`,
      };
    case 'undo':
      if (s.sessionCount <= 0) {
        return {
          kind: 'reject',
          message: 'Nothing to undo in this FILLET session',
          prompt: firstPrompt(),
        };
      }
      if (s.bus.canUndo()) {
        s.bus.undo();
        s.sessionCount -= 1;
      }
      s.first = null;
      s.phase = 'first';
      return {
        kind: 'continue',
        prompt: firstPrompt(),
        status: `${statusPrefix(s)}: Undid last fillet`,
        message: 'Undo',
      };
    default:
      return {
        kind: 'reject',
        message: `Unknown option: ${optionId}`,
        prompt: firstPrompt(),
      };
  }
}

export function initFilletCommandState(bus: CommandBus): Partial<FilletState> {
  const cfg = readSettings(bus);
  return {
    bus,
    radius: cfg.radius,
    trim: cfg.trim,
    multiple: false,
    phase: 'first',
    first: null,
    sessionCount: 0,
    shiftZero: false,
  };
}

export const filletCommand: CadEngineCommand = {
  id: 'fillet',
  name: 'FILLET',
  aliases: ['F'],
  description: 'Create a tangent fillet arc between two objects',
  tool: 'fillet',
  category: 'Modify',
  keywords: ['fillet', 'round', 'radius', 'corner'],
  bootstrap: (bus) => {
    const init = initFilletCommandState(bus);
    return {
      state: init,
      prompt: firstPrompt(),
      status: `FILLET · r=${fmtRadius(bus, init.radius ?? 0)} · Select first object:`,
    };
  },
  start: () => ({
    prompt: firstPrompt(),
    status: 'FILLET: Select first object:',
  }),
  onPoint: (point, prompt, _ctx, state) => {
    const s = state as FilletState;
    if (s.radius == null) Object.assign(s, initFilletCommandState(s.bus));

    const forceZero = !!(state as { shiftKey?: boolean }).shiftKey || s.shiftZero;
    s.shiftZero = false;
    delete (state as { shiftKey?: boolean }).shiftKey;

    if (prompt.id === 'polyline' || s.phase === 'polyline') {
      const ent = pickEntityAt(s.bus, point);
      if (!ent || ent.type !== 'polyline') {
        return {
          kind: 'reject',
          message: 'Select a polyline',
          prompt: {
            id: 'polyline',
            message: 'Select 2D polyline:',
            inputType: 'point',
          },
        };
      }
      if (!isEntityModifiable(s.bus.getDocument(), ent)) {
        return {
          kind: 'reject',
          message: 'Locked — cannot fillet',
          prompt: firstPrompt(),
        };
      }
      const result = filletPolylineAll(ent, {
        radius: forceZero ? 0 : s.radius,
        trim: true,
      });
      return commitResult(s, result);
    }

    if (prompt.id === 'second' || (s.phase === 'second' && s.first)) {
      const ent = pickEntityAt(s.bus, point);
      if (!ent) {
        return {
          kind: 'reject',
          message: 'Select second object',
          prompt: secondPrompt(),
        };
      }
      return runFillet(
        s,
        s.first!.id,
        s.first!.point,
        ent.id,
        point,
        forceZero,
      );
    }

    // First object
    const ent = pickEntityAt(s.bus, point);
    if (!ent) {
      return {
        kind: 'reject',
        message: 'Select first object',
        prompt: firstPrompt(),
      };
    }
    s.first = { id: ent.id, point };
    s.phase = 'second';
    s.bus.updateWithoutHistory((d) => setSelection(d, [ent.id]));
    return {
      kind: 'continue',
      prompt: secondPrompt(),
      status: `${statusPrefix(s)}: Select second object:`,
      message: 'First object selected',
      lastPoint: point,
      dynamic: { label: statusPrefix(s) },
    };
  },
  onText: (text, prompt, _ctx, state) => {
    const s = state as FilletState;
    if (s.radius == null) Object.assign(s, initFilletCommandState(s.bus));
    const trimmed = text.trim();
    const upper = trimmed.toUpperCase();

    if (
      ['radius', 'polyline', 'trim', 'multiple', 'undo'].includes(trimmed)
    ) {
      return handleOption(s, trimmed);
    }

    if (prompt.id === 'radius') {
      if (!trimmed) {
        s.phase = s.first ? 'second' : 'first';
        return {
          kind: 'continue',
          prompt: s.first ? secondPrompt() : firstPrompt(),
          status: `${statusPrefix(s)}: Select object:`,
        };
      }
      const parsed = parseRadiusText(trimmed, s.bus);
      if (!parsed.ok) {
        return { kind: 'reject', message: parsed.error, prompt };
      }
      s.radius = parsed.value;
      persistSettings(s);
      s.phase = s.first ? 'second' : 'first';
      return {
        kind: 'continue',
        prompt: s.first ? secondPrompt() : firstPrompt(),
        status: `${statusPrefix(s)}: Select object:`,
        message: `Radius = ${fmtRadius(s.bus, s.radius)}`,
      };
    }

    if (prompt.id === 'trim') {
      if (!trimmed || upper === 'T' || upper === 'TRIM') {
        s.trim = true;
      } else if (upper === 'N' || upper.startsWith('NO')) {
        s.trim = false;
      } else if (trimmed === 'trim-on') {
        s.trim = true;
      } else if (trimmed === 'trim-off') {
        s.trim = false;
      } else {
        return { kind: 'reject', message: 'Enter Trim or No trim', prompt };
      }
      persistSettings(s);
      s.phase = s.first ? 'second' : 'first';
      return {
        kind: 'continue',
        prompt: s.first ? secondPrompt() : firstPrompt(),
        status: `${statusPrefix(s)}: Select object:`,
        message: s.trim ? 'Trim ON' : 'Trim OFF',
      };
    }

    if (prompt.id === 'first' || prompt.id === 'second') {
      if (!trimmed) {
        if (s.multiple && prompt.id === 'first') {
          return {
            kind: 'complete',
            status: `FILLET complete (${s.sessionCount} fillet(s))`,
          };
        }
        if (prompt.id === 'second') {
          s.first = null;
          s.phase = 'first';
          return {
            kind: 'continue',
            prompt: firstPrompt(),
            status: `${statusPrefix(s)}: Select first object:`,
          };
        }
        return {
          kind: 'complete',
          status:
            s.sessionCount > 0
              ? `FILLET complete (${s.sessionCount})`
              : 'FILLET cancelled',
        };
      }
      // Typed distance while waiting for objects → set radius
      const asRadius = parseRadiusText(trimmed, s.bus);
      if (asRadius.ok && /[0-9]/.test(trimmed)) {
        s.radius = asRadius.value;
        persistSettings(s);
        return {
          kind: 'continue',
          prompt,
          status: `${statusPrefix(s)}: Select object:`,
          message: `Radius = ${fmtRadius(s.bus, s.radius)}`,
        };
      }
      return handleOption(s, trimmed.toLowerCase());
    }

    return { kind: 'reject', message: 'Invalid input', prompt };
  },
  onMove: (point, prompt, _ctx, state) => {
    const s = state as FilletState;
    if (s.radius == null) Object.assign(s, initFilletCommandState(s.bus));

    if (prompt.id !== 'second' || !s.first) {
      return {
        preview: null,
        previewEntities: null,
        hideEntityIds: [],
        dynamic: { label: statusPrefix(s) },
        status: statusPrefix(s),
      };
    }

    const second = pickEntityAt(s.bus, point);
    if (!second) {
      return {
        preview: null,
        previewEntities: null,
        hideEntityIds: [],
        dynamic: { label: statusPrefix(s) },
        status: `${statusPrefix(s)}: Select second object`,
      };
    }

    const a = getEntity(s.bus.getDocument(), s.first.id);
    if (!a) {
      return { preview: null, previewEntities: null, dynamic: null };
    }

    const forceZero = !!(state as { shiftKey?: boolean }).shiftKey;
    const result = computeFillet(
      { entity: a, worldPoint: s.first.point },
      { entity: second, worldPoint: point },
      { radius: forceZero ? 0 : s.radius, trim: s.trim },
      'fillet-preview' as EntityId,
    );

    if (!result.ok) {
      return {
        preview: null,
        previewEntities: null,
        hideEntityIds: [],
        dynamic: { label: statusPrefix(s) },
        status: `${statusPrefix(s)}: ${result.reason}`,
      };
    }

    return {
      preview: null,
      previewEntities: result.previewEntities,
      hideEntityIds: result.hideEntityIds,
      dynamic: {
        label: forceZero
          ? `${statusPrefix(s)} · Shift=R0`
          : `${statusPrefix(s)} · Click to fillet`,
      },
      status: `${statusPrefix(s)}: Click to confirm fillet`,
    };
  },
  onCancel: (state) => {
    const s = state as FilletState;
    s.first = null;
    s.bus.updateWithoutHistory((d) => setSelection(d, []));
  },
};
