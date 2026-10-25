import { describe, expect, it } from 'vitest';
import {
  createEmptyDocument,
  createEntityId,
  type DrawingDocument,
  type LineEntity,
} from '@ratecad/core';
import { createCamera } from './camera.js';
import { pickboxToleranceWorld } from './draftingCursor.js';
import { hitTestDocument } from './hitTest.js';

function withLine(doc: DrawingDocument, y = 0): { doc: DrawingDocument; id: string } {
  const id = createEntityId('ent');
  const line: LineEntity = {
    id,
    type: 'line',
    layerId: doc.currentLayerId,
    visible: true,
    locked: false,
    geometry: { start: { x: 0, y }, end: { x: 10, y } },
  };
  return {
    doc: { ...doc, entities: [...doc.entities, line] },
    id,
  };
}

describe('pickbox hit tolerance', () => {
  it('selects entities within pickbox aperture and misses outside', () => {
    const base = createEmptyDocument();
    const { doc, id } = withLine(base, 0);
    const cam = createCamera({ zoom: 40, centerX: 5, centerY: 0 });
    const medium = pickboxToleranceWorld(cam, 'medium');
    // Point 6px off the line in screen space → world = 6/40
    const near = { x: 5, y: 6 / 40 };
    const far = { x: 5, y: 20 / 40 };
    expect(hitTestDocument(doc, near, medium)).toBe(id);
    expect(hitTestDocument(doc, far, medium)).toBeNull();
  });

  it('keeps screen-pixel aperture across zoom levels', () => {
    const base = createEmptyDocument();
    const { doc, id } = withLine(base, 0);
    const close = createCamera({ zoom: 80, centerX: 5, centerY: 0 });
    const far = createCamera({ zoom: 20, centerX: 5, centerY: 0 });
    // 6 screen pixels from the line
    const atClose = { x: 5, y: 6 / 80 };
    const atFar = { x: 5, y: 6 / 20 };
    expect(hitTestDocument(doc, atClose, pickboxToleranceWorld(close, 'medium'))).toBe(
      id,
    );
    expect(hitTestDocument(doc, atFar, pickboxToleranceWorld(far, 'medium'))).toBe(id);
    // Same world offset is outside when zoomed in (smaller world tolerance)
    expect(hitTestDocument(doc, atFar, pickboxToleranceWorld(close, 'medium'))).toBeNull();
  });

  it('does not hit hidden-layer entities (hover/select restriction)', () => {
    let doc = createEmptyDocument();
    const made = withLine(doc, 0);
    doc = made.doc;
    const layer = doc.layers.find((l) => l.id === doc.currentLayerId)!;
    doc = {
      ...doc,
      layers: doc.layers.map((l) =>
        l.id === layer.id ? { ...l, visible: false } : l,
      ),
    };
    const cam = createCamera({ zoom: 40 });
    expect(
      hitTestDocument(doc, { x: 5, y: 0 }, pickboxToleranceWorld(cam, 'large')),
    ).toBeNull();
  });
});
