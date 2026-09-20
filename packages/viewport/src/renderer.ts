import type { DrawingDocument, Entity, Vec2 } from '@ratecad/core';
import { distance, type SnapResult } from '@ratecad/geometry';
import {
  type Camera,
  screenToWorld,
  worldToScreen,
} from './camera.js';
import { getEntityGrips, type Grip } from './grips.js';

export interface PreviewGeometry {
  kind: 'line' | 'rectangle' | 'circle' | 'polyline';
  start: Vec2;
  end: Vec2;
  /** Existing polyline vertices while drawing */
  vertices?: Vec2[];
}

export interface RenderOptions {
  width: number;
  height: number;
  camera: Camera;
  document: DrawingDocument;
  preview?: PreviewGeometry | null;
  /** Live entity previews for move/copy/grip (not committed). */
  previewEntities?: Entity[] | null;
  /** Transient selection window (world coords). */
  selectionRect?: { a: Vec2; b: Vec2 } | null;
  cursorWorld?: Vec2 | null;
  snap?: SnapResult | null;
  grips?: Grip[];
  /** Hide selected originals while showing previewEntities (move). */
  hideEntityIds?: string[];
  theme?: {
    background: string;
    gridMajor: string;
    gridMinor: string;
    entity: string;
    selected: string;
    preview: string;
    axis: string;
    snap: string;
    grip: string;
    gripFill: string;
    windowSelect: string;
    crossingSelect: string;
  };
}

const DEFAULT_THEME = {
  background: '#1a1d21',
  gridMajor: '#2c3238',
  gridMinor: '#23272c',
  entity: '#c8ced6',
  selected: '#4da3ff',
  preview: '#7eb6ff',
  axis: '#3a4450',
  snap: '#ffcc33',
  grip: '#4da3ff',
  gripFill: '#0f141a',
  windowSelect: 'rgba(77, 163, 255, 0.15)',
  crossingSelect: 'rgba(77, 200, 120, 0.15)',
};

function strokeEntity(
  ctx: CanvasRenderingContext2D,
  entity: Entity,
  camera: Camera,
  width: number,
  height: number,
  color: string,
  lineWidth: number,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();

  switch (entity.type) {
    case 'line': {
      const s = worldToScreen(entity.geometry.start, camera, width, height);
      const e = worldToScreen(entity.geometry.end, camera, width, height);
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(e.x, e.y);
      break;
    }
    case 'rectangle': {
      const a = worldToScreen(entity.geometry.corner1, camera, width, height);
      const b = worldToScreen(entity.geometry.corner2, camera, width, height);
      const x = Math.min(a.x, b.x);
      const y = Math.min(a.y, b.y);
      const w = Math.abs(b.x - a.x);
      const h = Math.abs(b.y - a.y);
      ctx.strokeRect(x, y, w, h);
      break;
    }
    case 'circle': {
      const c = worldToScreen(entity.geometry.center, camera, width, height);
      const r = entity.geometry.radius * camera.zoom;
      ctx.arc(c.x, c.y, Math.max(r, 0.5), 0, Math.PI * 2);
      break;
    }
    case 'polyline': {
      const verts = entity.geometry.vertices;
      if (verts.length === 0) break;
      const first = worldToScreen(verts[0]!, camera, width, height);
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < verts.length; i += 1) {
        const p = worldToScreen(verts[i]!, camera, width, height);
        ctx.lineTo(p.x, p.y);
      }
      if (entity.geometry.closed && verts.length > 2) {
        ctx.closePath();
      }
      break;
    }
  }

  ctx.stroke();
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  width: number,
  height: number,
  gridSize: number,
  theme: typeof DEFAULT_THEME,
): void {
  if (gridSize <= 0) return;

  const topLeft = screenToWorld({ x: 0, y: 0 }, camera, width, height);
  const bottomRight = screenToWorld({ x: width, y: height }, camera, width, height);

  const minX = Math.min(topLeft.x, bottomRight.x);
  const maxX = Math.max(topLeft.x, bottomRight.x);
  const minY = Math.min(topLeft.y, bottomRight.y);
  const maxY = Math.max(topLeft.y, bottomRight.y);

  // Avoid drawing millions of lines when zoomed out
  const screenSpacing = gridSize * camera.zoom;
  let step = gridSize;
  let majorEvery = 5;
  if (screenSpacing < 4) {
    const factor = Math.ceil(4 / screenSpacing);
    step = gridSize * factor;
    majorEvery = Math.max(1, Math.round(5 / factor) * factor);
  }

  const startX = Math.floor(minX / step) * step;
  const startY = Math.floor(minY / step) * step;

  for (let x = startX; x <= maxX + step; x += step) {
    const screen = worldToScreen({ x, y: 0 }, camera, width, height);
    const unitIndex = Math.round(x / gridSize);
    const isMajor = Math.abs(unitIndex % majorEvery) < 1e-6;
    const isAxis = Math.abs(x) < 1e-9;
    ctx.strokeStyle = isAxis ? theme.axis : isMajor ? theme.gridMajor : theme.gridMinor;
    ctx.lineWidth = isAxis ? 1.25 : 1;
    ctx.beginPath();
    ctx.moveTo(screen.x + 0.5, 0);
    ctx.lineTo(screen.x + 0.5, height);
    ctx.stroke();
  }

  for (let y = startY; y <= maxY + step; y += step) {
    const screen = worldToScreen({ x: 0, y }, camera, width, height);
    const unitIndex = Math.round(y / gridSize);
    const isMajor = Math.abs(unitIndex % majorEvery) < 1e-6;
    const isAxis = Math.abs(y) < 1e-9;
    ctx.strokeStyle = isAxis ? theme.axis : isMajor ? theme.gridMajor : theme.gridMinor;
    ctx.lineWidth = isAxis ? 1.25 : 1;
    ctx.beginPath();
    ctx.moveTo(0, screen.y + 0.5);
    ctx.lineTo(width, screen.y + 0.5);
    ctx.stroke();
  }
}

function drawPreview(
  ctx: CanvasRenderingContext2D,
  preview: PreviewGeometry,
  camera: Camera,
  width: number,
  height: number,
  color: string,
): void {
  ctx.save();
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.25;
  ctx.beginPath();

  switch (preview.kind) {
    case 'line': {
      const s = worldToScreen(preview.start, camera, width, height);
      const e = worldToScreen(preview.end, camera, width, height);
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(e.x, e.y);
      break;
    }
    case 'rectangle': {
      const a = worldToScreen(preview.start, camera, width, height);
      const b = worldToScreen(preview.end, camera, width, height);
      ctx.strokeRect(
        Math.min(a.x, b.x),
        Math.min(a.y, b.y),
        Math.abs(b.x - a.x),
        Math.abs(b.y - a.y),
      );
      break;
    }
    case 'circle': {
      const c = worldToScreen(preview.start, camera, width, height);
      const r = distance(preview.start, preview.end) * camera.zoom;
      ctx.arc(c.x, c.y, Math.max(r, 0.5), 0, Math.PI * 2);
      break;
    }
    case 'polyline': {
      const verts = preview.vertices ?? [];
      if (verts.length > 0) {
        const first = worldToScreen(verts[0]!, camera, width, height);
        ctx.moveTo(first.x, first.y);
        for (let i = 1; i < verts.length; i += 1) {
          const p = worldToScreen(verts[i]!, camera, width, height);
          ctx.lineTo(p.x, p.y);
        }
        const end = worldToScreen(preview.end, camera, width, height);
        ctx.lineTo(end.x, end.y);
      }
      break;
    }
  }

  ctx.stroke();
  ctx.restore();
}

function drawGrips(
  ctx: CanvasRenderingContext2D,
  grips: Grip[],
  camera: Camera,
  width: number,
  height: number,
  theme: typeof DEFAULT_THEME,
): void {
  const size = 5;
  for (const grip of grips) {
    const p = worldToScreen(grip.point, camera, width, height);
    ctx.fillStyle = theme.gripFill;
    ctx.strokeStyle = theme.grip;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.rect(p.x - size, p.y - size, size * 2, size * 2);
    ctx.fill();
    ctx.stroke();
  }
}

function drawSnapIndicator(
  ctx: CanvasRenderingContext2D,
  snap: SnapResult,
  camera: Camera,
  width: number,
  height: number,
  theme: typeof DEFAULT_THEME,
): void {
  if (!snap.snapped || !snap.kind) return;
  const p = worldToScreen(snap.point, camera, width, height);
  ctx.save();
  ctx.strokeStyle = theme.snap;
  ctx.fillStyle = theme.snap;
  ctx.lineWidth = 1.5;

  switch (snap.kind) {
    case 'endpoint': {
      // Square
      ctx.strokeRect(p.x - 6, p.y - 6, 12, 12);
      break;
    }
    case 'midpoint': {
      // Triangle
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 7);
      ctx.lineTo(p.x + 7, p.y + 5);
      ctx.lineTo(p.x - 7, p.y + 5);
      ctx.closePath();
      ctx.stroke();
      break;
    }
    case 'center': {
      // Circle with cross
      ctx.beginPath();
      ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p.x - 9, p.y);
      ctx.lineTo(p.x + 9, p.y);
      ctx.moveTo(p.x, p.y - 9);
      ctx.lineTo(p.x, p.y + 9);
      ctx.stroke();
      break;
    }
    case 'grid': {
      // Small crosshair
      ctx.beginPath();
      ctx.moveTo(p.x - 5, p.y);
      ctx.lineTo(p.x + 5, p.y);
      ctx.moveTo(p.x, p.y - 5);
      ctx.lineTo(p.x, p.y + 5);
      ctx.stroke();
      break;
    }
  }

  if (snap.label) {
    ctx.font = '11px Cascadia Mono, SF Mono, Consolas, monospace';
    ctx.fillText(snap.label, p.x + 10, p.y - 10);
  }
  ctx.restore();
}

/**
 * Pure projection of DrawingDocument → canvas.
 * Never mutates the document.
 */
export function renderDocument(
  ctx: CanvasRenderingContext2D,
  options: RenderOptions,
): void {
  const theme = { ...DEFAULT_THEME, ...options.theme };
  const { width, height, camera, document: doc } = options;
  const hidden = new Set(options.hideEntityIds ?? []);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, width, height);

  drawGrid(ctx, camera, width, height, doc.settings.gridSize, theme);

  const selected = new Set(doc.selection);
  const autoGrips: Grip[] = [];

  for (const entity of doc.entities) {
    if (!entity.visible) continue;
    if (hidden.has(entity.id)) continue;
    const layer = doc.layers.find((l) => l.id === entity.layerId);
    if (layer && !layer.visible) continue;

    const isSelected = selected.has(entity.id);
    strokeEntity(
      ctx,
      entity,
      camera,
      width,
      height,
      isSelected ? theme.selected : entity.properties.color ?? layer?.color ?? theme.entity,
      isSelected ? 2 : 1.25,
    );
    if (isSelected && !options.previewEntities?.length) {
      autoGrips.push(...getEntityGrips(entity));
    }
  }

  if (options.previewEntities?.length) {
    ctx.save();
    ctx.setLineDash([5, 4]);
    for (const entity of options.previewEntities) {
      strokeEntity(ctx, entity, camera, width, height, theme.preview, 1.5);
    }
    ctx.restore();
  }

  if (options.preview) {
    drawPreview(ctx, options.preview, camera, width, height, theme.preview);
  }

  if (options.selectionRect) {
    const a = worldToScreen(options.selectionRect.a, camera, width, height);
    const b = worldToScreen(options.selectionRect.b, camera, width, height);
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x);
    const h = Math.abs(b.y - a.y);
    const isWindow = options.selectionRect.b.x >= options.selectionRect.a.x;
    ctx.fillStyle = isWindow ? theme.windowSelect : theme.crossingSelect;
    ctx.strokeStyle = isWindow ? theme.selected : '#3ecf8e';
    ctx.lineWidth = 1;
    ctx.setLineDash(isWindow ? [] : [4, 3]);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
  }

  const grips = options.grips ?? autoGrips;
  if (grips.length > 0) {
    drawGrips(ctx, grips, camera, width, height, theme);
  }

  if (options.snap) {
    drawSnapIndicator(ctx, options.snap, camera, width, height, theme);
  }
}

