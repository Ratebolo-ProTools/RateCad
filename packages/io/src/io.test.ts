import { describe, expect, it } from 'vitest';
import { createEmptyDocument, type DrawingDocument } from '@ratecad/core';
import {
  parseDocument,
  serializeDocument,
  tryParseDocument,
} from '../src/index.js';

function sampleDoc(): DrawingDocument {
  const doc = createEmptyDocument('Floor Plan');
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
        id: 'pline-1',
        type: 'polyline',
        layerId: doc.layers[0]!.id,
        visible: true,
        locked: false,
        geometry: {
          vertices: [
            { x: 1, y: 2 },
            { x: 3, y: 4 },
            { x: 5, y: 6 },
          ],
          closed: false,
        },
        properties: {},
      },
    ],
  };
}

describe('.ratecad IO', () => {
  it('round-trips a document with entities and settings', () => {
    const original = sampleDoc();
    const text = serializeDocument(original);
    expect(text).toContain('"format": "ratecad"');
    expect(text).toContain('"schemaVersion"');

    const opened = parseDocument(text);
    expect(opened.meta.name).toBe('Floor Plan');
    expect(opened.schemaVersion).toBe(original.schemaVersion);
    expect(opened.settings.units).toBe('ft');
    expect(opened.layers).toHaveLength(1);
    expect(opened.entities).toHaveLength(2);
    expect(opened.entities.map((e) => e.type)).toEqual(['line', 'polyline']);
    expect(opened.selection).toEqual([]);
  });

  it('preserves polyline vertices on open', () => {
    const opened = parseDocument(serializeDocument(sampleDoc()));
    const pline = opened.entities.find((e) => e.type === 'polyline');
    expect(pline?.type).toBe('polyline');
    if (pline?.type === 'polyline') {
      expect(pline.geometry.vertices).toEqual([
        { x: 1, y: 2 },
        { x: 3, y: 4 },
        { x: 5, y: 6 },
      ]);
    }
  });

  it('rejects invalid JSON gracefully via tryParseDocument', () => {
    const result = tryParseDocument('{not json');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.length).toBeGreaterThan(0);
    }
  });

  it('rejects wrong format', () => {
    const result = tryParseDocument(
      JSON.stringify({ format: 'dxf', schemaVersion: 1, document: {} }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects missing document payload', () => {
    expect(() =>
      parseDocument(JSON.stringify({ format: 'ratecad', schemaVersion: 1 })),
    ).toThrow(/Missing document/);
  });

  it('rejects unsupported future schema', () => {
    const result = tryParseDocument(
      JSON.stringify({
        format: 'ratecad',
        schemaVersion: 999,
        document: {
          schemaVersion: 999,
          meta: { name: 'x', createdAt: '', updatedAt: '', appVersion: '' },
          settings: { units: 'ft', precision: 2, gridSize: 1, snapToGrid: true },
          layers: [
            {
              id: '0',
              name: '0',
              color: '#fff',
              visible: true,
              locked: false,
            },
          ],
          entities: [],
        },
      }),
    );
    expect(result.ok).toBe(false);
  });
});
