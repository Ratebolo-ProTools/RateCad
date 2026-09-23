import { describe, expect, it } from 'vitest';
import {
  WALLS_LAYER_ID,
  createEmptyDocument,
  updateLayer,
  type Entity,
  type LineEntity,
} from '@ratecad/core';
import {
  applyAppearancePatch,
  applyGeometryPropertyEdit,
  getGeometryPropertyValue,
  getStoredAppearance,
  matchPropPatch,
  resolveEffectiveAppearance,
  setByLayerPatch,
} from './propertyEngine.js';

function makeLine(
  props: LineEntity['properties'] = {},
  layerId = createEmptyDocument().currentLayerId,
): LineEntity {
  return {
    id: 'line-1',
    type: 'line',
    layerId,
    visible: true,
    locked: false,
    geometry: { start: { x: 0, y: 0 }, end: { x: 3000, y: 0 } },
    properties: props,
  };
}

describe('PropertyEngine', () => {
  it('defaults missing color to ByLayer and resolves layer color', () => {
    let doc = createEmptyDocument();
    doc = updateLayer(doc, WALLS_LAYER_ID, { color: '#ff0000' });
    const ent = makeLine({}, WALLS_LAYER_ID);
    expect(getStoredAppearance(ent).color.mode).toBe('BY_LAYER');
    expect(resolveEffectiveAppearance(ent, doc).colorHex.toLowerCase()).toBe(
      '#ff0000',
    );
  });

  it('explicit color overrides layer; ByLayer stays live', () => {
    let doc = createEmptyDocument();
    doc = updateLayer(doc, WALLS_LAYER_ID, { color: '#ff0000' });
    let ent: Entity = makeLine(
      {
        color: {
          mode: 'EXPLICIT',
          value: { type: 'RGB', r: 0, g: 0, b: 255 },
        },
      },
      WALLS_LAYER_ID,
    );
    expect(resolveEffectiveAppearance(ent, doc).colorHex.toLowerCase()).toBe(
      '#0000ff',
    );

    doc = updateLayer(doc, WALLS_LAYER_ID, { color: '#00ff00' });
    expect(resolveEffectiveAppearance(ent, doc).colorHex.toLowerCase()).toBe(
      '#0000ff',
    );

    ent = applyAppearancePatch(ent, setByLayerPatch(['color']));
    expect(getStoredAppearance(ent).color.mode).toBe('BY_LAYER');
    expect(resolveEffectiveAppearance(ent, doc).colorHex.toLowerCase()).toBe(
      '#00ff00',
    );

    doc = updateLayer(doc, WALLS_LAYER_ID, { color: '#ffffff' });
    expect(resolveEffectiveAppearance(ent, doc).colorHex.toLowerCase()).toBe(
      '#ffffff',
    );
  });

  it('matchPropPatch copies appearance fields', () => {
    const src = makeLine({
      color: { mode: 'EXPLICIT', value: { type: 'RGB', r: 255, g: 0, b: 0 } },
      linetype: { mode: 'EXPLICIT', value: 'Dashed' },
      lineweight: { mode: 'EXPLICIT', value: 0.5 },
    });
    const patch = matchPropPatch(src);
    expect(patch.color?.mode).toBe('EXPLICIT');
    expect(patch.linetype?.mode).toBe('EXPLICIT');
    expect(patch.lineweight?.mode).toBe('EXPLICIT');
  });

  it('line geometry property edits preserve start anchor', () => {
    let ent: Entity = makeLine();
    expect(getGeometryPropertyValue(ent, 'length')).toBeCloseTo(3000);
    expect(getGeometryPropertyValue(ent, 'angle')).toBeCloseTo(0);

    ent = applyGeometryPropertyEdit(ent, 'endX', 4000)!;
    expect(getGeometryPropertyValue(ent, 'length')).toBeCloseTo(4000);

    ent = applyGeometryPropertyEdit(ent, 'angle', 45)!;
    const end = ent.type === 'line' ? ent.geometry.end : null;
    expect(end).not.toBeNull();
    expect(end!.x).toBeCloseTo(4000 * Math.cos(Math.PI / 4), 5);
    expect(end!.y).toBeCloseTo(4000 * Math.sin(Math.PI / 4), 5);
    expect(ent.type === 'line' && ent.geometry.start.x).toBe(0);
  });

  it('legacy string color is treated as explicit', () => {
    const doc = createEmptyDocument();
    const ent = makeLine({ color: '#aabbcc' });
    expect(resolveEffectiveAppearance(ent, doc).colorHex.toLowerCase()).toBe(
      '#aabbcc',
    );
    expect(getStoredAppearance(ent).color.mode).toBe('EXPLICIT');
  });

  it('linetype pattern scales with object × global scale', () => {
    let doc = createEmptyDocument();
    doc = {
      ...doc,
      settings: { ...doc.settings, linetypeScale: 2 },
    };
    const ent = makeLine({
      linetype: { mode: 'EXPLICIT', value: 'Dashed' },
      linetypeScale: 2,
    });
    const eff = resolveEffectiveAppearance(ent, doc);
    expect(eff.linetypeId).toBe('Dashed');
    // base Dashed [0.5, -0.25] × 2 × 2
    expect(eff.linetypePattern[0]).toBeCloseTo(2);
    expect(eff.linetypePattern[1]).toBeCloseTo(-1);
  });
});
