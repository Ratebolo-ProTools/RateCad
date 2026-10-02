/**
 * UNITS / -UNITS / DIMSTYLE / DIST command-engine definitions.
 */

import type { CommandBus } from '@ratecad/commands';
import { formatWorldByDrawingUnits, distance } from '@ratecad/geometry';
import type { Vec2 } from '@ratecad/core';
import type { CadEngineCommand, CadPromptDefinition } from '../types.js';

type UnitsHost = {
  openUnitsDialog?: () => void;
  openDimStyleDialog?: () => void;
  getUnits?: () => import('@ratecad/core').LengthUnit;
  getWorldUnit?: () => import('@ratecad/core').LengthUnit;
};

function asHost(host: unknown): UnitsHost | null {
  if (!host || typeof host !== 'object') return null;
  return host as UnitsHost;
}

const donePrompt = (message: string): CadPromptDefinition => ({
  id: 'done',
  message,
  inputType: 'string',
  optional: true,
});

/** UNITS — open Drawing Units dialog. */
export const unitsCommand: CadEngineCommand = {
  id: 'units',
  name: 'UNITS',
  aliases: ['UNITS'],
  description: 'Set drawing unit format, precision, and insertion scale',
  tool: 'select',
  category: 'Other',
  keywords: ['units', 'lunits', 'precision', 'architectural', 'decimal'],
  bootstrap: (_bus, host) => {
    const h = asHost(host);
    h?.openUnitsDialog?.();
    return {
      complete: true,
      status: 'UNITS: Drawing Units dialog',
      prompt: donePrompt('UNITS'),
    };
  },
  start: () => ({
    prompt: donePrompt('UNITS'),
    status: 'UNITS',
  }),
  onPoint: () => ({ kind: 'complete' }),
  onText: () => ({ kind: 'complete' }),
};

/**
 * -UNITS — command-line style summary / confirm (opens same dialog for now).
 * Alias kept distinct for AutoCAD muscle memory.
 */
export const dashUnitsCommand: CadEngineCommand = {
  id: 'dash-units',
  name: '-UNITS',
  aliases: ['-UNITS'],
  description: 'Drawing units (command-line / dialog)',
  tool: 'select',
  category: 'Other',
  keywords: ['units', '-units'],
  bootstrap: (_bus, host) => {
    const h = asHost(host);
    h?.openUnitsDialog?.();
    return {
      complete: true,
      status: '-UNITS: Drawing Units',
      prompt: donePrompt('-UNITS'),
    };
  },
  start: () => ({
    prompt: donePrompt('-UNITS'),
    status: '-UNITS',
  }),
  onPoint: () => ({ kind: 'complete' }),
  onText: () => ({ kind: 'complete' }),
};

/** DIMSTYLE / D — open Dimension Style Manager. */
export const dimstyleCommand: CadEngineCommand = {
  id: 'dimstyle',
  name: 'DIMSTYLE',
  aliases: ['D', 'DIMSTY'],
  description: 'Manage dimension styles (primary/alternate units, text, arrows)',
  tool: 'select',
  category: 'Annotate',
  keywords: ['dimstyle', 'dimension', 'style', 'primary', 'alternate'],
  bootstrap: (_bus, host) => {
    const h = asHost(host);
    h?.openDimStyleDialog?.();
    return {
      complete: true,
      status: 'DIMSTYLE: Dimension Style Manager',
      prompt: donePrompt('DIMSTYLE'),
    };
  },
  start: () => ({
    prompt: donePrompt('DIMSTYLE'),
    status: 'DIMSTYLE',
  }),
  onPoint: () => ({ kind: 'complete' }),
  onText: () => ({ kind: 'complete' }),
};

type DistState = {
  bus: CommandBus;
  first: Vec2 | null;
};

/** DIST — measure distance between two points. */
export const distCommand: CadEngineCommand = {
  id: 'dist',
  name: 'DIST',
  aliases: ['DI', 'DIST'],
  description: 'Measure distance between two points',
  tool: 'select',
  category: 'Measure',
  keywords: ['distance', 'measure', 'dist'],
  start: () => ({
    prompt: {
      id: 'first',
      message: 'Specify first point:',
      inputType: 'point',
    },
    status: 'DIST: Specify first point:',
    state: { first: null },
  }),
  onPoint: (point, prompt, ctx, state) => {
    const s = state as DistState;
    if (prompt.id === 'first' || !s.first) {
      s.first = point;
      return {
        kind: 'continue',
        prompt: {
          id: 'second',
          message: 'Specify second point:',
          inputType: 'point',
        },
        lastPoint: point,
        status: 'DIST: Specify second point:',
        preview: null,
      };
    }
    const d = distance(s.first, point);
    const worldUnit = ctx.worldUnit;
    // Prefer drawingUnits formatting when available on bus document
    const doc = s.bus.getDocument();
    const du = doc.settings.drawingUnits;
    const label = du
      ? formatWorldByDrawingUnits(d, worldUnit, du)
      : `${d.toFixed(doc.settings.precision ?? 2)}`;
    const dx = point.x - s.first.x;
    const dy = point.y - s.first.y;
    const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
    return {
      kind: 'complete',
      status: `Distance = ${label},  ΔX=${dx.toFixed(4)}, ΔY=${dy.toFixed(4)}, Angle=${ang.toFixed(2)}°`,
      message: `Distance = ${label}`,
    };
  },
  onText: (_text, prompt, _ctx, _state) => ({
    kind: 'reject',
    message: 'Specify a point',
    prompt,
  }),
  onMove: (point, prompt, _ctx, state) => {
    const s = state as DistState;
    if (prompt.id !== 'second' || !s.first) return { preview: null };
    return {
      preview: { kind: 'line', start: s.first, end: point },
      dynamic: { distance: distance(s.first, point) },
    };
  },
};
