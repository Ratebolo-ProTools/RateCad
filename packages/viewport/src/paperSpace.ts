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
  locked = false,
): void {
  ctx.save();
  if (locked && !selected && !activeModel) {
    ctx.strokeStyle = '#8a6a3a';
  } else if (selected) {
    ctx.strokeStyle = '#4da3ff';
  } else if (activeModel) {
    ctx.strokeStyle = '#3ecf8e';
  } else {
    ctx.strokeStyle = '#2a6fad';
  }
  ctx.lineWidth = selected || activeModel ? 2.25 : 1.5;
  if (locked) {
    ctx.setLineDash([6, 3]);
  } else {
    ctx.setLineDash([]);
  }
  ctx.strokeRect(screenRect.x + 0.5, screenRect.y + 0.5, screenRect.w - 1, screenRect.h - 1);
  ctx.setLineDash([]);

  if (selected) {
    // Corner + edge grips
    const s = 7;
    ctx.fillStyle = '#0f141a';
    ctx.strokeStyle = '#4da3ff';
    ctx.lineWidth = 1.25;
    const pts: Array<[number, number]> = [
      [screenRect.x, screenRect.y],
      [screenRect.x + screenRect.w / 2, screenRect.y],
      [screenRect.x + screenRect.w, screenRect.y],
      [screenRect.x + screenRect.w, screenRect.y + screenRect.h / 2],
      [screenRect.x + screenRect.w, screenRect.y + screenRect.h],
      [screenRect.x + screenRect.w / 2, screenRect.y + screenRect.h],
      [screenRect.x, screenRect.y + screenRect.h],
      [screenRect.x, screenRect.y + screenRect.h / 2],
    ];
    for (const [cx, cy] of pts) {
      ctx.fillRect(cx - s / 2, cy - s / 2, s, s);
      ctx.strokeRect(cx - s / 2, cy - s / 2, s, s);
    }
  } else {
    // Subtle corner markers
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
  }

  if (locked) {
    ctx.fillStyle = selected ? '#4da3ff' : '#c4a35a';
    ctx.font = '10px "IBM Plex Sans", system-ui, sans-serif';
    ctx.fillText('Locked', screenRect.x + 6, screenRect.y + 14);
  }
  ctx.restore();
}

/** Draw a paper-space rectangle preview (e.g. MVIEW). */
export function drawPaperPreviewRect(
  ctx: CanvasRenderingContext2D,
  view: PaperViewTransform,
  a: Vec2,
  b: Vec2,
): void {
  const p0 = paperToScreen(a, view);
  const p1 = paperToScreen(b, view);
  const x = Math.min(p0.x, p1.x);
  const y = Math.min(p0.y, p1.y);
  const w = Math.abs(p1.x - p0.x);
  const h = Math.abs(p1.y - p0.y);
  ctx.save();
  ctx.strokeStyle = '#7eb6ff';
  ctx.fillStyle = 'rgba(77, 163, 255, 0.12)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}


export function layoutSheetLabel(layout: Layout): string {
  const sheet = sheetSizeInPageUnits(layout.pageSettings);
  return `${layout.name} · ${layout.pageSettings.paperSize} ${layout.pageSettings.orientation} (${sheet.width.toFixed(0)}×${sheet.height.toFixed(0)} ${layout.pageSettings.units})`;
}

/** Convenience: paper view for a layout on a canvas (applies paperCamera). */
export function paperViewForLayout(
  layout: Layout,
  canvasWidth: number,
  canvasHeight: number,
): PaperViewTransform {
  const base = fitPaperInCanvas(layout.pageSettings, canvasWidth, canvasHeight);
  const cam = layout.paperCamera ?? { offsetX: 0, offsetY: 0, zoom: 1 };
  const zoom = Math.max(0.2, Math.min(8, cam.zoom || 1));
  const pxPerMm = base.pxPerMm * zoom;
  const paperUnitMm = base.page.units === 'inch' ? 25.4 : 1;
  return {
    ...base,
    pxPerMm,
    // offsetX/Y are page units — convert to screen
    originX: base.originX + cam.offsetX * paperUnitMm * pxPerMm,
    originY: base.originY - cam.offsetY * paperUnitMm * pxPerMm,
  };
}
