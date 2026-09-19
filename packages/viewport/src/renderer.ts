import type { DrawingDocument, Entity, Vec2 } from '@ratecad/core';
import { distance } from '@ratecad/geometry';
import {
  type Camera,
  screenToWorld,
  worldToScreen,
} from './camera.js';

export interface PreviewGeometry {
  kind: 'line' | 'rectangle' | 'circle';
  start: Vec2;
  end: Vec2;
}

export interface RenderOptions {
  width: number;
  height: number;
  camera: Camera;
  document: DrawingDocument;
  preview?: PreviewGeometry | null;
  cursorWorld?: Vec2 | null;
  theme?: {
    background: string;
    gridMajor: string;
    gridMinor: string;
    entity: string;
    selected: string;
    preview: string;
    axis: string;
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
  const topLeft = screenToWorld({ x: 0, y: 0 }, camera, width, height);
  const bottomRight = screenToWorld({ x: width, y: height }, camera, width, height);

  const minX = Math.min(topLeft.x, bottomRight.x);
  const maxX = Math.max(topLeft.x, bottomRight.x);
  const minY = Math.min(topLeft.y, bottomRight.y);
  const maxY = Math.max(topLeft.y, bottomRight.y);

  const startX = Math.floor(minX / gridSize) * gridSize;
  const startY = Math.floor(minY / gridSize) * gridSize;

  const majorEvery = 5;

  for (let x = startX; x <= maxX + gridSize; x += gridSize) {
    const screen = worldToScreen({ x, y: 0 }, camera, width, height);
    const isMajor = Math.abs(Math.round(x / gridSize) % majorEvery) < 1e-6;
    const isAxis = Math.abs(x) < 1e-9;
    ctx.strokeStyle = isAxis ? theme.axis : isMajor ? theme.gridMajor : theme.gridMinor;
    ctx.lineWidth = isAxis ? 1.25 : 1;
    ctx.beginPath();
    ctx.moveTo(screen.x, 0);
    ctx.lineTo(screen.x, height);
    ctx.stroke();
  }

  for (let y = startY; y <= maxY + gridSize; y += gridSize) {
    const screen = worldToScreen({ x: 0, y }, camera, width, height);
    const isMajor = Math.abs(Math.round(y / gridSize) % majorEvery) < 1e-6;
    const isAxis = Math.abs(y) < 1e-9;
    ctx.strokeStyle = isAxis ? theme.axis : isMajor ? theme.gridMajor : theme.gridMinor;
    ctx.lineWidth = isAxis ? 1.25 : 1;
    ctx.beginPath();
    ctx.moveTo(0, screen.y);
    ctx.lineTo(width, screen.y);
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
  }

  ctx.stroke();
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

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, width, height);

  drawGrid(ctx, camera, width, height, doc.settings.gridSize, theme);

  const selected = new Set(doc.selection);

  for (const entity of doc.entities) {
    if (!entity.visible) continue;
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
  }

  if (options.preview) {
    drawPreview(ctx, options.preview, camera, width, height, theme.preview);
  }
}
