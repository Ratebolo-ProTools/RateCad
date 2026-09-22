import type { CommandBus } from '@ratecad/commands';
import { CreateLineCommand } from '@ratecad/commands';
import type { Vec2 } from '@ratecad/core';
import { distance } from '@ratecad/geometry';
import { matchOption, parseDistanceInput } from '../parsers.js';
import type {
  CadCommandContext,
  CadEngineCommand,
  CadPromptDefinition,
} from '../types.js';

type LineState = {
  bus: CommandBus;
  points: Vec2[];
};

const firstPrompt: CadPromptDefinition = {
  id: 'first',
  message: 'Specify first point:',
  inputType: 'point',
};

function nextPrompt(): CadPromptDefinition {
  return {
    id: 'next',
    message: 'Specify next point or [Undo]:',
    inputType: 'point',
    options: [{ id: 'undo', label: 'Undo', aliases: ['U', 'UNDO'] }],
  };
}

export const lineCommand: CadEngineCommand = {
  id: 'line',
  name: 'LINE',
  aliases: ['L'],
  description: 'Draw connected line segments',
  tool: 'line',
  start: () => ({ prompt: firstPrompt, status: 'LINE: Specify first point:' }),
  onPoint: (point, prompt, _ctx, state) => {
    const s = state as LineState;
    if (!s.points) s.points = [];
    if (prompt.id === 'first') {
      s.points = [point];
      return {
        kind: 'continue',
        prompt: nextPrompt(),
        lastPoint: point,
        status: 'LINE: Specify next point or [Undo]:',
        preview: null,
        dynamic: null,
      };
    }
    const prev = s.points[s.points.length - 1]!;
    if (distance(prev, point) > 1e-9) {
      s.bus.execute(new CreateLineCommand(prev, point));
      s.points.push(point);
    }
    return {
      kind: 'continue',
      prompt: nextPrompt(),
      lastPoint: point,
      status: 'LINE: Specify next point or [Undo]:',
      preview: null,
      dynamic: null,
    };
  },
  onText: (text, prompt, ctx, state) => {
    const s = state as LineState;
    if (prompt.id === 'next') {
      const opt = matchOption(text, prompt.options);
      if (opt.ok && opt.optionId === 'undo') {
        if (s.points.length > 1) {
          s.points.pop();
          const last = s.points[s.points.length - 1]!;
          return {
            kind: 'continue',
            prompt: nextPrompt(),
            lastPoint: last,
            status: 'LINE: Specify next point or [Undo]:',
            message: 'Undid last segment vertex',
            preview: null,
          };
        }
        if (s.points.length === 1) {
          s.points = [];
          return {
            kind: 'continue',
            prompt: firstPrompt,
            lastPoint: null,
            status: 'LINE: Specify first point:',
            message: 'Undid first point',
            preview: null,
          };
        }
        return {
          kind: 'reject',
          message: 'Nothing to undo',
          prompt,
        };
      }
    }
    // Empty Enter finishes the line command after at least one segment
    if (!text.trim() && prompt.id === 'next' && s.points.length >= 2) {
      return { kind: 'complete', status: 'LINE complete' };
    }
    if (!text.trim() && prompt.id === 'next' && s.points.length < 2) {
      return { kind: 'complete', status: 'LINE cancelled (no segment)' };
    }
    // Distance fallback handled by engine for point prompts
    const dist = parseDistanceInput(text, ctx.units);
    if (dist.ok) {
      return {
        kind: 'reject',
        message: 'Use direct distance with a cursor direction',
        prompt,
      };
    }
    return { kind: 'reject', message: 'Invalid input', prompt };
  },
  onMove: (point, prompt, ctx, state) => {
    const s = state as LineState;
    if (prompt.id !== 'next' || !s.points?.length) {
      return { preview: null, dynamic: null };
    }
    const start = s.points[s.points.length - 1]!;
    const dist = distance(start, point);
    const ang = (Math.atan2(point.y - start.y, point.x - start.x) * 180) / Math.PI;
    return {
      preview: { kind: 'line', start, end: point },
      dynamic: { distance: dist, angleDeg: ang },
      status: `LINE: Specify next point or [Undo]:`,
    };
  },
};
