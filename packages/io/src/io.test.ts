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
    expect(opened.layers.length).toBeGreaterThanOrEqual(8);
    expect(opened.currentLayerId).toBe(original.currentLayerId);
    expect(opened.settings.dimensionStyle).toBeDefined();
    expect(opened.entities).toHaveLength(2);
    expect(opened.entities.map((e) => e.type)).toEqual(['line', 'polyline']);
    expect(opened.selection).toEqual([]);
  });

  it('round-trips dimensions, text, leaders', () => {
    const base = createEmptyDocument('Anno');
    const doc: DrawingDocument = {
      ...base,
      entities: [
        {
          id: 'dim-1',
          type: 'dimension',
          layerId: 'layer-dimensions',
          visible: true,
          locked: false,
          geometry: {
            kind: 'horizontal',
            start: { x: 0, y: 0 },
            end: { x: 12, y: 0 },
            offset: 2,
          },
          properties: {},
        },
        {
          id: 'text-1',
          type: 'text',
          layerId: 'layer-text',
          visible: true,
          locked: false,
          geometry: {
            position: { x: 1, y: 2 },
            content: 'Label',
            height: 0.4,
            rotation: 0,
          },
          properties: {},
        },
        {
          id: 'leader-1',
          type: 'leader',
          layerId: 'layer-annotations',
          visible: true,
          locked: false,
          geometry: {
            arrow: { x: 0, y: 0 },
            vertices: [{ x: 2, y: 1 }],
            content: 'Existing column',
            textHeight: 0.35,
          },
          properties: {},
        },
      ],
    };
    const opened = parseDocument(serializeDocument(doc));
    expect(opened.entities.map((e) => e.type)).toEqual([
      'dimension',
      'text',
      'leader',
    ]);
  });

  it('migrates schema v1 documents to v2', () => {
    const v1 = {
      format: 'ratecad',
      schemaVersion: 1,
      document: {
        schemaVersion: 1,
        meta: {
          name: 'Old',
          createdAt: '2020-01-01T00:00:00.000Z',
          updatedAt: '2020-01-01T00:00:00.000Z',
          appVersion: '0.1.0',
        },
        settings: { units: 'ft', precision: 2, gridSize: 1, snapToGrid: true },
        layers: [
          {
            id: 'layer-0',
            name: '0',
            color: '#d4d4d4',
            visible: true,
            locked: false,
          },
        ],
        entities: [
          {
            id: 'line-1',
            type: 'line',
            layerId: 'layer-0',
            visible: true,
            locked: false,
            geometry: { start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
            properties: {},
          },
        ],
      },
    };
    const opened = parseDocument(JSON.stringify(v1));
    expect(opened.schemaVersion).toBe(2);
    expect(opened.currentLayerId).toBe('layer-0');
    expect(opened.settings.dimensionStyle).toBeDefined();
    expect(opened.layers.length).toBeGreaterThan(1);
    expect(opened.entities).toHaveLength(1);
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
