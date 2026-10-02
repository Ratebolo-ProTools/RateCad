/**
 * Paper Space coordinate transforms and layout sheet rendering helpers.
 *
 * Paper units: page settings units (mm or inch), origin at sheet bottom-left.
 * Screen: CSS pixels, origin top-left.
 * Model: separate world coordinates — viewed only through layout viewports.
 */

import type { Layout, LayoutViewport, PageSettings } from '@ratecad/core';
import { pageUnitsToMm, sheetSizeInPageUnits, sheetSizeMm } from '@ratecad/core';
import type { Vec2 } from '@ratecad/geometry';
import { type Camera, createCamera } from './camera.js';

export interface PaperViewTransform {
  /** Screen X of sheet left edge */
  originX: number;
  /** Screen Y of sheet top edge (canvas Y down) */
  originY: number;
  /** Screen pixels per paper millimetre */
  pxPerMm: number;
  sheetWidthMm: number;
  sheetHeightMm: number;
  page: PageSettings;
}

/** Fit the paper sheet inside the canvas with padding. */
export function fitPaperInCanvas(
  page: PageSettings,
  canvasWidth: number,
  canvasHeight: number,
  paddingPx = 36,
): PaperViewTransform {
  const sheet = sheetSizeMm(page);
  const availW = Math.max(1, canvasWidth - paddingPx * 2);
  const availH = Math.max(1, canvasHeight - paddingPx * 2);
  const pxPerMm = Math.min(availW / sheet.width, availH / sheet.height);
  const drawnW = sheet.width * pxPerMm;
  const drawnH = sheet.height * pxPerMm;
  return {
    originX: (canvasWidth - drawnW) / 2,
    originY: (canvasHeight - drawnH) / 2,
    pxPerMm,
    sheetWidthMm: sheet.width,
    sheetHeightMm: sheet.height,
    page,
  };
}

export function paperToScreen(
  paper: Vec2,
  view: PaperViewTransform,
): Vec2 {
  const xMm = pageUnitsToMm(paper.x, view.page.units);
  const yMm = pageUnitsToMm(paper.y, view.page.units);
  return {
    x: view.originX + xMm * view.pxPerMm,
    // paper Y up from bottom → screen Y down from top of sheet
    y: view.originY + (view.sheetHeightMm - yMm) * view.pxPerMm,
  };
}

export function screenToPaper(
  screen: Vec2,
  view: PaperViewTransform,
): Vec2 {
  const xMm = (screen.x - view.originX) / view.pxPerMm;
  const yMm = view.sheetHeightMm - (screen.y - view.originY) / view.pxPerMm;
  const units = view.page.units;
  const toPage = (mm: number) => (units === 'inch' ? mm / 25.4 : mm);
  return { x: toPage(xMm), y: toPage(yMm) };
}

/** Camera that maps model world → viewport screen rectangle. */
export function cameraForViewport(
  vp: LayoutViewport,
  view: PaperViewTransform,
): { camera: Camera; screenRect: { x: number; y: number; w: number; h: number } } {
  const bl = paperToScreen({ x: vp.x, y: vp.y }, view);
  const tr = paperToScreen({ x: vp.x + vp.width, y: vp.y + vp.height }, view);
  const x = Math.min(bl.x, tr.x);
  const y = Math.min(bl.y, tr.y);
  const w = Math.abs(tr.x - bl.x);
  const h = Math.abs(tr.y - bl.y);
  // scale = model units per paper unit → zoom = px per model unit
  const paperUnitMm = view.page.units === 'inch' ? 25.4 : 1;
  const pxPerPaperUnit = view.pxPerMm * paperUnitMm;
  const zoom = Math.max(1e-6, pxPerPaperUnit / Math.max(1e-9, vp.scale));
  return {
    camera: createCamera({
      centerX: vp.modelCenterX,
      centerY: vp.modelCenterY,
      zoom,
    }),
    screenRect: { x, y, w, h },
  };
}

export function isPointInSheet(
  screen: Vec2,
  view: PaperViewTransform,
): boolean {
  return (
    screen.x >= view.originX &&
    screen.x <= view.originX + view.sheetWidthMm * view.pxPerMm &&
    screen.y >= view.originY &&
    screen.y <= view.originY + view.sheetHeightMm * view.pxPerMm
  );
}

export function drawPaperSheet(
  ctx: CanvasRenderingContext2D,
  view: PaperViewTransform,
): void {
  const w = view.sheetWidthMm * view.pxPerMm;
  const h = view.sheetHeightMm * view.pxPerMm;
  // Desk background already cleared by caller
  // Sheet shadow
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(view.originX + 4, view.originY + 5, w, h);
  // Paper face
  ctx.fillStyle = '#e8e4dc';
  ctx.strokeStyle = '#9a9488';
  ctx.lineWidth = 1.25;
  ctx.fillRect(view.originX, view.originY, w, h);
  ctx.strokeRect(view.originX + 0.5, view.originY + 0.5, w - 1, h - 1);

  // Printable margin (foundation)
  const marginMm = pageUnitsToMm(view.page.margin, view.page.units);
  if (marginMm > 0 && marginMm * 2 < view.sheetWidthMm) {
    const mx = view.originX + marginMm * view.pxPerMm;
    const my = view.originY + marginMm * view.pxPerMm;
    const mw = w - marginMm * 2 * view.pxPerMm;
    const mh = h - marginMm * 2 * view.pxPerMm;
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = 'rgba(80, 90, 120, 0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(mx, my, mw, mh);
    ctx.setLineDash([]);
  }
  ctx.restore();
}

export function drawViewportFrame(
  ctx: CanvasRenderingContext2D,
  screenRect: { x: number; y: number; w: number; h: number },
  selected: boolean,
  activeModel: boolean,
): void {
  ctx.save();
  ctx.strokeStyle = selected
    ? '#4da3ff'
    : activeModel
      ? '#3ecf8e'
      : '#2a6fad';
  ctx.lineWidth = selected || activeModel ? 2 : 1.5;
  ctx.setLineDash([]);
  ctx.strokeRect(screenRect.x, screenRect.y, screenRect.w, screenRect.h);
  // Corner grips hint
  const s = 5;
  ctx.fillStyle = ctx.strokeStyle;
  for (const [cx, cy] of [
    [screenRect.x, screenRect.y],
    [screenRect.x + screenRect.w, screenRect.y],
    [screenRect.x, screenRect.y + screenRect.h],
    [screenRect.x + screenRect.w, screenRect.y + screenRect.h],
  ] as const) {
    ctx.fillRect(cx - s / 2, cy - s / 2, s, s);
  }
  ctx.restore();
}

export function layoutSheetLabel(layout: Layout): string {
  const sheet = sheetSizeInPageUnits(layout.pageSettings);
  return `${layout.name} · ${layout.pageSettings.paperSize} ${layout.pageSettings.orientation} (${sheet.width.toFixed(0)}×${sheet.height.toFixed(0)} ${layout.pageSettings.units})`;
}

/** Convenience: paper view for a layout on a canvas. */
export function paperViewForLayout(
  layout: Layout,
  canvasWidth: number,
  canvasHeight: number,
): PaperViewTransform {
  return fitPaperInCanvas(layout.pageSettings, canvasWidth, canvasHeight);
}
