import type { CommandBus } from '@ratecad/commands';
import { CreateRectangleCommand } from '@ratecad/commands';
import type { Vec2 } from '@ratecad/core';
import {
  constrainRectangleCorner,
  formatRectanglePreviewStatus,
  isDegenerateRectangle,
  rectangleSize,
} from '../../rectangleConstraints.js';
import { matchOption, parseDistanceInput } from '../parsers.js';
import type {
  CadEngineCommand,
  CadPromptDefinition,
} from '../types.js';

type RectState = {
  bus: CommandBus;
  corner1: Vec2 | null;
  length: number | null;
  width: number | null;
  mode: 'corner' | 'ask-length' | 'ask-width';
};

const firstCorner: CadPromptDefinition = {
  id: 'first',
  message: 'Specify first corner:',
  inputType: 'point',
};

const opposite: CadPromptDefinition = {
  id: 'opposite',
  message: 'Specify opposite corner or [Length/Width]:',
  inputType: 'point',
  options: [
    { id: 'length', label: 'Length', aliases: ['L', 'LEN'] },
    { id: 'width', label: 'Width', aliases: ['W', 'WID'] },
  ],
};

const askLength: CadPromptDefinition = {
  id: 'length',
  message: 'Specify length:',
  inputType: 'distance',
};

const askWidth: CadPromptDefinition = {
  id: 'width',
  message: 'Specify width:',
  inputType: 'distance',
};

function commit(
  s: RectState,
  corner1: Vec2,
  cursor: Vec2,
): ReturnType<CadEngineCommand['onPoint']> {
  const corner2 = constrainRectangleCorner(
    corner1,
    cursor,
    s.length,
    s.width,
  );
  if (isDegenerateRectangle(corner1, corner2)) {
    return {
      kind: 'reject',
      message: 'Degenerate rectangle',
      prompt: opposite,
    };
  }
  s.bus.execute(new CreateRectangleCommand(corner1, corner2));
  return { kind: 'complete', status: 'RECTANGLE complete' };
}

export const rectangleCommand: CadEngineCommand = {
  id: 'rectangle',
  name: 'RECTANGLE',
  aliases: ['REC', 'RECT'],
  description: 'Draw a rectangle',
  tool: 'rectangle',
  start: () => ({
    prompt: firstCorner,
    status: 'RECTANGLE: Specify first corner:',
  }),
  onPoint: (point, prompt, _ctx, state) => {
    const s = state as RectState;
    if (!s.corner1 && prompt.id === 'first') {
      s.corner1 = point;
      s.length = s.length ?? null;
      s.width = s.width ?? null;
      return {
        kind: 'continue',
        prompt: opposite,
        lastPoint: point,
        status: 'RECTANGLE: Specify opposite corner or [Length/Width]:',
        preview: null,
      };
    }
    if (prompt.id === 'opposite' && s.corner1) {
      return commit(s, s.corner1, point);
    }
    return { kind: 'reject', message: 'Unexpected point', prompt };
  },
  onText: (text, prompt, ctx, state) => {
    const s = state as RectState;
    if (prompt.id === 'opposite') {
      const opt = matchOption(text, prompt.options);
      if (opt.ok && opt.optionId === 'length') {
        return {
          kind: 'continue',
          prompt: askLength,
          status: 'RECTANGLE: Specify length:',
          lastPoint: s.corner1,
        };
      }
      if (opt.ok && opt.optionId === 'width') {
        return {
          kind: 'continue',
          prompt: askWidth,
          status: 'RECTANGLE: Specify width:',
          lastPoint: s.corner1,
        };
      }
    }
    if (prompt.id === 'length') {
      const d = parseDistanceInput(text, ctx.units, ctx.worldUnit);
      if (!d.ok) return { kind: 'reject', message: d.error, prompt };
      s.length = d.value;
      return {
        kind: 'continue',
        prompt: opposite,
        status: formatRectanglePreviewStatus(
          s.corner1 ?? { x: 0, y: 0 },
          s.corner1 ?? { x: 0, y: 0 },
          s.length,
          s.width,
        ),
        lastPoint: s.corner1,
        message: `Length = ${d.value}`,
      };
    }
    if (prompt.id === 'width') {
      const d = parseDistanceInput(text, ctx.units, ctx.worldUnit);
      if (!d.ok) return { kind: 'reject', message: d.error, prompt };
      s.width = d.value;
      return {
        kind: 'continue',
        prompt: opposite,
        status: formatRectanglePreviewStatus(
          s.corner1 ?? { x: 0, y: 0 },
          s.corner1 ?? { x: 0, y: 0 },
          s.length,
          s.width,
        ),
        lastPoint: s.corner1,
        message: `Width = ${d.value}`,
      };
    }
    return { kind: 'reject', message: 'Invalid input', prompt };
  },
  onMove: (point, prompt, _ctx, state) => {
    const s = state as RectState;
    if (prompt.id !== 'opposite' || !s.corner1) {
      return { preview: null, dynamic: null };
    }
    const corner2 = constrainRectangleCorner(
      s.corner1,
      point,
      s.length,
      s.width,
    );
    const size = rectangleSize(s.corner1, corner2);
    return {
      preview: { kind: 'rectangle', start: s.corner1, end: corner2 },
      dynamic: {
        length: size.length,
        width: size.width,
      },
      status: formatRectanglePreviewStatus(
        s.corner1,
        corner2,
        s.length,
        s.width,
      ),
    };
  },
};

/** Apply dock Length/Width fields into engine rectangle state when active. */
export function setEngineRectangleConstraints(
  state: Record<string, unknown>,
  length: number | null,
  width: number | null,
): void {
  const s = state as RectState;
  s.length = length != null && length > 0 ? length : null;
  s.width = width != null && width > 0 ? width : null;
}
