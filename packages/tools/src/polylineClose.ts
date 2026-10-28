/**
 * P4-C2 — Polyline Close helpers (open finish vs closed finish).
 */
import type { Vec2 } from '@ratecad/core';
import { distance, polygonArea } from '@ratecad/geometry';

/** Minimum absolute polygon area to accept a closed polyline. */
export const POLYLINE_CLOSE_MIN_AREA = 1e-9;

/** Vertex coincidence epsilon (world units). */
export const POLYLINE_VERTEX_EPS = 1e-9;

export type PolylineCloseValidation =
  | { ok: true; vertices: Vec2[] }
  | { ok: false; reason: string };

/** Remove consecutive duplicate vertices (and optional trailing-first for closed). */
export function cleanPolylineVertices(
  vertices: readonly Vec2[],
  opts?: { forClosed?: boolean },
): Vec2[] {
  const out: Vec2[] = [];
  for (const v of vertices) {
    const last = out[out.length - 1];
    if (last && distance(last, v) < POLYLINE_VERTEX_EPS) continue;
    out.push({ x: v.x, y: v.y });
  }
  if (
    opts?.forClosed &&
    out.length >= 2 &&
    distance(out[0]!, out[out.length - 1]!) < POLYLINE_VERTEX_EPS
  ) {
    out.pop();
  }
  return out;
}

/**
 * Validate vertices for closing. Does not mutate the document.
 * Requires ≥3 distinct non-collinear vertices (non-zero area).
 * Does not retain a duplicate closing vertex equal to the first.
 */
export function validatePolylineClose(
  vertices: readonly Vec2[],
): PolylineCloseValidation {
  const cleaned = cleanPolylineVertices(vertices, { forClosed: true });
  if (cleaned.length < 3) {
    return {
      ok: false,
      reason:
        'Polyline Close requires at least 3 distinct vertices — continue drawing',
    };
  }
  const area = polygonArea(cleaned);
  if (!(area > POLYLINE_CLOSE_MIN_AREA)) {
    return {
      ok: false,
      reason:
        'Cannot close: degenerate or collinear vertices (zero area) — continue drawing',
    };
  }
  return { ok: true, vertices: cleaned };
}

/** True when current vertices could form a valid closed polyline. */
export function canClosePolyline(vertices: readonly Vec2[]): boolean {
  return validatePolylineClose(vertices).ok;
}

export function isPolylineCloseOption(text: string): boolean {
  const t = text.trim().toUpperCase();
  return t === 'C' || t === 'CLOSE';
}

export function isPolylineUndoOption(text: string): boolean {
  const t = text.trim().toUpperCase();
  return t === 'U' || t === 'UNDO';
}

/** Status / prompt text for an in-progress polyline. */
export function polylineDrawStatus(vertexCount: number): string {
  if (vertexCount <= 0) return 'Polyline: specify first point';
  if (vertexCount === 1) {
    return 'Polyline: specify next point or [Undo]:';
  }
  if (vertexCount === 2) {
    return 'Polyline: specify next point or [Undo]:';
  }
  // ≥3 — Close is discoverable; validation still runs on commit
  return 'Polyline: specify next point or [Close/Undo]:';
}
