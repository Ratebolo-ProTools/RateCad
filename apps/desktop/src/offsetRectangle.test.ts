import { describe, expect, it } from 'vitest';
import { createEmptyDocument } from '@ratecad/core';
import { offsetRectangleEntity } from '@ratecad/geometry';
import { parseDocument, serializeDocument } from '@ratecad/io';

describe('rectangle offset save and reopen', () => {
  it('round-trips an inward offset rectangle', () => {
    const doc = createEmptyDocument('Offset');
    const source = {
      id: 'rect-1',
      type: 'rectangle' as const,
      layerId: doc.layers[0]!.id,
      visible: true,
      locked: false,
      geometry: { corner1: { x: 0, y: 0 }, corner2: { x: 5000, y: 4000 } },
      properties: { color: '#445566' },
    };
    const offset = offsetRectangleEntity(source, 230, { x: 2500, y: 2000 }, 'rect-2');
    expect(offset.ok).toBe(true);
    if (!offset.ok) return;
    const saved = serializeDocument({
      ...doc,
      entities: [source, offset.entities[0]!],
    });
    const opened = parseDocument(saved);
    const copy = opened.entities.find((entity) => entity.id === 'rect-2');
    expect(copy?.type).toBe('rectangle');
    if (copy?.type === 'rectangle') {
      expect(copy.geometry.corner1).toEqual({ x: 230, y: 230 });
      expect(copy.geometry.corner2).toEqual({ x: 4770, y: 3770 });
      expect(copy.properties.color).toBe('#445566');
    }
    const original = opened.entities.find((entity) => entity.id === 'rect-1');
    expect(original?.type).toBe('rectangle');
    if (original?.type === 'rectangle') {
      expect(original.geometry.corner2).toEqual({ x: 5000, y: 4000 });
    }
  });
});
