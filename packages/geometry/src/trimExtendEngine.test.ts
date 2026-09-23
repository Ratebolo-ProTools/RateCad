import { describe, expect, it } from 'vitest';
import type { Entity } from '@ratecad/core';
import {
  entitiesCrossedByFence,
  extendEntityMulti,
  fencePickPoint,
  trimEntityMulti,
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

const circle = (
  id: string,
  center: { x: number; y: number },
  radius: number,
): Extract<Entity, { type: 'circle' }> => ({
  id,
  type: 'circle',
  layerId: 'layer-0',
  visible: true,
  locked: false,
  geometry: { center, radius },
  properties: {},
});

const pline = (
  id: string,
  vertices: Array<{ x: number; y: number }>,
  closed = false,
): Extract<Entity, { type: 'polyline' }> => ({
  id,
  type: 'polyline',
  layerId: 'layer-0',
  visible: true,
  locked: false,
  geometry: { vertices, closed },
  properties: {},
});

describe('TrimExtendEngine — basic line trim', () => {
  it('Test 1 — trims beyond boundary (remaining 6m of 10m)', () => {
    const target = line('a', { x: 0, y: 0 }, { x: 10, y: 0 });
    const cutter = line('b', { x: 6, y: -2 }, { x: 6, y: 2 });
    const result = trimEntityMulti(target, [cutter], { x: 8, y: 0 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entities).toHaveLength(1);
      const g = result.entities[0]!;
      expect(g.type).toBe('line');
      if (g.type === 'line') {
        expect(g.geometry.start).toEqual({ x: 0, y: 0 });
        expect(g.geometry.end.x).toBeCloseTo(6);
      }
    }
  });

  it('Test 2 — opposite side removes the other segment', () => {
    const target = line('a', { x: 0, y: 0 }, { x: 10, y: 0 });
    const cutter = line('b', { x: 6, y: -2 }, { x: 6, y: 2 });
    const result = trimEntityMulti(target, [cutter], { x: 2, y: 0 });
    expect(result.ok).toBe(true);
    if (result.ok && result.entities[0]?.type === 'line') {
      expect(result.entities[0].geometry.start.x).toBeCloseTo(6);
      expect(result.entities[0].geometry.end).toEqual({ x: 10, y: 0 });
    }
  });

  it('Test 3 — multiple intersections remove clicked interval only', () => {
    const target = line('a', { x: 0, y: 0 }, { x: 12, y: 0 });
    const cutters = [
      line('c1', { x: 3, y: -1 }, { x: 3, y: 1 }),
      line('c2', { x: 6, y: -1 }, { x: 6, y: 1 }),
      line('c3', { x: 9, y: -1 }, { x: 9, y: 1 }),
    ];
    // Click between 3 and 6 → remove middle-left interval; keep 0-3, 6-9, 9-12
    const result = trimEntityMulti(target, cutters, { x: 4.5, y: 0 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entities.length).toBeGreaterThanOrEqual(2);
      const xs = result.entities
        .filter((e): e is Extract<Entity, { type: 'line' }> => e.type === 'line')
        .flatMap((e) => [e.geometry.start.x, e.geometry.end.x]);
      expect(xs.some((x) => Math.abs(x - 0) < 1e-6)).toBe(true);
      expect(xs.some((x) => Math.abs(x - 3) < 1e-6)).toBe(true);
      expect(xs.some((x) => Math.abs(x - 6) < 1e-6)).toBe(true);
      // Interval 3–6 should be gone: no segment midpoint near 4.5
      for (const e of result.entities) {
        if (e.type !== 'line') continue;
        const mid =
          (e.geometry.start.x + e.geometry.end.x) / 2;
        expect(Math.abs(mid - 4.5)).toBeGreaterThan(0.5);
      }
    }
  });
});

describe('TrimExtendEngine — circle / arc / polyline', () => {
  it('Test 4 — circle becomes arc-backed polyline', () => {
    const c = circle('c', { x: 0, y: 0 }, 5);
    const cutter = line('v', { x: 0, y: -10 }, { x: 0, y: 10 });
    const result = trimEntityMulti(c, [cutter], { x: 5, y: 0 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entities[0]?.type).toBe('polyline');
      const meta = result.entities[0]?.metadata?.arc as
        | { center: { x: number; y: number }; radius: number }
        | undefined;
      expect(meta?.radius).toBeCloseTo(5);
      expect(meta?.center.x).toBeCloseTo(0);
      expect(meta?.center.y).toBeCloseTo(0);
    }
  });

  it('Test 5 — arc-like polyline trim (open curve)', () => {
    const verts = [
      { x: 5, y: 0 },
      { x: 3.5, y: 3.5 },
      { x: 0, y: 5 },
      { x: -3.5, y: 3.5 },
      { x: -5, y: 0 },
    ];
    const arc = pline('arc', verts, false);
    // Cross the first segment interior (5,0)–(3.5,3.5)
    const cutter = line('cut', { x: 4.2, y: -1 }, { x: 4.2, y: 4 });
    const result = trimEntityMulti(arc, [cutter], { x: 5, y: 0.1 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entities.every((e) => e.type === 'polyline')).toBe(true);
      for (const e of result.entities) {
        if (e.type === 'polyline') {
          expect(e.geometry.vertices.length).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });

  it('Test 6 — polyline trims only the picked segment region', () => {
    const target = pline('p', [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 8, y: 0 },
      { x: 12, y: 0 },
    ]);
    const cutter = line('c', { x: 6, y: -1 }, { x: 6, y: 1 });
    const result = trimEntityMulti(target, [cutter], { x: 10, y: 0 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entities.length).toBeGreaterThanOrEqual(1);
      // Right portion beyond 6 should be removed or shortened
      const rightMost = Math.max(
        ...result.entities.flatMap((e) =>
          e.type === 'polyline'
            ? e.geometry.vertices.map((v) => v.x)
            : e.type === 'line'
              ? [e.geometry.start.x, e.geometry.end.x]
              : [0],
        ),
      );
      expect(rightMost).toBeLessThanOrEqual(6 + 1e-6);
    }
  });
});

describe('TrimExtendEngine — cutters, edge, fence', () => {
  it('Test 7 — multiple cutting edges', () => {
    const target = line('t', { x: 0, y: 0 }, { x: 10, y: 0 });
    const cutters = [
      line('a', { x: 4, y: -1 }, { x: 4, y: 1 }),
      line('b', { x: 7, y: -1 }, { x: 7, y: 1 }),
    ];
    const result = trimEntityMulti(target, cutters, { x: 9, y: 0 });
    expect(result.ok).toBe(true);
    if (result.ok && result.entities[0]?.type === 'line') {
      // Click past 7 → remove 7–10; keep pieces including up to 7
      const ends = result.entities
        .filter((e): e is Extract<Entity, { type: 'line' }> => e.type === 'line')
        .map((e) => e.geometry.end.x);
      expect(Math.max(...ends)).toBeCloseTo(7);
    }
  });

  it('Test 8 — Edge No Extend: non-intersecting → fail', () => {
    const target = line('t', { x: 0, y: 0 }, { x: 5, y: 0 });
    const cutter = line('c', { x: 8, y: -1 }, { x: 8, y: 1 });
    const result = trimEntityMulti(target, [cutter], { x: 2, y: 0 }, {
      edgeMode: 'no-extend',
    });
    expect(result.ok).toBe(false);
  });

  it('Test 9 — Edge Extend: natural extension of cutter', () => {
    const target = line('t', { x: 0, y: 0 }, { x: 10, y: 0 });
    // Short cutter that does not reach the target but its infinite line does
    const cutter = line('c', { x: 6, y: 2 }, { x: 6, y: 3 });
    const noExt = trimEntityMulti(target, [cutter], { x: 8, y: 0 }, {
      edgeMode: 'no-extend',
    });
    expect(noExt.ok).toBe(false);
    const ext = trimEntityMulti(target, [cutter], { x: 8, y: 0 }, {
      edgeMode: 'extend',
    });
    expect(ext.ok).toBe(true);
    if (ext.ok && ext.entities[0]?.type === 'line') {
      expect(ext.entities[0].geometry.end.x).toBeCloseTo(6);
    }
  });

  it('Test 10 — Fence crosses multiple objects', () => {
    const entities = [
      line('a', { x: 0, y: 0 }, { x: 10, y: 0 }),
      line('b', { x: 0, y: 2 }, { x: 10, y: 2 }),
      line('c', { x: 0, y: 4 }, { x: 10, y: 4 }),
    ];
    const fence = [
      { x: 5, y: -1 },
      { x: 5, y: 5 },
    ];
    const hit = entitiesCrossedByFence(entities, fence);
    expect(hit).toHaveLength(3);
    expect(fencePickPoint(entities[0]!, fence)).toEqual({ x: 5, y: 0 });
  });
});

describe('TrimExtendEngine — extend + units independence', () => {
  it('extends line to boundary (shared engine)', () => {
    const target = line('a', { x: 0, y: 0 }, { x: 3, y: 0 });
    const boundary = line('b', { x: 10, y: -2 }, { x: 10, y: 2 });
    const result = extendEntityMulti(target, [boundary], { x: 3, y: 0 });
    expect(result.ok).toBe(true);
    if (result.ok && result.entities[0]?.type === 'line') {
      expect(result.entities[0].geometry.end.x).toBeCloseTo(10);
    }
  });

  it('Test 16 — unit independence (mm-scale coords)', () => {
    // Same geometry in mm-like numbers (10000 units = 10m if world is mm)
    const target = line('a', { x: 0, y: 0 }, { x: 10000, y: 0 });
    const cutter = line('b', { x: 6000, y: -100 }, { x: 6000, y: 100 });
    const result = trimLineEntity(target, cutter, { x: 8000, y: 0 });
    expect(result.ok).toBe(true);
    if (result.ok && result.entities[0]?.type === 'line') {
      expect(result.entities[0].geometry.end.x).toBeCloseTo(6000);
    }
  });

  it('allows cutter to also be a potential target (self not required)', () => {
    const a = line('a', { x: 0, y: 0 }, { x: 10, y: 0 });
    const b = line('b', { x: 5, y: -5 }, { x: 5, y: 5 });
    const result = trimEntityMulti(a, [a, b], { x: 8, y: 0 }, {
      allowSelfAsCutter: true,
    });
    expect(result.ok).toBe(true);
  });
});
