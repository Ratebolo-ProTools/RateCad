import { describe, expect, it } from 'vitest';
import type { WallEntity } from '@ratecad/core';
import {
  detectClosedLoops,
  findLoopAtPoint,
  pointInPolygon,
  polygonArea,
  polygonCentroid,
} from './rooms.js';

function wall(
  id: string,
  start: { x: number; y: number },
  end: { x: number; y: number },
): WallEntity {
  return {
    id,
    type: 'wall',
    layerId: 'layer-walls',
    visible: true,
    locked: false,
    geometry: {
      start,
      end,
      thickness: 0.75,
      height: 8,
      justification: 'center',
    },
    properties: {},
  };
}

describe('room topology', () => {
  it('detects a rectangular closed loop and area', () => {
    const walls = [
      wall('w1', { x: 0, y: 0 }, { x: 10, y: 0 }),
      wall('w2', { x: 10, y: 0 }, { x: 10, y: 12 }),
      wall('w3', { x: 10, y: 12 }, { x: 0, y: 12 }),
      wall('w4', { x: 0, y: 12 }, { x: 0, y: 0 }),
    ];
    const result = detectClosedLoops(walls);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.loops.length).toBeGreaterThanOrEqual(1);
    const loop = result.loops[0]!;
    expect(loop.wallIds).toHaveLength(4);
    expect(loop.area).toBeCloseTo(120, 5);
    expect(pointInPolygon({ x: 5, y: 6 }, loop.polygon)).toBe(true);
    expect(pointInPolygon({ x: 20, y: 6 }, loop.polygon)).toBe(false);
  });

  it('rejects open wall networks', () => {
    const walls = [
      wall('w1', { x: 0, y: 0 }, { x: 10, y: 0 }),
      wall('w2', { x: 10, y: 0 }, { x: 10, y: 12 }),
      wall('w3', { x: 10, y: 12 }, { x: 0, y: 12 }),
      // missing closing wall
    ];
    const result = detectClosedLoops(walls);
    expect(result.ok).toBe(false);
  });

  it('finds loop at click point (smallest containing)', () => {
    const walls = [
      wall('w1', { x: 0, y: 0 }, { x: 10, y: 0 }),
      wall('w2', { x: 10, y: 0 }, { x: 10, y: 10 }),
      wall('w3', { x: 10, y: 10 }, { x: 0, y: 10 }),
      wall('w4', { x: 0, y: 10 }, { x: 0, y: 0 }),
    ];
    const at = findLoopAtPoint(walls, { x: 3, y: 3 });
    expect('wallIds' in at).toBe(true);
    if (!('wallIds' in at)) return;
    expect(at.area).toBeCloseTo(100, 5);

    const miss = findLoopAtPoint(walls, { x: 50, y: 50 });
    expect('ok' in miss && miss.ok === false).toBe(true);
  });

  it('supports L-shaped non-rectangular rooms', () => {
    // L polygon via 6 walls
    const walls = [
      wall('a', { x: 0, y: 0 }, { x: 8, y: 0 }),
      wall('b', { x: 8, y: 0 }, { x: 8, y: 4 }),
      wall('c', { x: 8, y: 4 }, { x: 4, y: 4 }),
      wall('d', { x: 4, y: 4 }, { x: 4, y: 8 }),
      wall('e', { x: 4, y: 8 }, { x: 0, y: 8 }),
      wall('f', { x: 0, y: 8 }, { x: 0, y: 0 }),
    ];
    const result = detectClosedLoops(walls);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const loop = result.loops[0]!;
    // Area = 8*4 + 4*4 = 48
    expect(loop.area).toBeCloseTo(48, 4);
    expect(pointInPolygon({ x: 2, y: 2 }, loop.polygon)).toBe(true);
    expect(pointInPolygon({ x: 6, y: 6 }, loop.polygon)).toBe(false);
  });

  it('computes polygon area and centroid', () => {
    const poly = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 3 },
      { x: 0, y: 3 },
    ];
    expect(polygonArea(poly)).toBeCloseTo(12, 6);
    const c = polygonCentroid(poly);
    expect(c.x).toBeCloseTo(2, 5);
    expect(c.y).toBeCloseTo(1.5, 5);
  });
});
