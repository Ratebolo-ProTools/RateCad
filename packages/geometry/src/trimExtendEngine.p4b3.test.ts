/**
 * P4-B3 — EXTEND geometry hardening regression tests.
 * Uses production extendEntityMulti / planOpenSegmentExtend (no mocks).
 */
import { describe, expect, it } from 'vitest';
import type { Entity } from '@ratecad/core';
import {
  extendEntityMulti,
  extendPreviewMulti,
  planOpenSegmentExtend,
  segmentsAreParallel,
  trimEntityMulti,
} from './trimExtendEngine.js';

const line = (
  id: string,
  start: { x: number; y: number },
  end: { x: number; y: number },
  props: Record<string, unknown> = {},
): Extract<Entity, { type: 'line' }> => ({
  id,
  type: 'line',
  layerId: 'layer-0',
  visible: true,
  locked: false,
  geometry: { start, end },
  properties: props as Entity['properties'],
  metadata: { source: id },
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
  properties: { color: '#00aaff', linetype: 'Dashed' },
  metadata: { poly: true },
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

describe('P4-B3 EXTEND geometry', () => {
  it('1: single boundary extension (END)', () => {
    const target = line('t', { x: 0, y: 0 }, { x: 3, y: 0 });
    const b = line('b', { x: 10, y: -2 }, { x: 10, y: 2 });
    const r = extendEntityMulti(target, [b], { x: 3, y: 0 });
    expect(r.ok).toBe(true);
    if (r.ok && r.entities[0]?.type === 'line') {
      expect(r.entities[0].geometry.start).toEqual({ x: 0, y: 0 });
      expect(r.entities[0].geometry.end.x).toBeCloseTo(10);
    }
  });

  it('2: multiple boundaries — nearest forward hit wins', () => {
    const target = line('t', { x: 0, y: 0 }, { x: 2, y: 0 });
    const near = line('n', { x: 5, y: -1 }, { x: 5, y: 1 });
    const far = line('f', { x: 12, y: -1 }, { x: 12, y: 1 });
    const r = extendEntityMulti(target, [far, near], { x: 2, y: 0 });
    expect(r.ok).toBe(true);
    if (r.ok && r.entities[0]?.type === 'line') {
      expect(r.entities[0].geometry.end.x).toBeCloseTo(5);
    }
  });

  it('3/4: START vs END endpoint from pick', () => {
    const target = line('t', { x: 0, y: 0 }, { x: 4, y: 0 });
    const left = line('L', { x: -3, y: -1 }, { x: -3, y: 1 });
    const right = line('R', { x: 9, y: -1 }, { x: 9, y: 1 });
    const startPick = extendEntityMulti(target, [left, right], { x: 0.2, y: 0 });
    expect(startPick.ok).toBe(true);
    if (startPick.ok && startPick.entities[0]?.type === 'line') {
      expect(startPick.entities[0].geometry.start.x).toBeCloseTo(-3);
      expect(startPick.entities[0].geometry.end).toEqual({ x: 4, y: 0 });
    }
    const endPick = extendEntityMulti(target, [left, right], { x: 3.8, y: 0 });
    expect(endPick.ok).toBe(true);
    if (endPick.ok && endPick.entities[0]?.type === 'line') {
      expect(endPick.entities[0].geometry.start).toEqual({ x: 0, y: 0 });
      expect(endPick.entities[0].geometry.end.x).toBeCloseTo(9);
    }
  });

  it('5: reversed line direction still respects click end', () => {
    const target = line('t', { x: 10, y: 0 }, { x: 0, y: 0 }); // reversed
    const b = line('b', { x: -4, y: -1 }, { x: -4, y: 1 });
    const r = extendEntityMulti(target, [b], { x: 0.1, y: 0 });
    expect(r.ok).toBe(true);
    if (r.ok && r.entities[0]?.type === 'line') {
      // pick near geometric end at x=0 → extend that end left to -4
      expect(r.entities[0].geometry.end.x).toBeCloseTo(-4);
      expect(r.entities[0].geometry.start).toEqual({ x: 10, y: 0 });
    }
  });

  it('6: parallel geometry fails safely', () => {
    const target = line('t', { x: 0, y: 0 }, { x: 4, y: 0 });
    const b = line('p', { x: 0, y: 2 }, { x: 4, y: 2 });
    const r = extendEntityMulti(target, [b], { x: 4, y: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Parallel/i);
    expect(
      segmentsAreParallel(
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 0, y: 2 },
        { x: 4, y: 2 },
      ),
    ).toBe(true);
  });

  it('7: collinear geometry fails safely', () => {
    const target = line('t', { x: 0, y: 0 }, { x: 3, y: 0 });
    const b = line('c', { x: 5, y: 0 }, { x: 9, y: 0 });
    const r = extendEntityMulti(target, [b], { x: 3, y: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Collinear|no transverse|No extension/i);
  });

  it('8: boundary behind endpoint rejected', () => {
    const target = line('t', { x: 0, y: 0 }, { x: 4, y: 0 });
    const behind = line('b', { x: -2, y: -1 }, { x: -2, y: 1 });
    const r = extendEntityMulti(target, [behind], { x: 4, y: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/behind|No extension|Parallel/i);
  });

  it('9: already-touching boundary is a no-op reject', () => {
    const target = line('t', { x: 0, y: 0 }, { x: 5, y: 0 });
    const b = line('b', { x: 5, y: -2 }, { x: 5, y: 2 });
    const r = extendEntityMulti(target, [b], { x: 5, y: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Already intersecting|nothing to extend/i);
  });

  it('10: near-endpoint pick still chooses that end', () => {
    const plan = planOpenSegmentExtend(
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 4.99, y: 0.01 },
      [line('b', { x: 8, y: -1 }, { x: 8, y: 1 })],
      'no-extend',
    );
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.extendStart).toBe(false);
      expect(plan.hit.x).toBeCloseTo(8);
    }
  });

  it('11: tangent circle boundary', () => {
    // Horizontal line y=0 ending at x=2; circle center (5,1) r=1 → tangent at (5,0)
    const target = line('t', { x: 0, y: 0 }, { x: 2, y: 0 });
    const c = circle('c', { x: 5, y: 1 }, 1);
    const r = extendEntityMulti(target, [c], { x: 2, y: 0 });
    expect(r.ok).toBe(true);
    if (r.ok && r.entities[0]?.type === 'line') {
      expect(r.entities[0].geometry.end.x).toBeCloseTo(5, 5);
      expect(r.entities[0].geometry.end.y).toBeCloseTo(0, 5);
    }
  });

  it('12: circle as boundary (non-tangent forward hit)', () => {
    const target = line('t', { x: 0, y: 0 }, { x: 1, y: 0 });
    const c = circle('c', { x: 5, y: 0 }, 1);
    const r = extendEntityMulti(target, [c], { x: 1, y: 0 });
    expect(r.ok).toBe(true);
    if (r.ok && r.entities[0]?.type === 'line') {
      expect(r.entities[0].geometry.end.x).toBeCloseTo(4);
    }
  });

  it('13: open polyline extends terminal only', () => {
    const poly = pline('p', [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
    ]);
    const b = line('b', { x: 2, y: 5 }, { x: 6, y: 5 });
    // Pick near last vertex — extend upward terminal
    const r = extendEntityMulti(poly, [b], { x: 2, y: 2 });
    expect(r.ok).toBe(true);
    if (r.ok && r.entities[0]?.type === 'polyline') {
      const v = r.entities[0].geometry.vertices;
      expect(v).toHaveLength(3);
      expect(v[0]).toEqual({ x: 0, y: 0 });
      expect(v[1]).toEqual({ x: 2, y: 0 });
      expect(v[2]!.y).toBeCloseTo(5);
      expect(r.entities[0].properties.color).toBe('#00aaff');
      expect(r.entities[0].metadata).toMatchObject({ poly: true });
    }
  });

  it('14: closed polyline rejected', () => {
    const poly = pline(
      'c',
      [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 3 },
      ],
      true,
    );
    const b = line('b', { x: 10, y: -1 }, { x: 10, y: 1 });
    const r = extendEntityMulti(poly, [b], { x: 4, y: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Closed polyline/i);
  });

  it('15: invalid entity type rejected', () => {
    const target = circle('c', { x: 0, y: 0 }, 2);
    const b = line('b', { x: 5, y: -1 }, { x: 5, y: 1 });
    const r = extendEntityMulti(target, [b], { x: 2, y: 0 });
    expect(r.ok).toBe(false);
  });

  it('16: property + metadata preservation', () => {
    const target = line(
      't',
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { color: '#ff0000', linetype: 'Center', lineweight: 0.5 },
    );
    const b = line('b', { x: 7, y: -1 }, { x: 7, y: 1 });
    const r = extendEntityMulti(target, [b], { x: 2, y: 0 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.entities[0]!.properties).toMatchObject({
        color: '#ff0000',
        linetype: 'Center',
      });
      expect(r.entities[0]!.layerId).toBe('layer-0');
      expect(r.entities[0]!.id).toBe('t');
      expect(r.entities[0]!.metadata).toMatchObject({ source: 't' });
    }
  });

  it('25: preview matches commit geometry', () => {
    const target = line('t', { x: 0, y: 0 }, { x: 2, y: 0 });
    const b = line('b', { x: 6, y: -2 }, { x: 6, y: 2 });
    const pick = { x: 2, y: 0 };
    const preview = extendPreviewMulti(target, [b], pick, { edgeMode: 'extend' });
    const commit = extendEntityMulti(target, [b], pick, { edgeMode: 'extend' });
    expect(preview).not.toBeNull();
    expect(commit.ok).toBe(true);
    if (preview?.type === 'line' && commit.ok && commit.entities[0]?.type === 'line') {
      expect(preview.geometry.end.x).toBeCloseTo(commit.entities[0].geometry.end.x);
      expect(preview.geometry.start).toEqual(commit.entities[0].geometry.start);
    }
  });

  it('28: TRIM regression — LEFT/MIDDLE/RIGHT still works', () => {
    const target = line('t', { x: 0, y: 0 }, { x: 10, y: 0 });
    const cutters = [
      line('c1', { x: 3, y: -1 }, { x: 3, y: 1 }),
      line('c2', { x: 7, y: -1 }, { x: 7, y: 1 }),
    ];
    const mid = trimEntityMulti(target, cutters, { x: 5, y: 0 });
    expect(mid.ok).toBe(true);
    if (mid.ok) {
      expect(mid.entities).toHaveLength(2);
    }
  });

  it('finite edgeMode rejects imaginary boundary hit', () => {
    const target = line('t', { x: 0, y: 0 }, { x: 2, y: 0 });
    // Vertical segment above the ray — only meets on infinite extension
    const b = line('b', { x: 8, y: 3 }, { x: 8, y: 5 });
    const finite = extendEntityMulti(target, [b], { x: 2, y: 0 }, {
      edgeMode: 'no-extend',
    });
    expect(finite.ok).toBe(false);
    const infinite = extendEntityMulti(target, [b], { x: 2, y: 0 }, {
      edgeMode: 'extend',
    });
    expect(infinite.ok).toBe(true);
  });
});
