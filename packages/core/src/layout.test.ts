import { beforeEach, describe, expect, it } from 'vitest';
import {
  addLayout,
  addViewport,
  assertLayoutsValid,
  createDefaultLayout,
  createEmptyDocument,
  createLayout,
  createViewportFromRect,
  formatViewportScale,
  getViewport,
  hitTestViewport,
  hitTestViewportBoundary,
  isStandardViewportScale,
  replaceViewport,
  resetIdCounter,
  scaleFromRatio,
  setActiveLayout,
  sheetSizeInPageUnits,
  workspaceModeLabel,
} from '../src/index.js';

describe('Layout / Model-Paper foundation', () => {
  beforeEach(() => resetIdCounter());

  it('empty document has Model tab (activeLayoutId null) and Layout1', () => {
    const doc = createEmptyDocument();
    expect(doc.activeLayoutId).toBeNull();
    expect(doc.layouts).toHaveLength(1);
    expect(doc.layouts[0]!.name).toBe('Layout1');
    expect(doc.layouts[0]!.viewports.length).toBe(1);
  });

  it('Layout1 has unique id, page settings, and a viewport that does not copy model entities', () => {
    const layout = createDefaultLayout();
    expect(layout.id).toBeTruthy();
    expect(layout.pageSettings.paperSize).toBe('A4');
    expect(layout.pageSettings.orientation).toBe('landscape');
    expect(layout.pageSettings.units).toBe('mm');
    expect(layout.paperSpaceEntities).toEqual([]);
    expect(layout.viewports[0]!.width).toBeGreaterThan(0);
    expect(layout.viewports[0]!.height).toBeGreaterThan(0);
    // Viewport is a reference window — no embedded model entities
    expect('entities' in layout.viewports[0]!).toBe(false);
  });

  it('sheet size uses paper orientation (A4 landscape)', () => {
    const layout = createDefaultLayout();
    const size = sheetSizeInPageUnits(layout.pageSettings);
    expect(size.width).toBe(297);
    expect(size.height).toBe(210);
  });

  it('supports multiple layouts with unique ids and names', () => {
    let doc = createEmptyDocument();
    const a = addLayout(doc);
    doc = a.document;
    const b = addLayout(doc);
    doc = b.document;
    expect(doc.layouts.length).toBe(3);
    assertLayoutsValid(doc.layouts);
    const names = doc.layouts.map((l) => l.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    const ids = doc.layouts.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('createLayout generates unique names', () => {
    const existing = [createDefaultLayout('Layout1'), createLayout([], 'Layout2')];
    const next = createLayout(existing);
    expect(next.name.toLowerCase()).not.toBe('layout1');
    expect(next.name.toLowerCase()).not.toBe('layout2');
  });

  it('Model ↔ Layout tab switching via setActiveLayout', () => {
    let doc = createEmptyDocument();
    const layoutId = doc.layouts[0]!.id;
    doc = setActiveLayout(doc, layoutId);
    expect(doc.activeLayoutId).toBe(layoutId);
    expect(doc.workspaceMode).toBe('PAPER_SPACE');
    doc = setActiveLayout(doc, null);
    expect(doc.activeLayoutId).toBeNull();
    expect(doc.workspaceMode).toBe('MODEL_SPACE');
  });

  it('viewport hit-test distinguishes inside vs outside', () => {
    const layout = createDefaultLayout();
    const vp = layout.viewports[0]!;
    const inside = hitTestViewport(layout, vp.x + vp.width / 2, vp.y + vp.height / 2);
    expect(inside?.id).toBe(vp.id);
    const outside = hitTestViewport(layout, vp.x - 1, vp.y - 1);
    expect(outside).toBeNull();
  });

  it('workspace mode labels', () => {
    expect(workspaceModeLabel('MODEL_SPACE')).toBe('MODEL SPACE');
    expect(workspaceModeLabel('PAPER_SPACE')).toBe('PAPER SPACE');
    expect(workspaceModeLabel('VIEWPORT_MODEL_SPACE', 'Layout1', 0)).toBe(
      'MODEL SPACE — Layout1 — Viewport 1',
    );
  });

  it('layouts do not duplicate model entity list', () => {
    const doc = createEmptyDocument();
    doc.entities.push({
      id: 'line-model-1',
      type: 'line',
      layerId: doc.currentLayerId,
      visible: true,
      locked: false,
      geometry: { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
      properties: {},
    });
    for (const layout of doc.layouts) {
      expect(layout.paperSpaceEntities.find((e) => e.id === 'line-model-1')).toBeUndefined();
    }
  });

  it('addViewport / replaceViewport / scale helpers', () => {
    let doc = createEmptyDocument();
    const layoutId = doc.layouts[0]!.id;
    const vp2 = createViewportFromRect(
      { x: 5, y: 5, width: 40, height: 30 },
      { scale: scaleFromRatio(100), locked: true },
    );
    doc = addViewport(doc, layoutId, vp2);
    expect(doc.layouts[0]!.viewports.length).toBe(2);
    expect(formatViewportScale(vp2.scale)).toBe('1:100');
    expect(isStandardViewportScale(vp2.scale)).toBe(100);

    const updated = { ...vp2, modelCenterX: 42 };
    doc = replaceViewport(doc, layoutId, updated);
    expect(getViewport(doc.layouts[0]!, vp2.id)?.modelCenterX).toBe(42);

    // Switching layouts preserves viewport cameras on each layout
    const other = addLayout(doc);
    doc = other.document;
    const first = doc.layouts.find((l) => l.id === layoutId)!;
    expect(getViewport(first, vp2.id)?.modelCenterX).toBe(42);
    expect(getViewport(first, vp2.id)?.locked).toBe(true);
  });

  it('viewport boundary hit-test', () => {
    const layout = createDefaultLayout();
    const vp = layout.viewports[0]!;
    const onEdge = hitTestViewportBoundary(layout, vp.x, vp.y + vp.height / 2, 2);
    expect(onEdge?.id).toBe(vp.id);
    const deepInside = hitTestViewportBoundary(
      layout,
      vp.x + vp.width / 2,
      vp.y + vp.height / 2,
      1,
    );
    expect(deepInside).toBeNull();
  });
});
