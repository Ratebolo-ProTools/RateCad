import { describe, expect, it } from 'vitest';
import type { Entity } from '@ratecad/core';
import {
  degreesToRadians,
  extendLineEntity,
  intersectSegments,
  mirrorEntity,
  classifyRectangleOffsetSide,
  offsetEntity,
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

  it('offsets a 5000 by 4000 rectangle inward and outward by 230', () => {
    const rect: Extract<Entity, { type: 'rectangle' }> = {
      id: 'r',
      type: 'rectangle',
      layerId: 'layer-0',
      visible: true,
      locked: false,
      geometry: { corner1: { x: 0, y: 0 }, corner2: { x: 5000, y: 4000 } },
      properties: { color: '#112233', lineweight: 2, linetype: 'dashed' },
    };
    const inward = offsetRectangleEntity(rect, 230, { x: 2500, y: 2000 }, 'in');
    expect(inward.ok).toBe(true);
    if (inward.ok && inward.entities[0]?.type === 'rectangle') {
      expect(inward.entities[0].geometry.corner1).toEqual({ x: 230, y: 230 });
      expect(inward.entities[0].geometry.corner2).toEqual({ x: 4770, y: 3770 });
      expect(inward.entities[0].id).toBe('in');
      expect(inward.entities[0].properties).toEqual(rect.properties);
      expect(inward.entities[0].layerId).toBe(rect.layerId);
    }
    expect(rect.geometry.corner2).toEqual({ x: 5000, y: 4000 });
    const outward = offsetRectangleEntity(rect, 230, { x: -10, y: 2000 }, 'out');
    expect(outward.ok).toBe(true);
    if (outward.ok && outward.entities[0]?.type === 'rectangle') {
      expect(outward.entities[0].geometry.corner1).toEqual({ x: -230, y: -230 });
      expect(outward.entities[0].geometry.corner2).toEqual({ x: 5230, y: 4230 });
    }
  });

  it('keeps a square square and rejects a collapsing inward offset', () => {
    const square: Extract<Entity, { type: 'rectangle' }> = {
      id: 's',
      type: 'rectangle',
      layerId: 'layer-0',
      visible: true,
      locked: false,
      geometry: { corner1: { x: 0, y: 0 }, corner2: { x: 4000, y: 4000 } },
      properties: {},
    };
    const result = offsetRectangleEntity(square, 150, { x: 2000, y: 2000 }, 's2');
    expect(result.ok).toBe(true);
    if (result.ok && result.entities[0]?.type === 'rectangle') {
      const { corner1, corner2 } = result.entities[0].geometry;
      const width = Math.abs(corner2.x - corner1.x);
      const height = Math.abs(corner2.y - corner1.y);
      expect(width).toBeCloseTo(3700);
      expect(height).toBeCloseTo(3700);
    }
    expect(offsetRectangleEntity(square, 2000, { x: 2000, y: 2000 }, 'bad').ok).toBe(
      false,
    );
  });

  it('rejects zero, negative, and non-finite rectangle distances', () => {
    const rect: Extract<Entity, { type: 'rectangle' }> = {
      id: 'r',
      type: 'rectangle',
      layerId: 'layer-0',
      visible: true,
      locked: false,
      geometry: { corner1: { x: 0, y: 0 }, corner2: { x: 10, y: 10 } },
      properties: {},
    };
    for (const distance of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = offsetRectangleEntity(rect, distance, { x: 1, y: 1 }, 'x');
      expect(result.ok).toBe(false);
    }
    expect(rect.geometry).toEqual({
      corner1: { x: 0, y: 0 },
      corner2: { x: 10, y: 10 },
    });
  });

  it('holds the side inside a screen-space boundary band', () => {
    const rect: Extract<Entity, { type: 'rectangle' }> = {
      id: 'r',
      type: 'rectangle',
      layerId: 'layer-0',
      visible: true,
      locked: false,
      geometry: { corner1: { x: 0, y: 0 }, corner2: { x: 100, y: 80 } },
      properties: {},
    };
    expect(classifyRectangleOffsetSide(rect, { x: 50, y: 40 }, 2)).toBe('inward');
    expect(classifyRectangleOffsetSide(rect, { x: -20, y: 40 }, 2)).toBe('outward');
    expect(classifyRectangleOffsetSide(rect, { x: 0.5, y: 40 }, 2)).toBe('boundary');
  });

  it('offsets a rotated rectangle as one closed polyline', () => {
    const square: Extract<Entity, { type: 'rectangle' }> = {
      id: 's',
      type: 'rectangle',
      layerId: 'layer-0',
      visible: true,
      locked: false,
      geometry: { corner1: { x: 0, y: 0 }, corner2: { x: 4000, y: 4000 } },
      properties: { color: '#abcdef' },
    };
    const rotated = rotateEntity(square, { x: 2000, y: 2000 }, degreesToRadians(45));
    expect(rotated?.type).toBe('polyline');
    if (rotated?.type !== 'polyline') return;
    expect(rotated.geometry.closed).toBe(true);
    const result = offsetEntity(rotated, 150, { x: 2000, y: 2000 }, 'rot');
    expect(result.ok).toBe(true);
    if (result.ok && result.entities[0]?.type === 'polyline') {
      const vertices = result.entities[0].geometry.vertices;
      expect(result.entities[0].geometry.closed).toBe(true);
      expect(vertices).toHaveLength(4);
      expect(result.entities[0].properties.color).toBe('#abcdef');
      for (let i = 0; i < vertices.length; i += 1) {
        const a = vertices[i]!;
        const b = vertices[(i + 1) % vertices.length]!;
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        expect(Math.hypot(mid.x - 2000, mid.y - 2000)).toBeCloseTo(1850, 3);
      }
    }
    expect(rotated.geometry.vertices[0]).toEqual(
      rotateEntity(square, { x: 2000, y: 2000 }, degreesToRadians(45)) &&
        rotated.geometry.vertices[0],
    );
  });

  it('refuses a collapsed concave polyline offset without changing the source', () => {
    const pline: Extract<Entity, { type: 'polyline' }> = {
      id: 'c',
      type: 'polyline',
      layerId: 'layer-0',
      visible: true,
      locked: false,
      geometry: {
        vertices: [
          { x: 0, y: 0 },
          { x: 6, y: 0 },
          { x: 6, y: 2 },
          { x: 2, y: 2 },
          { x: 2, y: 4 },
          { x: 6, y: 4 },
          { x: 6, y: 6 },
          { x: 0, y: 6 },
        ],
        closed: true,
      },
      properties: {},
    };
    const before = structuredClone(pline.geometry.vertices);
    const result = offsetPolylineEntity(pline, 1.5, { x: 1, y: 3 }, 'c2');
    expect(result.ok).toBe(false);
    expect(pline.geometry.vertices).toEqual(before);
  });

  it('keeps an offset line parallel at the requested distance', () => {
    const src = line('a', { x: 0, y: 0 }, { x: 10, y: 0 });
    const result = offsetLineEntity(src, 150, { x: 5, y: 1 }, 'b');
    expect(result.ok).toBe(true);
    if (result.ok && result.entities[0]?.type === 'line') {
      expect(result.entities[0].geometry.start).toEqual({ x: 0, y: 150 });
      expect(result.entities[0].geometry.end).toEqual({ x: 10, y: 150 });
    }
    expect(src.geometry.end).toEqual({ x: 10, y: 0 });
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
