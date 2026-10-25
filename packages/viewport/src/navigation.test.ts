import { describe, expect, it } from 'vitest';
import {
  createEmptyDocument,
  updateLayer,
  type CircleEntity,
  type RectangleEntity,
} from '@ratecad/core';
import {
  ViewHistory,
  cameraForZoomWindow,
  clampCameraZoom,
  documentVisibleBounds,
  fitCameraToBounds,
} from './navigation.js';
import { createCamera } from './camera.js';

function layer0Id(doc: ReturnType<typeof createEmptyDocument>): string {
  return doc.layers.find((l) => l.name === '0')?.id ?? doc.currentLayerId;
}

function withRect(
  doc: ReturnType<typeof createEmptyDocument>,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  layerId?: string,
): RectangleEntity {
  return {
    id: `rect-${minX}-${minY}`,
    type: 'rectangle',
    layerId: layerId ?? layer0Id(doc),
    visible: true,
    locked: false,
    geometry: {
      corner1: { x: minX, y: minY },
      corner2: { x: maxX, y: maxY },
    },
    properties: {},
  };
}

function withCircle(
  doc: ReturnType<typeof createEmptyDocument>,
  cx: number,
  cy: number,
  r: number,
  layerId?: string,
): CircleEntity {
  return {
    id: `circle-${cx}-${cy}`,
    type: 'circle',
    layerId: layerId ?? layer0Id(doc),
    visible: true,
    locked: false,
    geometry: { center: { x: cx, y: cy }, radius: r },
    properties: {},
  };
}

describe('fitCameraToBounds / zoom window', () => {
  it('fits a rectangle into the viewport with padding', () => {
    const cam = fitCameraToBounds(
      { minX: 0, minY: 0, maxX: 10, maxY: 5 },
      800,
      600,
    );
    expect(cam.centerX).toBeCloseTo(5);
    expect(cam.centerY).toBeCloseTo(2.5);
    expect(cam.zoom).toBeGreaterThan(1);
    // Height-limited: usableH/bh ≈ 600*0.84/5
    expect(cam.zoom).toBeLessThanOrEqual(600 * 0.84 / 5 + 1e-6);
  });

  it('fits a circle bounds', () => {
    const cam = fitCameraToBounds(
      { minX: -2, minY: -2, maxX: 2, maxY: 2 },
      400,
      400,
    );
    expect(cam.centerX).toBeCloseTo(0);
    expect(cam.centerY).toBeCloseTo(0);
    expect(cam.zoom).toBeGreaterThan(0);
  });

  it('clamps invalid zoom values', () => {
    const cam = clampCameraZoom(createCamera({ zoom: 1e9 }));
    expect(cam.zoom).toBeLessThanOrEqual(400);
    const tiny = clampCameraZoom(createCamera({ zoom: 0.001 }));
    expect(tiny.zoom).toBeGreaterThanOrEqual(2);
  });

  it('rejects zero-size zoom windows', () => {
    expect(
      cameraForZoomWindow({ x: 1, y: 1 }, { x: 1, y: 1 }, 800, 600),
    ).toBeNull();
  });

  it('builds a camera for a valid zoom window', () => {
    const cam = cameraForZoomWindow(
      { x: 0, y: 0 },
      { x: 20, y: 10 },
      800,
      600,
    );
    expect(cam).not.toBeNull();
    expect(cam!.centerX).toBeCloseTo(10);
    expect(cam!.centerY).toBeCloseTo(5);
  });
});

describe('documentVisibleBounds', () => {
  it('unions multiple entities', () => {
    let doc = createEmptyDocument('t');
    doc = {
      ...doc,
      entities: [withRect(doc, 0, 0, 10, 10), withCircle(doc, 30, 0, 5)],
    };
    const b = documentVisibleBounds(doc);
    expect(b).not.toBeNull();
    expect(b!.minX).toBeCloseTo(0);
    expect(b!.maxX).toBeCloseTo(35);
  });

  it('excludes hidden-layer entities', () => {
    let doc = createEmptyDocument('t');
    const walls = doc.layers.find((l) => l.name === 'Walls')!;
    doc = {
      ...doc,
      entities: [
        withRect(doc, 0, 0, 5, 5),
        withCircle(doc, 100, 100, 10, walls.id),
      ],
    };
    doc = updateLayer(doc, walls.id, { visible: false });
    const b = documentVisibleBounds(doc);
    expect(b).not.toBeNull();
    expect(b!.maxX).toBeLessThan(20);
  });

  it('returns null for empty drawings', () => {
    const doc = createEmptyDocument('empty');
    expect(documentVisibleBounds(doc)).toBeNull();
  });
});

describe('ViewHistory', () => {
  it('stores previous cameras without duplicates', () => {
    const h = new ViewHistory(4);
    const a = { kind: 'model' as const, camera: createCamera({ zoom: 40 }) };
    const b = {
      kind: 'model' as const,
      camera: createCamera({ zoom: 80, centerX: 1 }),
    };
    h.push(a);
    h.push(a);
    expect(h.size).toBe(1);
    h.push(b);
    expect(h.size).toBe(2);
    const prev = h.previous();
    expect(prev?.kind).toBe('model');
    if (prev?.kind === 'model') expect(prev.camera.zoom).toBe(80);
    expect(h.previous()?.kind).toBe('model');
    expect(h.previous()).toBeNull();
  });

  it('handles empty history gracefully', () => {
    expect(new ViewHistory().previous()).toBeNull();
  });
});
