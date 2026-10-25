/**
 * ZOOM / Z — Extents, Window, Previous (Phase P1).
 * Camera changes go through NavigationHost; no drawing geometry is created.
 */

import type { Vec2 } from '@ratecad/core';
import { matchOption } from '../parsers.js';
import type {
  CadCommandOption,
  CadEngineCommand,
  CadPromptDefinition,
} from '../types.js';

export interface NavigationHost {
  zoomExtents(): { ok: boolean; message: string };
  zoomWindow(a: Vec2, b: Vec2): { ok: boolean; message: string };
  zoomPrevious(): { ok: boolean; message: string };
  beginPanTool(): void;
}

function asNavHost(host: unknown): NavigationHost | null {
  if (!host || typeof host !== 'object') return null;
  const h = host as Record<string, unknown>;
  if (typeof h.zoomExtents !== 'function') return null;
  if (typeof h.zoomWindow !== 'function') return null;
  if (typeof h.zoomPrevious !== 'function') return null;
  return host as NavigationHost;
}

type ZoomState = {
  host: NavigationHost | null;
  corner1: Vec2 | null;
};

const ZOOM_OPTIONS: CadCommandOption[] = [
  { id: 'extents', label: 'Extents', aliases: ['E', 'EXTENTS', 'EXT'] },
  { id: 'window', label: 'Window', aliases: ['W', 'WINDOW', 'WIN'] },
  { id: 'previous', label: 'Previous', aliases: ['P', 'PREVIOUS', 'PREV'] },
];

const menuPrompt: CadPromptDefinition = {
  id: 'menu',
  message:
    'Specify corner of window or [Extents/Window/Previous]:',
  inputType: 'point',
  options: ZOOM_OPTIONS,
};

const firstCorner: CadPromptDefinition = {
  id: 'first',
  message: 'Specify first corner:',
  inputType: 'point',
};

const oppositeCorner: CadPromptDefinition = {
  id: 'opposite',
  message: 'Specify opposite corner:',
  inputType: 'point',
};

function runExtents(host: NavigationHost | null) {
  if (!host) {
    return {
      kind: 'reject' as const,
      message: 'ZOOM Extents unavailable',
      prompt: menuPrompt,
    };
  }
  const result = host.zoomExtents();
  if (!result.ok) {
    return {
      kind: 'reject' as const,
      message: result.message,
      prompt: menuPrompt,
    };
  }
  return { kind: 'complete' as const, status: result.message };
}

function runPrevious(host: NavigationHost | null) {
  if (!host) {
    return {
      kind: 'reject' as const,
      message: 'ZOOM Previous unavailable',
      prompt: menuPrompt,
    };
  }
  const result = host.zoomPrevious();
  if (!result.ok) {
    return {
      kind: 'reject' as const,
      message: result.message,
      prompt: menuPrompt,
    };
  }
  return { kind: 'complete' as const, status: result.message };
}

function applyWindow(
  host: NavigationHost | null,
  a: Vec2,
  b: Vec2,
): ReturnType<CadEngineCommand['onPoint']> {
  if (!host) {
    return {
      kind: 'reject',
      message: 'ZOOM Window unavailable',
      prompt: menuPrompt,
    };
  }
  const result = host.zoomWindow(a, b);
  if (!result.ok) {
    return {
      kind: 'reject',
      message: result.message,
      prompt: firstCorner,
    };
  }
  return { kind: 'complete', status: result.message };
}

export const zoomCommand: CadEngineCommand = {
  id: 'zoom',
  name: 'ZOOM',
  aliases: ['Z'],
  description: 'Zoom Extents, Window, or Previous view',
  tool: 'select',
  category: 'Other',
  keywords: [
    'zoom',
    'extents',
    'window',
    'previous',
    'view',
    'fit',
    'navigation',
  ],
  bootstrap: (_bus, host) => ({
    state: { host: asNavHost(host), corner1: null },
  }),
  start: () => ({
    prompt: menuPrompt,
    status: 'ZOOM: Specify corner of window or [Extents/Window/Previous]:',
  }),
  onPoint: (point, prompt, _ctx, state) => {
    const s = state as ZoomState;
    if (prompt.id === 'menu' || prompt.id === 'first') {
      s.corner1 = point;
      return {
        kind: 'continue',
        prompt: oppositeCorner,
        lastPoint: point,
        status: 'ZOOM: Specify opposite corner:',
        preview: {
          kind: 'rectangle',
          start: point,
          end: point,
        },
      };
    }
    if (prompt.id === 'opposite' && s.corner1) {
      return applyWindow(s.host, s.corner1, point);
    }
    return {
      kind: 'reject',
      message: 'Unexpected ZOOM point',
      prompt: menuPrompt,
    };
  },
  onMove: (point, prompt, _ctx, state) => {
    const s = state as ZoomState;
    if (prompt.id === 'opposite' && s.corner1) {
      return {
        preview: {
          kind: 'rectangle',
          start: s.corner1,
          end: point,
        },
        status: 'ZOOM: Specify opposite corner:',
      };
    }
    return {};
  },
  onText: (text, prompt, _ctx, state) => {
    const s = state as ZoomState;
    const opt = matchOption(text, ZOOM_OPTIONS);
    if (opt.ok) {
      if (opt.optionId === 'extents') return runExtents(s.host);
      if (opt.optionId === 'previous') return runPrevious(s.host);
      if (opt.optionId === 'window') {
        s.corner1 = null;
        return {
          kind: 'continue',
          prompt: firstCorner,
          status: 'ZOOM: Specify first corner:',
          preview: null,
        };
      }
    }
    // At opposite corner, reject non-point text
    if (prompt.id === 'opposite' || prompt.id === 'first') {
      return {
        kind: 'reject',
        message: 'Specify a point or press ESC to cancel',
        prompt,
      };
    }
    return {
      kind: 'reject',
      message: 'Enter E, W, P, or pick a window corner',
      prompt: menuPrompt,
    };
  },
};

/** Immediate ZOOM Extents (alias convenience). */
export const zoomExtentsCommand: CadEngineCommand = {
  id: 'zoom-extents',
  name: 'ZOOMEXTENTS',
  aliases: ['ZE'],
  description: 'Zoom to drawing extents',
  tool: 'select',
  category: 'Other',
  keywords: ['zoom', 'extents', 'fit', 'all'],
  bootstrap: (_bus, host) => {
    const nav = asNavHost(host);
    if (!nav) {
      return {
        complete: true,
        status: 'ZOOM Extents unavailable',
      };
    }
    const result = nav.zoomExtents();
    return {
      complete: true,
      status: result.message,
    };
  },
  start: () => ({
    prompt: {
      id: 'done',
      message: '',
      inputType: 'string',
      optional: true,
    },
  }),
  onPoint: () => ({ kind: 'complete' }),
  onText: () => ({ kind: 'complete' }),
};

export const panCommand: CadEngineCommand = {
  id: 'pan',
  name: 'PAN',
  aliases: ['P'],
  description: 'Pan the drawing view',
  tool: 'pan',
  category: 'Other',
  keywords: ['pan', 'hand', 'move view', 'navigation'],
  handoffToTool: true,
  bootstrap: (_bus, host) => {
    const nav = asNavHost(host);
    nav?.beginPanTool();
    return {};
  },
  start: () => ({
    prompt: {
      id: 'handoff',
      message: 'PAN: Drag to pan — ESC for Select',
      inputType: 'string',
      optional: true,
    },
    status: 'PAN: Drag to pan — ESC for Select',
  }),
  onPoint: () => ({ kind: 'complete' }),
  onText: () => ({ kind: 'complete' }),
};
