import { beforeEach, describe, expect, it } from 'vitest';
import {
  createEmptyDocument,
  createEntityId,
  getEntity,
  isEntityModifiable,
  isEntitySelectable,
  resetIdCounter,
  setCurrentLayer,
  updateLayer,
} from '../src/index.js';

describe('DrawingDocument', () => {
  beforeEach(() => {
    resetIdCounter();
  });

  it('creates an empty document with default layers and units', () => {
    const doc = createEmptyDocument('Test');
    expect(doc.schemaVersion).toBe(5);
    expect(doc.meta.name).toBe('Test');
    expect(doc.entities).toEqual([]);
    expect(doc.layers.length).toBeGreaterThanOrEqual(9);
    expect(doc.layers.map((l) => l.name)).toEqual(
      expect.arrayContaining([
        '0',
        'Walls',
        'Doors',
        'Windows',
        'Rooms',
        'Dimensions',
        'Text',
        'Construction',
        'Annotations',
      ]),
    );
    expect(doc.settings.units).toBe('ft-in');
    expect(doc.settings.worldUnit).toBe('ft');
    expect(doc.settings.dimensionStyle).toBeDefined();
    expect(doc.currentLayerId).toBe('layer-0');
    expect(doc.selection).toEqual([]);
  });

  it('creates stable unique entity ids', () => {
    const a = createEntityId('line');
    const b = createEntityId('line');
    expect(a).not.toBe(b);
    expect(a.startsWith('line-')).toBe(true);
  });

  it('getEntity returns undefined for missing ids', () => {
    const doc = createEmptyDocument();
    expect(getEntity(doc, 'missing')).toBeUndefined();
  });

  it('respects layer visibility and lock for selection/modification', () => {
    let doc = createEmptyDocument();
    const layer = doc.layers.find((l) => l.name === 'Walls')!;
    doc = {
      ...doc,
      entities: [
        {
          id: 'line-1',
          type: 'line',
          layerId: layer.id,
          visible: true,
          locked: false,
          geometry: { start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
          properties: {},
        },
      ],
    };
    const entity = doc.entities[0]!;
    expect(isEntitySelectable(doc, entity)).toBe(true);
    expect(isEntityModifiable(doc, entity)).toBe(true);

    doc = updateLayer(doc, layer.id, { visible: false });
    expect(isEntitySelectable(doc, entity)).toBe(false);
    expect(isEntityModifiable(doc, entity)).toBe(false);

    doc = updateLayer(doc, layer.id, { visible: true, locked: true });
    expect(isEntitySelectable(doc, entity)).toBe(true);
    expect(isEntityModifiable(doc, entity)).toBe(false);
  });

  it('tracks current layer', () => {
    let doc = createEmptyDocument();
    const walls = doc.layers.find((l) => l.name === 'Walls')!;
    doc = setCurrentLayer(doc, walls.id);
    expect(doc.currentLayerId).toBe(walls.id);
  });
});
