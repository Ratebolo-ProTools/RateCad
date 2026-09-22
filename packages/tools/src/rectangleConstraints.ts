import type { Vec2 } from '@ratecad/core';
import { formatLength } from '@ratecad/geometry';
import type { ToolSession } from './session.js';

/**
 * Compute the opposite rectangle corner.
 * Length constrains |Δx|; Width constrains |Δy|.
 * Cursor position chooses the quadrant relative to the base corner.
 */
export function constrainRectangleCorner(
  corner1: Vec2,
  cursor: Vec2,
  length: number | null,
  width: number | null,
): Vec2 {
  const sx = cursor.x >= corner1.x ? 1 : -1;
  const sy = cursor.y >= corner1.y ? 1 : -1;
  const dx = length != null && length > 0 ? sx * length : cursor.x - corner1.x;
  const dy = width != null && width > 0 ? sy * width : cursor.y - corner1.y;
  return { x: corner1.x + dx, y: corner1.y + dy };
}

export function rectangleSize(corner1: Vec2, corner2: Vec2): {
  length: number;
  width: number;
} {
  return {
    length: Math.abs(corner2.x - corner1.x),
    width: Math.abs(corner2.y - corner1.y),
  };
}

export function isDegenerateRectangle(corner1: Vec2, corner2: Vec2): boolean {
  const { length, width } = rectangleSize(corner1, corner2);
  return length <= 1e-9 || width <= 1e-9;
}

export function setRectangleConstraints(
  session: ToolSession,
  length: number | null,
  width: number | null,
): ToolSession {
  if (session.activeTool !== 'rectangle') return session;
  const rectLength = length != null && length > 0 ? length : null;
  const rectWidth = width != null && width > 0 ? width : null;
  return {
    ...session,
    rectLength,
    rectWidth,
    statusMessage: rectangleStatus(session, rectLength, rectWidth),
  };
}

export function rectangleStatus(
  session: ToolSession,
  length: number | null = session.rectLength,
  width: number | null = session.rectWidth,
): string {
  const L = length != null ? `L=${formatLength(length)} (fixed)` : 'L=free';
  const W = width != null ? `W=${formatLength(width)} (fixed)` : 'W=free';
  if (!session.anchor) {
    return `Rectangle: ${L} × ${W} — specify first corner`;
  }
  return `Rectangle: ${L} × ${W} — specify opposite corner`;
}

export function formatRectanglePreviewStatus(
  corner1: Vec2,
  corner2: Vec2,
  lengthFixed: number | null,
  widthFixed: number | null,
): string {
  const size = rectangleSize(corner1, corner2);
  const L =
    lengthFixed != null
      ? `L=${formatLength(lengthFixed)} (fixed)`
      : `L=${formatLength(size.length)}`;
  const W =
    widthFixed != null
      ? `W=${formatLength(widthFixed)} (fixed)`
      : `W=${formatLength(size.width)}`;
  return `Rectangle: ${L} × ${W} — specify opposite corner`;
}
