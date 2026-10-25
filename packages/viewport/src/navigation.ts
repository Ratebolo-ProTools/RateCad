import {
  getLayer,
  getWall,
  isEntitySelectable,
  type DrawingDocument,
  type Entity,
  type Layout,
  type PaperCameraState,
} from '@ratecad/core';
import type { AABB } from '@ratecad/geometry';
import { createCamera, type Camera } from './camera.js';
import { entityBounds, entityBoundsWithHost } from './hitTest.js';

export const NAV_MIN_ZOOM = 2;
export const NAV_MAX_ZOOM = 400;
/** Ignore zoom windows smaller than this (world units). */
export const NAV_MIN_WINDOW = 1e-9;

export type ViewSnapshot =
  | { kind: 'model'; camera: Camera }
  | { kind: 'paper'; layoutId: string; paperCamera: PaperCameraState }
  | {
      kind: 'viewport';
      layoutId: string;
      viewportId: string;
      modelCenterX: number;
      modelCenterY: number;
      scale: number;
    };

function nearlyEqualCamera(a: Camera, b: Camera, eps = 1e-6): boolean {
  return (
    Math.abs(a.centerX - b.centerX) <= eps &&
    Math.abs(a.centerY - b.centerY) <= eps &&
    Math.abs(a.zoom - b.zoom) <= eps * Math.max(1, a.zoom)
  );
}

function nearlyEqualPaper(
  a: PaperCameraState,
  b: PaperCameraState,
  eps = 1e-6,
): boolean {
  return (
    Math.abs(a.offsetX - b.offsetX) <= eps &&
    Math.abs(a.offsetY - b.offsetY) <= eps &&
    Math.abs(a.zoom - b.zoom) <= eps
  );
}

function snapshotsEqual(a: ViewSnapshot, b: ViewSnapshot): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'model' && b.kind === 'model') {
    return nearlyEqualCamera(a.camera, b.camera);
  }
  if (a.kind === 'paper' && b.kind === 'paper') {
    return (
      a.layoutId === b.layoutId &&
      nearlyEqualPaper(a.paperCamera, b.paperCamera)
    );
  }
  if (a.kind === 'viewport' && b.kind === 'viewport') {
    return (
      a.layoutId === b.layoutId &&
      a.viewportId === b.viewportId &&
      Math.abs(a.modelCenterX - b.modelCenterX) <= 1e-6 &&
      Math.abs(a.modelCenterY - b.modelCenterY) <= 1e-6 &&
      Math.abs(a.scale - b.scale) <= 1e-9
    );
  }
  return false;
}

/** Bounded previous-view stack — independent of geometry Undo/Redo. */
export class ViewHistory {
  private readonly stack: ViewSnapshot[] = [];
  constructor(private readonly max = 32) {}

  clear(): void {
    this.stack.length = 0;
  }

  /** Record a snapshot if it differs from the latest entry. */
  push(snapshot: ViewSnapshot): void {
    const last = this.stack[this.stack.length - 1];
    if (last && snapshotsEqual(last, snapshot)) return;
    this.stack.push(structuredClone(snapshot));
    while (this.stack.length > this.max) this.stack.shift();
  }

  /** Pop and return the previous snapshot, or null when empty. */
  previous(): ViewSnapshot | null {
    if (this.stack.length === 0) return null;
    return this.stack.pop() ?? null;
  }

  get size(): number {
    return this.stack.length;
  }
}

function mergeAabb(acc: AABB | null, next: AABB): AABB {
  if (!acc) return { ...next };
  return {
    minX: Math.min(acc.minX, next.minX),
    minY: Math.min(acc.minY, next.minY),
    maxX: Math.max(acc.maxX, next.maxX),
    maxY: Math.max(acc.maxY, next.maxY),
  };
}

function boundsForEntity(doc: DrawingDocument, entity: Entity): AABB | null {
  if (entity.type === 'door' || entity.type === 'window') {
    const host = getWall(doc, entity.geometry.hostWallId);
    return entityBoundsWithHost(entity, host);
  }
  return entityBounds(entity);
}

/**
 * Union AABB of visible entities (hidden layers / invisible entities excluded).
 * Does not create geometry.
 */
export function documentVisibleBounds(doc: DrawingDocument): AABB | null {
  let acc: AABB | null = null;
  for (const entity of doc.entities) {
    if (!isEntitySelectable(doc, entity)) continue;
    const layer = getLayer(doc, entity.layerId);
    if (layer && !layer.visible) continue;
    const b = boundsForEntity(doc, entity);
    if (!b) continue;
    if (!(b.maxX >= b.minX && b.maxY >= b.minY)) continue;
    acc = mergeAabb(acc, b);
  }
  return acc;
}

/** Paper-space extents from layout viewports (sheet coordinates). */
export function layoutPaperBounds(layout: Layout): AABB | null {
  let acc: AABB | null = null;
  for (const vp of layout.viewports) {
    if (!vp.visible) continue;
    acc = mergeAabb(acc, {
      minX: vp.x,
      minY: vp.y,
      maxX: vp.x + vp.width,
      maxY: vp.y + vp.height,
    });
  }
  return acc;
}

export function fitCameraToBounds(
  bounds: AABB,
  width: number,
  height: number,
  options?: {
    padding?: number;
    minZoom?: number;
    maxZoom?: number;
  },
): Camera {
  const padding = options?.padding ?? 0.08;
  const minZoom = options?.minZoom ?? NAV_MIN_ZOOM;
  const maxZoom = options?.maxZoom ?? NAV_MAX_ZOOM;
  const bw = Math.max(bounds.maxX - bounds.minX, NAV_MIN_WINDOW);
  const bh = Math.max(bounds.maxY - bounds.minY, NAV_MIN_WINDOW);
  const usableW = Math.max(1, width * (1 - 2 * padding));
  const usableH = Math.max(1, height * (1 - 2 * padding));
  let zoom = Math.min(usableW / bw, usableH / bh);
  if (!Number.isFinite(zoom) || zoom <= 0) zoom = minZoom;
  zoom = Math.min(maxZoom, Math.max(minZoom, zoom));
  return createCamera({
    centerX: (bounds.minX + bounds.maxX) / 2,
    centerY: (bounds.minY + bounds.maxY) / 2,
    zoom,
  });
}

/**
 * Camera that frames the world rectangle defined by two corners.
 * Returns null for zero-size / invalid windows.
 */
export function cameraForZoomWindow(
  a: { x: number; y: number },
  b: { x: number; y: number },
  width: number,
  height: number,
  options?: { padding?: number; minZoom?: number; maxZoom?: number },
): Camera | null {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  if (maxX - minX < NAV_MIN_WINDOW || maxY - minY < NAV_MIN_WINDOW) {
    return null;
  }
  return fitCameraToBounds(
    { minX, minY, maxX, maxY },
    width,
    height,
    options,
  );
}

/** Clamp zoom to safe navigation range. */
export function clampCameraZoom(
  camera: Camera,
  minZoom = NAV_MIN_ZOOM,
  maxZoom = NAV_MAX_ZOOM,
): Camera {
  const zoom = Math.min(
    maxZoom,
    Math.max(minZoom, Number.isFinite(camera.zoom) ? camera.zoom : minZoom),
  );
  return { ...camera, zoom };
}

/**
 * Fit paper camera so that paper-space bounds fill the canvas.
 * Uses page-unit offsets relative to the fitted sheet.
 */
export function fitPaperCameraToBounds(
  bounds: AABB,
  sheetWidth: number,
  sheetHeight: number,
  canvasWidth: number,
  canvasHeight: number,
): PaperCameraState {
  const bw = Math.max(bounds.maxX - bounds.minX, NAV_MIN_WINDOW);
  const bh = Math.max(bounds.maxY - bounds.minY, NAV_MIN_WINDOW);
  const fitScale = Math.min(sheetWidth / bw, sheetHeight / bh);
  const zoom = Math.min(8, Math.max(0.25, fitScale * 0.92));
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  // Keep sheet centered; offset toward bounds center relative to sheet center.
  const offsetX = (sheetWidth / 2 - cx) * 0.15;
  const offsetY = (cy - sheetHeight / 2) * 0.15;
  void canvasWidth;
  void canvasHeight;
  return {
    offsetX: Number.isFinite(offsetX) ? offsetX : 0,
    offsetY: Number.isFinite(offsetY) ? offsetY : 0,
    zoom: Number.isFinite(zoom) ? zoom : 1,
  };
}

/** Derive viewport model view fields from a model Camera. */
export function viewportPatchFromCamera(
  camera: Camera,
  pxPerPaperUnit: number,
): { modelCenterX: number; modelCenterY: number; scale: number } {
  const zoom = Math.max(1e-6, camera.zoom);
  const scale = Math.max(1e-9, pxPerPaperUnit / zoom);
  return {
    modelCenterX: camera.centerX,
    modelCenterY: camera.centerY,
    scale,
  };
}
