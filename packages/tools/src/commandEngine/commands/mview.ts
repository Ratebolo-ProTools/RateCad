import type { CommandBus } from '@ratecad/commands';
import { CreateViewportCommand } from '@ratecad/commands';
import {
  MIN_VIEWPORT_SIZE,
  createViewportFromRect,
  formatViewportScale,
  normalizeViewportRect,
  scaleFromRatio,
  type LayoutId,
  type Vec2,
} from '@ratecad/core';
import type {
  CadEngineCommand,
  CadPromptDefinition,
} from '../types.js';

type MviewState = {
  bus: CommandBus;
  layoutId: LayoutId | null;
  corner1: Vec2 | null;
};

const firstCorner: CadPromptDefinition = {
  id: 'first',
  message: 'Specify first corner:',
  inputType: 'point',
};

const opposite: CadPromptDefinition = {
  id: 'opposite',
  message: 'Specify opposite corner:',
  inputType: 'point',
};

function resolveLayoutId(bus: CommandBus, explicit: LayoutId | null): LayoutId | null {
  if (explicit) return explicit;
  return bus.getDocument().activeLayoutId;
}

function commit(
  s: MviewState,
  corner1: Vec2,
  corner2: Vec2,
): ReturnType<CadEngineCommand['onPoint']> {
  const layoutId = resolveLayoutId(s.bus, s.layoutId);
  if (!layoutId) {
    return {
      kind: 'reject',
      message: 'MVIEW requires an active layout (Paper Space)',
      prompt: firstCorner,
    };
  }
  const rect = normalizeViewportRect(corner1, corner2, MIN_VIEWPORT_SIZE);
  if (Math.abs(corner2.x - corner1.x) < 1e-9 && Math.abs(corner2.y - corner1.y) < 1e-9) {
    return {
      kind: 'reject',
      message: 'Degenerate viewport',
      prompt: opposite,
    };
  }
  const viewport = createViewportFromRect(rect, {
    scale: scaleFromRatio(50),
    modelCenterX: 0,
    modelCenterY: 0,
  });
  // Preview must not mutate — only CommandBus execute commits.
  s.bus.execute(new CreateViewportCommand(layoutId, viewport));
  return {
    kind: 'complete',
    status: `MVIEW complete · ${formatViewportScale(viewport.scale)}`,
  };
}

export const mviewCommand: CadEngineCommand = {
  id: 'mview',
  name: 'MVIEW',
  aliases: ['MVIEW', 'MV'],
  description: 'Create a rectangular layout viewport in Paper Space',
  tool: 'select',
  category: 'Other',
  keywords: ['mview', 'viewport', 'layout', 'paper'],
  bootstrap: (bus) => {
    const layoutId = bus.getDocument().activeLayoutId;
    if (!layoutId) {
      return {
        prompt: {
          id: 'need-layout',
          message: 'MVIEW: Switch to a layout tab (Paper Space) first.',
          inputType: 'string',
          optional: true,
        },
        status: 'MVIEW: Switch to a layout tab (Paper Space) first.',
        state: { layoutId: null, corner1: null },
      };
    }
    return {
      state: { layoutId, corner1: null },
    };
  },
  start: () => ({
    prompt: firstCorner,
    status: 'MVIEW: Specify first corner:',
    state: { corner1: null },
  }),
  onPoint: (point, prompt, _ctx, state) => {
    const s = state as MviewState;
    if (prompt.id === 'need-layout') {
      return {
        kind: 'complete',
        status: 'MVIEW cancelled — no active layout',
      };
    }
    if (!s.corner1 && prompt.id === 'first') {
      s.corner1 = point;
      return {
        kind: 'continue',
        prompt: opposite,
        lastPoint: point,
        status: 'MVIEW: Specify opposite corner:',
        preview: null,
      };
    }
    if (prompt.id === 'opposite' && s.corner1) {
      return commit(s, s.corner1, point);
    }
    return { kind: 'reject', message: 'Unexpected point', prompt };
  },
  onText: (text, prompt, _ctx, state) => {
    const s = state as MviewState;
    if (prompt.id === 'need-layout') {
      return {
        kind: 'complete',
        status: 'MVIEW cancelled — no active layout',
        message: text,
      };
    }
    return { kind: 'reject', message: 'Enter a point', prompt };
  },
  onMove: (point, prompt, _ctx, state) => {
    const s = state as MviewState;
    if (prompt.id !== 'opposite' || !s.corner1) {
      return { preview: null, dynamic: null };
    }
    const rect = normalizeViewportRect(s.corner1, point, MIN_VIEWPORT_SIZE);
    return {
      preview: {
        kind: 'rectangle',
        start: s.corner1,
        end: { x: rect.x + rect.width, y: rect.y + rect.height },
      },
      dynamic: {
        length: rect.width,
        width: rect.height,
      },
      status: `MVIEW: ${rect.width.toFixed(1)} × ${rect.height.toFixed(1)}`,
    };
  },
  onCancel: (state) => {
    const s = state as MviewState;
    s.corner1 = null;
  },
};
