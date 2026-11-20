import { describe, expect, it } from 'vitest';
import { createEmptyDocument, type BlockReferenceEntity } from '@ratecad/core';
import { getEntityGrips } from './grips.js';
import { hitTestDocument } from './hitTest.js';

function documentWithBlock(reference: BlockReferenceEntity) {
  const doc = createEmptyDocument('Hit');
  doc.blockDefinitions = [
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
  ];
  doc.entities = [reference];
  return doc;
}

describe('block reference picking', () => {
  it('selects the reference, not its definition geometry, and exposes one insertion grip', () => {
    const reference: BlockReferenceEntity = {
      id: 'block-1',
      type: 'block',
      layerId: 'layer-0',
      visible: true,
      locked: false,
      properties: {},
      geometry: {
        definitionId: 'bdef-1',
        position: { x: 10, y: 10 },
        scaleX: 1,
        scaleY: 1,
        rotation: Math.PI / 2,
      },
    };
    const doc = documentWithBlock(reference);
    expect(hitTestDocument(doc, { x: 10, y: 11 }, 0.05)).toBe('block-1');
    expect(hitTestDocument(doc, { x: 12, y: 10 }, 0.05)).toBeNull();
    const grips = getEntityGrips(reference);
    expect(grips).toHaveLength(1);
    expect(grips[0]).toMatchObject({
      role: 'insertion',
      point: { x: 10, y: 10 },
      editTarget: { kind: 'block-insertion' },
    });
  });
});
