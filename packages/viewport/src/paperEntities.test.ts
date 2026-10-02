import { describe, expect, it } from 'vitest';
import {
  createDefaultLayout,
  createEmptyDocument,
  createViewportFromRect,
  defaultSheetInfo,
  defaultTitleBlock,
  buildTitleBlockEntities,
  buildViewportLabelEntity,
  syncViewportLabelPositions,
  scaleFromRatio,
} from '@ratecad/core';
import {
  drawPaperSpaceEntities,
  hitTestPaperSpaceEntities,
  paperViewForLayout,
} from '../src/index.js';

describe('paper space entities render/hit', () => {
  it('hit-tests paper text', () => {
    const layout = createDefaultLayout();
    const ents = buildTitleBlockEntities(
      { ...defaultTitleBlock(layout.pageSettings), enabled: true },
      defaultSheetInfo(),
    );
    layout.paperSpaceEntities = ents;
    const hit = hitTestPaperSpaceEntities(
      layout,
      { x: ents[0]!.type === 'line' ? ents[0]!.geometry.start.x : 0, y: ents[0]!.type === 'line' ? ents[0]!.geometry.start.y : 0 },
      3,
    );
    expect(hit).not.toBeNull();
  });

  it('syncs viewport label position with viewport', () => {
    const vp = createViewportFromRect(
      { x: 40, y: 50, width: 80, height: 60 },
      { scale: scaleFromRatio(100) },
    );
    vp.showLabel = true;
    vp.label = 'GROUND FLOOR PLAN';
    vp.scaleLabel = 'Scale 1:100';
    const label = buildViewportLabelEntity(vp, 0)!;
    vp.x = 70;
    vp.y = 90;
    const synced = syncViewportLabelPositions([label], [vp]);
    expect(synced[0]!.type).toBe('text');
    if (synced[0]!.type === 'text') {
      expect(synced[0]!.geometry.position.x).toBe(70);
      expect(synced[0]!.geometry.position.y).toBe(85);
    }
  });

  it('paperViewForLayout applies paperCamera zoom', () => {
    const layout = createDefaultLayout();
    layout.paperCamera = { offsetX: 0, offsetY: 0, zoom: 2 };
    const view = paperViewForLayout(layout, 800, 600);
    const base = paperViewForLayout(
      { ...layout, paperCamera: { offsetX: 0, offsetY: 0, zoom: 1 } },
      800,
      600,
    );
    expect(view.pxPerMm).toBeCloseTo(base.pxPerMm * 2, 5);
  });

  it('drawPaperSpaceEntities does not throw', () => {
    const doc = createEmptyDocument();
    const layout = doc.layouts[0]!;
    layout.paperSpaceEntities = buildTitleBlockEntities(
      { ...defaultTitleBlock(layout.pageSettings), enabled: true },
      defaultSheetInfo(),
    );
    const canvas = {
      save() {},
      restore() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      stroke() {},
      fill() {},
      fillText() {},
      strokeRect() {},
      closePath() {},
      arc() {},
      translate() {},
      rotate() {},
      strokeStyle: '',
      fillStyle: '',
      lineWidth: 1,
      globalAlpha: 1,
      font: '',
      textAlign: 'left',
      textBaseline: 'alphabetic',
    } as unknown as CanvasRenderingContext2D;
    const view = paperViewForLayout(layout, 800, 600);
    expect(() =>
      drawPaperSpaceEntities(canvas, doc, layout, view, {}),
    ).not.toThrow();
  });
});
