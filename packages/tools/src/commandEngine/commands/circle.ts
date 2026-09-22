import type { CommandBus } from '@ratecad/commands';
import { CreateCircleCommand } from '@ratecad/commands';
import type { Vec2 } from '@ratecad/core';
import { distance } from '@ratecad/geometry';
import { parseDistanceInput } from '../parsers.js';
import type { CadEngineCommand, CadPromptDefinition } from '../types.js';

type CircleState = {
  bus: CommandBus;
  center: Vec2 | null;
};

const centerPrompt: CadPromptDefinition = {
  id: 'center',
  message: 'Specify center point:',
  inputType: 'point',
};

const radiusPrompt: CadPromptDefinition = {
  id: 'radius',
  message: 'Specify radius:',
  inputType: 'point',
};

export const circleCommand: CadEngineCommand = {
  id: 'circle',
  name: 'CIRCLE',
  aliases: ['C'],
  description: 'Draw a circle by center and radius',
  tool: 'circle',
  start: () => ({
    prompt: centerPrompt,
    status: 'CIRCLE: Specify center point:',
  }),
  onPoint: (point, prompt, _ctx, state) => {
    const s = state as CircleState;
    if (prompt.id === 'center') {
      s.center = point;
      return {
        kind: 'continue',
        prompt: radiusPrompt,
        lastPoint: point,
        status: 'CIRCLE: Specify radius:',
        preview: null,
      };
    }
    if (prompt.id === 'radius' && s.center) {
      const r = distance(s.center, point);
      if (!(r > 1e-9)) {
        return { kind: 'reject', message: 'Invalid radius', prompt };
      }
      s.bus.execute(new CreateCircleCommand(s.center, r));
      return { kind: 'complete', status: 'CIRCLE complete' };
    }
    return { kind: 'reject', message: 'Unexpected point', prompt };
  },
  onText: (text, prompt, ctx, state) => {
    const s = state as CircleState;
    if (prompt.id === 'radius') {
      const d = parseDistanceInput(text, ctx.units);
      if (!d.ok) return { kind: 'reject', message: d.error, prompt };
      if (!s.center) {
        return { kind: 'reject', message: 'No center point', prompt };
      }
      s.bus.execute(new CreateCircleCommand(s.center, d.value));
      return { kind: 'complete', status: 'CIRCLE complete' };
    }
    return { kind: 'reject', message: 'Invalid input', prompt };
  },
  onMove: (point, prompt, _ctx, state) => {
    const s = state as CircleState;
    if (prompt.id !== 'radius' || !s.center) {
      return { preview: null, dynamic: null };
    }
    const r = distance(s.center, point);
    return {
      preview: { kind: 'circle', start: s.center, end: point },
      dynamic: { distance: r },
      status: 'CIRCLE: Specify radius:',
    };
  },
};
