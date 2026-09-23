import type { CommandBus } from '@ratecad/commands';
import {
  ChangeEntitiesAppearanceCommand,
  MatchPropertiesCommand,
  SetByLayerCommand,
} from '@ratecad/commands';
import {
  getEntity,
  getSelectedEntities,
  nearestLineweightMm,
  parseColorInput,
  setSelection,
  type Entity,
  type EntityId,
  type LayerId,
  type Vec2,
} from '@ratecad/core';
import {
  canEditEntityProperties,
  type AppearancePatch,
} from '@ratecad/geometry';
import { hitTestDocument } from '@ratecad/viewport';
import type {
  CadCommandOption,
  CadEngineCommand,
  CadPromptDefinition,
} from '../types.js';

/** Status prefix — App may focus the Properties panel when seen. */
export const PROPERTIES_PANEL_HINT = 'PROPERTIES_PANEL';

type ChpropState = {
  bus: CommandBus;
  ids: EntityId[];
  property:
    | 'color'
    | 'layer'
    | 'linetype'
    | 'linetypeScale'
    | 'lineweight'
    | 'transparency'
    | null;
};

type MatchState = {
  bus: CommandBus;
  sourceId: EntityId | null;
  destIds: EntityId[];
};

type SetByLayerState = {
  bus: CommandBus;
  ids: EntityId[];
};

const CHPROP_OPTIONS: CadCommandOption[] = [
  { id: 'color', label: 'Color', aliases: ['C', 'COLOR'] },
  { id: 'layer', label: 'Layer', aliases: ['LA', 'LAYER'] },
  { id: 'linetype', label: 'Linetype', aliases: ['LT', 'LINETYPE', 'LTYPE'] },
  {
    id: 'linetypeScale',
    label: 'Linetype scale',
    aliases: ['S', 'LTS', 'SCALE'],
  },
  {
    id: 'lineweight',
    label: 'Lineweight',
    aliases: ['LW', 'LINEWEIGHT', 'WEIGHT'],
  },
  {
    id: 'transparency',
    label: 'Transparency',
    aliases: ['TR', 'TRANSPARENCY'],
  },
];

function pickEntityAt(bus: CommandBus, point: Vec2): Entity | null {
  const grid = bus.getDocument().settings.gridSize || 1;
  const tol = Math.max(grid * 0.35, 0.05);
  const id = hitTestDocument(bus.getDocument(), point, tol);
  if (!id) return null;
  return getEntity(bus.getDocument(), id) ?? null;
}

function applyPatch(
  bus: CommandBus,
  ids: EntityId[],
  patch: AppearancePatch,
): number {
  const editable = ids.filter((id) => {
    const e = getEntity(bus.getDocument(), id);
    return e && canEditEntityProperties(e, bus.getDocument());
  });
  if (editable.length === 0) return 0;
  bus.execute(new ChangeEntitiesAppearanceCommand(editable, patch));
  return editable.length;
}

function propertyPrompt(): CadPromptDefinition {
  return {
    id: 'property',
    message:
      'Enter property to change [Color/Layer/Linetype/Linetype scale/Lineweight/Transparency]:',
    inputType: 'string',
    options: CHPROP_OPTIONS,
  };
}

function valuePrompt(property: string): CadPromptDefinition {
  const messages: Record<string, string> = {
    color: 'New color [ByLayer/Red/Yellow/…/#RRGGBB]:',
    layer: 'New layer name:',
    linetype:
      'New linetype [ByLayer/Continuous/Dashed/Dotted/DashDot/Center/Hidden]:',
    linetypeScale: 'New linetype scale:',
    lineweight: 'New lineweight (mm) or ByLayer:',
    transparency: 'New transparency 0–100 or ByLayer:',
  };
  return {
    id: 'value',
    message: messages[property] ?? 'New value:',
    inputType: 'string',
  };
}

/** PROPERTIES / PR — focus properties palette (current or selection). */
export const propertiesCommand: CadEngineCommand = {
  id: 'properties',
  name: 'PROPERTIES',
  aliases: ['PR', 'PROPS', 'PROPERTIES'],
  description: 'Open the Properties palette',
  tool: 'select',
  category: 'Modify',
  keywords: ['properties', 'inspector', 'palette', 'appearance'],
  handoffToTool: true,
  start: (ctx) => {
    const n = ctx.selectedIds.length;
    const msg =
      n === 0
        ? 'Current properties (no selection)'
        : n === 1
          ? 'Object properties'
          : `Common properties (${n} objects)`;
    return {
      prompt: {
        id: 'handoff',
        message: msg,
        inputType: 'string',
        optional: true,
      },
      status: `${PROPERTIES_PANEL_HINT} · ${msg}`,
    };
  },
  onPoint: () => ({ kind: 'complete' }),
  onText: () => ({ kind: 'complete' }),
};

export const chpropCommand: CadEngineCommand = {
  id: 'chprop',
  name: 'CHPROP',
  aliases: ['CHPROP', 'CHANGEPROP'],
  description: 'Change properties of selected objects',
  tool: 'select',
  category: 'Modify',
  keywords: ['change', 'properties', 'color', 'layer', 'linetype', 'lineweight'],
  start: (ctx) => {
    const ids = [...ctx.selectedIds];
    if (ids.length === 0) {
      return {
        prompt: {
          id: 'select',
          message: 'Select objects:',
          inputType: 'point',
        },
        status: 'CHPROP · Select objects',
        state: { ids: [] as EntityId[], property: null },
      };
    }
    return {
      prompt: propertyPrompt(),
      status: `CHPROP · ${ids.length} object(s)`,
      state: { ids, property: null },
    };
  },
  onPoint: (point, prompt, _ctx, state) => {
    const s = state as ChpropState;
    if (prompt.id === 'select' || s.ids.length === 0) {
      const ent = pickEntityAt(s.bus, point);
      if (!ent) {
        return {
          kind: 'reject',
          message: 'Select objects',
          prompt: {
            id: 'select',
            message: 'Select objects:',
            inputType: 'point',
          },
        };
      }
      const ids = [...new Set([...s.ids, ent.id])];
      s.ids = ids;
      s.bus.updateWithoutHistory((d) => setSelection(d, ids));
      return {
        kind: 'continue',
        prompt: propertyPrompt(),
        status: `CHPROP · ${ids.length} object(s)`,
      };
    }
    return {
      kind: 'reject',
      message: 'Enter a property name',
      prompt: propertyPrompt(),
    };
  },
  onText: (text, prompt, _ctx, state) => {
    const s = state as ChpropState;
    const t = text.trim();
    if (!t) {
      return { kind: 'reject', message: 'Enter a value', prompt };
    }

    if (prompt.id === 'property' || !s.property) {
      const opt = CHPROP_OPTIONS.find(
        (o) =>
          o.id.toLowerCase() === t.toLowerCase() ||
          o.aliases.some((a) => a.toLowerCase() === t.toLowerCase()) ||
          o.label.toLowerCase() === t.toLowerCase(),
      );
      if (!opt) {
        return {
          kind: 'reject',
          message: 'Unknown property',
          prompt: propertyPrompt(),
        };
      }
      s.property = opt.id as NonNullable<ChpropState['property']>;
      return {
        kind: 'continue',
        prompt: valuePrompt(opt.id),
        status: `CHPROP · ${opt.label}`,
      };
    }

    const ids = s.ids.length
      ? s.ids
      : getSelectedEntities(s.bus.getDocument()).map((e) => e.id);
    if (ids.length === 0) {
      return {
        kind: 'reject',
        message: 'No objects selected',
        prompt: {
          id: 'select',
          message: 'Select objects:',
          inputType: 'point',
        },
      };
    }

    const lower = t.toLowerCase();
    if (s.property === 'color') {
      const parsed = parseColorInput(t);
      if (!parsed) {
        return {
          kind: 'reject',
          message: 'Invalid color',
          prompt: valuePrompt('color'),
        };
      }
      const n = applyPatch(s.bus, ids, { color: parsed });
      return { kind: 'complete', status: `CHPROP · Color updated (${n})` };
    }

    if (s.property === 'layer') {
      const doc = s.bus.getDocument();
      const layer =
        doc.layers.find((l) => l.name.toLowerCase() === lower) ??
        doc.layers.find((l) => l.id === t);
      if (!layer) {
        return {
          kind: 'reject',
          message: 'Layer not found',
          prompt: valuePrompt('layer'),
        };
      }
      applyPatch(s.bus, ids, { layerId: layer.id as LayerId });
      return { kind: 'complete', status: `CHPROP · Layer → ${layer.name}` };
    }

    if (s.property === 'linetype') {
      if (lower === 'bylayer' || lower === 'by layer') {
        applyPatch(s.bus, ids, { linetype: { mode: 'BY_LAYER' } });
      } else {
        applyPatch(s.bus, ids, { linetype: { mode: 'EXPLICIT', value: t } });
      }
      return { kind: 'complete', status: 'CHPROP · Linetype updated' };
    }

    if (s.property === 'linetypeScale') {
      const n = Number(t);
      if (!Number.isFinite(n) || n <= 0) {
        return {
          kind: 'reject',
          message: 'Enter a positive scale',
          prompt: valuePrompt('linetypeScale'),
        };
      }
      applyPatch(s.bus, ids, { linetypeScale: n });
      return { kind: 'complete', status: `CHPROP · Linetype scale ${n}` };
    }

    if (s.property === 'lineweight') {
      if (lower === 'bylayer' || lower === 'by layer') {
        applyPatch(s.bus, ids, { lineweight: { mode: 'BY_LAYER' } });
      } else {
        const n = Number(t.replace(/mm$/i, '').trim());
        if (!Number.isFinite(n) || n < 0) {
          return {
            kind: 'reject',
            message: 'Enter lineweight in mm or ByLayer',
            prompt: valuePrompt('lineweight'),
          };
        }
        applyPatch(s.bus, ids, {
          lineweight: { mode: 'EXPLICIT', value: nearestLineweightMm(n) },
        });
      }
      return { kind: 'complete', status: 'CHPROP · Lineweight updated' };
    }

    if (s.property === 'transparency') {
      if (lower === 'bylayer' || lower === 'by layer') {
        applyPatch(s.bus, ids, { transparency: { mode: 'BY_LAYER' } });
      } else {
        const n = Number(t.replace(/%$/, '').trim());
        if (!Number.isFinite(n) || n < 0 || n > 100) {
          return {
            kind: 'reject',
            message: 'Enter transparency 0–100 or ByLayer',
            prompt: valuePrompt('transparency'),
          };
        }
        applyPatch(s.bus, ids, {
          transparency: { mode: 'EXPLICIT', value: Math.round(n) },
        });
      }
      return { kind: 'complete', status: 'CHPROP · Transparency updated' };
    }

    return { kind: 'complete' };
  },
};

export const setByLayerCommand: CadEngineCommand = {
  id: 'setbylayer',
  name: 'SETBYLAYER',
  aliases: ['SETBYLAYER', 'SETBY'],
  description: 'Reset object property overrides to ByLayer',
  tool: 'select',
  category: 'Modify',
  keywords: ['bylayer', 'layer', 'inheritance', 'reset'],
  start: (ctx) => {
    const ids = [...ctx.selectedIds];
    if (ids.length > 0) {
      return {
        prompt: {
          id: 'confirm',
          message: 'Press Enter to set ByLayer on selection:',
          inputType: 'string',
          optional: true,
          defaultValue: '',
        },
        status: `SETBYLAYER · ${ids.length} selected — Enter to confirm`,
        state: { ids },
      };
    }
    return {
      prompt: {
        id: 'select',
        message: 'Select objects to set ByLayer:',
        inputType: 'point',
      },
      status: 'SETBYLAYER · Select objects',
      state: { ids: [] as EntityId[] },
    };
  },
  onPoint: (point, prompt, _ctx, state) => {
    const s = state as SetByLayerState;
    const ent = pickEntityAt(s.bus, point);
    if (!ent) {
      return {
        kind: 'reject',
        message: 'Select objects',
        prompt: {
          id: 'select',
          message: 'Select objects to set ByLayer:',
          inputType: 'point',
        },
      };
    }
    const ids = [...new Set([...s.ids, ent.id])];
    s.ids = ids;
    s.bus.updateWithoutHistory((d) => setSelection(d, ids));
    s.bus.execute(new SetByLayerCommand(ids));
    return {
      kind: 'complete',
      status: `SETBYLAYER · ${ids.length} object(s)`,
    };
  },
  onText: (_text, _prompt, _ctx, state) => {
    const s = state as SetByLayerState;
    const ids =
      s.ids.length > 0
        ? s.ids
        : getSelectedEntities(s.bus.getDocument()).map((e) => e.id);
    if (ids.length === 0) {
      return {
        kind: 'reject',
        message: 'No objects selected',
        prompt: {
          id: 'select',
          message: 'Select objects to set ByLayer:',
          inputType: 'point',
        },
      };
    }
    s.bus.execute(new SetByLayerCommand(ids));
    return {
      kind: 'complete',
      status: `SETBYLAYER · ${ids.length} object(s)`,
    };
  },
};

export const matchPropCommand: CadEngineCommand = {
  id: 'matchprop',
  name: 'MATCHPROP',
  aliases: ['MATCHPROP', 'MA', 'MATCHPROPERTIES'],
  description: 'Copy appearance properties from one object to others',
  tool: 'select',
  category: 'Modify',
  keywords: ['match', 'properties', 'copy', 'paint'],
  start: () => ({
    prompt: {
      id: 'source',
      message: 'Select source object:',
      inputType: 'point',
    },
    status: 'MATCHPROP · Select source',
    state: { sourceId: null, destIds: [] as EntityId[] },
  }),
  onPoint: (point, prompt, _ctx, state) => {
    const s = state as MatchState;
    const ent = pickEntityAt(s.bus, point);
    if (!ent) {
      return {
        kind: 'reject',
        message: prompt.id === 'source' ? 'Select source' : 'Select destination',
        prompt: {
          id: prompt.id,
          message:
            prompt.id === 'source'
              ? 'Select source object:'
              : 'Select destination object(s):',
          inputType: 'point',
        },
      };
    }
    if (prompt.id === 'source' || !s.sourceId) {
      s.sourceId = ent.id;
      s.bus.updateWithoutHistory((d) => setSelection(d, [ent.id]));
      return {
        kind: 'continue',
        prompt: {
          id: 'dest',
          message: 'Select destination object(s):',
          inputType: 'point',
        },
        status: 'MATCHPROP · Select destination',
      };
    }
    if (ent.id === s.sourceId) {
      return {
        kind: 'reject',
        message: 'Destination must differ from source',
        prompt: {
          id: 'dest',
          message: 'Select destination object(s):',
          inputType: 'point',
        },
      };
    }
    const destIds = [...new Set([...s.destIds, ent.id])];
    s.destIds = destIds;
    s.bus.execute(new MatchPropertiesCommand(s.sourceId, destIds));
    return {
      kind: 'complete',
      status: `MATCHPROP · Copied to ${destIds.length} object(s)`,
    };
  },
  onText: () => ({
    kind: 'reject',
    message: 'Click to select an object',
    prompt: {
      id: 'source',
      message: 'Select source object:',
      inputType: 'point',
    },
  }),
};
