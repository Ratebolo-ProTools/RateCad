/**
 * P4-B2 — TRIM geometry hardening regression tests.
 * Uses production trimEntityMulti / planOpenSegmentTrim (no mocks).
 */
import { describe, expect, it } from 'vitest';
import type { Entity } from '@ratecad/core';
import {
  planOpenSegmentTrim,
  segmentsAreCollinear,
  segmentsAreParallel,
  trimEntityMulti,
  trimRemovalPreviewMulti,
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
  properties: { color: '#ff0000', linetype: 'Dashed' },
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
  properties: { color: '#00ff00' },
});

function lineXs(entities: Entity[]): number[] {
  return entities
    .filter((e): e is Extract<Entity, { type: 'line' }> => e.type === 'line')
    .flatMap((e) => [e.geometry.start.x, e.geometry.end.x]);
}

describe('P4-B2 segment selection (LEFT | MIDDLE | RIGHT)', () => {
  const target = line('t', { x: 0, y: 0 }, { x: 10, y: 0 });
  const cutters = [
    line('c1', { x: 3, y: -1 }, { x: 3, y: 1 }),
    line('c2', { x: 7, y: -1 }, { x: 7, y: 1 }),
  ];

  it('1: trim before first intersection (LEFT)', () => {
    const r = trimEntityMulti(target, cutters, { x: 1.5, y: 0 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const xs = lineXs(r.entities);
    expect(xs.some((x) => Math.abs(x - 0) < 1e-6)).toBe(false);
    expect(Math.min(...xs)).toBeCloseTo(3);
    expect(Math.max(...xs)).toBeCloseTo(10);
  });

  it('2: trim between two intersections (MIDDLE)', () => {
    const r = trimEntityMulti(target, cutters, { x: 5, y: 0 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entities).toHaveLength(2);
    for (const e of r.entities) {
      if (e.type !== 'line') continue;
      const mid = (e.geometry.start.x + e.geometry.end.x) / 2;
      expect(Math.abs(mid - 5)).toBeGreaterThan(1);
    }
  });

  it('3: trim after last intersection (RIGHT)', () => {
    const r = trimEntityMulti(target, cutters, { x: 8.5, y: 0 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Math.max(...lineXs(r.entities))).toBeCloseTo(7);
  });

  it('4: multiple boundaries (three cutters)', () => {
    const more = [...cutters, line('c3', { x: 5, y: -1 }, { x: 5, y: 1 })];
    const r = trimEntityMulti(target, more, { x: 4, y: 0 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const e of r.entities) {
      if (e.type !== 'line') continue;
      const mid = (e.geometry.start.x + e.geometry.end.x) / 2;
      expect(Math.abs(mid - 4)).toBeGreaterThan(0.4);
    }
  });

  it('5: reversed line direction still respects click side', () => {
    const rev = line('r', { x: 10, y: 0 }, { x: 0, y: 0 });
    const r = trimEntityMulti(rev, cutters, { x: 5, y: 0 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entities).toHaveLength(2);
    for (const e of r.entities) {
      if (e.type !== 'line') continue;
      const mid = (e.geometry.start.x + e.geometry.end.x) / 2;
      expect(Math.abs(mid - 5)).toBeGreaterThan(1);
    }
  });
});

describe('P4-B2 polyline / closed / intersections', () => {
  it('6: trim open polyline segment (vertex joint cutter)', () => {
    const target = pline('p', [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 5 },
      { x: 10, y: 5 },
    ]);
    const cutter = line('c', { x: 5, y: -1 }, { x: 5, y: 2 });
    const r = trimEntityMulti(target, [cutter], { x: 2, y: 0 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entities.every((e) => e.type === 'polyline')).toBe(true);
    const first = r.entities[0]!;
    if (first.type === 'polyline') {
      expect(first.geometry.closed).toBe(false);
      expect(first.geometry.vertices[0]!.x).toBeCloseTo(5);
      expect(first.properties.color).toBe('#ff0000');
      expect(first.metadata?.poly).toBe(true);
    }
  });

  it('7: closed polyline requires two cuts; two cuts open safely', () => {
    const closed = pline(
      'cl',
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      true,
    );
    const one = trimEntityMulti(
      closed,
      [line('a', { x: 3, y: -1 }, { x: 3, y: 1 })],
      { x: 1.5, y: 0 },
    );
    expect(one.ok).toBe(false);
    if (!one.ok) expect(one.reason).toMatch(/two intersection/i);

    const two = trimEntityMulti(
      closed,
      [
        line('a', { x: 3, y: -1 }, { x: 3, y: 1 }),
        line('b', { x: 7, y: -1 }, { x: 7, y: 1 }),
      ],
      { x: 5, y: 0 },
    );
    expect(two.ok).toBe(true);
    if (!two.ok) return;
    expect(two.entities).toHaveLength(1);
    const e = two.entities[0]!;
    expect(e.type).toBe('polyline');
    if (e.type === 'polyline') {
      expect(e.geometry.closed).toBe(false);
      expect(e.geometry.vertices.length).toBeGreaterThanOrEqual(2);
      const a = e.geometry.vertices[0]!;
      const b = e.geometry.vertices[e.geometry.vertices.length - 1]!;
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(1e-6);
    }
  });

  it('8: parallel boundaries fail without modifying', () => {
    const target = line('t', { x: 0, y: 0 }, { x: 10, y: 0 });
    const r = trimEntityMulti(
      target,
      [line('p', { x: 0, y: 1 }, { x: 10, y: 1 })],
      { x: 5, y: 0 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Parallel/i);
    expect(
      segmentsAreParallel(
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 0, y: 1 },
        { x: 10, y: 1 },
      ),
    ).toBe(true);
  });

  it('9: collinear overlapping geometry fails safely', () => {
    const target = line('t', { x: 0, y: 0 }, { x: 10, y: 0 });
    const r = trimEntityMulti(
      target,
      [line('o', { x: 2, y: 0 }, { x: 8, y: 0 })],
      { x: 5, y: 0 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Collinear/i);
    expect(
      segmentsAreCollinear(
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 2, y: 0 },
        { x: 8, y: 0 },
      ),
    ).toBe(true);
  });

  it('10: tangent circle cutter splits at contact', () => {
    const target = line('t', { x: 0, y: 0 }, { x: 10, y: 0 });
    const cutter = circle('c', { x: 5, y: 1 }, 1); // tangent at (5,0)
    const r = trimEntityMulti(target, [cutter], { x: 8, y: 0 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entities).toHaveLength(1);
    if (r.entities[0]?.type === 'line') {
      expect(r.entities[0].geometry.end.x).toBeCloseTo(5);
    }
  });

  it('11: near-endpoint intersection / pick on cut boundary', () => {
    const target = line('t', { x: 0, y: 0 }, { x: 10, y: 0 });
    const cutters = [
      line('c1', { x: 3, y: -1 }, { x: 3, y: 1 }),
      line('c2', { x: 7, y: -1 }, { x: 7, y: 1 }),
    ];
    const leftish = trimEntityMulti(target, cutters, { x: 2.9999, y: 0 });
    expect(leftish.ok).toBe(true);
    if (leftish.ok) {
      expect(Math.min(...lineXs(leftish.entities))).toBeCloseTo(3);
    }
    const rightish = trimEntityMulti(target, cutters, { x: 3.0001, y: 0 });
    expect(rightish.ok).toBe(true);
    if (rightish.ok) {
      // Middle removed → keep 0–3 and 7–10
      expect(rightish.entities).toHaveLength(2);
    }
  });

  it('12: invalid / endpoint-only / locked-style rejects', () => {
    const target = line('t', { x: 0, y: 0 }, { x: 10, y: 0 });
    const endOnly = trimEntityMulti(
      target,
      [line('e', { x: 0, y: -1 }, { x: 0, y: 1 })],
      { x: 5, y: 0 },
    );
    expect(endOnly.ok).toBe(false);
    if (!endOnly.ok) expect(endOnly.reason).toMatch(/endpoint/i);

    const text = {
      id: 'txt',
      type: 'text' as const,
      layerId: 'layer-0',
      visible: true,
      locked: false,
      geometry: {
        position: { x: 0, y: 0 },
        content: 'Hi',
        height: 1,
        rotation: 0,
      },
      properties: {},
    };
    const bad = trimEntityMulti(text, [target], { x: 0, y: 0 });
    expect(bad.ok).toBe(false);
  });

  it('13: zero-length / degenerate target rejected', () => {
    const tiny = line('s', { x: 0, y: 0 }, { x: 1e-12, y: 0 });
    const r = trimEntityMulti(
      tiny,
      [line('c', { x: 0, y: -1 }, { x: 0, y: 1 })],
      { x: 0, y: 0 },
    );
    expect(r.ok).toBe(false);
  });

  it('14: property + metadata preservation on split', () => {
    const target = line(
      't',
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { color: '#abc', linetype: 'Center', lineweight: 0.5 },
    );
    const r = trimEntityMulti(
      target,
      [
        line('c1', { x: 3, y: -1 }, { x: 3, y: 1 }),
        line('c2', { x: 7, y: -1 }, { x: 7, y: 1 }),
      ],
      { x: 5, y: 0 },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const e of r.entities) {
      expect(e.properties.color).toBe('#abc');
      expect(e.properties.linetype).toBe('Center');
      expect(e.metadata?.source).toBe('t');
      expect(e.layerId).toBe('layer-0');
    }
    expect(r.entities[0]?.id).toBe('t');
  });
});

describe('P4-B2 preview/commit + circle safety', () => {
  it('23: preview removal matches committed removed interval', () => {
    const target = line('t', { x: 0, y: 0 }, { x: 10, y: 0 });
    const cutters = [
      line('c1', { x: 3, y: -1 }, { x: 3, y: 1 }),
      line('c2', { x: 7, y: -1 }, { x: 7, y: 1 }),
    ];
    const pick = { x: 5, y: 0 };
    const plan = planOpenSegmentTrim(
      target.geometry.start,
      target.geometry.end,
      pick,
      cutters,
    );
    const preview = trimRemovalPreviewMulti(target, cutters, pick);
    const commit = trimEntityMulti(target, cutters, pick);
    expect(plan.ok).toBe(true);
    expect(preview).not.toBeNull();
    expect(commit.ok).toBe(true);
    if (!plan.ok || !preview || !commit.ok) return;
    expect(preview.geometry.start.x).toBeCloseTo(plan.removed.start.x);
    expect(preview.geometry.end.x).toBeCloseTo(plan.removed.end.x);
    // Committed parts exclude the preview segment mid
    for (const e of commit.entities) {
      if (e.type !== 'line') continue;
      const mid = (e.geometry.start.x + e.geometry.end.x) / 2;
      expect(Math.abs(mid - 5)).toBeGreaterThan(1);
    }
  });

  it('circle: single hit rejected; dual hit yields arc-meta polyline', () => {
    const c = circle('c', { x: 0, y: 0 }, 5);
    const one = trimEntityMulti(
      c,
      [line('t', { x: 5, y: -1 }, { x: 5, y: 1 })],
      { x: 5, y: 0 },
    );
    expect(one.ok).toBe(false);
    if (!one.ok) expect(one.reason).toMatch(/native ARC/i);

    const two = trimEntityMulti(
      c,
      [line('v', { x: 0, y: -10 }, { x: 0, y: 10 })],
      { x: 5, y: 0 },
    );
    expect(two.ok).toBe(true);
    if (!two.ok) return;
    expect(two.entities[0]?.type).toBe('polyline');
    const meta = two.entities[0]?.metadata?.arc as
      | { radius: number; approximate?: boolean; fromCircle?: boolean }
      | undefined;
    expect(meta?.radius).toBeCloseTo(5);
    expect(meta?.fromCircle).toBe(true);
    expect(meta?.approximate).toBe(true);
    expect(two.entities[0]?.properties.color).toBe('#00ff00');
  });
});
