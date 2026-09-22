import type { CommandBus } from '@ratecad/commands';
import { CopyEntitiesCommand, MoveEntitiesCommand } from '@ratecad/commands';
import {
  getSelectedEntities,
  isEntityModifiable,
  type Entity,
  type EntityId,
  type Vec2,
} from '@ratecad/core';
import { translateEntity, vecDelta } from '@ratecad/geometry';
import type { CadEngineCommand, CadPromptDefinition } from '../types.js';

type XformState = {
  bus: CommandBus;
  mode: 'move' | 'copy';
  entities: Entity[];
  base: Vec2 | null;
};

const selectPrompt: CadPromptDefinition = {
  id: 'select',
  message: 'Select objects, then specify base point:',
  inputType: 'point',
};

const secondPrompt: CadPromptDefinition = {
  id: 'second',
  message: 'Specify second point or displacement:',
  inputType: 'point',
};

function selectedModifiable(bus: CommandBus): Entity[] {
  return getSelectedEntities(bus.getDocument()).filter((e) =>
    isEntityModifiable(bus.getDocument(), e),
  );
}

function makeCommand(mode: 'move' | 'copy'): CadEngineCommand {
  const name = mode === 'move' ? 'MOVE' : 'COPY';
  const aliases = mode === 'move' ? ['M'] : ['CO'];
  return {
    id: mode,
    name,
    aliases,
    description: mode === 'move' ? 'Move objects' : 'Copy objects',
    tool: mode,
    start: (ctx) => {
      const hasSel = ctx.selectedIds.length > 0;
      return {
        prompt: hasSel
          ? { id: 'base', message: 'Specify base point:', inputType: 'point' }
          : selectPrompt,
        status: hasSel
          ? `${name}: Specify base point:`
          : `${name}: Select objects, then specify base point:`,
      };
    },
    onPoint: (point, prompt, _ctx, state) => {
      const s = state as XformState;
      s.mode = mode;
      if (prompt.id === 'select' || prompt.id === 'base') {
        const entities = selectedModifiable(s.bus);
        if (!entities.length) {
          return {
            kind: 'reject',
            message: 'No objects selected',
            prompt: selectPrompt,
          };
        }
        s.entities = entities;
        s.base = point;
        return {
          kind: 'continue',
          prompt: secondPrompt,
          lastPoint: point,
          status: `${name}: Specify second point or displacement:`,
          preview: null,
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
        } else {
          s.bus.execute(new CopyEntitiesCommand(s.entities, delta, context));
        }
        return { kind: 'complete', status: `${name} complete` };
      }
      return { kind: 'reject', message: 'Unexpected point', prompt };
    },
    onText: (_text, prompt) => ({
      kind: 'reject',
      message: 'Invalid input',
      prompt,
    }),
    onMove: (point, prompt, _ctx, state) => {
      const s = state as XformState;
      if (prompt.id !== 'second' || !s.base) {
        return { preview: null, dynamic: null };
      }
      const delta = vecDelta(s.base, point);
      const entities = selectedModifiable(s.bus);
      const previewEntities = entities
        .map((e) => translateEntity(e, delta))
        .filter((e): e is Entity => !!e);
      return {
        preview: null,
        previewEntities,
        hideEntityIds: mode === 'move' ? s.entities.map((e) => e.id) : [],
        dynamic: {
          distance: Math.hypot(delta.x, delta.y),
          angleDeg: (Math.atan2(delta.y, delta.x) * 180) / Math.PI,
        },
        status: `${name}: Specify second point or displacement:`,
      };
    },
  };
}

// Fix onMove return type to include previewEntities - need to extend engine apply
export const moveCommand = makeCommand('move');
export const copyCommand = makeCommand('copy');
