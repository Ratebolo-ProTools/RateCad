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

/** Explicit LINE phases. Preview is derived from pointer motion, not a document write. */
export type LinePhase = 'waiting-first-point' | 'waiting-next-point';

type LineState = {
  bus: CommandBus;
  points: Vec2[];
  phase: LinePhase;
};

/** Reject coordinates that cannot round-trip through JSON geometry. */
const MAX_ABS_COORD = 1e8;

const firstPrompt: CadPromptDefinition = {
  id: 'first',
  message: 'Specify first point:',
  inputType: 'point',
};

function nextPrompt(): CadPromptDefinition {
  return {
    id: 'next',
    message: 'Specify next point or [Close/Undo]:',
    inputType: 'point',
    options: [
      { id: 'close', label: 'Close', aliases: ['C', 'CLOSE'] },
      { id: 'undo', label: 'Undo', aliases: ['U', 'UNDO'] },
    ],
    /** Empty Enter finishes LINE when segments exist (handled in onText). */
    optional: true,
  };
}

function finitePoint(point: Vec2): boolean {
  return (
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    Math.abs(point.x) <= MAX_ABS_COORD &&
    Math.abs(point.y) <= MAX_ABS_COORD
  );
}

function continueNext(s: LineState, message?: string) {
  const last = s.points[s.points.length - 1] ?? null;
  return {
    kind: 'continue' as const,
    prompt: nextPrompt(),
    lastPoint: last,
    status: 'LINE: Specify next point or [Close/Undo]:',
    message,
    preview: null,
    dynamic: null,
  };
}

export const lineCommand: CadEngineCommand = {
  id: 'line',
  name: 'LINE',
  aliases: ['L'],
  description: 'Draw connected line segments',
  tool: 'line',
  category: 'Draw',
  keywords: ['line', 'segment', 'draw'],
  start: () => ({
    prompt: firstPrompt,
    status: 'LINE: Specify first point:',
    state: { points: [], phase: 'waiting-first-point' satisfies LinePhase },
  }),
  onPoint: (point, prompt, _ctx, state) => {
    const s = state as LineState;
    if (!s.points) s.points = [];
    if (!finitePoint(point)) {
      return {
        kind: 'reject',
        message: 'Invalid coordinate',
        prompt,
      };
    }
    if (prompt.id === 'first' || (s.phase === 'waiting-first-point' && s.points.length === 0)) {
      s.points = [point];
      s.phase = 'waiting-next-point';
      return continueNext(s);
    }
    const prev = s.points[s.points.length - 1]!;
    if (!(distance(prev, point) > 1e-9)) {
      return {
        ...continueNext(s, 'Zero-length segment rejected'),
        kind: 'continue',
      };
    }
    s.bus.execute(new CreateLineCommand(prev, point));
    s.points.push(point);
    s.phase = 'waiting-next-point';
    return continueNext(s);
  },
  onText: (text, prompt, ctx, state) => {
    const s = state as LineState;
    if (prompt.id === 'next') {
      const opt = matchOption(text, prompt.options);
      if (opt.ok && opt.optionId === 'close') {
        if (s.points.length < 3) {
          return {
            kind: 'reject',
            message: 'Need at least two segments to close',
            prompt,
          };
        }
        const first = s.points[0]!;
        const last = s.points[s.points.length - 1]!;
        if (!(distance(last, first) > 1e-9)) {
          return {
            kind: 'reject',
            message: 'Sequence is already closed',
            prompt,
          };
        }
        s.bus.execute(new CreateLineCommand(last, first));
        s.points.push(first);
        return { kind: 'complete', status: 'LINE closed' };
      }
      if (opt.ok && opt.optionId === 'undo') {
        if (s.points.length > 1) {
          // Each committed segment is a CommandBus entry — undo it.
          s.bus.undo();
          s.points.pop();
          const last = s.points[s.points.length - 1]!;
          return {
            kind: 'continue',
            prompt: nextPrompt(),
            lastPoint: last,
            status: 'LINE: Specify next point or [Close/Undo]:',
            message: 'Undid last segment',
            preview: null,
          };
        }
        if (s.points.length === 1) {
          s.points = [];
          s.phase = 'waiting-first-point';
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
    // No committed segment — treat as cancel (do not store as last completed)
    if (!text.trim() && prompt.id === 'next' && s.points.length < 2) {
      return { kind: 'cancel' };
    }
    // Distance fallback handled by engine for point prompts
    const dist = parseDistanceInput(text, ctx.units, ctx.worldUnit);
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
      status: 'LINE: Specify next point or [Close/Undo]:',
    };
  },
};
