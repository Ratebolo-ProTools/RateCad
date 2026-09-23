import type { CommandBus } from '@ratecad/commands';
import { CreateCircleCommand } from '@ratecad/commands';
import type { Vec2 } from '@ratecad/core';
import { distance } from '@ratecad/geometry';
import { parseDistanceInput } from '../parsers.js';
import type { CadEngineCommand, CadPromptDefinition } from '../types.js';

/** Default radius owned by the CIRCLE command definition (drawing units). */
export const CIRCLE_DEFAULT_RADIUS = 5;

type CircleState = {
  bus: CommandBus;
  center: Vec2 | null;
};

const centerPrompt: CadPromptDefinition = {
  id: 'center',
  message: 'Specify center point:',
  inputType: 'point',
};

function radiusPrompt(): CadPromptDefinition {
  return {
    id: 'radius',
    message: `Specify radius <${CIRCLE_DEFAULT_RADIUS.toFixed(2)}>:`,
    inputType: 'distance',
    defaultValue: CIRCLE_DEFAULT_RADIUS.toFixed(2),
  };
}

function commitRadius(
  s: CircleState,
  r: number,
  prompt: CadPromptDefinition,
): ReturnType<CadEngineCommand['onPoint']> {
  if (!(r > 1e-9)) {
    return { kind: 'reject', message: 'Radius must be greater than zero', prompt };
  }
  if (!s.center) {
    return { kind: 'reject', message: 'No center point', prompt };
  }
  s.bus.execute(new CreateCircleCommand(s.center, r));
  return { kind: 'complete', status: 'CIRCLE complete' };
}

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
      const next = radiusPrompt();
      return {
        kind: 'continue',
        prompt: next,
        lastPoint: point,
        status: `CIRCLE: ${next.message}`,
        preview: null,
      };
    }
    if (prompt.id === 'radius' && s.center) {
      return commitRadius(s, distance(s.center, point), prompt);
    }
    return { kind: 'reject', message: 'Unexpected point', prompt };
  },
  onText: (text, prompt, ctx, state) => {
    const s = state as CircleState;
    if (prompt.id === 'radius') {
      const d = parseDistanceInput(text, ctx.units, ctx.worldUnit);
      if (!d.ok) return { kind: 'reject', message: d.error, prompt };
      return commitRadius(s, d.value, prompt);
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
      dynamic: { distance: r, label: 'Radius' },
      status: `CIRCLE: Specify radius <${CIRCLE_DEFAULT_RADIUS.toFixed(2)}>:`,
    };
  },
};
