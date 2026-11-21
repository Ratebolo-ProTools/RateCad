import { describe, expect, it } from 'vitest';
import type { Entity, Vec2 } from '@ratecad/core';
import {
  closestPointOnSegment,
  offsetEntity,
  segmentsAreCollinear,
  trimEntityMulti,
  trimRemovalPreviewMulti,
} from './index.js';

const props = { color: '#112233', lineweight: 0.35, linetype: 'Dashed' };

const line = (
  id: string,
  start: Vec2,
  end: Vec2,
): Entity => ({
  id,
  type: 'line',
  layerId: 'layer-0',
  visible: true,
  locked: false,
  geometry: { start, end },
  properties: { ...props },
});

const rect = (id: string, c1: Vec2, c2: Vec2): Entity => ({
  id,
  type: 'rectangle',
  layerId: 'layer-0',
  visible: true,
  locked: false,
  geometry: { corner1: c1, corner2: c2 },
  properties: { ...props },
});

const pline = (id: string, vertices: Vec2[], closed = true): Entity => ({
  id,
  type: 'polyline',
  layerId: 'layer-0',
  visible: true,
  locked: false,
  geometry: { vertices, closed },
  properties: { ...props },
});

const circle = (id: string, center: Vec2, radius: number): Entity => ({
  id,
  type: 'circle',
  layerId: 'layer-0',
  visible: true,
  locked: false,
  geometry: { center, radius },
  properties: { ...props },
});

function edgesOf(vertices: Vec2[], closed: boolean): Array<{ a: Vec2; b: Vec2 }> {
  const count = closed ? vertices.length : Math.max(0, vertices.length - 1);
  const out: Array<{ a: Vec2; b: Vec2 }> = [];
  for (let i = 0; i < count; i += 1) {
    out.push({ a: vertices[i]!, b: vertices[(i + 1) % vertices.length]! });
  }
  return out;
}

function rectEdges(entity: Extract<Entity, { type: 'rectangle' }>): Array<{ a: Vec2; b: Vec2 }> {
  const { corner1: c1, corner2: c2 } = entity.geometry;
  return edgesOf(
    [
      { x: c1.x, y: c1.y },
      { x: c2.x, y: c1.y },
      { x: c2.x, y: c2.y },
      { x: c1.x, y: c2.y },
    ],
    true,
  );
}

function chainDistance(point: Vec2, vertices: Vec2[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < vertices.length - 1; i += 1) {
    best = Math.min(
      best,
      Math.hypot(
        point.x - closestPointOnSegment(point, vertices[i]!, vertices[i + 1]!).x,
        point.y - closestPointOnSegment(point, vertices[i]!, vertices[i + 1]!).y,
      ),
    );
  }
  return best;
}

function expectOpenBoundary(
  entity: Entity,
  sourceEdges: Array<{ a: Vec2; b: Vec2 }>,
) {
  expect(entity.type).toBe('polyline');
  if (entity.type !== 'polyline') return;
  expect(entity.geometry.closed).toBe(false);
  expect(entity.geometry.vertices.length).toBeGreaterThanOrEqual(2);
  expect(entity.properties.color).toBe(props.color);
  expect(entity.properties.lineweight).toBe(props.lineweight);
  expect(entity.properties.linetype).toBe(props.linetype);
  const verts = entity.geometry.vertices;
  expect(Math.hypot(verts[0]!.x - verts[verts.length - 1]!.x, verts[0]!.y - verts[verts.length - 1]!.y)).toBeGreaterThan(1e-6);
  for (let i = 0; i < verts.length - 1; i += 1) {
    const a = verts[i]!;
    const b = verts[i + 1]!;
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(1e-6);
    const supported = sourceEdges.some(
      (edge) =>
        segmentsAreCollinear(a, b, edge.a, edge.b) &&
        Math.hypot(a.x - closestPointOnSegment(a, edge.a, edge.b).x, a.y - closestPointOnSegment(a, edge.a, edge.b).y) < 1e-5 &&
        Math.hypot(b.x - closestPointOnSegment(b, edge.a, edge.b).x, b.y - closestPointOnSegment(b, edge.a, edge.b).y) < 1e-5,
    );
    expect(supported).toBe(true);
  }
}

describe('rectangle TRIM', () => {
  const box = rect('box', { x: 0, y: 0 }, { x: 10, y: 10 });
  const cutter = line('cut', { x: -2, y: 5 }, { x: 12, y: 5 });

  it('trims only the clicked interval of a line that crosses a rectangle', () => {
    const result = trimEntityMulti(cutter, [box, cutter], { x: 5, y: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entities).toHaveLength(2);
    const spans = result.entities.map((entity) => {
      expect(entity.type).toBe('line');
      if (entity.type !== 'line') return [];
      return [entity.geometry.start.x, entity.geometry.end.x];
    });
    expect(spans).toEqual([
      [-2, 0],
      [10, 12],
    ]);
    const preview = trimRemovalPreviewMulti(cutter, [box, cutter], { x: 5, y: 5 });
    expect(preview?.type).toBe('line');
    if (preview?.type === 'line') {
      expect(preview.geometry.start.x).toBeCloseTo(0);
      expect(preview.geometry.end.x).toBeCloseTo(10);
    }
    expect(cutter.geometry.end).toEqual({ x: 12, y: 5 });
  });

  it('keeps every unpicked segment when a line crosses two rectangle edges', () => {
    const result = trimEntityMulti(cutter, [box], { x: -1, y: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const spans = result.entities.flatMap((entity) =>
      entity.type === 'line' ? [[entity.geometry.start.x, entity.geometry.end.x]] : [],
    );
    expect(spans).toEqual([
      [0, 10],
      [10, 12],
    ]);
  });

  it('converts a trimmed rectangle edge span into one open polyline', () => {
    const source = structuredClone(box);
    const result = trimEntityMulti(source, [source, cutter], { x: 5, y: 10 });
    const preview = trimRemovalPreviewMulti(source, [source, cutter], { x: 5, y: 10 });
    expect(result.ok).toBe(true);
    if (!result.ok || result.entities[0]?.type !== 'polyline') return;
    expectOpenBoundary(result.entities[0], rectEdges(box));
    expect(result.entities[0].geometry.vertices).toEqual([
      { x: 0, y: 5 },
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
    ]);
    expect(result.entities[0].metadata?.trimmedFrom).toBe('rectangle');
    expect(preview?.type).toBe('polyline');
    if (preview?.type === 'polyline') {
      expect(preview.geometry.closed).toBe(false);
      expect(preview.geometry.vertices).toEqual([
        { x: 10, y: 5 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
        { x: 0, y: 5 },
      ]);
      expect(preview.properties.color).toBe('#ff6b6b');
      expect(chainDistance({ x: 5, y: 10 }, preview.geometry.vertices)).toBeLessThan(1e-6);
      expect(chainDistance({ x: 5, y: 10 }, result.entities[0].geometry.vertices)).toBeGreaterThan(1);
    }
    expect(source.type).toBe('rectangle');
    expect(source.geometry).toEqual(box.geometry);
  });

  it('removes only the clicked span when two rectangles cross at four points', () => {
    const target = rect('a', { x: 0, y: 0 }, { x: 10, y: 10 });
    const bar = rect('b', { x: 2, y: -2 }, { x: 8, y: 12 });
    const result = trimEntityMulti(target, [target, bar], { x: 5, y: 10 });
    const preview = trimRemovalPreviewMulti(target, [target, bar], { x: 5, y: 10 });
    expect(result.ok).toBe(true);
    if (!result.ok || result.entities[0]?.type !== 'polyline') return;
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].geometry.vertices.map((p) => [p.x, p.y])).toEqual([
      [2, 10],
      [0, 10],
      [0, 0],
      [10, 0],
      [10, 10],
      [8, 10],
    ]);
    expect(preview?.type).toBe('polyline');
    if (preview?.type === 'polyline') {
      expect(preview.geometry.vertices).toEqual([
        { x: 8, y: 10 },
        { x: 2, y: 10 },
      ]);
    }
    expect(bar.type).toBe('rectangle');
  });

  it('removes only the overlapping corner when that corner is picked', () => {
    const target = rect('a', { x: 0, y: 0 }, { x: 10, y: 10 });
    const other = rect('b', { x: 6, y: 4 }, { x: 16, y: 14 });
    const result = trimEntityMulti(target, [target, other], { x: 8, y: 10 });
    expect(result.ok).toBe(true);
    if (!result.ok || result.entities[0]?.type !== 'polyline') return;
    expect(result.entities[0].geometry.vertices).toEqual([
      { x: 6, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 4 },
    ]);
    expect(other.geometry.corner2).toEqual({ x: 16, y: 14 });
  });

  it('does not invent a trim for a shared edge, a contained rectangle, or a corner touch', () => {
    const shared = trimEntityMulti(
      rect('sa', { x: 0, y: 0 }, { x: 10, y: 10 }),
      [
        rect('sa', { x: 0, y: 0 }, { x: 10, y: 10 }),
        rect('sb', { x: 10, y: 0 }, { x: 20, y: 10 }),
      ],
      { x: 10, y: 5 },
    );
    const contained = trimEntityMulti(
      rect('inner', { x: 4, y: 4 }, { x: 6, y: 6 }),
      [
        rect('inner', { x: 4, y: 4 }, { x: 6, y: 6 }),
        rect('outer', { x: 0, y: 0 }, { x: 10, y: 10 }),
      ],
      { x: 5, y: 6 },
    );
    const corner = trimEntityMulti(
      rect('ca', { x: 0, y: 0 }, { x: 4, y: 4 }),
      [
        rect('ca', { x: 0, y: 0 }, { x: 4, y: 4 }),
        rect('cb', { x: 4, y: 4 }, { x: 8, y: 8 }),
      ],
      { x: 2, y: 4 },
    );
    expect(shared.ok).toBe(false);
    expect(contained.ok).toBe(false);
    expect(corner.ok).toBe(false);
    expect(trimRemovalPreviewMulti(
      rect('inner', { x: 4, y: 4 }, { x: 6, y: 6 }),
      [rect('inner', { x: 4, y: 4 }, { x: 6, y: 6 }), rect('outer', { x: 0, y: 0 }, { x: 10, y: 10 })],
      { x: 5, y: 6 },
    )).toBeNull();
  });

  it('trims a closed four-segment polyline with the same boundary plan', () => {
    const closed = pline('rec', [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]);
    const result = trimEntityMulti(closed, [closed, cutter], { x: 5, y: 10 });
    const preview = trimRemovalPreviewMulti(closed, [closed, cutter], { x: 5, y: 10 });
    expect(result.ok).toBe(true);
    if (!result.ok || result.entities[0]?.type !== 'polyline' || preview?.type !== 'polyline') return;
    expect(result.entities[0].geometry.vertices).toEqual([
      { x: 0, y: 5 },
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
    ]);
    expect(preview.geometry.vertices).toEqual([
      { x: 10, y: 5 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 5 },
    ]);
  });

  it('keeps a rotated rectangular polyline on its original edges', () => {
    const rotated = pline('rot', [
      { x: 0, y: 0 },
      { x: 10, y: 2 },
      { x: 8, y: 12 },
      { x: -2, y: 10 },
    ]);
    const blade = line('blade', { x: -4, y: 6 }, { x: 14, y: 6 });
    const pick = { x: 3, y: 11 };
    const result = trimEntityMulti(rotated, [rotated, blade], pick);
    const preview = trimRemovalPreviewMulti(rotated, [rotated, blade], pick);
    expect(result.ok).toBe(true);
    if (!result.ok || result.entities[0]?.type !== 'polyline' || preview?.type !== 'polyline') return;
    const source = edgesOf(rotated.geometry.vertices, true);
    expectOpenBoundary(result.entities[0], source);
    expect(chainDistance(pick, preview.geometry.vertices)).toBeLessThan(0.2);
    expect(chainDistance(pick, result.entities[0].geometry.vertices)).toBeGreaterThan(0.5);
  });

  it('trims against an offset rectangle and does not trim a contained offset', () => {
    const offset = offsetEntity(box, 2, { x: 5, y: 12 }, 'off');
    expect(offset.ok).toBe(true);
    if (!offset.ok || offset.entities[0]?.type !== 'rectangle') return;
    const outer = offset.entities[0];
    const contained = trimEntityMulti(outer, [outer, box], { x: 0, y: 12 });
    expect(contained.ok).toBe(false);
    const across = line('across', { x: -5, y: 0 }, { x: 15, y: 0 });
    const cut = trimEntityMulti(across, [outer], { x: 0, y: 0 });
    expect(cut.ok).toBe(true);
    if (!cut.ok) return;
    expect(cut.entities.map((entity) => entity.type === 'line'
      ? [entity.geometry.start.x, entity.geometry.end.x]
      : [])).toEqual([[-5, -2], [12, 15]]);
  });

  it('removes one overlapping edge when its vertices lie on the longer edge', () => {
    const long = rect('long', { x: 0, y: 0 }, { x: 10, y: 10 });
    const short = rect('short', { x: 10, y: 3 }, { x: 16, y: 7 });
    const result = trimEntityMulti(short, [short, long], { x: 10, y: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok || result.entities[0]?.type !== 'polyline') return;
    expect(result.entities[0].geometry.closed).toBe(false);
    expect(result.entities[0].geometry.vertices).toEqual([
      { x: 10, y: 3 },
      { x: 16, y: 3 },
      { x: 16, y: 7 },
      { x: 10, y: 7 },
    ]);
    const overlap = trimEntityMulti(long, [long, short], { x: 10, y: 5 });
    expect(overlap.ok).toBe(true);
    if (!overlap.ok || overlap.entities[0]?.type !== 'polyline') return;
    expect(overlap.entities[0].geometry.vertices).toEqual([
      { x: 10, y: 7 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 3 },
    ]);
  });

  it('still trims a circle to native arcs and an arc to the unpicked piece', () => {
    const round = circle('c', { x: 0, y: 0 }, 5);
    const wall = line('w', { x: 0, y: -8 }, { x: 0, y: 8 });
    const trimmed = trimEntityMulti(round, [wall], { x: 5, y: 0 });
    expect(trimmed.ok).toBe(true);
    if (!trimmed.ok) return;
    expect(trimmed.entities).toHaveLength(1);
    expect(trimmed.entities[0]?.type).toBe('arc');
    const arc = trimmed.entities[0]!;
    if (arc.type !== 'arc') return;
    const again = trimEntityMulti(arc, [line('h', { x: -8, y: 0 }, { x: 8, y: 0 })], { x: 0, y: 5 });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.entities.every((entity) => entity.type === 'arc')).toBe(true);
    expect(again.entities.length).toBeGreaterThan(0);
  });
});
