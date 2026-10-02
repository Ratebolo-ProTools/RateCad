import { beforeEach, describe, expect, it } from 'vitest';
import {
  WINDOWS_LAYER_ID,
  createEmptyDocument,
  createViewportFromRect,
  isLayerVisibleInViewport,
  replaceViewport,
  resetIdCounter,
  scaleFromRatio,
  withViewportLayerOverride,
} from './index.js';

describe('viewport layer visibility overrides', () => {
  beforeEach(() => resetIdCounter());

  it('override hidden hides only when global layer is visible', () => {
    const layer = { id: WINDOWS_LAYER_ID, visible: true };
    expect(isLayerVisibleInViewport(layer, { [WINDOWS_LAYER_ID]: false })).toBe(
      false,
    );
    expect(isLayerVisibleInViewport(layer, { [WINDOWS_LAYER_ID]: true })).toBe(
      true,
    );
    expect(isLayerVisibleInViewport(layer, {})).toBe(true);
  });

  it('global layer visibility still wins', () => {
    const layer = { id: WINDOWS_LAYER_ID, visible: false };
    expect(isLayerVisibleInViewport(layer, { [WINDOWS_LAYER_ID]: true })).toBe(
      false,
    );
    expect(isLayerVisibleInViewport(layer, {})).toBe(false);
  });

  it('independent viewport overrides do not duplicate entities', () => {
    let doc = createEmptyDocument();
    const layout = doc.layouts[0]!;
    const vp1 = withViewportLayerOverride(
      createViewportFromRect(
        { x: 20, y: 20, width: 100, height: 80 },
        { scale: scaleFromRatio(100) },
      ),
      WINDOWS_LAYER_ID,
      true,
    );
    const vp2 = withViewportLayerOverride(
      createViewportFromRect(
        { x: 140, y: 20, width: 100, height: 80 },
        { scale: scaleFromRatio(50) },
      ),
      WINDOWS_LAYER_ID,
      false,
    );
    doc = replaceViewport(doc, layout.id, vp1);
    // add second viewport via replace on a layout that has only one — use document helpers
    const layout2 = {
      ...doc.layouts[0]!,
      viewports: [vp1, vp2],
    };
    doc = {
      ...doc,
      layouts: [layout2],
      entities: [
        {
          id: 'win-1',
          type: 'line',
          layerId: WINDOWS_LAYER_ID,
          visible: true,
          locked: false,
          geometry: { start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
          properties: {},
        },
      ],
    };

    expect(doc.entities).toHaveLength(1);
    expect(
      isLayerVisibleInViewport(
        { id: WINDOWS_LAYER_ID, visible: true },
        vp1.layerVisibilityOverrides,
      ),
    ).toBe(true);
    expect(
      isLayerVisibleInViewport(
        { id: WINDOWS_LAYER_ID, visible: true },
        vp2.layerVisibilityOverrides,
      ),
    ).toBe(false);
    expect(vp1.scale).not.toBeCloseTo(vp2.scale);
  });

  it('withViewportLayerOverride clears when null', () => {
    const vp = createViewportFromRect({ x: 0, y: 0, width: 50, height: 40 });
    const hidden = withViewportLayerOverride(vp, 'layer-a', false);
    expect(hidden.layerVisibilityOverrides['layer-a']).toBe(false);
    const cleared = withViewportLayerOverride(hidden, 'layer-a', null);
    expect(cleared.layerVisibilityOverrides['layer-a']).toBeUndefined();
  });
});
