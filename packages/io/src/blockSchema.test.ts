import { describe, expect, it } from 'vitest';
import { createEmptyDocument, type DrawingDocument } from '@ratecad/core';
import { parseDocument, serializeDocument } from './index.js';

function blockDocument(): DrawingDocument {
  const doc = createEmptyDocument('Blocks');
  return {
    ...doc,
    blockDefinitions: [
      {
        id: 'bdef-1',
        name: 'Mark',
        basePoint: { x: 0, y: 0 },
        entities: [
          {
            id: 'line-a',
            type: 'line',
            layerId: doc.currentLayerId,
            visible: true,
            locked: false,
            properties: {},
            geometry: { start: { x: 0, y: 0 }, end: { x: 2, y: 0 } },
          },
        ],
      },
    ],
    entities: [
      {
        id: 'block-1',
        type: 'block',
        layerId: doc.currentLayerId,
        visible: true,
        locked: false,
        properties: {},
        geometry: {
          definitionId: 'bdef-1',
          position: { x: -2, y: 4 },
          scaleX: -1.5,
          scaleY: 0.5,
          rotation: Math.PI / 6,
        },
      },
      {
        id: 'block-2',
        type: 'block',
        layerId: doc.currentLayerId,
        visible: true,
        locked: false,
        properties: {},
        geometry: {
          definitionId: 'bdef-1',
          position: { x: 8, y: -3 },
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
        },
      },
    ],
  };
}

describe('block schema 11', () => {
  it('round-trips definitions and references', () => {
    const original = blockDocument();
    const opened = parseDocument(serializeDocument(original));
    expect(opened.schemaVersion).toBe(12);
    expect(opened.blockDefinitions).toHaveLength(1);
    expect(opened.blockDefinitions[0]).toMatchObject({
      id: 'bdef-1',
      name: 'Mark',
    });
    expect(opened.blockDefinitions[0]!.entities[0]).toMatchObject({
      id: 'line-a',
      geometry: { start: { x: 0, y: 0 }, end: { x: 2, y: 0 } },
    });
    expect(opened.entities).toHaveLength(2);
    expect(opened.entities[0]).toMatchObject({
      id: 'block-1',
      geometry: {
        definitionId: 'bdef-1',
        position: { x: -2, y: 4 },
        scaleX: -1.5,
        scaleY: 0.5,
        rotation: Math.PI / 6,
      },
    });
    expect(opened.selection).toEqual([]);
  });

  it('migrates a schema 10 document with an empty definition list', () => {
    const current = JSON.parse(serializeDocument(createEmptyDocument('Legacy'))) as {
      schemaVersion: number;
      document: { schemaVersion: number; blockDefinitions?: unknown };
    };
    current.schemaVersion = 10;
    current.document.schemaVersion = 10;
    delete current.document.blockDefinitions;
    const opened = parseDocument(JSON.stringify(current));
    expect(opened.schemaVersion).toBe(12);
    expect(opened.blockDefinitions).toEqual([]);
    expect(opened.entities).toEqual([]);
  });

  it('rejects a missing definition, a nested block, and duplicate names or ids', () => {
    const missing = JSON.parse(serializeDocument(blockDocument())) as {
      document: { entities: Array<{ geometry: { definitionId: string } }> };
    };
    missing.document.entities[0]!.geometry.definitionId = 'missing';
    expect(() => parseDocument(JSON.stringify(missing))).toThrow(/missing definition/i);

    const nested = JSON.parse(serializeDocument(blockDocument())) as {
      document: {
        blockDefinitions: Array<{ entities: Array<Record<string, unknown>> }>;
      };
    };
    nested.document.blockDefinitions[0]!.entities.push({
      id: 'inner',
      type: 'block',
      layerId: 'layer-0',
      visible: true,
      locked: false,
      properties: {},
      geometry: {
        definitionId: 'bdef-1',
        position: { x: 0, y: 0 },
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
      },
    });
    expect(() => parseDocument(JSON.stringify(nested))).toThrow(/nested block/i);

    const names = JSON.parse(serializeDocument(blockDocument())) as {
      document: { blockDefinitions: Array<Record<string, unknown>> };
    };
    names.document.blockDefinitions.push({
      ...names.document.blockDefinitions[0],
      id: 'bdef-2',
      name: 'mark',
    });
    expect(() => parseDocument(JSON.stringify(names))).toThrow(/duplicate block name/i);

    const ids = JSON.parse(serializeDocument(blockDocument())) as {
      document: { blockDefinitions: Array<Record<string, unknown>> };
    };
    ids.document.blockDefinitions.push({
      ...ids.document.blockDefinitions[0],
      name: 'Other',
    });
    expect(() => parseDocument(JSON.stringify(ids))).toThrow(/duplicate block definition id/i);
  });
});
