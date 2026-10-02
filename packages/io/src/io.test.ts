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
    expect(opened.settings.units).toBe('ft-in');
    expect(opened.settings.worldUnit).toBe('ft');
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

  it('migrates schema v1 documents to current schema', () => {
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
    expect(opened.schemaVersion).toBe(10);
    expect(opened.currentLayerId).toBe('layer-0');
    expect(opened.settings.dimensionStyle).toBeDefined();
    expect(opened.settings.constructionDefaults).toBeDefined();
    expect(opened.layers.map((l) => l.name)).toEqual(
      expect.arrayContaining(['0', 'Walls', 'Doors', 'Windows', 'Rooms', 'Dimensions']),
    );
    expect(opened.entities).toHaveLength(1);
  });

  it('migrates schema v2 documents to v3 with construction defaults', () => {
    const v2 = {
      format: 'ratecad',
      schemaVersion: 2,
      document: {
        schemaVersion: 2,
        meta: {
          name: 'M5',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          appVersion: '0.3.0',
        },
        settings: {
          units: 'ft',
          precision: 2,
          gridSize: 1,
          snapToGrid: true,
          dimensionStyle: {
            textHeight: 0.35,
            arrowSize: 0.2,
            precision: 2,
            extensionGap: 0.05,
            extensionBeyond: 0.1,
          },
        },
        currentLayerId: 'layer-0',
        layers: [
          {
            id: 'layer-0',
            name: '0',
            color: '#d4d4d4',
            visible: true,
            locked: false,
          },
          {
            id: 'layer-dimensions',
            name: 'Dimensions',
            color: '#7dd3fc',
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
            geometry: { start: { x: 0, y: 0 }, end: { x: 5, y: 0 } },
            properties: {},
          },
        ],
      },
    };
    const opened = parseDocument(JSON.stringify(v2));
    expect(opened.schemaVersion).toBe(10);
    expect(opened.settings.constructionDefaults.wallThickness).toBeGreaterThan(0);
    expect(opened.layers.map((l) => l.name)).toEqual(
      expect.arrayContaining(['Walls', 'Doors', 'Windows', 'Rooms']),
    );
    expect(opened.entities).toHaveLength(1);
  });

  it('migrates schema v3 documents to v4 with Rooms layer', () => {
    const v3 = {
      format: 'ratecad',
      schemaVersion: 3,
      document: {
        schemaVersion: 3,
        meta: {
          name: 'M6',
          createdAt: '2024-06-01T00:00:00.000Z',
          updatedAt: '2024-06-01T00:00:00.000Z',
          appVersion: '0.4.0',
        },
        settings: {
          units: 'ft',
          precision: 2,
          gridSize: 1,
          snapToGrid: true,
          dimensionStyle: {
            textHeight: 0.35,
            arrowSize: 0.2,
            precision: 2,
            extensionGap: 0.05,
            extensionBeyond: 0.1,
          },
          constructionDefaults: {
            wallThickness: 0.75,
            wallHeight: 8,
            doorWidth: 3,
            doorHeight: 7,
            windowWidth: 3,
            windowHeight: 4,
            windowSill: 3,
          },
        },
        currentLayerId: 'layer-0',
        layers: [
          {
            id: 'layer-0',
            name: '0',
            color: '#d4d4d4',
            visible: true,
            locked: false,
          },
          {
            id: 'layer-walls',
            name: 'Walls',
            color: '#e8e8e8',
            visible: true,
            locked: false,
          },
        ],
        entities: [],
      },
    };
    const opened = parseDocument(JSON.stringify(v3));
    expect(opened.schemaVersion).toBe(10);
    expect(opened.layers.map((l) => l.name)).toEqual(
      expect.arrayContaining(['Rooms']),
    );
  });

  it('round-trips walls, doors, windows and host relationships', () => {
    const base = createEmptyDocument('Construction');
    const wallId = 'wall-1';
    const doc: DrawingDocument = {
      ...base,
      entities: [
        {
          id: wallId,
          type: 'wall',
          layerId: 'layer-walls',
          visible: true,
          locked: false,
          geometry: {
            start: { x: 0, y: 0 },
            end: { x: 20, y: 0 },
            thickness: 0.75,
            height: 8,
            justification: 'center',
          },
          properties: { material: 'Brick' },
        },
        {
          id: 'door-1',
          type: 'door',
          layerId: 'layer-doors',
          visible: true,
          locked: false,
          geometry: {
            hostWallId: wallId,
            position: 0.4,
            width: 3,
            height: 7,
            swing: 'left',
            swingAngle: Math.PI / 2,
          },
          properties: { doorType: 'single' },
        },
        {
          id: 'window-1',
          type: 'window',
          layerId: 'layer-windows',
          visible: true,
          locked: false,
          geometry: {
            hostWallId: wallId,
            position: 0.75,
            width: 4,
            height: 4,
            sillHeight: 3,
          },
          properties: { windowType: 'fixed' },
        },
      ],
    };
    const opened = parseDocument(serializeDocument(doc));
    expect(opened.schemaVersion).toBe(10);
    expect(opened.entities.map((e) => e.type)).toEqual([
      'wall',
      'door',
      'window',
    ]);
    const door = opened.entities.find((e) => e.type === 'door');
    const win = opened.entities.find((e) => e.type === 'window');
    expect(door?.type === 'door' && door.geometry.hostWallId).toBe(wallId);
    expect(win?.type === 'window' && win.geometry.hostWallId).toBe(wallId);
    expect(opened.settings.constructionDefaults).toBeDefined();
  });

  it('round-trips rooms with wall boundary references', () => {
    const base = createEmptyDocument('Rooms');
    const wallIds = ['wall-a', 'wall-b', 'wall-c', 'wall-d'];
    const doc: DrawingDocument = {
      ...base,
      entities: [
        {
          id: wallIds[0]!,
          type: 'wall',
          layerId: 'layer-walls',
          visible: true,
          locked: false,
          geometry: {
            start: { x: 0, y: 0 },
            end: { x: 10, y: 0 },
            thickness: 0.75,
            height: 8,
            justification: 'center',
          },
          properties: {},
        },
        {
          id: wallIds[1]!,
          type: 'wall',
          layerId: 'layer-walls',
          visible: true,
          locked: false,
          geometry: {
            start: { x: 10, y: 0 },
            end: { x: 10, y: 12 },
            thickness: 0.75,
            height: 8,
            justification: 'center',
          },
          properties: {},
        },
        {
          id: wallIds[2]!,
          type: 'wall',
          layerId: 'layer-walls',
          visible: true,
          locked: false,
          geometry: {
            start: { x: 10, y: 12 },
            end: { x: 0, y: 12 },
            thickness: 0.75,
            height: 8,
            justification: 'center',
          },
          properties: {},
        },
        {
          id: wallIds[3]!,
          type: 'wall',
          layerId: 'layer-walls',
          visible: true,
          locked: false,
          geometry: {
            start: { x: 0, y: 12 },
            end: { x: 0, y: 0 },
            thickness: 0.75,
            height: 8,
            justification: 'center',
          },
          properties: {},
        },
        {
          id: 'room-1',
          type: 'room',
          layerId: 'layer-rooms',
          visible: true,
          locked: false,
          geometry: {
            wallIds,
            wallDirs: ['forward', 'forward', 'forward', 'forward'],
            polygon: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 10, y: 12 },
              { x: 0, y: 12 },
            ],
            labelPosition: { x: 5, y: 6 },
            area: 120,
          },
          properties: { name: 'Bedroom', roomType: 'bedroom' },
        },
      ],
    };
    const opened = parseDocument(serializeDocument(doc));
    expect(opened.schemaVersion).toBe(10);
    const room = opened.entities.find((e) => e.type === 'room');
    expect(room?.type).toBe('room');
    if (room?.type === 'room') {
      expect(room.properties.name).toBe('Bedroom');
      expect(room.geometry.area).toBe(120);
      expect(room.geometry.wallIds).toEqual(wallIds);
    }
  });

  it('drops orphaned doors/windows on open', () => {
    const base = createEmptyDocument('Orphans');
    const doc: DrawingDocument = {
      ...base,
      entities: [
        {
          id: 'door-orphan',
          type: 'door',
          layerId: 'layer-doors',
          visible: true,
          locked: false,
          geometry: {
            hostWallId: 'missing-wall',
            position: 0.5,
            width: 3,
            height: 7,
            swing: 'left',
            swingAngle: Math.PI / 2,
          },
          properties: {},
        },
      ],
    };
    const opened = parseDocument(serializeDocument(doc));
    expect(opened.entities).toHaveLength(0);
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
