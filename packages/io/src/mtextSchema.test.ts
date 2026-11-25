import { describe, expect, it } from 'vitest';
import { createEmptyDocument, SCHEMA_VERSION, type DrawingDocument } from '@ratecad/core';
import { parseDocument, serializeDocument } from './index.js';

function withText(geometry: DrawingDocument['entities'][number]['geometry']): DrawingDocument {
  const doc = createEmptyDocument('Text');
  return {
    ...doc,
    entities: [
      {
        id: 'text-1',
        type: 'text',
        layerId: doc.layers[0]!.id,
        visible: true,
        locked: false,
        geometry: geometry as never,
        properties: {},
      },
    ],
  };
}

describe('multiline text persistence', () => {
  it('still opens a single-line text entity from an older drawing', () => {
    const opened = parseDocument(
      serializeDocument(
        withText({
          position: { x: 1, y: 2 },
          content: 'Room',
          height: 0.35,
          rotation: 0,
        }),
      ),
    );
    expect(opened.schemaVersion).toBe(SCHEMA_VERSION);
    expect(opened.entities[0]).toMatchObject({
      type: 'text',
      geometry: { content: 'Room', height: 0.35 },
    });
  });

  it('round-trips formatted multiline text at the current schema', () => {
    const opened = parseDocument(
      serializeDocument(
        withText({
          position: { x: 4, y: 8 },
          content: 'Bedroom\n12x15',
          height: 150,
          rotation: Math.PI / 4,
          width: 80,
          attachment: 'MC',
          body: {
            paragraphs: [
              { align: 'center', spans: [{ text: 'Bedroom', bold: true, fontFamily: 'Georgia', height: 200 }] },
              { align: 'right', spans: [{ text: '12x15', italic: true, height: 150 }] },
            ],
          },
        }),
      ),
    );
    const entity = opened.entities[0];
    expect(entity?.type).toBe('text');
    if (entity?.type !== 'text') return;
    expect(entity.geometry.content).toBe('Bedroom\n12x15');
    expect(entity.geometry.width).toBe(80);
    expect(entity.geometry.attachment).toBe('MC');
    expect(entity.geometry.body?.paragraphs[0]?.spans[0]).toMatchObject({
      text: 'Bedroom',
      bold: true,
      fontFamily: 'Georgia',
      height: 200,
    });
    expect(entity.geometry.body?.paragraphs[1]?.spans[0]?.italic).toBe(true);
    expect(entity.geometry.rotation).toBeCloseTo(Math.PI / 4);
  });

  it('rejects a multiline body that is not structured text', () => {
    const doc = withText({
      position: { x: 0, y: 0 },
      content: 'Room',
      height: 1,
      rotation: 0,
      body: { paragraphs: [{ spans: [{ text: 12 }] }] },
    });
    expect(() => parseDocument(serializeDocument(doc))).toThrow(/multiline text body/i);
  });
});
