import { describe, expect, it } from 'vitest';
import type { Entity } from '@ratecad/core';
import {
  degreesToRadians,
  extendLineEntity,
  intersectSegments,
  mirrorEntity,
  offsetLineEntity,
  offsetPolylineEntity,
  offsetRectangleEntity,
  rotateEntity,
  scaleEntity,
  trimLineEntity,
} from '../src/index.js';

const line = (
  id: string,
  start: { x: number; y: number },
  end: { x: number; y: number },
): Extract<Entity, { type: 'line' }> => ({
  id,
  type: 'line',
  layerId: 'layer-0',
  visible: true,
  locked: false,
  geometry: { start, end },
  properties: {},
});

describe('intersectSegments', () => {
  it('finds line-line intersection', () => {
    const p = intersectSegments(
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: -5 },
      { x: 5, y: 5 },
    );
    expect(p).toEqual({ x: 5, y: 0 });
  });

  it('returns null for parallel segments', () => {
    expect(
      intersectSegments(
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 0, y: 1 },
        { x: 10, y: 1 },
      ),
    ).toBeNull();
  });
});

describe('trimLineEntity', () => {
  it('trims line at intersection (remove end portion)', () => {
    const target = line('a', { x: 0, y: 0 }, { x: 10, y: 0 });
    const cutter = line('b', { x: 5, y: -2 }, { x: 5, y: 2 });
    const result = trimLineEntity(target, cutter, { x: 8, y: 0 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entities).toHaveLength(1);
      const g = result.entities[0]!;
      expect(g.type).toBe('line');
      if (g.type === 'line') {
        expect(g.geometry.start).toEqual({ x: 0, y: 0 });
        expect(g.geometry.end.x).toBeCloseTo(5);
        expect(g.geometry.end.y).toBeCloseTo(0);
      }
    }
  });

  it('rejects trim with no intersection', () => {
    const target = line('a', { x: 0, y: 0 }, { x: 2, y: 0 });
    const cutter = line('b', { x: 5, y: -1 }, { x: 5, y: 1 });
    const result = trimLineEntity(target, cutter, { x: 1, y: 0 });
    expect(result.ok).toBe(false);
  });
});

describe('extendLineEntity', () => {
  it('extends line to boundary', () => {
    const target = line('a', { x: 0, y: 0 }, { x: 3, y: 0 });
    const boundary = line('b', { x: 10, y: -2 }, { x: 10, y: 2 });
    const result = extendLineEntity(target, boundary, { x: 3, y: 0 });
    expect(result.ok).toBe(true);
    if (result.ok && result.entities[0]?.type === 'line') {
      expect(result.entities[0].geometry.end.x).toBeCloseTo(10);
      expect(result.entities[0].geometry.start).toEqual({ x: 0, y: 0 });
    }
  });
});

describe('offset', () => {
  it('offsets a line by distance', () => {
    const src = line('a', { x: 0, y: 0 }, { x: 10, y: 0 });
    const result = offsetLineEntity(src, 2, { x: 5, y: 1 }, 'b');
    expect(result.ok).toBe(true);
    if (result.ok && result.entities[0]?.type === 'line') {
      const g = result.entities[0].geometry;
      expect(g.start.y).toBeCloseTo(2);
      expect(g.end.y).toBeCloseTo(2);
      expect(result.entities[0].id).toBe('b');
    }
  });

  it('offsets a polyline', () => {
    const pline: Extract<Entity, { type: 'polyline' }> = {
      id: 'p',
      type: 'polyline',
      layerId: 'layer-0',
      visible: true,
      locked: false,
      geometry: {
        vertices: [
          { x: 0, y: 0 },
          { x: 4, y: 0 },
          { x: 4, y: 3 },
        ],
        closed: false,
      },
      properties: {},
    };
    const result = offsetPolylineEntity(pline, 1, { x: 1, y: 1 }, 'p2');
    expect(result.ok).toBe(true);
    if (result.ok && result.entities[0]?.type === 'polyline') {
      expect(result.entities[0].geometry.vertices.length).toBeGreaterThanOrEqual(2);
      expect(result.entities[0].id).toBe('p2');
    }
  });

  it('offsets a rectangle outward', () => {
    const rect: Extract<Entity, { type: 'rectangle' }> = {
      id: 'r',
      type: 'rectangle',
      layerId: 'layer-0',
      visible: true,
      locked: false,
      geometry: { corner1: { x: 0, y: 0 }, corner2: { x: 4, y: 2 } },
      properties: {},
    };
    const result = offsetRectangleEntity(rect, 1, { x: 10, y: 10 }, 'r2');
    expect(result.ok).toBe(true);
    if (result.ok && result.entities[0]?.type === 'rectangle') {
      expect(result.entities[0].geometry.corner1).toEqual({ x: -1, y: -1 });
      expect(result.entities[0].geometry.corner2).toEqual({ x: 5, y: 3 });
    }
  });
});

describe('mirror / rotate / scale', () => {
  it('mirrors a line across Y axis', () => {
    const src = line('a', { x: 2, y: 1 }, { x: 4, y: 1 });
    const m = mirrorEntity(src, { x: 0, y: 0 }, { x: 0, y: 1 }, 'm1');
    expect(m?.type).toBe('line');
    if (m?.type === 'line') {
      expect(m.geometry.start.x).toBeCloseTo(-2);
      expect(m.geometry.end.x).toBeCloseTo(-4);
      expect(m.id).toBe('m1');
    }
  });

  it('rotates a line 90 degrees', () => {
    const src = line('a', { x: 1, y: 0 }, { x: 2, y: 0 });
    const r = rotateEntity(src, { x: 0, y: 0 }, degreesToRadians(90));
    expect(r?.type).toBe('line');
    if (r?.type === 'line') {
      expect(r.geometry.start.x).toBeCloseTo(0);
      expect(r.geometry.start.y).toBeCloseTo(1);
      expect(r.geometry.end.x).toBeCloseTo(0);
      expect(r.geometry.end.y).toBeCloseTo(2);
    }
  });

  it('rotates 45 degrees', () => {
    const src = line('a', { x: 1, y: 0 }, { x: 1, y: 0 });
    // zero-length invalid — use proper line
    const src2 = line('a', { x: 1, y: 0 }, { x: 2, y: 0 });
    const r = rotateEntity(src2, { x: 0, y: 0 }, degreesToRadians(45));
    expect(r).toBeTruthy();
  });

  it('scales 2x and 0.5x', () => {
    const src = line('a', { x: 2, y: 0 }, { x: 4, y: 0 });
    const big = scaleEntity(src, { x: 0, y: 0 }, 2);
    if (big?.type === 'line') {
      expect(big.geometry.end).toEqual({ x: 8, y: 0 });
    }
    const small = scaleEntity(src, { x: 0, y: 0 }, 0.5);
    if (small?.type === 'line') {
      expect(small.geometry.end).toEqual({ x: 2, y: 0 });
    }
  });

  it('rejects non-positive scale', () => {
    const src = line('a', { x: 0, y: 0 }, { x: 1, y: 0 });
    expect(scaleEntity(src, { x: 0, y: 0 }, 0)).toBeNull();
    expect(scaleEntity(src, { x: 0, y: 0 }, -1)).toBeNull();
  });

  it('mirrors circle and polyline', () => {
    const circle: Entity = {
      id: 'c',
      type: 'circle',
      layerId: 'layer-0',
      visible: true,
      locked: false,
      geometry: { center: { x: 3, y: 0 }, radius: 1 },
      properties: {},
    };
    const mc = mirrorEntity(circle, { x: 0, y: 0 }, { x: 0, y: 1 }, 'c2');
    if (mc?.type === 'circle') {
      expect(mc.geometry.center.x).toBeCloseTo(-3);
      expect(mc.geometry.radius).toBe(1);
    }

    const pline: Entity = {
      id: 'p',
      type: 'polyline',
      layerId: 'layer-0',
      visible: true,
      locked: false,
      geometry: {
        vertices: [
          { x: 1, y: 0 },
          { x: 2, y: 1 },
          { x: 3, y: 0 },
        ],
        closed: false,
      },
      properties: {},
    };
    const mp = mirrorEntity(pline, { x: 0, y: 0 }, { x: 0, y: 1 }, 'p2');
    expect(mp?.type).toBe('polyline');
  });

  it('mirrors rectangle', () => {
    const rect: Entity = {
      id: 'r',
      type: 'rectangle',
      layerId: 'layer-0',
      visible: true,
      locked: false,
      geometry: { corner1: { x: 1, y: 1 }, corner2: { x: 3, y: 2 } },
      properties: {},
    };
    const m = mirrorEntity(rect, { x: 0, y: 0 }, { x: 0, y: 1 }, 'r2');
    expect(m?.type).toBe('rectangle');
  });
});
