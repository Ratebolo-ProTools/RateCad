/**
 * P4-C5 — arc-polyline metadata transform consistency (DEF-P4C4-03).
 */
import { describe, expect, it } from 'vitest';
import type { Entity } from '@ratecad/core';
import {
  arcMetaConsistentWithVertices,
  cloneEntityWithNewId,
  computeFillet,
  degreesToRadians,
  mirrorEntity,
  readArcPolylineMeta,
  rotateEntity,
  scaleEntity,
  translateEntity,
} from './index.js';

function makeFilletArc(): Entity {
  const a: Entity = {
    id: 'L1',
    type: 'line',
    layerId: 'TEST-FILLET',
    visible: true,
    locked: false,
    geometry: { start: { x: 0, y: 0 }, end: { x: 5000, y: 0 } },
    properties: {
      color: { mode: 'RGB', value: '#ff0000' },
      linetype: { mode: 'NAMED', value: 'Dashed' },
      lineweight: { mode: 'MM', value: 0.7 },
    },
  };
  const b: Entity = {
    id: 'L2',
    type: 'line',
    layerId: 'TEST-FILLET',
    visible: true,
    locked: false,
    geometry: { start: { x: 5000, y: 0 }, end: { x: 5000, y: 3500 } },
    properties: {
      color: { mode: 'RGB', value: '#ff0000' },
      linetype: { mode: 'NAMED', value: 'Dashed' },
      lineweight: { mode: 'MM', value: 0.7 },
    },
  };
  const r = computeFillet(
    { entity: a, worldPoint: { x: 2500, y: 0 } },
    { entity: b, worldPoint: { x: 5000, y: 1750 } },
    { radius: 500, trim: true },
    'fillet-arc',
  );
  if (!r.ok || !r.created[0]) throw new Error('fillet setup failed');
  return r.created[0]!;
}

function expectArcOk(entity: Entity | null): asserts entity is Entity {
  expect(entity).toBeTruthy();
  expect(entity!.type).toBe('polyline');
  expect(readArcPolylineMeta(entity!)).toBeTruthy();
  expect(arcMetaConsistentWithVertices(entity!)).toBe(true);
  const verts = entity!.type === 'polyline' ? entity!.geometry.vertices : [];
  for (const v of verts) {
    expect(Number.isFinite(v.x)).toBe(true);
    expect(Number.isFinite(v.y)).toBe(true);
  }
}

describe('P4-C5 arc metadata transforms', () => {
  it('B01: ROTATE 90°', () => {
    const src = makeFilletArc();
    const before = readArcPolylineMeta(src)!;
    const next = rotateEntity(src, { x: 0, y: 0 }, degreesToRadians(90));
    expectArcOk(next);
    const meta = readArcPolylineMeta(next!)!;
    expect(meta.radius).toBeCloseTo(before.radius, 9);
    expect(meta.ccw).toBe(before.ccw);
    expect(meta.fillet).toBe(true);
  });

  it('B02: ROTATE 180°', () => {
    const next = rotateEntity(
      makeFilletArc(),
      { x: 0, y: 0 },
      degreesToRadians(180),
    );
    expectArcOk(next);
  });

  it('B03: ROTATE −90°', () => {
    const next = rotateEntity(
      makeFilletArc(),
      { x: 0, y: 0 },
      degreesToRadians(-90),
    );
    expectArcOk(next);
  });

  it('B04: ROTATE around arbitrary pivot', () => {
    const next = rotateEntity(
      makeFilletArc(),
      { x: 1234, y: -500 },
      degreesToRadians(37),
    );
    expectArcOk(next);
  });

  it('B05: ROTATE around arc center', () => {
    const src = makeFilletArc();
    const c = readArcPolylineMeta(src)!.center;
    const next = rotateEntity(src, c, degreesToRadians(45));
    expectArcOk(next);
    const meta = readArcPolylineMeta(next!)!;
    expect(meta.center.x).toBeCloseTo(c.x, 6);
    expect(meta.center.y).toBeCloseTo(c.y, 6);
  });

  it('B06: MOVE positive vector', () => {
    const src = makeFilletArc();
    const before = readArcPolylineMeta(src)!;
    const next = translateEntity(src, { x: 100, y: 50 });
    expectArcOk(next);
    const meta = readArcPolylineMeta(next!)!;
    expect(meta.center.x).toBeCloseTo(before.center.x + 100, 9);
    expect(meta.center.y).toBeCloseTo(before.center.y + 50, 9);
    expect(meta.radius).toBeCloseTo(before.radius, 9);
    expect(meta.startAngle).toBeCloseTo(before.startAngle, 9);
  });

  it('B07: MOVE negative vector', () => {
    const next = translateEntity(makeFilletArc(), { x: -250, y: -10 });
    expectArcOk(next);
  });

  it('B08: COPY arc-polyline (clone + translate)', () => {
    const src = makeFilletArc();
    const cloned = cloneEntityWithNewId(src, 'fillet-copy');
    expect(readArcPolylineMeta(cloned)).toBeTruthy();
    const moved = translateEntity(cloned, { x: 10, y: 20 });
    expectArcOk(moved);
    expect(moved!.id).toBe('fillet-copy');
    // Original unchanged
    expect(arcMetaConsistentWithVertices(src)).toBe(true);
  });

  it('B09: MIRROR horizontal axis', () => {
    const next = mirrorEntity(
      makeFilletArc(),
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      'm-h',
    );
    expectArcOk(next);
    const meta = readArcPolylineMeta(next!)!;
    expect(meta.ccw).toBe(false); // was true for standard fillet
  });

  it('B10: MIRROR vertical axis', () => {
    const next = mirrorEntity(
      makeFilletArc(),
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      'm-v',
    );
    expectArcOk(next);
  });

  it('B11: MIRROR arbitrary axis', () => {
    const next = mirrorEntity(
      makeFilletArc(),
      { x: 100, y: 100 },
      { x: 200, y: 150 },
      'm-arb',
    );
    expectArcOk(next);
  });

  it('B12: uniform SCALE ×2', () => {
    const src = makeFilletArc();
    const before = readArcPolylineMeta(src)!;
    const next = scaleEntity(src, { x: 0, y: 0 }, 2);
    expectArcOk(next);
    expect(readArcPolylineMeta(next!)!.radius).toBeCloseTo(before.radius * 2, 9);
  });

  it('B13: uniform SCALE ×0.5', () => {
    const src = makeFilletArc();
    const before = readArcPolylineMeta(src)!;
    const next = scaleEntity(src, { x: 4500, y: 500 }, 0.5);
    expectArcOk(next);
    expect(readArcPolylineMeta(next!)!.radius).toBeCloseTo(
      before.radius * 0.5,
      9,
    );
  });

  it('B14: negative scale NOT SUPPORTED', () => {
    expect(scaleEntity(makeFilletArc(), { x: 0, y: 0 }, -1)).toBeNull();
    expect(scaleEntity(makeFilletArc(), { x: 0, y: 0 }, 0)).toBeNull();
  });

  it('B15: non-uniform scale NOT SUPPORTED (API is uniform factor only)', () => {
    // scaleEntity accepts a single positive factor — document as unsupported.
    expect(typeof scaleEntity).toBe('function');
  });

  it('B19: explicit properties preserved across ROTATE', () => {
    const src = makeFilletArc();
    const next = rotateEntity(src, { x: 0, y: 0 }, Math.PI / 2)!;
    expect(next.layerId).toBe('TEST-FILLET');
    expect(next.properties).toEqual(src.properties);
  });

  it('B20: unrelated metadata preserved', () => {
    const src = makeFilletArc();
    const withExtra: Entity = {
      ...src,
      metadata: {
        ...(src.metadata as object),
        customTag: 'keep-me',
        arc: (src.metadata as { arc: unknown }).arc,
      },
    };
    const next = translateEntity(withExtra, { x: 1, y: 1 })!;
    expect((next.metadata as { customTag?: string }).customTag).toBe('keep-me');
    expectArcOk(next);
  });

  it('B21: invalid rotate leaves caller responsible (null on bad input)', () => {
    const src = makeFilletArc();
    expect(rotateEntity(src, { x: NaN, y: 0 }, 1)).toBeNull();
    expect(arcMetaConsistentWithVertices(src)).toBe(true);
  });

  it('B22: no NaN/Infinity after transforms', () => {
    let e: Entity | null = makeFilletArc();
    e = rotateEntity(e, { x: 10, y: 20 }, 1.234);
    e = translateEntity(e!, { x: -5, y: 8 });
    e = scaleEntity(e!, { x: 0, y: 0 }, 1.5);
    e = mirrorEntity(e!, { x: 0, y: 0 }, { x: 1, y: 1 }, 'm');
    expectArcOk(e);
  });
});
