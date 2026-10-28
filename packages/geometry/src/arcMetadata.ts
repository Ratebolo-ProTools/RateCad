/**
 * Arc-polyline metadata helpers.
 *
 * RateCAD stores circular fillet/TRIM arcs as open polylines with analytical
 * `metadata.arc`. Rigid/similarity transforms must update that metadata so it
 * stays consistent with transformed vertices. Never leave stale arc meta.
 */
import type { Entity, Vec2 } from '@ratecad/core';
import { distance } from './math.js';
import { isFiniteVec2 } from './transform.js';

const TWO_PI = Math.PI * 2;

export type ArcPolylineMeta = {
  center: Vec2;
  radius: number;
  startAngle: number;
  endAngle: number;
  ccw: boolean;
  fillet?: boolean;
  [key: string]: unknown;
};

export function normalizeAngleRad(a: number): number {
  let x = a;
  while (x < 0) x += TWO_PI;
  while (x >= TWO_PI) x -= TWO_PI;
  return x;
}

export function readArcPolylineMeta(entity: Entity): ArcPolylineMeta | null {
  if (entity.type !== 'polyline') return null;
  const raw = entity.metadata && (entity.metadata as { arc?: unknown }).arc;
  if (!raw || typeof raw !== 'object') return null;
  const arc = raw as Record<string, unknown>;
  const center = arc.center as Vec2 | undefined;
  const radius = arc.radius;
  const startAngle = arc.startAngle;
  const endAngle = arc.endAngle;
  const ccw = arc.ccw;
  if (
    !center ||
    !isFiniteVec2(center) ||
    typeof radius !== 'number' ||
    !Number.isFinite(radius) ||
    !(radius > 0) ||
    typeof startAngle !== 'number' ||
    !Number.isFinite(startAngle) ||
    typeof endAngle !== 'number' ||
    !Number.isFinite(endAngle) ||
    typeof ccw !== 'boolean'
  ) {
    return null;
  }
  return {
    ...arc,
    center: { x: center.x, y: center.y },
    radius,
    startAngle,
    endAngle,
    ccw,
    fillet: arc.fillet === true ? true : arc.fillet === false ? false : undefined,
  };
}

export function stripArcPolylineMeta(entity: Entity): Entity {
  if (entity.type !== 'polyline' || !entity.metadata) return entity;
  const { arc: _drop, ...rest } = entity.metadata as Record<string, unknown> & {
    arc?: unknown;
  };
  void _drop;
  const keys = Object.keys(rest);
  if (keys.length === 0) {
    const { metadata: _m, ...without } = entity;
    void _m;
    return without as Entity;
  }
  return { ...entity, metadata: rest };
}

function angleOf(center: Vec2, p: Vec2): number {
  return Math.atan2(p.y - center.y, p.x - center.x);
}

function pointOnArc(center: Vec2, radius: number, angle: number): Vec2 {
  return {
    x: center.x + radius * Math.cos(angle),
    y: center.y + radius * Math.sin(angle),
  };
}

/**
 * Scale-aware tolerance for comparing arc meta to polyline samples.
 */
export function arcMetaTolerance(radius: number, points: Vec2[]): number {
  let mag = Math.abs(radius);
  for (const p of points) {
    mag = Math.max(mag, Math.abs(p.x), Math.abs(p.y));
  }
  return Math.max(1e-6, radius * 1e-6, mag * 1e-9, 1e-4);
}

/**
 * True when analytical arc meta matches polyline endpoints (and radius).
 */
export function arcMetaConsistentWithVertices(
  entity: Entity,
  tol?: number,
): boolean {
  const meta = readArcPolylineMeta(entity);
  if (!meta || entity.type !== 'polyline') return false;
  const verts = entity.geometry.vertices;
  if (verts.length < 2) return false;
  const first = verts[0]!;
  const last = verts[verts.length - 1]!;
  const t = tol ?? arcMetaTolerance(meta.radius, [meta.center, first, last]);
  if (!isFiniteVec2(meta.center) || !Number.isFinite(meta.radius)) return false;
  if (Math.abs(distance(meta.center, first) - meta.radius) > t) return false;
  if (Math.abs(distance(meta.center, last) - meta.radius) > t) return false;
  // Angles may wrap; compare via reconstructed points on the unit circle.
  const a0 = pointOnArc(meta.center, meta.radius, meta.startAngle);
  const a1 = pointOnArc(meta.center, meta.radius, meta.endAngle);
  if (distance(a0, first) > t * 10 && distance(a0, last) > t * 10) return false;
  if (distance(a1, last) > t * 10 && distance(a1, first) > t * 10) return false;
  return true;
}

export type ArcMetaMapOptions = {
  /** Maps world points (center and polar samples). */
  mapPoint: (p: Vec2) => Vec2 | null;
  /**
   * Rigid rotation delta applied to start/end angles (radians).
   * Omit when angles must be recomputed from mapped polar points (mirror).
   */
  angleDelta?: number;
  /** Reflection / improper isometry — flips CCW. */
  reverseOrientation?: boolean;
  /** Uniform scale factor applied to radius (default 1). */
  radiusScale?: number;
};

/**
 * Update `metadata.arc` after geometry vertices were already transformed with
 * the same point map. Strips arc meta if the result cannot stay circular.
 */
export function syncArcPolylineMetadata(
  entity: Entity,
  options: ArcMetaMapOptions,
): Entity {
  if (entity.type !== 'polyline') return entity;
  const prev = readArcPolylineMeta(entity);
  if (!prev) return entity;

  const center = options.mapPoint(prev.center);
  if (!center || !isFiniteVec2(center)) {
    return stripArcPolylineMeta(entity);
  }

  const scaleR = options.radiusScale ?? 1;
  if (!Number.isFinite(scaleR) || !(Math.abs(scaleR) > 0)) {
    return stripArcPolylineMeta(entity);
  }
  const radius = prev.radius * Math.abs(scaleR);
  if (!Number.isFinite(radius) || !(radius > 0)) {
    return stripArcPolylineMeta(entity);
  }

  let startAngle: number;
  let endAngle: number;
  let ccw = prev.ccw;

  if (typeof options.angleDelta === 'number' && Number.isFinite(options.angleDelta)) {
    // Pure translate/uniform-scale: keep stored angles bit-stable when delta is 0.
    if (
      options.angleDelta === 0 &&
      !options.reverseOrientation &&
      scaleR > 0
    ) {
      startAngle = prev.startAngle;
      endAngle = prev.endAngle;
    } else {
      startAngle = normalizeAngleRad(prev.startAngle + options.angleDelta);
      endAngle = normalizeAngleRad(prev.endAngle + options.angleDelta);
    }
    if (options.reverseOrientation) ccw = !ccw;
    if (scaleR < 0) ccw = !ccw;
  } else {
    // Recompute angles from mapped analytical endpoints (mirror / general).
    const p0 = options.mapPoint(pointOnArc(prev.center, prev.radius, prev.startAngle));
    const p1 = options.mapPoint(pointOnArc(prev.center, prev.radius, prev.endAngle));
    if (!p0 || !p1 || !isFiniteVec2(p0) || !isFiniteVec2(p1)) {
      return stripArcPolylineMeta(entity);
    }
    startAngle = angleOf(center, p0);
    endAngle = angleOf(center, p1);
    if (options.reverseOrientation) ccw = !ccw;
    if (scaleR < 0) ccw = !ccw;
  }

  const { fillet, center: _c, radius: _r, startAngle: _s, endAngle: _e, ccw: _ccw, ...rest } =
    prev;
  void _c;
  void _r;
  void _s;
  void _e;
  void _ccw;

  const nextMeta: ArcPolylineMeta = {
    ...rest,
    center: { x: center.x, y: center.y },
    radius,
    startAngle,
    endAngle,
    ccw,
    ...(fillet === true ? { fillet: true } : fillet === false ? { fillet: false } : {}),
  };

  const next: Entity = {
    ...entity,
    metadata: {
      ...(entity.metadata as Record<string, unknown> | undefined),
      arc: nextMeta,
    },
  };

  if (!arcMetaConsistentWithVertices(next)) {
    // Prefer stripping over retaining incorrect analytical data.
    return stripArcPolylineMeta(entity);
  }
  return next;
}
