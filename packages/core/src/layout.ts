/**
 * Model Space / Paper Space / Layout foundation.
 *
 * Layouts reference Model Space through viewports — they never duplicate
 * model geometry. Paper-space coordinates are independent of model coords.
 */

import type { Entity, EntityId } from './types.js';

export type LayoutId = string;
export type ViewportId = string;

/** Explicit workspace interaction mode (do not infer from UI booleans). */
export type WorkspaceMode =
  | 'MODEL_SPACE'
  | 'PAPER_SPACE'
  | 'VIEWPORT_MODEL_SPACE';

export type PaperSizeId = 'A4' | 'A3' | 'A2' | 'A1' | 'A0';
export type PageOrientation = 'portrait' | 'landscape';
export type PageUnit = 'mm' | 'inch';

/** ISO paper sizes in millimetres (portrait width × height). */
export const PAPER_SIZE_MM: Record<PaperSizeId, { width: number; height: number }> =
  {
    A4: { width: 210, height: 297 },
    A3: { width: 297, height: 420 },
    A2: { width: 420, height: 594 },
    A1: { width: 594, height: 841 },
    A0: { width: 841, height: 1189 },
  };

export interface PageSettings {
  paperSize: PaperSizeId;
  orientation: PageOrientation;
  units: PageUnit;
  /**
   * Margin inset from sheet edge, in page `units` (mm or inch).
   * Printable-boundary foundation only — no OS printer yet.
   */
  margin: number;
}

/**
 * Layout viewport — a paper-space rectangle that displays Model Space.
 * Does NOT store or copy model entities.
 */
export interface LayoutViewport {
  id: ViewportId;
  /** Paper-space origin (bottom-left of viewport) in page units. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Model-space camera center shown in this viewport. */
  modelCenterX: number;
  modelCenterY: number;
  /**
   * Model world-units per paper unit (mm when units=mm).
   * Example: 0.05 with ft world → 100 mm paper ≈ 5 ft of model.
   */
  scale: number;
  /** Radians; foundation for future rotated viewports. */
  rotation: number;
  locked: boolean;
  visible: boolean;
  /** Optional paper-space title for this viewport. */
  label?: string;
  /** Optional scale caption shown with the label (e.g. "Scale 1:100"). */
  scaleLabel?: string;
  /** When true, a Paper Space label entity is shown under the viewport. */
  showLabel?: boolean;
  /** Layer visibility overrides inside this viewport (foundation). */
  layerVisibilityOverrides: Record<string, boolean>;
}

export interface Layout {
  id: LayoutId;
  name: string;
  pageSettings: PageSettings;
  /** Entities that live only in this layout's paper space (not model). */
  paperSpaceEntities: Entity[];
  viewports: LayoutViewport[];
  /** Structured sheet information for title block / sheet UI. */
  sheetInfo?: import('./sheet.js').SheetInfo;
  /** Title block placement / template (entities generated into paperSpaceEntities). */
  titleBlock?: import('./sheet.js').TitleBlock;
  /** Independent Paper Space camera for this layout. */
  paperCamera?: import('./sheet.js').PaperCameraState;
}

export const DEFAULT_LAYOUT_ID = 'layout-1' as LayoutId;

export function createLayoutId(prefix = 'layout'): LayoutId {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function createViewportId(prefix = 'vp'): ViewportId {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Sheet width/height in millimetres for the given page settings. */
export function sheetSizeMm(page: PageSettings): { width: number; height: number } {
  const base = PAPER_SIZE_MM[page.paperSize] ?? PAPER_SIZE_MM.A4;
  if (page.orientation === 'landscape') {
    return { width: base.height, height: base.width };
  }
  return { width: base.width, height: base.height };
}

/** Convert page units → millimetres. */
export function pageUnitsToMm(value: number, units: PageUnit): number {
  return units === 'inch' ? value * 25.4 : value;
}

export function mmToPageUnits(mm: number, units: PageUnit): number {
  return units === 'inch' ? mm / 25.4 : mm;
}

export function sheetSizeInPageUnits(page: PageSettings): {
  width: number;
  height: number;
} {
  const mm = sheetSizeMm(page);
  return {
    width: mmToPageUnits(mm.width, page.units),
    height: mmToPageUnits(mm.height, page.units),
  };
}

export function defaultPageSettings(): PageSettings {
  return {
    paperSize: 'A4',
    orientation: 'landscape',
    units: 'mm',
    margin: 10,
  };
}

/** Create a default rectangular viewport inset on the sheet. */
export function createDefaultViewport(
  page: PageSettings = defaultPageSettings(),
  id?: ViewportId,
): LayoutViewport {
  const sheet = sheetSizeInPageUnits(page);
  const margin = Math.max(page.margin, 0);
  const inset = margin + 15;
  const w = Math.max(20, sheet.width - inset * 2);
  const h = Math.max(20, sheet.height - inset * 2);
  return {
    id: id ?? createViewportId('vp'),
    x: inset,
    y: inset,
    width: w,
    height: h,
    modelCenterX: 0,
    modelCenterY: 0,
    scale: scaleFromRatio(50),
    rotation: 0,
    locked: false,
    visible: true,
    label: undefined,
    scaleLabel: undefined,
    showLabel: false,
    layerVisibilityOverrides: {},
  };
}

export function createDefaultLayout(
  name = 'Layout1',
  id: LayoutId = DEFAULT_LAYOUT_ID,
): Layout {
  const pageSettings = defaultPageSettings();
  return {
    id,
    name,
    pageSettings,
    paperSpaceEntities: [],
    viewports: [createDefaultViewport(pageSettings, `${id}-vp1` as ViewportId)],
    sheetInfo: undefined,
    titleBlock: undefined,
    paperCamera: undefined,
  };
}

/** Ensure unique layout display names (Layout1, Layout2, …). */
export function nextLayoutName(existing: Layout[]): string {
  let n = 1;
  const names = new Set(existing.map((l) => l.name.toLowerCase()));
  while (names.has(`layout${n}`) || names.has(`layout ${n}`)) {
    n += 1;
  }
  return `Layout${n}`;
}

export function createLayout(existing: Layout[], name?: string): Layout {
  const pageSettings = defaultPageSettings();
  const id = createLayoutId('layout');
  return {
    id,
    name: name?.trim() || nextLayoutName(existing),
    pageSettings,
    paperSpaceEntities: [],
    viewports: [createDefaultViewport(pageSettings)],
    sheetInfo: undefined,
    titleBlock: undefined,
    paperCamera: undefined,
  };
}

export function getLayout(
  layouts: Layout[],
  layoutId: LayoutId | null | undefined,
): Layout | undefined {
  if (!layoutId) return undefined;
  return layouts.find((l) => l.id === layoutId);
}

export function getViewport(
  layout: Layout,
  viewportId: ViewportId | null | undefined,
): LayoutViewport | undefined {
  if (!viewportId) return undefined;
  return layout.viewports.find((v) => v.id === viewportId);
}

/** Hit-test a paper-space point against layout viewports (top-most first). */
export function hitTestViewport(
  layout: Layout,
  paperX: number,
  paperY: number,
): LayoutViewport | null {
  for (let i = layout.viewports.length - 1; i >= 0; i -= 1) {
    const vp = layout.viewports[i]!;
    if (!vp.visible) continue;
    if (
      paperX >= vp.x &&
      paperX <= vp.x + vp.width &&
      paperY >= vp.y &&
      paperY <= vp.y + vp.height
    ) {
      return vp;
    }
  }
  return null;
}

export function workspaceModeLabel(
  mode: WorkspaceMode,
  layoutName?: string | null,
  viewportIndex?: number | null,
): string {
  if (mode === 'MODEL_SPACE') return 'MODEL SPACE';
  if (mode === 'PAPER_SPACE') return 'PAPER SPACE';
  const layout = layoutName ?? 'Layout';
  const vp =
    viewportIndex != null && viewportIndex >= 0
      ? `Viewport ${viewportIndex + 1}`
      : 'Viewport';
  return `MODEL SPACE — ${layout} — ${vp}`;
}

/** Validate layout collection invariants. */
export function assertLayoutsValid(layouts: Layout[]): void {
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const layout of layouts) {
    if (ids.has(layout.id)) {
      throw new Error(`Duplicate layout id: ${layout.id}`);
    }
    ids.add(layout.id);
    const key = layout.name.toLowerCase();
    if (names.has(key)) {
      throw new Error(`Duplicate layout name: ${layout.name}`);
    }
    names.add(key);
    const vpIds = new Set<string>();
    for (const vp of layout.viewports) {
      if (vpIds.has(vp.id)) {
        throw new Error(`Duplicate viewport id: ${vp.id}`);
      }
      vpIds.add(vp.id);
    }
  }
}

/** Paper-space entity IDs never overlap conceptually with model — helper for checks. */
export function collectPaperSpaceEntityIds(layouts: Layout[]): Set<EntityId> {
  const ids = new Set<EntityId>();
  for (const layout of layouts) {
    for (const e of layout.paperSpaceEntities) {
      ids.add(e.id);
    }
  }
  return ids;
}

/** Minimum viewport width/height in page units. */
export const MIN_VIEWPORT_SIZE = 10;

/**
 * Standard viewport scale denominators (display as 1:N).
 * Stored `LayoutViewport.scale` = N / VIEWPORT_SCALE_RATIO_DIVISOR
 * so default 0.05 ≈ 1:50 and 1:50 appears larger than 1:100.
 */
export const VIEWPORT_SCALE_RATIO_DIVISOR = 1000;

export const VIEWPORT_SCALE_PRESETS = [
  20, 25, 50, 75, 100, 150, 200, 250, 500,
] as const;

export type ViewportScalePreset = (typeof VIEWPORT_SCALE_PRESETS)[number];

/** Map display ratio 1:N → stored scale (model units per paper unit). */
export function scaleFromRatio(n: number): number {
  if (!(n > 0) || !Number.isFinite(n)) {
    throw new Error(`Invalid scale ratio: ${n}`);
  }
  return n / VIEWPORT_SCALE_RATIO_DIVISOR;
}

/** Best-effort inverse: stored scale → ratio denominator N. */
export function ratioFromScale(scale: number): number {
  if (!(scale > 0) || !Number.isFinite(scale)) return 1;
  return scale * VIEWPORT_SCALE_RATIO_DIVISOR;
}

export function isStandardViewportScale(
  scale: number,
  epsilon = 1e-9,
): ViewportScalePreset | null {
  const n = ratioFromScale(scale);
  for (const preset of VIEWPORT_SCALE_PRESETS) {
    if (Math.abs(n - preset) <= epsilon * VIEWPORT_SCALE_RATIO_DIVISOR) {
      return preset;
    }
  }
  return null;
}

/** Human-readable scale label, e.g. "1:100" or "Custom (1:87)". */
export function formatViewportScale(scale: number): string {
  const preset = isStandardViewportScale(scale);
  if (preset != null) return `1:${preset}`;
  const n = ratioFromScale(scale);
  const rounded = Math.abs(n - Math.round(n)) < 1e-6 ? Math.round(n) : Number(n.toFixed(3));
  return `Custom (1:${rounded})`;
}

/** Normalize two paper corners into a positive-size viewport rect. */
export function normalizeViewportRect(
  a: { x: number; y: number },
  b: { x: number; y: number },
  minSize = MIN_VIEWPORT_SIZE,
): { x: number; y: number; width: number; height: number } {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const width = Math.max(minSize, Math.abs(b.x - a.x));
  const height = Math.max(minSize, Math.abs(b.y - a.y));
  return { x, y, width, height };
}

/** Clone a viewport with a new id (does not copy model geometry). */
export function createViewportFromRect(
  rect: { x: number; y: number; width: number; height: number },
  opts?: Partial<Omit<LayoutViewport, 'id' | 'x' | 'y' | 'width' | 'height'>> & {
    id?: ViewportId;
  },
): LayoutViewport {
  return {
    id: opts?.id ?? createViewportId('vp'),
    x: rect.x,
    y: rect.y,
    width: Math.max(MIN_VIEWPORT_SIZE, rect.width),
    height: Math.max(MIN_VIEWPORT_SIZE, rect.height),
    modelCenterX: opts?.modelCenterX ?? 0,
    modelCenterY: opts?.modelCenterY ?? 0,
    scale: opts?.scale ?? scaleFromRatio(50),
    rotation: opts?.rotation ?? 0,
    locked: opts?.locked ?? false,
    visible: opts?.visible ?? true,
    layerVisibilityOverrides: opts?.layerVisibilityOverrides
      ? { ...opts.layerVisibilityOverrides }
      : {},
  };
}

/** Hit-test near the viewport border (for boundary-preferring selection). */
export function hitTestViewportBoundary(
  layout: Layout,
  paperX: number,
  paperY: number,
  tol: number,
): LayoutViewport | null {
  for (let i = layout.viewports.length - 1; i >= 0; i -= 1) {
    const vp = layout.viewports[i]!;
    if (!vp.visible) continue;
    const left = vp.x;
    const right = vp.x + vp.width;
    const bottom = vp.y;
    const top = vp.y + vp.height;
    const nearX = paperX >= left - tol && paperX <= right + tol;
    const nearY = paperY >= bottom - tol && paperY <= top + tol;
    if (!nearX || !nearY) continue;
    const onLeft = Math.abs(paperX - left) <= tol;
    const onRight = Math.abs(paperX - right) <= tol;
    const onBottom = Math.abs(paperY - bottom) <= tol;
    const onTop = Math.abs(paperY - top) <= tol;
    const insideX = paperX >= left && paperX <= right;
    const insideY = paperY >= bottom && paperY <= top;
    if ((onLeft || onRight) && insideY) return vp;
    if ((onBottom || onTop) && insideX) return vp;
    // Corner / thickened border outside the rect
    if ((onLeft || onRight) && (onBottom || onTop)) return vp;
  }
  return null;
}
