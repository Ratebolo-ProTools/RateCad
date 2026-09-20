import type { Vec2 } from './math.js';
import { add, distance, scale, sub } from './math.js';
import { isFiniteVec2 } from './transform.js';

const EPS = 1e-9;

export function isFiniteNumber(n: number): boolean {
  return Number.isFinite(n);
}

export function normalize(v: Vec2): Vec2 | null {
  const len = Math.hypot(v.x, v.y);
  if (len < EPS) return null;
  return { x: v.x / len, y: v.y / len };
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

export function cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}

export function projectParam(point: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const len2 = ab.x * ab.x + ab.y * ab.y;
  if (len2 < EPS * EPS) return 0;
  return dot(sub(point, a), ab) / len2;
}

export function pointOnSegment(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function closestPointOnSegment(point: Vec2, a: Vec2, b: Vec2): Vec2 {
  const t = Math.max(0, Math.min(1, projectParam(point, a, b)));
  return pointOnSegment(a, b, t);
}

/** Segment–segment intersection in world coords. Returns null if parallel/no overlap. */
export function intersectSegments(
  a1: Vec2,
  a2: Vec2,
  b1: Vec2,
  b2: Vec2,
  allowEndpoints = true,
): Vec2 | null {
  if (
    !isFiniteVec2(a1) ||
    !isFiniteVec2(a2) ||
    !isFiniteVec2(b1) ||
    !isFiniteVec2(b2)
  ) {
    return null;
  }
  const r = sub(a2, a1);
  const s = sub(b2, b1);
  const denom = cross(r, s);
  const qp = sub(b1, a1);
  if (Math.abs(denom) < EPS) return null;
  const t = cross(qp, s) / denom;
  const u = cross(qp, r) / denom;
  const lo = allowEndpoints ? -EPS : EPS;
  const hi = allowEndpoints ? 1 + EPS : 1 - EPS;
  if (t < lo || t > hi || u < lo || u > hi) return null;
  const p = pointOnSegment(a1, a2, Math.max(0, Math.min(1, t)));
  return isFiniteVec2(p) ? p : null;
}

/**
 * Infinite line through a1→a2 vs segment b1→b2.
 * Returns intersection if it lies on the segment (u in [0,1]).
 */
export function intersectRaySegment(
  origin: Vec2,
  direction: Vec2,
  b1: Vec2,
  b2: Vec2,
  forwardOnly = true,
): { point: Vec2; t: number } | null {
  const n = normalize(direction);
  if (!n) return null;
  const s = sub(b2, b1);
  const denom = cross(n, s);
  if (Math.abs(denom) < EPS) return null;
  const qp = sub(b1, origin);
  const t = cross(qp, s) / denom;
  const u = cross(qp, n) / denom;
  if (forwardOnly && t < -EPS) return null;
  if (u < -EPS || u > 1 + EPS) return null;
  const point = add(origin, scale(n, t));
  if (!isFiniteVec2(point)) return null;
  return { point, t };
}

/** Infinite line a1→a2 vs circle. Returns 0–2 points. */
export function intersectLineCircle(
  a1: Vec2,
  a2: Vec2,
  center: Vec2,
  radius: number,
): Vec2[] {
  if (!(radius > EPS) || !isFiniteNumber(radius)) return [];
  const d = sub(a2, a1);
  const f = sub(a1, center);
  const a = dot(d, d);
  if (a < EPS * EPS) return [];
  const b = 2 * dot(f, d);
  const c = dot(f, f) - radius * radius;
  const disc = b * b - 4 * a * c;
  if (disc < -EPS) return [];
  const points: Vec2[] = [];
  if (Math.abs(disc) <= EPS) {
    const t = -b / (2 * a);
    const p = pointOnSegment(a1, a2, t);
    if (isFiniteVec2(p)) points.push(p);
  } else {
    const sqrt = Math.sqrt(disc);
    for (const sign of [-1, 1] as const) {
      const t = (-b + sign * sqrt) / (2 * a);
      const p = pointOnSegment(a1, a2, t);
      if (isFiniteVec2(p)) points.push(p);
    }
  }
  return points;
}

/** Segment vs circle — only points with t in [0,1] along a1→a2. */
export function intersectSegmentCircle(
  a1: Vec2,
  a2: Vec2,
  center: Vec2,
  radius: number,
): Vec2[] {
  const d = sub(a2, a1);
  const len2 = dot(d, d);
  if (len2 < EPS * EPS) return [];
  return intersectLineCircle(a1, a2, center, radius).filter((p) => {
    const t = projectParam(p, a1, a2);
    return t >= -EPS && t <= 1 + EPS;
  });
}

export function reflectPoint(point: Vec2, axisA: Vec2, axisB: Vec2): Vec2 | null {
  const ab = sub(axisB, axisA);
  const len2 = ab.x * ab.x + ab.y * ab.y;
  if (len2 < EPS * EPS) return null;
  const t = dot(sub(point, axisA), ab) / len2;
  const proj = pointOnSegment(axisA, axisB, t);
  return {
    x: 2 * proj.x - point.x,
    y: 2 * proj.y - point.y,
  };
}

export function rotatePoint(point: Vec2, origin: Vec2, radians: number): Vec2 {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  return {
    x: origin.x + dx * c - dy * s,
    y: origin.y + dx * s + dy * c,
  };
}

export function scalePoint(point: Vec2, origin: Vec2, factor: number): Vec2 {
  return {
    x: origin.x + (point.x - origin.x) * factor,
    y: origin.y + (point.y - origin.y) * factor,
  };
}

export function angleBetween(from: Vec2, to: Vec2): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

export function degreesToRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function radiansToDegrees(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** Perpendicular unit normal to segment a→b (left side when looking a→b). */
export function leftNormal(a: Vec2, b: Vec2): Vec2 | null {
  const n = normalize(sub(b, a));
  if (!n) return null;
  return { x: -n.y, y: n.x };
}
