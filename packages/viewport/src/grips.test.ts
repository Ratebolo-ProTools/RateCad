import { describe, expect, it } from 'vitest';
import type { Entity } from '@ratecad/core';
import { getEntityGrips } from '../src/grips.js';

describe('getEntityGrips', () => {
  it('returns start/end for lines', () => {
    const line: Entity = {
      id: 'l1',
      type: 'line',
      layerId: '0',
      visible: true,
      locked: false,
      geometry: { start: { x: 0, y: 0 }, end: { x: 2, y: 2 } },
      properties: {},
    };
    const grips = getEntityGrips(line);
    expect(grips.map((g) => g.role)).toEqual(['start', 'end']);
  });

  it('returns vertex grips for polylines', () => {
    const pline: Entity = {
      id: 'p1',
      type: 'polyline',
      layerId: '0',
      visible: true,
      locked: false,
      geometry: {
        vertices: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
        ],
        closed: false,
      },
      properties: {},
    };
    expect(getEntityGrips(pline)).toHaveLength(3);
  });

  it('returns center and quadrant grips for circles', () => {
    const circle: Entity = {
      id: 'c1',
      type: 'circle',
      layerId: '0',
      visible: true,
      locked: false,
      geometry: { center: { x: 0, y: 0 }, radius: 2 },
      properties: {},
    };
    const grips = getEntityGrips(circle);
    expect(grips.some((g) => g.role === 'center')).toBe(true);
    expect(grips.filter((g) => g.role === 'quadrant')).toHaveLength(4);
  });
});
