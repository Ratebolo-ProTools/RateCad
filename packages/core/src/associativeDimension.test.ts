import { beforeEach, describe, expect, it } from 'vitest';
import {
  createEmptyDocument,
  createEntityId,
  getAssociativeRef,
  refreshAssociativePaperDimensions,
  resetIdCounter,
  withAssociativeRef,
  type DimensionEntity,
  type LineEntity,
} from './index.js';

describe('associative paper dimension foundation', () => {
  beforeEach(() => resetIdCounter());

  it('updates modelMeasurement when reference is valid', () => {
    let doc = createEmptyDocument();
    const lineId = createEntityId('line');
    const line: LineEntity = {
      id: lineId,
      type: 'line',
      layerId: doc.currentLayerId,
      visible: true,
      locked: false,
      geometry: { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
      properties: {},
    };
    doc = { ...doc, entities: [line] };
    const layout = doc.layouts[0]!;
    const dim: DimensionEntity = withAssociativeRef(
      {
        id: createEntityId('ps-dim'),
        type: 'dimension',
        layerId: doc.currentLayerId,
        visible: true,
        locked: false,
        geometry: {
          kind: 'horizontal',
          start: { x: 20, y: 20 },
          end: { x: 40, y: 20 },
          offset: 5,
        },
        properties: {},
        metadata: { paperSpace: true },
      },
      {
        modelEntityId: lineId,
        kind: 'horizontal',
        valid: true,
        viewportId: layout.viewports[0]!.id,
      },
    );
    doc = {
      ...doc,
      layouts: [{ ...layout, paperSpaceEntities: [dim] }],
      activeLayoutId: layout.id,
    };

    doc = refreshAssociativePaperDimensions(doc, layout.id);
    const next = doc.layouts[0]!.paperSpaceEntities[0]!;
    const ref = getAssociativeRef(next);
    expect(ref?.valid).toBe(true);
    expect(next.metadata?.modelMeasurement).toEqual({
      start: { x: 0, y: 0 },
      end: { x: 10, y: 0 },
      length: 10,
    });
  });

  it('marks non-associative when model entity is missing (keeps measurement)', () => {
    let doc = createEmptyDocument();
    const layout = doc.layouts[0]!;
    const dim: DimensionEntity = withAssociativeRef(
      {
        id: createEntityId('ps-dim'),
        type: 'dimension',
        layerId: doc.currentLayerId,
        visible: true,
        locked: false,
        geometry: {
          kind: 'aligned',
          start: { x: 1, y: 1 },
          end: { x: 5, y: 1 },
          offset: 2,
        },
        properties: {},
        metadata: { paperSpace: true },
      },
      {
        modelEntityId: 'missing-entity',
        kind: 'aligned',
        valid: true,
      },
    );
    doc = {
      ...doc,
      layouts: [{ ...layout, paperSpaceEntities: [dim] }],
    };
    doc = refreshAssociativePaperDimensions(doc, layout.id);
    const next = doc.layouts[0]!.paperSpaceEntities[0] as DimensionEntity;
    const ref = getAssociativeRef(next);
    expect(ref?.valid).toBe(false);
    expect(ref?.brokenReason).toMatch(/missing/i);
    // Geometry unchanged — do not invent a measurement
    expect(next.geometry.start).toEqual({ x: 1, y: 1 });
    expect(next.geometry.end).toEqual({ x: 5, y: 1 });
  });
});
