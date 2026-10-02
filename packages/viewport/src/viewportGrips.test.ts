import { describe, expect, it } from 'vitest';
import {
  createDefaultLayout,
  createViewportFromRect,
  scaleFromRatio,
} from '@ratecad/core';
import {
  applyViewportGripResize,
  applyViewportMove,
  cameraForViewport,
  fitPaperInCanvas,
  getViewportGrips,
  hitTestViewportGrip,
  panViewportModel,
  zoomViewportScale,
} from '../src/index.js';

describe('viewport grips and cameras', () => {
  it('hit-tests corner grips in screen space', () => {
    const layout = createDefaultLayout();
    const vp = layout.viewports[0]!;
    const view = fitPaperInCanvas(layout.pageSettings, 800, 600);
    const grips = getViewportGrips(vp, view);
    expect(grips.length).toBe(8);
    const se = grips.find((g) => g.role === 'se')!;
    const hit = hitTestViewportGrip(grips, se.screen, 8);
    expect(hit?.role).toBe('se');
  });

  it('resize preview enforces minimum size', () => {
    const vp = createViewportFromRect({ x: 10, y: 10, width: 100, height: 80 });
    const next = applyViewportGripResize(vp, 'se', { x: 12, y: 12 });
    expect(next.width).toBeGreaterThanOrEqual(10);
    expect(next.height).toBeGreaterThanOrEqual(10);
  });

  it('move preview shifts paper position only', () => {
    const vp = createViewportFromRect({ x: 10, y: 20, width: 50, height: 40 });
    const next = applyViewportMove(vp, { x: 5, y: -3 });
    expect(next.x).toBe(15);
    expect(next.y).toBe(17);
    expect(next.modelCenterX).toBe(vp.modelCenterX);
    expect(next.scale).toBe(vp.scale);
  });

  it('zoom/pan change view scale/center, not paper rect', () => {
    const vp = createViewportFromRect(
      { x: 10, y: 10, width: 100, height: 80 },
      { scale: scaleFromRatio(100), modelCenterX: 0, modelCenterY: 0 },
    );
    const zoomed = zoomViewportScale(vp, 2);
    expect(zoomed.scale).toBeCloseTo(vp.scale / 2);
    expect(zoomed.x).toBe(vp.x);
    const panned = panViewportModel(vp, { x: 3, y: 4 });
    expect(panned.modelCenterX).toBe(3);
    expect(panned.modelCenterY).toBe(4);
    expect(panned.width).toBe(vp.width);
  });

  it('independent cameras: two viewports yield different cameras', () => {
    const layout = createDefaultLayout();
    const view = fitPaperInCanvas(layout.pageSettings, 800, 600);
    const a = {
      ...layout.viewports[0]!,
      modelCenterX: 0,
      modelCenterY: 0,
      scale: scaleFromRatio(100),
    };
    const b = {
      ...createViewportFromRect({ x: 40, y: 40, width: 80, height: 60 }),
      modelCenterX: 50,
      modelCenterY: 25,
      scale: scaleFromRatio(50),
    };
    const ca = cameraForViewport(a, view).camera;
    const cb = cameraForViewport(b, view).camera;
    expect(ca.centerX).not.toBe(cb.centerX);
    expect(ca.zoom).not.toBe(cb.zoom);
  });
});
