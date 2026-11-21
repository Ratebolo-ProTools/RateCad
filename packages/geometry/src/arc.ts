import type { Vec2 } from '@ratecad/core';
import { distance } from './math.js';

/** Full turn in radians. */
export const TAU = Math.PI * 2;

/** Normalize to [0, 2π). Non-finite input stays NaN. */
export function normalizeAngle(angle: number): number {
  if (!Number.isFinite(angle)) return Number.NaN;
  const wrapped = angle % TAU;
  return wrapped < 0 ? wrapped + TAU : wrapped;
}

/** Counterclockwise span from start to end, in (0, 2π]. A full turn is 2π. */
export function ccwSweep(startAngle: number, endAngle: number): number {
  const span = normalizeAngle(endAngle - startAngle);
  return span === 0 ? TAU : span;
}

export function angleOf(center: Vec2, point: Vec2): number {
  return Math.atan2(point.y - center.y, point.x - center.x);
}

export function pointOnCircle(center: Vec2, radius: number, angle: number): Vec2 {
  return {
    x: center.x + radius * Math.cos(angle),
    y: center.y + radius * Math.sin(angle),
  };
}

/**
 * True when `angle` lies on the counterclockwise sweep from start to end.
 * `pad` widens both ends by that many radians. A zero sweep is not a circle.
 */
export function angleOnArc(
  angle: number,
  startAngle: number,
  endAngle: number,
  pad = 0,
): boolean {
  const sweep = normalizeAngle(endAngle - startAngle);
  if (!(sweep > 0)) return false;
  const fromStart = normalizeAngle(angle - startAngle);
  if (fromStart <= sweep + pad) return true;
  return pad > 0 && fromStart >= TAU - pad;
}

export function arcEndpoints(
  center: Vec2,
  radius: number,
  startAngle: number,
  endAngle: number,
): { start: Vec2; end: Vec2; mid: Vec2 } {
  const sweep = ccwSweep(startAngle, endAngle);
  return {
    start: pointOnCircle(center, radius, startAngle),
    end: pointOnCircle(center, radius, endAngle),
    mid: pointOnCircle(center, radius, startAngle + sweep / 2),
  };
}

/** Endpoints plus any axis extrema that lie on the arc. These bound the curve. */
export function arcExtremePoints(
  center: Vec2,
  radius: number,
  startAngle: number,
  endAngle: number,
): Vec2[] {
  const points = [
    pointOnCircle(center, radius, startAngle),
    pointOnCircle(center, radius, endAngle),
  ];
  for (const quadrant of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
    if (angleOnArc(quadrant, startAngle, endAngle)) {
      points.push(pointOnCircle(center, radius, quadrant));
    }
  }
  return points;
}

export function intersectCircles(
  c0: Vec2,
  r0: number,
  c1: Vec2,
  r1: number,
): Vec2[] {
  const dx = c1.x - c0.x;
  const dy = c1.y - c0.y;
  const d = Math.hypot(dx, dy);
  if (!(d > 1e-12) || !(r0 > 0) || !(r1 > 0)) return [];
  if (d > r0 + r1 + 1e-8) return [];
  if (d < Math.abs(r0 - r1) - 1e-8) return [];
  const a = (r0 * r0 - r1 * r1 + d * d) / (2 * d);
  const h2 = r0 * r0 - a * a;
  if (h2 < -1e-8) return [];
  const xm = c0.x + (a * dx) / d;
  const ym = c0.y + (a * dy) / d;
  const h = Math.sqrt(Math.max(0, h2));
  if (h <= 1e-9) return [{ x: xm, y: ym }];
  const rx = (-dy * h) / d;
  const ry = (dx * h) / d;
  return [
    { x: xm + rx, y: ym + ry },
    { x: xm - rx, y: ym - ry },
  ];
}

/** Drop angles that describe the same point on a circle of the given radius. */
export function dedupeAngles(angles: number[], radius: number): number[] {
  const tol = Math.max(1e-6, 1e-5 / Math.max(radius, 1e-9));
  const sorted = angles
    .map((angle) => normalizeAngle(angle))
    .filter((angle) => Number.isFinite(angle))
    .sort((a, b) => a - b);
  const unique: number[] = [];
  for (const angle of sorted) {
    const prev = unique[unique.length - 1];
    if (prev == null || angle - prev > tol) unique.push(angle);
  }
  if (unique.length >= 2) {
    const wrap = TAU - (unique[unique.length - 1]! - unique[0]!);
    if (wrap <= tol) unique.pop();
  }
  return unique;
}

export function pointOnArc(
  center: Vec2,
  radius: number,
  startAngle: number,
  endAngle: number,
  point: Vec2,
  tolerance: number,
): boolean {
  if (!(radius > 0) || !Number.isFinite(tolerance)) return false;
  if (Math.abs(distance(point, center) - radius) > tolerance) return false;
  const pad = Math.atan2(Math.max(tolerance, 0), radius);
  return angleOnArc(angleOf(center, point), startAngle, endAngle, pad);
}
