import { describe, expect, it } from 'vitest';
import { createEmptyDocument, type DrawingDocument } from '@ratecad/core';
import { resolveSnap } from '../src/index.js';

function docWithGeometry(): DrawingDocument {
  const doc = createEmptyDocument();
  return {
    ...doc,
    entities: [
      {
        id: 'line-1',
        type: 'line',
        layerId: doc.layers[0]!.id,
        visible: true,
        locked: false,
        geometry: { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
        properties: {},
      },
      {
        id: 'circle-1',
        type: 'circle',
        layerId: doc.layers[0]!.id,
        visible: true,
        locked: false,
        geometry: { center: { x: 5, y: 5 }, radius: 2 },
        properties: {},
      },
    ],
  };
}

describe('resolveSnap', () => {
  it('returns cursor unchanged when snap disabled', () => {
    const doc = docWithGeometry();
    const result = resolveSnap(
      { x: 0.1, y: 0.1 },
      doc,
      { enabled: false, gridSize: 1, tolerance: 0.5 },
    );
    expect(result.snapped).toBe(false);
    expect(result.point).toEqual({ x: 0.1, y: 0.1 });
  });

  it('snaps to endpoint', () => {
    const doc = docWithGeometry();
    const result = resolveSnap(
      { x: 0.2, y: 0.1 },
      doc,
      { enabled: true, gridSize: 1, tolerance: 0.5 },
    );
    expect(result.snapped).toBe(true);
    expect(result.kind).toBe('endpoint');
    expect(result.point).toEqual({ x: 0, y: 0 });
  });

  it('snaps to midpoint', () => {
    const doc = docWithGeometry();
    const result = resolveSnap(
      { x: 5.1, y: 0.1 },
      doc,
      { enabled: true, gridSize: 1, tolerance: 0.5 },
    );
    expect(result.snapped).toBe(true);
    expect(result.kind).toBe('midpoint');
    expect(result.point).toEqual({ x: 5, y: 0 });
  });

  it('snaps to circle center', () => {
    const doc = docWithGeometry();
    const result = resolveSnap(
      { x: 5.2, y: 5.1 },
      doc,
      { enabled: true, gridSize: 1, tolerance: 0.5 },
    );
    expect(result.snapped).toBe(true);
    expect(result.kind).toBe('center');
    expect(result.point).toEqual({ x: 5, y: 5 });
  });

  it('falls back to grid snap', () => {
    const doc = createEmptyDocument();
    const result = resolveSnap(
      { x: 1.4, y: 2.6 },
      doc,
      { enabled: true, gridSize: 1, tolerance: 0.5 },
    );
    expect(result.snapped).toBe(true);
    expect(result.kind).toBe('grid');
    expect(result.point).toEqual({ x: 1, y: 3 });
  });

  it('prefers endpoint over grid when both nearby', () => {
    const doc = docWithGeometry();
    const result = resolveSnap(
      { x: 0.3, y: 0.2 },
      doc,
      { enabled: true, gridSize: 1, tolerance: 0.5 },
    );
    expect(result.kind).toBe('endpoint');
  });
});
