/**
 * Shared TRIM / EXTEND geometry engine.
 *
 * All calculations use CAD model (world) coordinates — never screen pixels.
 * Click location (worldPoint) selects which interval is trimmed/extended.
 */
import type { Entity, EntityId, Vec2 } from '@ratecad/core';
import {
  closestPointOnSegment,
  cross,
  intersectLineCircle,
  intersectRaySegment,
  intersectSegmentCircle,
  intersectSegments,
  normalize,
  pointOnSegment,
  projectParam,
} from './intersect.js';
import { add, distance, sub } from './math.js';
import { isFiniteVec2, validateEntityGeometry } from './transform.js';

export type ModifyResult =
  | { ok: true; entities: Entity[] }
  | { ok: false; reason: string };

/** Absolute geometric epsilon (degenerate lengths, parallel test). */
const EPS = 1e-9;
/** Hit / vertex de-dupe distance in world units. */
const HIT_EPS = 1e-6;
/**
 * Interior parameter band on a segment for trim split points.
 * Exact endpoints (t=0/1) do not split a single open segment, but values
 * extremely close to the ends still count as near-endpoint intersections.
 */
const PARAM_INTERIOR_LO = EPS;
const PARAM_INTERIOR_HI = 1 - EPS;

export type TrimExtendOperation = 'trim' | 'extend';
export type TrimMode = 'quick' | 'standard';
export type EdgeMode = 'extend' | 'no-extend';
/** Prepared for future 3D; 2D RateCAD treats all as identity (None). */
export type ProjectMode = 'none' | 'ucs' | 'view';

export interface TrimPick {
  objectId: EntityId;
  worldPoint: Vec2;
  screenPoint?: Vec2;
  segmentIndex?: number;
}

export interface TrimExtendOptions {
  operation?: TrimExtendOperation;
  edgeMode?: EdgeMode;
  projectMode?: ProjectMode;
  /** When true, allow target to also be a cutter (AutoCAD-compatible). */
  allowSelfAsCutter?: boolean;
}

export interface CurveInterval {
  t0: number;
  t1: number;
  a: Vec2;
  b: Vec2;
}

function fail(reason: string): ModifyResult {
  return { ok: false, reason };
}

function ok(entities: Entity[]): ModifyResult {
  for (const e of entities) {
    if (!validateEntityGeometry(e)) {
      return fail(`Invalid result geometry for ${e.type}`);
    }
  }
  return { ok: true, entities };
}

function pushUniqueHit(hits: Vec2[], p: Vec2, start: Vec2, end: Vec2): void {
  if (!isFiniteVec2(p)) return;
  if (hits.some((h) => distance(h, p) < HIT_EPS)) return;
  const t = projectParam(p, start, end);
  // Exact endpoints do not create a new interval on a lone segment; near-end hits do.
  if (t > PARAM_INTERIOR_LO && t < PARAM_INTERIOR_HI) hits.push(p);
}

/** True when two segments are parallel (including opposite direction). */
export function segmentsAreParallel(
  a1: Vec2,
  a2: Vec2,
  b1: Vec2,
  b2: Vec2,
): boolean {
  const r = sub(a2, a1);
  const s = sub(b2, b1);
  return Math.abs(cross(r, s)) < EPS;
}

/** True when segments are collinear (parallel and share the same supporting line). */
export function segmentsAreCollinear(
  a1: Vec2,
  a2: Vec2,
  b1: Vec2,
  b2: Vec2,
): boolean {
  if (!segmentsAreParallel(a1, a2, b1, b2)) return false;
  const r = sub(a2, a1);
  const len2 = r.x * r.x + r.y * r.y;
  if (len2 < EPS * EPS) {
    // Degenerate a — treat as collinear if b passes near a1
    return distance(a1, closestPointOnSegment(a1, b1, b2)) < HIT_EPS;
  }
  return Math.abs(cross(sub(b1, a1), r)) < EPS * Math.sqrt(len2);
}

/** Infinite line through a1→a2 vs segment b1→b2 (u in [0,1]). */
export function intersectInfiniteLineSegment(
  a1: Vec2,
  a2: Vec2,
  b1: Vec2,
  b2: Vec2,
): Vec2 | null {
  const r = sub(a2, a1);
  const s = sub(b2, b1);
  const denom = cross(r, s);
  if (Math.abs(denom) < EPS) return null;
  const qp = sub(b1, a1);
  const t = cross(qp, s) / denom;
  const u = cross(qp, r) / denom;
  if (u < -EPS || u > 1 + EPS) return null;
  const p = pointOnSegment(a1, a2, t);
  return isFiniteVec2(p) ? p : null;
}

/** Infinite line a1→a2 vs infinite line b1→b2. */
export function intersectInfiniteLines(
  a1: Vec2,
  a2: Vec2,
  b1: Vec2,
  b2: Vec2,
): Vec2 | null {
  const r = sub(a2, a1);
  const s = sub(b2, b1);
  const denom = cross(r, s);
  if (Math.abs(denom) < EPS) return null;
  const qp = sub(b1, a1);
  const t = cross(qp, s) / denom;
  const p = pointOnSegment(a1, a2, t);
  return isFiniteVec2(p) ? p : null;
}

/** Expand entity into cutting / edge segments (includes wall centerlines). */
export function cuttingSegments(entity: Entity): Array<{ a: Vec2; b: Vec2 }> {
  switch (entity.type) {
    case 'line':
    case 'wall':
      return [{ a: entity.geometry.start, b: entity.geometry.end }];
    case 'rectangle': {
      const { corner1: c1, corner2: c2 } = entity.geometry;
      const corners = [
        { x: c1.x, y: c1.y },
        { x: c2.x, y: c1.y },
        { x: c2.x, y: c2.y },
        { x: c1.x, y: c2.y },
      ];
      return [0, 1, 2, 3].map((i) => ({
        a: corners[i]!,
        b: corners[(i + 1) % 4]!,
      }));
    }
    case 'polyline': {
      const v = entity.geometry.vertices;
      const segs: Array<{ a: Vec2; b: Vec2 }> = [];
      const count = entity.geometry.closed ? v.length : v.length - 1;
      for (let i = 0; i < count; i += 1) {
        segs.push({ a: v[i]!, b: v[(i + 1) % v.length]! });
      }
      return segs;
    }
    default:
      return [];
  }
}

/**
 * Collect intersections of target segment start→end with a cutter,
 * respecting EDGEMODE (natural extension of the cutter).
 */
export function collectIntersectionsOnSegment(
  start: Vec2,
  end: Vec2,
  cutter: Entity,
  edgeMode: EdgeMode = 'no-extend',
): Vec2[] {
  const hits: Vec2[] = [];
  const extend = edgeMode === 'extend';

  if (cutter.type === 'circle') {
    const pts = extend
      ? intersectLineCircle(start, end, cutter.geometry.center, cutter.geometry.radius)
      : intersectSegmentCircle(
          start,
          end,
          cutter.geometry.center,
          cutter.geometry.radius,
        );
    // For No Extend, target must actually meet the circle on the segment;
    // circle itself is always its full natural path.
    for (const p of pts) pushUniqueHit(hits, p, start, end);
    return hits;
  }

  for (const seg of cuttingSegments(cutter)) {
    if (extend) {
      // Natural extension of cutter segment → infinite line; target stays a segment.
      const p = intersectInfiniteLineSegment(seg.a, seg.b, start, end);
      if (p) pushUniqueHit(hits, p, start, end);
    } else {
      const p = intersectSegments(start, end, seg.a, seg.b);
      if (p) pushUniqueHit(hits, p, start, end);
    }
  }
  return hits;
}

export function collectIntersectionsWithCutters(
  start: Vec2,
  end: Vec2,
  cutters: Entity[],
  edgeMode: EdgeMode = 'no-extend',
  excludeId?: EntityId,
): Vec2[] {
  const hits: Vec2[] = [];
  for (const cutter of cutters) {
    if (excludeId && cutter.id === excludeId) continue;
    for (const p of collectIntersectionsOnSegment(start, end, cutter, edgeMode)) {
      if (!hits.some((h) => distance(h, p) < HIT_EPS)) hits.push(p);
    }
  }
  return hits;
}

/** Sort intersection points along a directed segment. */
export function sortHitsAlongSegment(
  start: Vec2,
  end: Vec2,
  hits: Vec2[],
): Array<{ p: Vec2; t: number }> {
  return hits
    .map((p) => ({ p, t: projectParam(p, start, end) }))
    .filter((h) => h.t > EPS && h.t < 1 - EPS)
    .sort((a, b) => a.t - b.t);
}

/** Build closed intervals [0,t0], [t0,t1], … [tn,1] along a segment. */
export function buildIntervals(
  start: Vec2,
  end: Vec2,
  sortedTs: number[],
): CurveInterval[] {
  const bounds = [0, ...sortedTs, 1];
  const out: CurveInterval[] = [];
  for (let i = 0; i < bounds.length - 1; i += 1) {
    const t0 = bounds[i]!;
    const t1 = bounds[i + 1]!;
    if (t1 - t0 < EPS) continue;
    out.push({
      t0,
      t1,
      a: pointOnSegment(start, end, t0),
      b: pointOnSegment(start, end, t1),
    });
  }
  return out;
}

/**
 * Which interval contains pickT.
 * When the pick lies on a shared boundary between two intervals, choose the
 * interval whose midpoint is closer — avoids snapping to the wrong side of a cut.
 */
export function resolvePickInterval(
  intervals: CurveInterval[],
  pickT: number,
): number {
  if (intervals.length === 0) return -1;
  const t = Math.max(0, Math.min(1, pickT));

  // Exact / near boundary between intervals → midpoint rule
  for (let i = 0; i < intervals.length - 1; i += 1) {
    const boundary = intervals[i]!.t1;
    if (Math.abs(t - boundary) <= HIT_EPS) {
      const leftMid = (intervals[i]!.t0 + intervals[i]!.t1) / 2;
      const rightMid =
        (intervals[i + 1]!.t0 + intervals[i + 1]!.t1) / 2;
      return Math.abs(t - leftMid) <= Math.abs(t - rightMid) ? i : i + 1;
    }
  }

  for (let i = 0; i < intervals.length; i += 1) {
    const iv = intervals[i]!;
    if (t >= iv.t0 - EPS && t <= iv.t1 + EPS) return i;
  }
  // Nearest midpoint fallback
  let best = 0;
  let bestD = Number.POSITIVE_INFINITY;
  for (let i = 0; i < intervals.length; i += 1) {
    const mid = (intervals[i]!.t0 + intervals[i]!.t1) / 2;
    const d = Math.abs(mid - t);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function isTrimmableType(type: Entity['type']): boolean {
  return (
    type === 'line' ||
    type === 'polyline' ||
    type === 'rectangle' ||
    type === 'circle' ||
    type === 'wall'
  );
}

export function canTrimEntity(entity: Entity): boolean {
  return isTrimmableType(entity.type) && entity.visible && !entity.locked;
}

export function canExtendEntity(entity: Entity): boolean {
  return (
    (entity.type === 'line' || entity.type === 'polyline' || entity.type === 'wall') &&
    entity.visible &&
    !entity.locked &&
    !(entity.type === 'polyline' && entity.geometry.closed)
  );
}

function eligibleCutters(
  cutters: Entity[],
  targetId: EntityId,
  allowSelf: boolean,
): Entity[] {
  return cutters.filter(
    (c) =>
      c.visible &&
      (allowSelf || c.id !== targetId) &&
      (cuttingSegments(c).length > 0 || c.type === 'circle'),
  );
}

/**
 * Spatial prefilter: keep cutters whose AABB is near the target AABB
 * (cheap reject before exact intersection).
 * When edgeMode is extend, expand pad so natural extensions still qualify.
 */
export function nearbyCutters(
  target: Entity,
  cutters: Entity[],
  pad = 1e-3,
  edgeMode: EdgeMode = 'no-extend',
): Entity[] {
  // Edge Extend: cutter may be far along its natural line — keep all segment/circle cutters.
  if (edgeMode === 'extend') {
    return cutters.filter(
      (c) => c.type === 'circle' || cuttingSegments(c).length > 0,
    );
  }
  const segs = cuttingSegments(target);
  if (target.type === 'circle') {
    const { center, radius } = target.geometry;
    const minX = center.x - radius - pad;
    const maxX = center.x + radius + pad;
    const minY = center.y - radius - pad;
    const maxY = center.y + radius + pad;
    return cutters.filter((c) => cutterNearBox(c, minX, minY, maxX, maxY, pad));
  }
  if (segs.length === 0) return cutters;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of segs) {
    minX = Math.min(minX, s.a.x, s.b.x);
    minY = Math.min(minY, s.a.y, s.b.y);
    maxX = Math.max(maxX, s.a.x, s.b.x);
    maxY = Math.max(maxY, s.a.y, s.b.y);
  }
  return cutters.filter((c) =>
    cutterNearBox(c, minX - pad, minY - pad, maxX + pad, maxY + pad, pad),
  );
}

function cutterNearBox(
  c: Entity,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  pad: number,
): boolean {
  if (c.type === 'circle') {
    const { center, radius } = c.geometry;
    const cx = Math.max(minX, Math.min(maxX, center.x));
    const cy = Math.max(minY, Math.min(maxY, center.y));
    const dx = center.x - cx;
    const dy = center.y - cy;
    return dx * dx + dy * dy <= (radius + pad) * (radius + pad);
  }
  for (const s of cuttingSegments(c)) {
    const sx0 = Math.min(s.a.x, s.b.x);
    const sx1 = Math.max(s.a.x, s.b.x);
    const sy0 = Math.min(s.a.y, s.b.y);
    const sy1 = Math.max(s.a.y, s.b.y);
    if (!(sx1 < minX || sx0 > maxX || sy1 < minY || sy0 > maxY)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Line / wall trim
// ---------------------------------------------------------------------------

type OpenSegmentTrimPlan =
  | {
      ok: true;
      parts: Array<{ start: Vec2; end: Vec2 }>;
      removed: { start: Vec2; end: Vec2 };
      removeIndex: number;
      intervals: CurveInterval[];
    }
  | { ok: false; reason: string };

function noIntersectionReason(
  start: Vec2,
  end: Vec2,
  cutters: Entity[],
): string {
  if (distance(start, end) <= HIT_EPS) {
    return 'Degenerate target segment';
  }
  for (const cutter of cutters) {
    if (cutter.type === 'circle') continue;
    for (const seg of cuttingSegments(cutter)) {
      if (segmentsAreCollinear(start, end, seg.a, seg.b)) {
        return 'Collinear or overlapping cutting edge — no transverse intersection';
      }
    }
  }
  const onlyParallel = cutters.every(
    (c) =>
      c.type !== 'circle' &&
      cuttingSegments(c).every((seg) =>
        segmentsAreParallel(start, end, seg.a, seg.b),
      ),
  );
  if (onlyParallel && cutters.length > 0) {
    return 'Parallel cutting edge — no intersection';
  }
  return 'No intersection with cutting edge';
}

/** True when cutters only meet the target at its endpoints (no interior split). */
function hasEndpointOnlyIntersection(
  start: Vec2,
  end: Vec2,
  cutters: Entity[],
  edgeMode: EdgeMode,
  excludeId?: EntityId,
): boolean {
  let sawEndpoint = false;
  for (const cutter of cutters) {
    if (excludeId && cutter.id === excludeId) continue;
    if (cutter.type === 'circle') {
      for (const endPt of [start, end]) {
        const d = distance(endPt, cutter.geometry.center);
        if (Math.abs(d - cutter.geometry.radius) < HIT_EPS) sawEndpoint = true;
      }
      const pts =
        edgeMode === 'extend'
          ? intersectLineCircle(start, end, cutter.geometry.center, cutter.geometry.radius)
          : intersectSegmentCircle(
              start,
              end,
              cutter.geometry.center,
              cutter.geometry.radius,
            );
      for (const p of pts) {
        const t = projectParam(p, start, end);
        if (t > PARAM_INTERIOR_LO && t < PARAM_INTERIOR_HI) return false;
        if (t >= -EPS && t <= 1 + EPS) sawEndpoint = true;
      }
      continue;
    }
    for (const seg of cuttingSegments(cutter)) {
      const p =
        edgeMode === 'extend'
          ? intersectInfiniteLineSegment(seg.a, seg.b, start, end)
          : intersectSegments(start, end, seg.a, seg.b);
      if (!p) continue;
      const t = projectParam(p, start, end);
      if (t > PARAM_INTERIOR_LO && t < PARAM_INTERIOR_HI) return false;
      if (t >= -EPS && t <= 1 + EPS) sawEndpoint = true;
    }
  }
  return sawEndpoint;
}

/**
 * Plan a line/wall trim from the same intersection + pick logic used for commit
 * and preview (single source of truth).
 */
export function planOpenSegmentTrim(
  start: Vec2,
  end: Vec2,
  pickPoint: Vec2,
  cutters: Entity[],
  edgeMode: EdgeMode = 'no-extend',
  excludeId?: EntityId,
): OpenSegmentTrimPlan {
  if (!isFiniteVec2(start) || !isFiniteVec2(end) || !isFiniteVec2(pickPoint)) {
    return { ok: false, reason: 'Invalid pick point' };
  }
  if (distance(start, end) <= HIT_EPS) {
    return { ok: false, reason: 'Degenerate target segment' };
  }

  const hits = collectIntersectionsWithCutters(
    start,
    end,
    cutters,
    edgeMode,
    excludeId,
  );
  if (hits.length === 0) {
    // Distinguish true misses from endpoint-only contacts (excluded as non-splitting).
    if (hasEndpointOnlyIntersection(start, end, cutters, edgeMode, excludeId)) {
      return {
        ok: false,
        reason:
          'Intersection only at endpoint — no trimmable interior segment',
      };
    }
    return { ok: false, reason: noIntersectionReason(start, end, cutters) };
  }

  const sorted = sortHitsAlongSegment(start, end, hits);
  if (sorted.length === 0) {
    return {
      ok: false,
      reason:
        'Intersection only at endpoint — no trimmable interior segment',
    };
  }

  const intervals = buildIntervals(
    start,
    end,
    sorted.map((h) => h.t),
  );
  const pick = closestPointOnSegment(pickPoint, start, end);
  const pickT = projectParam(pick, start, end);
  const removeI = resolvePickInterval(intervals, pickT);
  if (removeI < 0) return { ok: false, reason: 'Pick point not on segment' };

  const removedIv = intervals[removeI]!;
  if (distance(removedIv.a, removedIv.b) <= HIT_EPS) {
    return { ok: false, reason: 'Trim would produce zero-length removal' };
  }

  const keep: Array<{ start: Vec2; end: Vec2 }> = [];
  for (let i = 0; i < intervals.length; i += 1) {
    if (i === removeI) continue;
    const iv = intervals[i]!;
    if (distance(iv.a, iv.b) > HIT_EPS) {
      keep.push({ start: { ...iv.a }, end: { ...iv.b } });
    }
  }
  if (keep.length === 0) {
    return { ok: false, reason: 'Trim would remove entire segment' };
  }
  return {
    ok: true,
    parts: keep,
    removed: { start: { ...removedIv.a }, end: { ...removedIv.b } },
    removeIndex: removeI,
    intervals,
  };
}

function trimOpenSegment(
  start: Vec2,
  end: Vec2,
  pickPoint: Vec2,
  cutters: Entity[],
  edgeMode: EdgeMode,
  excludeId?: EntityId,
):
  | { ok: true; parts: Array<{ start: Vec2; end: Vec2 }> }
  | { ok: false; reason: string } {
  const plan = planOpenSegmentTrim(
    start,
    end,
    pickPoint,
    cutters,
    edgeMode,
    excludeId,
  );
  if (!plan.ok) return plan;
  return { ok: true, parts: plan.parts };
}

function trimLineLike(
  entity: Extract<Entity, { type: 'line' | 'wall' }>,
  cutters: Entity[],
  pickPoint: Vec2,
  edgeMode: EdgeMode,
  allowSelf: boolean,
): ModifyResult {
  const pool = eligibleCutters(cutters, entity.id, allowSelf);
  const near = nearbyCutters(entity, pool, 1e-3, edgeMode);
  const { start, end } = entity.geometry;
  // Spatial prefilter can drop distant parallel/collinear cutters — diagnose against pool.
  if (near.length === 0) {
    return fail(
      pool.length === 0
        ? 'No cutting edges'
        : noIntersectionReason(start, end, pool),
    );
  }
  const result = trimOpenSegment(
    start,
    end,
    pickPoint,
    near,
    edgeMode,
    allowSelf ? undefined : entity.id,
  );
  if (!result.ok) return fail(result.reason);

  const results: Entity[] = result.parts.map((g, index) => {
    if (entity.type === 'wall') {
      return {
        ...entity,
        id: (index === 0 ? entity.id : `${entity.id}#trim${index}`) as Entity['id'],
        geometry: {
          ...entity.geometry,
          start: { ...g.start },
          end: { ...g.end },
        },
      };
    }
    return {
      ...entity,
      id: (index === 0 ? entity.id : `${entity.id}#trim${index}`) as Entity['id'],
      geometry: {
        start: { ...g.start },
        end: { ...g.end },
      },
    };
  });
  return ok(results);
}

// ---------------------------------------------------------------------------
// Polyline trim
// ---------------------------------------------------------------------------

type PolyParam = { seg: number; t: number; s: number; point: Vec2 };

function polylineParams(
  verts: Vec2[],
  closed: boolean,
): { segCount: number; lengths: number[]; total: number } {
  const segCount = closed ? verts.length : verts.length - 1;
  const lengths: number[] = [];
  let total = 0;
  for (let i = 0; i < segCount; i += 1) {
    const len = distance(verts[i]!, verts[(i + 1) % verts.length]!);
    lengths.push(len);
    total += len;
  }
  return { segCount, lengths, total };
}

function pointAtPolylineS(
  verts: Vec2[],
  closed: boolean,
  lengths: number[],
  s: number,
): Vec2 {
  let rem = s;
  const segCount = lengths.length;
  for (let i = 0; i < segCount; i += 1) {
    const len = lengths[i]!;
    if (rem <= len + EPS || i === segCount - 1) {
      const t = len > EPS ? Math.max(0, Math.min(1, rem / len)) : 0;
      return pointOnSegment(verts[i]!, verts[(i + 1) % verts.length]!, t);
    }
    rem -= len;
  }
  return { ...verts[verts.length - 1]! };
}

function closestPolylineParam(
  verts: Vec2[],
  closed: boolean,
  lengths: number[],
  pick: Vec2,
): PolyParam {
  const segCount = lengths.length;
  let best: PolyParam = { seg: 0, t: 0, s: 0, point: verts[0]! };
  let bestD = Number.POSITIVE_INFINITY;
  let acc = 0;
  for (let i = 0; i < segCount; i += 1) {
    const a = verts[i]!;
    const b = verts[(i + 1) % verts.length]!;
    const cp = closestPointOnSegment(pick, a, b);
    const d = distance(pick, cp);
    const t = projectParam(cp, a, b);
    if (d < bestD) {
      bestD = d;
      best = { seg: i, t, s: acc + lengths[i]! * Math.max(0, Math.min(1, t)), point: cp };
    }
    acc += lengths[i]!;
  }
  return best;
}

function trimPolylineMulti(
  pline: Extract<Entity, { type: 'polyline' }>,
  cutters: Entity[],
  pickPoint: Vec2,
  edgeMode: EdgeMode,
  allowSelf: boolean,
): ModifyResult {
  const verts = pline.geometry.vertices;
  if (verts.length < 2) return fail('Invalid polyline');

  const closed = pline.geometry.closed;
  const { segCount, lengths, total } = polylineParams(verts, closed);
  if (!(total > EPS)) return fail('Degenerate polyline');

  const pool = eligibleCutters(cutters, pline.id, allowSelf);
  const near = nearbyCutters(pline, pool, 1e-3, edgeMode);

  // Collect intersections along the polyline as arc-length parameters.
  // Segment *endpoints* are included when they map to an interior arc-length
  // (vertex cuts between segments) — critical for polylines meeting cutters at joints.
  const hitS: number[] = [];
  const pushS = (s: number) => {
    let ss = s;
    if (closed) {
      // Normalize into [0, total); seam 0/total is one location
      ss = ((ss % total) + total) % total;
      if (ss < EPS || ss > total - EPS) {
        // Seam hit — store once as 0
        ss = 0;
      }
    } else if (ss <= EPS || ss >= total - EPS) {
      // Open polyline: overall endpoints do not create a split by themselves
      return;
    }
    if (hitS.some((h) => Math.abs(h - ss) < HIT_EPS || (closed && (Math.abs(h - ss) < HIT_EPS || Math.abs(h - ss + total) < HIT_EPS || Math.abs(h - ss - total) < HIT_EPS)))) {
      return;
    }
    hitS.push(ss);
  };

  let acc = 0;
  for (let i = 0; i < segCount; i += 1) {
    const a = verts[i]!;
    const b = verts[(i + 1) % verts.length]!;
    // Inclusive endpoint collection on each segment, then pushS filters overall ends.
    const hits: Vec2[] = [];
    for (const cutter of near) {
      if (!allowSelf && cutter.id === pline.id) continue;
      for (const p of collectIntersectionsOnSegment(a, b, cutter, edgeMode)) {
        if (!hits.some((h) => distance(h, p) < HIT_EPS)) hits.push(p);
      }
      // Also accept exact segment-endpoint intersections (vertex joints)
      if (cutter.type !== 'circle') {
        for (const seg of cuttingSegments(cutter)) {
          for (const endPt of [a, b]) {
            const onCutter =
              distance(endPt, closestPointOnSegment(endPt, seg.a, seg.b)) <
              HIT_EPS;
            if (onCutter && !hits.some((h) => distance(h, endPt) < HIT_EPS)) {
              hits.push({ ...endPt });
            }
          }
        }
      } else {
        for (const endPt of [a, b]) {
          const d = distance(endPt, cutter.geometry.center);
          if (Math.abs(d - cutter.geometry.radius) < HIT_EPS) {
            if (!hits.some((h) => distance(h, endPt) < HIT_EPS)) {
              hits.push({ ...endPt });
            }
          }
        }
      }
    }
    for (const p of hits) {
      const t = Math.max(0, Math.min(1, projectParam(p, a, b)));
      pushS(acc + lengths[i]! * t);
    }
    acc += lengths[i]!;
  }

  if (hitS.length === 0) {
    // Diagnose against pool so distant parallel/collinear cutters are still explained.
    const a0 = verts[0]!;
    const b0 = verts[1]!;
    const diag = near.length > 0 ? near : pool;
    return fail(
      diag.length === 0
        ? 'No cutting edges'
        : noIntersectionReason(a0, b0, diag),
    );
  }
  hitS.sort((a, b) => a - b);

  const pick = closestPolylineParam(verts, closed, lengths, pickPoint);

  if (closed) {
    // Like circle trim: a closed loop needs ≥2 cuts to remove one arc and leave an open chain.
    if (hitS.length < 2) {
      return fail(
        'Closed polyline trim requires at least two intersection points',
      );
    }
    type Civ = { s0: number; s1: number };
    const intervals: Civ[] = [];
    for (let i = 0; i < hitS.length; i += 1) {
      const s0 = hitS[i]!;
      const s1 = i + 1 < hitS.length ? hitS[i + 1]! : hitS[0]! + total;
      if (s1 - s0 > HIT_EPS) intervals.push({ s0, s1 });
    }
    if (intervals.length === 0) {
      return fail('Closed polyline trim produced no intervals');
    }

    let removeI = 0;
    let bestMidD = Number.POSITIVE_INFINITY;
    for (let i = 0; i < intervals.length; i += 1) {
      const iv = intervals[i]!;
      let ps = pick.s;
      if (iv.s1 > total && ps < iv.s0) ps += total;
      const mid = (iv.s0 + iv.s1) / 2;
      if (ps >= iv.s0 - EPS && ps <= iv.s1 + EPS) {
        const d = Math.abs(ps - mid);
        // Prefer tighter midpoint match when pick sits on a shared cut
        if (d < bestMidD) {
          bestMidD = d;
          removeI = i;
        }
      }
    }

    const rem = intervals[removeI]!;
    // Remaining open chain: walk forward from rem.s1 → rem.s0 (wrapping)
    const startS = rem.s1 >= total ? rem.s1 - total : rem.s1;
    const endS = rem.s0;
    const endTarget = endS <= startS + EPS ? endS + total : endS;

    const chain: Vec2[] = [
      pointAtPolylineS(verts, closed, lengths, startS),
    ];
    // Vertices whose arc-length falls strictly inside the keep span, in walk order
    const midVerts: Array<{ s: number; p: Vec2 }> = [];
    let vAcc = 0;
    for (let si = 0; si < segCount; si += 1) {
      vAcc += lengths[si]!;
      if (vAcc >= total - EPS) continue; // seam == s0
      for (const cand of [vAcc, vAcc + total]) {
        if (cand > startS + EPS && cand < endTarget - EPS) {
          midVerts.push({
            s: cand,
            p: { ...verts[(si + 1) % verts.length]! },
          });
        }
      }
    }
    midVerts.sort((a, b) => a.s - b.s);
    for (const mv of midVerts) {
      if (distance(chain[chain.length - 1]!, mv.p) > HIT_EPS) {
        chain.push(mv.p);
      }
    }
    const endPt = pointAtPolylineS(verts, closed, lengths, endS);
    if (distance(chain[chain.length - 1]!, endPt) > HIT_EPS) {
      chain.push(endPt);
    }
    const cleaned = dedupeVerts(chain);
    if (cleaned.length < 2) return fail('Trim produced no geometry');
    if (distance(cleaned[0]!, cleaned[cleaned.length - 1]!) <= HIT_EPS) {
      return fail('Closed polyline trim produced degenerate open chain');
    }
    return ok([
      {
        ...pline,
        properties: { ...pline.properties },
        metadata: { ...(pline.metadata ?? {}) },
        geometry: { vertices: cleaned, closed: false },
      },
    ]);
  }

  // Open polyline: intervals [0, h0], [h0,h1], ..., [hn, total]
  const bounds = [0, ...hitS, total];
  let removeI = 0;
  for (let i = 0; i < bounds.length - 1; i += 1) {
    if (pick.s >= bounds[i]! - EPS && pick.s <= bounds[i + 1]! + EPS) {
      removeI = i;
      break;
    }
  }

  const results: Entity[] = [];
  let resultIndex = 0;
  for (let i = 0; i < bounds.length - 1; i += 1) {
    if (i === removeI) continue;
    const s0 = bounds[i]!;
    const s1 = bounds[i + 1]!;
    if (s1 - s0 < HIT_EPS) continue;
    const chain: Vec2[] = [pointAtPolylineS(verts, false, lengths, s0)];
    // Include original vertices strictly inside (s0, s1)
    let acc2 = 0;
    for (let si = 0; si < segCount; si += 1) {
      acc2 += lengths[si]!;
      // vertex at end of segment si is at s=acc2 (except last)
      if (acc2 > s0 + EPS && acc2 < s1 - EPS) {
        chain.push({ ...verts[(si + 1) % verts.length]! });
      }
    }
    chain.push(pointAtPolylineS(verts, false, lengths, s1));
    const cleaned = dedupeVerts(chain);
    if (cleaned.length >= 2) {
      results.push(makePline(pline, cleaned, resultIndex));
      resultIndex += 1;
    }
  }

  if (results.length === 0) return fail('Trim would remove entire polyline');
  return ok(results);
}

function dedupeVerts(verts: Vec2[]): Vec2[] {
  const cleaned: Vec2[] = [];
  for (const v of verts) {
    if (
      cleaned.length === 0 ||
      distance(cleaned[cleaned.length - 1]!, v) > HIT_EPS
    ) {
      cleaned.push({ ...v });
    }
  }
  return cleaned;
}

function makePline(
  src: Extract<Entity, { type: 'polyline' }>,
  vertices: Vec2[],
  index: number,
): Entity {
  return {
    ...src,
    id: (index === 0 ? src.id : `${src.id}#trim${index}`) as Entity['id'],
    geometry: { vertices, closed: false },
    properties: { ...src.properties },
    metadata: { ...(src.metadata ?? {}) },
  };
}

// ---------------------------------------------------------------------------
// Rectangle → open polyline after edge trim
// ---------------------------------------------------------------------------

function trimRectangleMulti(
  rect: Extract<Entity, { type: 'rectangle' }>,
  cutters: Entity[],
  pickPoint: Vec2,
  edgeMode: EdgeMode,
  allowSelf: boolean,
): ModifyResult {
  const segs = cuttingSegments(rect);
  let best = 0;
  let bestD = Number.POSITIVE_INFINITY;
  for (let i = 0; i < segs.length; i += 1) {
    const d = distance(
      pickPoint,
      closestPointOnSegment(pickPoint, segs[i]!.a, segs[i]!.b),
    );
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  const { corner1: c1, corner2: c2 } = rect.geometry;
  const pline: Extract<Entity, { type: 'polyline' }> = {
    id: rect.id,
    type: 'polyline',
    layerId: rect.layerId,
    visible: rect.visible,
    locked: rect.locked,
    geometry: {
      vertices: [
        { x: c1.x, y: c1.y },
        { x: c2.x, y: c1.y },
        { x: c2.x, y: c2.y },
        { x: c1.x, y: c2.y },
      ],
      closed: true,
    },
    properties: { ...rect.properties },
    metadata: { ...(rect.metadata ?? {}), trimmedFrom: 'rectangle', edgeIndex: best },
  };
  return trimPolylineMulti(pline, cutters, pickPoint, edgeMode, allowSelf);
}

// ---------------------------------------------------------------------------
// Circle trim → open polyline along remaining arc (exact center/radius in metadata)
// RateCAD has no Arc entity yet; remaining geometry is an arc-backed polyline.
// ---------------------------------------------------------------------------

function angleOf(center: Vec2, p: Vec2): number {
  return Math.atan2(p.y - center.y, p.x - center.x);
}

function normalizeAngle(a: number): number {
  let x = a;
  while (x < 0) x += Math.PI * 2;
  while (x >= Math.PI * 2) x -= Math.PI * 2;
  return x;
}

function sampleArc(
  center: Vec2,
  radius: number,
  startAng: number,
  endAng: number,
  ccw: boolean,
): Vec2[] {
  let sweep = ccw
    ? normalizeAngle(endAng - startAng)
    : -normalizeAngle(startAng - endAng);
  if (Math.abs(sweep) < EPS) sweep = ccw ? Math.PI * 2 - EPS : -(Math.PI * 2 - EPS);
  if (!ccw && sweep > 0) sweep -= Math.PI * 2;
  if (ccw && sweep < 0) sweep += Math.PI * 2;

  const steps = Math.max(8, Math.ceil((Math.abs(sweep) / (Math.PI * 2)) * 64));
  const verts: Vec2[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const ang = startAng + sweep * t;
    verts.push({
      x: center.x + radius * Math.cos(ang),
      y: center.y + radius * Math.sin(ang),
    });
  }
  return verts;
}

function trimCircleMulti(
  circle: Extract<Entity, { type: 'circle' }>,
  cutters: Entity[],
  pickPoint: Vec2,
  edgeMode: EdgeMode,
  allowSelf: boolean,
): ModifyResult {
  const { center, radius } = circle.geometry;
  if (!(radius > EPS)) return fail('Invalid circle');

  const pool = eligibleCutters(cutters, circle.id, allowSelf);
  const near = nearbyCutters(circle, pool, 1e-3, edgeMode);
  const hits: Vec2[] = [];

  for (const cutter of near) {
    if (!allowSelf && cutter.id === circle.id) continue;
    if (cutter.type === 'circle') {
      // Circle×circle — sample via line through centers or skip (rare for trim)
      continue;
    }
    for (const seg of cuttingSegments(cutter)) {
      const pts =
        edgeMode === 'extend'
          ? intersectLineCircle(seg.a, seg.b, center, radius).filter((p) => {
              // Natural extension of cutter: intersection may be beyond segment
              return isFiniteVec2(p);
            })
          : intersectSegmentCircle(seg.a, seg.b, center, radius);
      for (const p of pts) {
        if (!hits.some((h) => distance(h, p) < HIT_EPS)) hits.push(p);
      }
    }
  }

  if (hits.length < 1) {
    return fail('No intersection with cutting edge');
  }

  // Native ARC entity is not available — a safe open arc requires ≥2 cuts.
  // Single-hit trim would be ambiguous / malformed; reject without modifying the circle.
  if (hits.length === 1) {
    return fail(
      'Circle trim requires at least two intersection points (native ARC not available)',
    );
  }

  // Sort hits by angle
  const angled = hits
    .map((p) => ({ p, ang: normalizeAngle(angleOf(center, p)) }))
    .sort((a, b) => a.ang - b.ang);

  const pickAng = normalizeAngle(angleOf(center, pickPoint));

  // Intervals between consecutive hits (wrapping)
  type ArcIv = { i0: number; i1: number; a0: number; a1: number };
  const intervals: ArcIv[] = [];
  for (let i = 0; i < angled.length; i += 1) {
    const j = (i + 1) % angled.length;
    const a0 = angled[i]!.ang;
    let a1 = angled[j]!.ang;
    if (j === 0) a1 += Math.PI * 2;
    intervals.push({ i0: i, i1: j, a0, a1 });
  }

  let removeI = 0;
  for (let i = 0; i < intervals.length; i += 1) {
    const iv = intervals[i]!;
    let p = pickAng;
    if (iv.i1 === 0 && p < iv.a0) p += Math.PI * 2;
    if (p >= iv.a0 - EPS && p <= iv.a1 + EPS) {
      removeI = i;
      break;
    }
  }

  // Remaining = everything except removeI — for a circle, removing one arc
  // leaves one complementary arc (from remove.end to remove.start CCW).
  const rem = intervals[removeI]!;
  const startAng = rem.a1 >= Math.PI * 2 ? rem.a1 - Math.PI * 2 : rem.a1;
  const endAng = rem.a0;
  // Remaining goes from end of removed interval to start of removed (CCW)
  const remainStart = angled[rem.i1]!.ang;
  const remainEnd = angled[rem.i0]!.ang;

  const verts = sampleArc(center, radius, remainStart, remainEnd, true);
  const cleaned = dedupeVerts(verts);
  if (cleaned.length < 2) return fail('Circle trim produced empty arc');
  if (distance(cleaned[0]!, cleaned[cleaned.length - 1]!) <= HIT_EPS) {
    return fail('Circle trim produced degenerate polyline');
  }
  if (
    !Number.isFinite(remainStart) ||
    !Number.isFinite(remainEnd) ||
    !(radius > EPS)
  ) {
    return fail('Circle trim produced invalid arc metadata');
  }

  const arcEntity: Entity = {
    id: circle.id,
    type: 'polyline',
    layerId: circle.layerId,
    visible: circle.visible,
    locked: circle.locked,
    geometry: { vertices: cleaned, closed: false },
    properties: { ...circle.properties },
    metadata: {
      ...(circle.metadata ?? {}),
      // Representation note: not a native ArcEntity — open polyline + arc meta.
      arc: {
        center: { ...center },
        radius,
        startAngle: remainStart,
        endAngle: remainEnd,
        fromCircle: true,
        approximate: true,
      },
    },
  };
  void startAng;
  void endAng;
  if (!validateEntityGeometry(arcEntity)) {
    return fail('Circle trim produced invalid geometry');
  }
  return ok([arcEntity]);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function trimEntityMulti(
  target: Entity,
  cutters: Entity[],
  pickPoint: Vec2,
  options: TrimExtendOptions = {},
): ModifyResult {
  if (!isFiniteVec2(pickPoint)) return fail('Invalid pick point');
  if (!cutters.length) return fail('No cutting edges');
  const edgeMode = options.edgeMode ?? 'no-extend';
  const allowSelf = options.allowSelfAsCutter ?? true;
  // projectMode reserved for 3D — 2D is identity
  void options.projectMode;

  switch (target.type) {
    case 'line':
      return trimLineLike(target, cutters, pickPoint, edgeMode, allowSelf);
    case 'wall':
      return trimLineLike(target, cutters, pickPoint, edgeMode, allowSelf);
    case 'polyline':
      return trimPolylineMulti(target, cutters, pickPoint, edgeMode, allowSelf);
    case 'rectangle':
      return trimRectangleMulti(target, cutters, pickPoint, edgeMode, allowSelf);
    case 'circle':
      return trimCircleMulti(target, cutters, pickPoint, edgeMode, allowSelf);
    case 'dimension':
    case 'text':
    case 'leader':
    case 'door':
    case 'window':
    case 'room':
      return fail(`Cannot trim ${target.type}`);
  }
}

function rayHitsBoundaryLocal(
  origin: Vec2,
  direction: Vec2,
  boundary: Entity,
  edgeMode: EdgeMode,
): Vec2 | null {
  let best: { point: Vec2; t: number } | null = null;
  const n = normalize(direction);
  if (!n) return null;

  if (boundary.type === 'circle') {
    const hits = intersectLineCircle(
      origin,
      add(origin, n),
      boundary.geometry.center,
      boundary.geometry.radius,
    );
    for (const p of hits) {
      const tt = (p.x - origin.x) * n.x + (p.y - origin.y) * n.y;
      if (tt > EPS && (!best || tt < best.t)) best = { point: p, t: tt };
    }
    return best?.point ?? null;
  }

  for (const seg of cuttingSegments(boundary)) {
    if (edgeMode === 'extend') {
      const hitInf = intersectInfiniteLines(origin, add(origin, n), seg.a, seg.b);
      if (hitInf) {
        const tt = (hitInf.x - origin.x) * n.x + (hitInf.y - origin.y) * n.y;
        if (tt > EPS && (!best || tt < best.t)) best = { point: hitInf, t: tt };
      }
    }
    const hit = intersectRaySegment(origin, direction, seg.a, seg.b, true);
    if (hit && hit.t > EPS && (!best || hit.t < best.t)) best = hit;
  }
  return best?.point ?? null;
}

/** True when origin already lies on a boundary (within HIT_EPS). */
function originTouchesBoundary(
  origin: Vec2,
  boundaries: Entity[],
  excludeId?: EntityId,
): boolean {
  for (const boundary of boundaries) {
    if (excludeId && boundary.id === excludeId) continue;
    if (boundary.type === 'circle') {
      const d = distance(origin, boundary.geometry.center);
      if (Math.abs(d - boundary.geometry.radius) < HIT_EPS) return true;
      continue;
    }
    for (const seg of cuttingSegments(boundary)) {
      if (distance(origin, closestPointOnSegment(origin, seg.a, seg.b)) < HIT_EPS) {
        return true;
      }
    }
  }
  return false;
}

function noExtendIntersectionReason(
  origin: Vec2,
  direction: Vec2,
  other: Vec2,
  boundaries: Entity[],
  edgeMode: EdgeMode,
  excludeId?: EntityId,
): string {
  const n = normalize(direction);
  if (!n) return 'Degenerate target segment';
  if (originTouchesBoundary(origin, boundaries, excludeId)) {
    return 'Already intersecting boundary — nothing to extend';
  }

  let sawBehind = false;
  let onlyParallel = true;
  let anyBoundary = false;
  for (const boundary of boundaries) {
    if (excludeId && boundary.id === excludeId) continue;
    anyBoundary = true;
    if (boundary.type === 'circle') {
      onlyParallel = false;
      const behind = rayHitsBoundaryLocal(origin, { x: -direction.x, y: -direction.y }, boundary, edgeMode);
      if (behind) sawBehind = true;
      continue;
    }
    for (const seg of cuttingSegments(boundary)) {
      if (!segmentsAreParallel(origin, add(origin, direction), seg.a, seg.b)) {
        onlyParallel = false;
      }
      if (segmentsAreCollinear(origin, other, seg.a, seg.b)) {
        return 'Collinear boundary — no transverse extension';
      }
    }
    const behind = rayHitsBoundaryLocal(
      origin,
      { x: -direction.x, y: -direction.y },
      boundary,
      edgeMode,
    );
    if (behind) sawBehind = true;
  }
  if (!anyBoundary) return 'No boundary edges';
  if (onlyParallel) return 'Parallel boundary — no intersection';
  if (sawBehind) {
    return 'Boundary lies behind selected endpoint — choose the other end or another boundary';
  }
  if (edgeMode === 'no-extend') {
    return 'No intersection with finite boundary (Edge Extend off)';
  }
  return 'No extension intersection with boundary';
}

export type OpenSegmentExtendPlan =
  | {
      ok: true;
      extendStart: boolean;
      origin: Vec2;
      other: Vec2;
      hit: Vec2;
      direction: Vec2;
    }
  | { ok: false; reason: string };

/**
 * Plan a line/wall extend from the same ray + nearest-boundary logic used for
 * commit and preview (single source of truth).
 *
 * P4-B3 edge semantics: `edgeMode: 'no-extend'` = finite boundary only;
 * `edgeMode: 'extend'` = natural (infinite) boundary line — already supported
 * by rayHitsBoundaryLocal; UI Edge-mode option remains a P4-B4 concern.
 */
export function planOpenSegmentExtend(
  start: Vec2,
  end: Vec2,
  pickPoint: Vec2,
  boundaries: Entity[],
  edgeMode: EdgeMode = 'extend',
  excludeId?: EntityId,
): OpenSegmentExtendPlan {
  if (!isFiniteVec2(start) || !isFiniteVec2(end) || !isFiniteVec2(pickPoint)) {
    return { ok: false, reason: 'Invalid pick point' };
  }
  if (distance(start, end) <= HIT_EPS) {
    return { ok: false, reason: 'Degenerate target segment' };
  }
  if (!boundaries.length) {
    return { ok: false, reason: 'No boundary edges' };
  }

  const distStart = distance(pickPoint, start);
  const distEnd = distance(pickPoint, end);
  const extendStart = distStart <= distEnd;
  const origin = extendStart ? start : end;
  const other = extendStart ? end : start;
  // Outward direction from the selected endpoint (away from the other end).
  const direction = extendStart ? sub(start, end) : sub(end, start);
  if (!(Math.hypot(direction.x, direction.y) > EPS)) {
    return { ok: false, reason: 'Degenerate target segment' };
  }

  let nearest: Vec2 | null = null;
  let nearestDist = Number.POSITIVE_INFINITY;
  for (const boundary of boundaries) {
    if (excludeId && boundary.id === excludeId) continue;
    const hit = rayHitsBoundaryLocal(origin, direction, boundary, edgeMode);
    if (!hit || !isFiniteVec2(hit)) continue;
    const d = distance(origin, hit);
    // Reject zero-length / collapsing onto the opposite endpoint.
    if (d > HIT_EPS && d < nearestDist && distance(hit, other) > HIT_EPS) {
      nearestDist = d;
      nearest = hit;
    }
  }
  if (!nearest) {
    return {
      ok: false,
      reason: noExtendIntersectionReason(
        origin,
        direction,
        other,
        boundaries,
        edgeMode,
        excludeId,
      ),
    };
  }
  return {
    ok: true,
    extendStart,
    origin: { ...origin },
    other: { ...other },
    hit: { ...nearest },
    direction: { ...direction },
  };
}

export type PolylineExtendPlan =
  | {
      ok: true;
      extendStart: boolean;
      origin: Vec2;
      hit: Vec2;
      vertices: Vec2[];
    }
  | { ok: false; reason: string };

export function planPolylineExtend(
  vertices: Vec2[],
  closed: boolean,
  pickPoint: Vec2,
  boundaries: Entity[],
  edgeMode: EdgeMode = 'extend',
  excludeId?: EntityId,
): PolylineExtendPlan {
  if (closed) return { ok: false, reason: 'Closed polyline cannot be extended' };
  if (vertices.length < 2) return { ok: false, reason: 'Invalid polyline' };
  if (!isFiniteVec2(pickPoint)) return { ok: false, reason: 'Invalid pick point' };
  if (!boundaries.length) return { ok: false, reason: 'No boundary edges' };

  const first = vertices[0]!;
  const last = vertices[vertices.length - 1]!;
  if (!isFiniteVec2(first) || !isFiniteVec2(last)) {
    return { ok: false, reason: 'Invalid polyline' };
  }
  const extendStart = distance(pickPoint, first) <= distance(pickPoint, last);
  const origin = extendStart ? first : last;
  const next = extendStart ? vertices[1]! : vertices[vertices.length - 2]!;
  const direction = sub(origin, next);
  const other = next;
  if (!(Math.hypot(direction.x, direction.y) > EPS)) {
    return { ok: false, reason: 'Degenerate terminal segment' };
  }

  let nearest: Vec2 | null = null;
  let nearestDist = Number.POSITIVE_INFINITY;
  for (const boundary of boundaries) {
    if (excludeId && boundary.id === excludeId) continue;
    const hit = rayHitsBoundaryLocal(origin, direction, boundary, edgeMode);
    if (!hit || !isFiniteVec2(hit)) continue;
    const d = distance(origin, hit);
    if (d > HIT_EPS && d < nearestDist && distance(hit, other) > HIT_EPS) {
      nearestDist = d;
      nearest = hit;
    }
  }
  if (!nearest) {
    return {
      ok: false,
      reason: noExtendIntersectionReason(
        origin,
        direction,
        other,
        boundaries,
        edgeMode,
        excludeId,
      ),
    };
  }

  // Replace only the terminal vertex; preserve interior order and properties.
  const nextVerts = extendStart
    ? [{ ...nearest }, ...vertices.slice(1).map((p) => ({ ...p }))]
    : [...vertices.slice(0, -1).map((p) => ({ ...p })), { ...nearest }];
  // Drop accidental duplicate at the joint after extension.
  const cleaned: Vec2[] = [];
  for (const p of nextVerts) {
    if (
      cleaned.length === 0 ||
      distance(cleaned[cleaned.length - 1]!, p) > HIT_EPS
    ) {
      cleaned.push(p);
    }
  }
  if (cleaned.length < 2) {
    return { ok: false, reason: 'Extension would produce degenerate polyline' };
  }
  return {
    ok: true,
    extendStart,
    origin: { ...origin },
    hit: { ...nearest },
    vertices: cleaned,
  };
}

export function extendEntityMulti(
  target: Entity,
  boundaries: Entity[],
  pickPoint: Vec2,
  options: TrimExtendOptions = {},
): ModifyResult {
  if (!isFiniteVec2(pickPoint)) return fail('Invalid pick point');
  if (!boundaries.length) return fail('No boundary edges');
  const edgeMode = options.edgeMode ?? 'extend';
  void options.projectMode;

  if (target.type === 'line' || target.type === 'wall') {
    const { start, end } = target.geometry;
    const plan = planOpenSegmentExtend(
      start,
      end,
      pickPoint,
      boundaries,
      edgeMode,
      target.id,
    );
    if (!plan.ok) return fail(plan.reason);
    if (target.type === 'wall') {
      return ok([
        {
          ...target,
          geometry: {
            ...target.geometry,
            start: plan.extendStart ? { ...plan.hit } : { ...start },
            end: plan.extendStart ? { ...end } : { ...plan.hit },
          },
        },
      ]);
    }
    return ok([
      {
        ...target,
        geometry: {
          start: plan.extendStart ? { ...plan.hit } : { ...start },
          end: plan.extendStart ? { ...end } : { ...plan.hit },
        },
      },
    ]);
  }

  if (target.type === 'polyline') {
    const plan = planPolylineExtend(
      target.geometry.vertices,
      target.geometry.closed,
      pickPoint,
      boundaries,
      edgeMode,
      target.id,
    );
    if (!plan.ok) return fail(plan.reason);
    return ok([
      {
        ...target,
        geometry: { ...target.geometry, vertices: plan.vertices },
      },
    ]);
  }

  return fail(`${target.type} extend not supported`);
}

/**
 * Preview entity for EXTEND — same plan path as commit (line/wall/polyline).
 * Returns cyan preview of the extended entity, or null when the operation is invalid.
 */
export function extendPreviewMulti(
  target: Entity,
  boundaries: Entity[],
  pickPoint: Vec2,
  options: TrimExtendOptions = {},
): Entity | null {
  const result = extendEntityMulti(target, boundaries, pickPoint, options);
  if (!result.ok || !result.entities[0]) return null;
  const e = result.entities[0]!;
  return {
    ...e,
    properties: {
      ...(e.properties as Record<string, unknown>),
      color: '#7eb6ff',
    },
  } as Entity;
}

/**
 * Unified entry: TRIM or EXTEND via the same engine.
 */
export function applyTrimExtend(
  target: Entity,
  edges: Entity[],
  pick: TrimPick,
  options: TrimExtendOptions = {},
): ModifyResult {
  const op = options.operation ?? 'trim';
  if (op === 'extend') {
    return extendEntityMulti(target, edges, pick.worldPoint, options);
  }
  return trimEntityMulti(target, edges, pick.worldPoint, options);
}

/**
 * Preview segment that would be removed by a trim.
 * Uses the same planOpenSegmentTrim path as commit for line/wall targets.
 */
export function trimRemovalPreviewMulti(
  target: Entity,
  cutters: Entity[],
  pickPoint: Vec2,
  options: TrimExtendOptions = {},
): Entity | null {
  if (target.type !== 'line' && target.type !== 'wall') return null;
  const edgeMode = options.edgeMode ?? 'no-extend';
  const allowSelf = options.allowSelfAsCutter ?? true;
  const pool = eligibleCutters(cutters, target.id, allowSelf);
  const near = nearbyCutters(target, pool, 1e-3, edgeMode);
  const { start, end } = target.geometry;
  const plan = planOpenSegmentTrim(
    start,
    end,
    pickPoint,
    near,
    edgeMode,
    allowSelf ? undefined : target.id,
  );
  if (!plan.ok) return null;
  return {
    ...target,
    type: 'line',
    geometry: {
      start: { ...plan.removed.start },
      end: { ...plan.removed.end },
    },
    properties: { ...target.properties, color: '#ff6b6b' },
  };
}

/** Entities crossed by an open fence path (not a closed polygon). */
export function entitiesCrossedByFence(
  entities: Entity[],
  fence: Vec2[],
): Entity[] {
  if (fence.length < 2) return [];
  const fenceSegs: Array<{ a: Vec2; b: Vec2 }> = [];
  for (let i = 0; i < fence.length - 1; i += 1) {
    fenceSegs.push({ a: fence[i]!, b: fence[i + 1]! });
  }
  const out: Entity[] = [];
  for (const e of entities) {
    if (!canTrimEntity(e) && e.type !== 'circle') continue;
    let hit = false;
    if (e.type === 'circle') {
      for (const fs of fenceSegs) {
        if (
          intersectSegmentCircle(
            fs.a,
            fs.b,
            e.geometry.center,
            e.geometry.radius,
          ).length
        ) {
          hit = true;
          break;
        }
      }
    } else {
      for (const seg of cuttingSegments(e)) {
        for (const fs of fenceSegs) {
          if (intersectSegments(seg.a, seg.b, fs.a, fs.b)) {
            hit = true;
            break;
          }
        }
        if (hit) break;
      }
    }
    if (hit) out.push(e);
  }
  return out;
}

/** Pick point for fence trim: first fence×entity intersection. */
export function fencePickPoint(entity: Entity, fence: Vec2[]): Vec2 | null {
  if (fence.length < 2) return null;
  for (let i = 0; i < fence.length - 1; i += 1) {
    const fa = fence[i]!;
    const fb = fence[i + 1]!;
    if (entity.type === 'circle') {
      const pts = intersectSegmentCircle(
        fa,
        fb,
        entity.geometry.center,
        entity.geometry.radius,
      );
      if (pts[0]) return pts[0];
      continue;
    }
    for (const seg of cuttingSegments(entity)) {
      const p = intersectSegments(seg.a, seg.b, fa, fb);
      if (p) return p;
    }
  }
  return null;
}

export function defaultTrimSettings(): {
  trimMode: TrimMode;
  edgeMode: EdgeMode;
  projectMode: ProjectMode;
  trimEraseUntrimmable: boolean;
} {
  return {
    trimMode: 'quick',
    edgeMode: 'no-extend',
    projectMode: 'none',
    trimEraseUntrimmable: false,
  };
}
