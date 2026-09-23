import type { CommandBus } from '@ratecad/commands';
import { CopyEntitiesCommand, MoveEntitiesCommand } from '@ratecad/commands';
import {
  getSelectedEntities,
  isEntityModifiable,
  type Entity,
  type Vec2,
} from '@ratecad/core';
import { distance, translateEntity, vecDelta } from '@ratecad/geometry';
import type { CadEngineCommand, CadPromptDefinition } from '../types.js';

type XformState = {
  bus: CommandBus;
  mode: 'move' | 'copy';
  entities: Entity[];
  base: Vec2 | null;
  copyCount: number;
};

const selectPrompt: CadPromptDefinition = {
  id: 'select',
  message: 'Select objects:',
  inputType: 'entities',
  optional: true,
};

const basePrompt: CadPromptDefinition = {
  id: 'base',
  message: 'Specify base point:',
  inputType: 'point',
};

function secondPrompt(mode: 'move' | 'copy'): CadPromptDefinition {
  if (mode === 'copy') {
    return {
      id: 'second',
      message: 'Specify second point or [Exit]:',
      inputType: 'point',
      options: [{ id: 'exit', label: 'Exit', aliases: ['E', 'EXIT'] }],
      optional: true,
    };
  }
  return {
    id: 'second',
    message: 'Specify second point or displacement:',
    inputType: 'point',
  };
}

function selectedModifiable(bus: CommandBus): Entity[] {
  return getSelectedEntities(bus.getDocument()).filter((e) =>
    isEntityModifiable(bus.getDocument(), e),
  );
}

function finishSelection(
  s: XformState,
  name: string,
): ReturnType<CadEngineCommand['onText']> {
  const entities = selectedModifiable(s.bus);
  if (!entities.length) {
    return {
      kind: 'reject',
      message: 'No objects selected',
      prompt: selectPrompt,
    };
  }
  s.entities = entities;
  return {
    kind: 'continue',
    prompt: basePrompt,
    status: `${name}: Specify base point:`,
    message: `${entities.length} selected`,
    preview: null,
    dynamic: null,
  };
}

function makeCommand(mode: 'move' | 'copy'): CadEngineCommand {
  const name = mode === 'move' ? 'MOVE' : 'COPY';
  const aliases = mode === 'move' ? ['M'] : ['CO', 'CP'];
  return {
    id: mode,
    name,
    aliases,
    description: mode === 'move' ? 'Move objects' : 'Copy objects',
    tool: mode,
    category: mode === 'move' ? 'Modify' : 'Modify',
    keywords:
      mode === 'move'
        ? ['move', 'translate', 'displace']
        : ['copy', 'duplicate', 'clone'],
    start: (ctx) => {
      const hasSel = ctx.selectedIds.length > 0;
      return {
        prompt: hasSel ? basePrompt : selectPrompt,
        status: hasSel
          ? `${name}: Specify base point:`
          : `${name}: Select objects:`,
      };
    },
    onPoint: (point, prompt, _ctx, state) => {
      const s = state as XformState;
      s.mode = mode;

      if (prompt.id === 'select') {
        // Clicks during selection are handled by the App selection path.
        return {
          kind: 'reject',
          message: 'Select objects, then press Enter',
          prompt: selectPrompt,
        };
      }

      if (prompt.id === 'base') {
        const entities =
          s.entities?.length > 0 ? s.entities : selectedModifiable(s.bus);
        if (!entities.length) {
          return {
            kind: 'reject',
            message: 'No objects selected',
            prompt: selectPrompt,
          };
        }
        s.entities = entities;
        s.base = point;
        s.copyCount = 0;
        return {
          kind: 'continue',
          prompt: secondPrompt(mode),
          lastPoint: point,
          status:
            mode === 'copy'
              ? `${name}: Specify second point or [Exit]:`
              : `${name}: Specify second point or displacement:`,
          preview: null,
          dynamic: null,
        };
      }

      if (prompt.id === 'second' && s.base) {
        const delta = vecDelta(s.base, point);
        if (Math.hypot(delta.x, delta.y) < 1e-12) {
          return { kind: 'reject', message: 'Zero displacement', prompt };
        }
        const context = s.bus.getDocument().entities;
        if (mode === 'move') {
          s.bus.execute(new MoveEntitiesCommand(s.entities, delta, context));
          return { kind: 'complete', status: `${name} complete` };
        }
        s.bus.execute(new CopyEntitiesCommand(s.entities, delta, context));
        s.copyCount = (s.copyCount ?? 0) + 1;
        return {
          kind: 'continue',
          prompt: secondPrompt('copy'),
          lastPoint: s.base,
          status: `${name}: Specify next point (${s.copyCount} copied) or Enter to finish:`,
          message: `Copy ${s.copyCount} placed`,
          preview: null,
          dynamic: null,
        };
      }
      return { kind: 'reject', message: 'Unexpected point', prompt };
    },
    onText: (text, prompt, _ctx, state) => {
      const s = state as XformState;
      const trimmed = text.trim();

      if (prompt.id === 'select') {
        if (!trimmed) return finishSelection(s, name);
        return {
          kind: 'reject',
          message: 'Select objects, then press Enter',
          prompt,
        };
      }

      if (prompt.id === 'second' && mode === 'copy') {
        if (!trimmed) {
          return {
            kind: 'complete',
            status:
              (s.copyCount ?? 0) > 0
                ? `COPY complete (${s.copyCount} copies)`
                : 'COPY cancelled (no copies)',
          };
        }
        const upper = trimmed.toUpperCase();
        if (upper === 'E' || upper === 'EXIT' || upper === 'M' || upper === 'MULTIPLE') {
          // Multiple is the default repeated-copy mode; Exit finishes.
          if (upper === 'E' || upper === 'EXIT') {
            return {
              kind: 'complete',
              status:
                (s.copyCount ?? 0) > 0
                  ? `COPY complete (${s.copyCount} copies)`
                  : 'COPY cancelled (no copies)',
            };
          }
          return {
            kind: 'continue',
            prompt: secondPrompt('copy'),
            lastPoint: s.base,
            status: `${name}: Multiple mode — specify second points (Enter to finish):`,
            message: 'Multiple copy active',
          };
        }
      }

      return { kind: 'reject', message: 'Invalid input', prompt };
    },
    onMove: (point, prompt, _ctx, state) => {
      const s = state as XformState;
      if (prompt.id !== 'second' || !s.base || !s.entities?.length) {
        return { preview: null, previewEntities: null, dynamic: null };
      }
      const delta = vecDelta(s.base, point);
      const previewEntities = s.entities
        .map((e) => translateEntity(e, delta))
        .filter((e): e is Entity => !!e);
      const dist = distance(s.base, point);
      const angleDeg = (Math.atan2(delta.y, delta.x) * 180) / Math.PI;
      return {
        preview: null,
        previewEntities,
        hideEntityIds: mode === 'move' ? s.entities.map((e) => e.id) : [],
        dynamic: {
          distance: dist,
          angleDeg,
          label: mode === 'move' ? 'MOVE' : 'COPY',
        },
        status:
          mode === 'copy'
            ? `${name}: Specify second point (${s.copyCount ?? 0} copied):`
            : `${name}: Specify second point or displacement:`,
      };
    },
  };
}

export const moveCommand = makeCommand('move');
export const copyCommand = makeCommand('copy');
