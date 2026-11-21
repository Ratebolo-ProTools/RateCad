import type { Entity, Vec2 } from '@ratecad/core';
import {
  closestPointOnSegment,
  cross,
  degreesToRadians,
  dot,
  intersectLineCircle,
  intersectRaySegment,
  intersectSegmentCircle,
  intersectSegments,
  leftNormal,
  normalize,
  pointOnSegment,
  projectParam,
  reflectPoint,
  rotatePoint,
  scalePoint,
} from './intersect.js';
import { add, distance, scale, sub } from './math.js';
import { syncArcPolylineMetadata } from './arcMetadata.js';
import {
  cloneEntityWithNewId,
  isFiniteVec2,
  validateEntityGeometry,
} from './transform.js';
import { pointInPolygon } from './rooms.js';
import {
  extendEntityMulti,
  trimEntityMulti,
  trimRemovalPreviewMulti,
  type EdgeMode,
} from './trimExtendEngine.js';

const EPS = 1e-9;

export type ModifyResult =
  | { ok: true; entities: Entity[] }
  | { ok: false; reason: string };

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

/** Expand entity into open edge segments for intersection tests. */
export function entitySegments(entity: Entity): Array<{ a: Vec2; b: Vec2 }> {
  switch (entity.type) {
    case 'line':
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
    case 'circle':
    case 'dimension':
    case 'text':
    case 'leader':
    case 'door':
    case 'window':
    case 'room':
    case 'block':
      return [];
    case 'wall':
      return [{ a: entity.geometry.start, b: entity.geometry.end }];
  }
}

function collectIntersectionsOnLine(
  start: Vec2,
  end: Vec2,
  cutter: Entity,
): Vec2[] {
  const hits: Vec2[] = [];
  const pushUnique = (p: Vec2) => {
    if (!isFiniteVec2(p)) return;
    if (hits.some((h) => distance(h, p) < 1e-6)) return;
    const t = projectParam(p, start, end);
    if (t > EPS && t < 1 - EPS) hits.push(p);
  };

  if (cutter.type === 'circle') {
    for (const p of intersectSegmentCircle(
      start,
      end,
      cutter.geometry.center,
      cutter.geometry.radius,
    )) {
      pushUnique(p);
    }
    return hits;
  }

  for (const seg of entitySegments(cutter)) {
    const p = intersectSegments(start, end, seg.a, seg.b);
    if (p) pushUnique(p);
  }
  return hits;
}

/**
 * Trim a line by removing the portion containing pickPoint.
 * Returns one or two line entities (same id for single result; caller assigns ids for splits).
 */
export function trimLineEntity(
  line: Extract<Entity, { type: 'line' }>,
  cutter: Entity,
  pickPoint: Vec2,
): ModifyResult {
  return trimEntityMulti(line, [cutter], pickPoint, {
    edgeMode: 'no-extend',
    allowSelfAsCutter: false,
  });
}

export function trimPolylineEntity(
  pline: Extract<Entity, { type: 'polyline' }>,
  cutter: Entity,
  pickPoint: Vec2,
): ModifyResult {
  return trimEntityMulti(pline, [cutter], pickPoint, {
    edgeMode: 'no-extend',
    allowSelfAsCutter: false,
  });
}

export function trimCircleEntity(
  circle: Extract<Entity, { type: 'circle' }>,
  cutter: Entity,
  pickPoint: Vec2,
): ModifyResult {
  return trimEntityMulti(circle, [cutter], pickPoint, {
    edgeMode: 'no-extend',
    allowSelfAsCutter: false,
  });
}

export function trimEntity(
  target: Entity,
  cutter: Entity,
  pickPoint: Vec2,
  options?: { edgeMode?: EdgeMode; cutters?: Entity[] },
): ModifyResult {
  const cutters = options?.cutters?.length ? options.cutters : [cutter];
  return trimEntityMulti(target, cutters, pickPoint, {
    edgeMode: options?.edgeMode ?? 'no-extend',
    allowSelfAsCutter: true,
  });
}

/** Preview of portion to remove for a line trim (segment containing pick). */
export function trimRemovalPreview(
  target: Entity,
  cutter: Entity,
  pickPoint: Vec2,
  options?: { edgeMode?: EdgeMode; cutters?: Entity[] },
): Entity | null {
  const cutters = options?.cutters?.length ? options.cutters : [cutter];
  return trimRemovalPreviewMulti(target, cutters, pickPoint, {
    edgeMode: options?.edgeMode ?? 'no-extend',
    allowSelfAsCutter: true,
  });
}

// ---------------------------------------------------------------------------
// EXTEND
// ---------------------------------------------------------------------------

function rayHitsBoundary(
  origin: Vec2,
  direction: Vec2,
  boundary: Entity,
): Vec2 | null {
  let best: { point: Vec2; t: number } | null = null;

  if (boundary.type === 'circle') {
    const hits = intersectLineCircle(
      origin,
      add(origin, direction),
      boundary.geometry.center,
      boundary.geometry.radius,
    );
    const n = normalize(direction);
    if (!n) return null;
    for (const p of hits) {
      const t = projectParam(p, origin, add(origin, n));
      // projectParam with unit direction point: use dot
      const tt = (p.x - origin.x) * n.x + (p.y - origin.y) * n.y;
      if (tt > EPS && (!best || tt < best.t)) {
        best = { point: p, t: tt };
      }
    }
    return best?.point ?? null;
  }

  for (const seg of entitySegments(boundary)) {
    const hit = intersectRaySegment(origin, direction, seg.a, seg.b, true);
    if (hit && hit.t > EPS && (!best || hit.t < best.t)) {
      best = hit;
    }
  }
  return best?.point ?? null;
}

export function extendLineEntity(
  line: Extract<Entity, { type: 'line' }>,
  boundary: Entity,
  pickPoint: Vec2,
): ModifyResult {
  if (line.id === boundary.id) return fail('Cannot extend to itself');
  const { start, end } = line.geometry;
  const distStart = distance(pickPoint, start);
  const distEnd = distance(pickPoint, end);
  const extendStart = distStart <= distEnd;
  const origin = extendStart ? start : end;
  const other = extendStart ? end : start;
  const dir = extendStart ? sub(start, end) : sub(end, start);
  const hit = rayHitsBoundary(origin, dir, boundary);
  if (!hit) return fail('No extension intersection with boundary');
  if (distance(hit, other) < EPS) return fail('Extension degenerate');

  const geometry = extendStart
    ? { start: { ...hit }, end: { ...end } }
    : { start: { ...start }, end: { ...hit } };
  return ok([{ ...line, geometry }]);
}

export function extendPolylineEntity(
  pline: Extract<Entity, { type: 'polyline' }>,
  boundary: Entity,
  pickPoint: Vec2,
): ModifyResult {
  if (pline.geometry.closed) return fail('Closed polyline cannot be extended');
  const v = pline.geometry.vertices;
  if (v.length < 2) return fail('Invalid polyline');
  const first = v[0]!;
  const last = v[v.length - 1]!;
  const extendStart = distance(pickPoint, first) <= distance(pickPoint, last);
  const origin = extendStart ? first : last;
  const next = extendStart ? v[1]! : v[v.length - 2]!;
  const dir = sub(origin, next);
  const hit = rayHitsBoundary(origin, dir, boundary);
  if (!hit) return fail('No extension intersection with boundary');
  const vertices = extendStart
    ? [{ ...hit }, ...v.slice(1).map((p) => ({ ...p }))]
    : [...v.slice(0, -1).map((p) => ({ ...p })), { ...hit }];
  return ok([
    {
      ...pline,
      geometry: { ...pline.geometry, vertices },
    },
  ]);
}

export function extendEntity(
  target: Entity,
  boundary: Entity,
  pickPoint: Vec2,
): ModifyResult {
  // Preview/commit parity: same extendEntityMulti pathway as ExtendEntityCommand.
  // Legacy single-boundary helpers remain exported for direct unit tests.
  return extendEntityMulti(target, [boundary], pickPoint, {
    edgeMode: 'extend',
  });
}

// ---------------------------------------------------------------------------
// OFFSET
// ---------------------------------------------------------------------------

export function offsetLineEntity(
  line: Extract<Entity, { type: 'line' }>,
  distanceValue: number,
  sidePoint: Vec2,
  newId: Entity['id'],
): ModifyResult {
  if (!(Math.abs(distanceValue) > EPS) || !Number.isFinite(distanceValue)) {
    return fail('Invalid offset distance');
  }
  const { start, end } = line.geometry;
  const n = leftNormal(start, end);
  if (!n) return fail('Degenerate line');
  const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const side = cross(sub(end, start), sub(sidePoint, start));
  const sign = side >= 0 ? 1 : -1;
  const d = Math.abs(distanceValue) * sign;
  const delta = scale(n, d);
  const offset: Entity = {
    ...line,
    id: newId,
    geometry: {
      start: add(start, delta),
      end: add(end, delta),
    },
  };
  void mid;
  return ok([offset]);
}

/**
 * Parallel polyline offset (open). Joins consecutive offset segments at
 * line–line intersections (miter). Rejects self-intersecting / failed cases.
 */
export function offsetPolylineEntity(
  pline: Extract<Entity, { type: 'polyline' }>,
  distanceValue: number,
  sidePoint: Vec2,
  newId: Entity['id'],
): ModifyResult {
  if (polylineHasCurve(pline)) {
    return fail('Curved geometry offset is unsupported');
  }
  if (pline.geometry.closed) {
    return offsetClosedPolylineEntity(pline, distanceValue, sidePoint, newId);
  }
  if (!(Math.abs(distanceValue) > EPS) || !Number.isFinite(distanceValue)) {
    return fail('Invalid offset distance');
  }
  const verts = pline.geometry.vertices;
  if (verts.length < 2) return fail('Invalid polyline');

  // Determine side from first segment
  const side = cross(sub(verts[1]!, verts[0]!), sub(sidePoint, verts[0]!));
  const sign = side >= 0 ? 1 : -1;
  const dist = Math.abs(distanceValue) * sign;

  const offsetSegs: Array<{ a: Vec2; b: Vec2 }> = [];
  for (let i = 0; i < verts.length - 1; i += 1) {
    const a = verts[i]!;
    const b = verts[i + 1]!;
    const n = leftNormal(a, b);
    if (!n) return fail('Degenerate polyline segment');
    const delta = scale(n, dist);
    offsetSegs.push({ a: add(a, delta), b: add(b, delta) });
  }

  const out: Vec2[] = [{ ...offsetSegs[0]!.a }];
  for (let i = 0; i < offsetSegs.length - 1; i += 1) {
    const s0 = offsetSegs[i]!;
    const s1 = offsetSegs[i + 1]!;
    // Intersect infinite lines of consecutive offset segments
    const r = sub(s0.b, s0.a);
    const s = sub(s1.b, s1.a);
    const denom = cross(r, s);
    let join: Vec2;
    if (Math.abs(denom) < EPS) {
      join = { ...s0.b };
    } else {
      const qp = sub(s1.a, s0.a);
      const t = cross(qp, s) / denom;
      join = pointOnSegment(s0.a, s0.b, t);
      // If intersection is far (sharp angle), clamp to segment end
      if (!isFiniteVec2(join) || Math.abs(t) > 10) {
        join = { ...s0.b };
      }
    }
    out.push(join);
  }
  out.push({ ...offsetSegs[offsetSegs.length - 1]!.b });

  const cleaned: Vec2[] = [];
  for (const v of out) {
    if (!isFiniteVec2(v)) return fail('Offset produced non-finite vertex');
    if (
      cleaned.length === 0 ||
      distance(cleaned[cleaned.length - 1]!, v) > 1e-9
    ) {
      cleaned.push(v);
    }
  }
  if (cleaned.length < 2) return fail('Offset polyline too short');

  return ok([
    {
      ...pline,
      id: newId,
      geometry: { vertices: cleaned, closed: false },
    },
  ]);
}

export type OffsetSide = 'inward' | 'outward';

export interface RectangleBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
}

export function rectangleBounds(
  rect: Extract<Entity, { type: 'rectangle' }>,
): RectangleBounds {
  const { corner1, corner2 } = rect.geometry;
  const minX = Math.min(corner1.x, corner2.x);
  const maxX = Math.max(corner1.x, corner2.x);
  const minY = Math.min(corner1.y, corner2.y);
  const maxY = Math.max(corner1.y, corner2.y);
  return {
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/** Perpendicular distance from a point to the nearest rectangle side. */
export function rectangleBoundaryDistance(
  rect: Extract<Entity, { type: 'rectangle' }>,
  point: Vec2,
): number {
  const b = rectangleBounds(rect);
  const dx =
    point.x < b.minX ? b.minX - point.x : point.x > b.maxX ? point.x - b.maxX : 0;
  const dy =
    point.y < b.minY ? b.minY - point.y : point.y > b.maxY ? point.y - b.maxY : 0;
  if (dx > 0 || dy > 0) return Math.hypot(dx, dy);
  return Math.min(
    point.x - b.minX,
    b.maxX - point.x,
    point.y - b.minY,
    b.maxY - point.y,
  );
}

/**
 * Inside the rectangle is inward. Outside is outward.
 * Points within `hysteresisWorld` of a side stay on the boundary so the
 * caller can hold the previous side.
 */
export function classifyRectangleOffsetSide(
  rect: Extract<Entity, { type: 'rectangle' }>,
  point: Vec2,
  hysteresisWorld = 0,
): OffsetSide | 'boundary' {
  if (rectangleBoundaryDistance(rect, point) <= Math.max(0, hysteresisWorld)) {
    return 'boundary';
  }
  const b = rectangleBounds(rect);
  const inside =
    point.x > b.minX &&
    point.x < b.maxX &&
    point.y > b.minY &&
    point.y < b.maxY;
  return inside ? 'inward' : 'outward';
}

function polylineHasCurve(pline: Extract<Entity, { type: 'polyline' }>): boolean {
  const arc = (pline.metadata as { arc?: unknown } | undefined)?.arc;
  return arc != null;
}

function ringVertices(vertices: Vec2[]): Vec2[] | null {
  const out: Vec2[] = [];
  for (const vertex of vertices) {
    if (!isFiniteVec2(vertex)) return null;
    if (out.length === 0 || distance(out[out.length - 1]!, vertex) > 1e-9) {
      out.push(vertex);
    }
  }
  if (out.length > 1 && distance(out[0]!, out[out.length - 1]!) <= 1e-9) {
    out.pop();
  }
  return out.length >= 3 ? out : null;
}

function signedRingArea(vertices: Vec2[]): number {
  let area = 0;
  for (let i = 0; i < vertices.length; i += 1) {
    const a = vertices[i]!;
    const b = vertices[(i + 1) % vertices.length]!;
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

function minRingDistance(point: Vec2, ring: Vec2[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < ring.length; i += 1) {
    const closest = closestPointOnSegment(
      point,
      ring[i]!,
      ring[(i + 1) % ring.length]!,
    );
    best = Math.min(best, distance(point, closest));
  }
  return best;
}

export function classifyClosedPolylineOffsetSide(
  pline: Extract<Entity, { type: 'polyline' }>,
  point: Vec2,
  hysteresisWorld = 0,
): OffsetSide | 'boundary' | null {
  if (!pline.geometry.closed) return null;
  const ring = ringVertices(pline.geometry.vertices);
  if (!ring) return null;
  if (minRingDistance(point, ring) <= Math.max(0, hysteresisWorld)) {
    return 'boundary';
  }
  return pointInPolygon(point, ring) ? 'inward' : 'outward';
}

export function closedPolylineBoundaryDistance(
  pline: Extract<Entity, { type: 'polyline' }>,
  point: Vec2,
): number | null {
  const ring = ringVertices(pline.geometry.vertices);
  if (!ring) return null;
  return minRingDistance(point, ring);
}

function intersectInfiniteLines(
  a1: Vec2,
  a2: Vec2,
  b1: Vec2,
  b2: Vec2,
): Vec2 | null {
  const r = sub(a2, a1);
  const s = sub(b2, b1);
  const denom = cross(r, s);
  if (Math.abs(denom) < 1e-12) return null;
  const t = cross(sub(b1, a1), s) / denom;
  const hit = { x: a1.x + t * r.x, y: a1.y + t * r.y };
  return isFiniteVec2(hit) ? hit : null;
}

function offsetClosedRing(ring: Vec2[], signedDistance: number): Vec2[] | null {
  const segments: Array<{ a: Vec2; b: Vec2; dir: Vec2 }> = [];
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const normal = leftNormal(a, b);
    if (!normal) return null;
    const delta = scale(normal, signedDistance);
    segments.push({ a: add(a, delta), b: add(b, delta), dir: sub(b, a) });
  }
  const joins: Vec2[] = [];
  for (let i = 0; i < segments.length; i += 1) {
    const prev = segments[(i + segments.length - 1) % segments.length]!;
    const current = segments[i]!;
    let join = intersectInfiniteLines(prev.a, prev.b, current.a, current.b);
    if (!join) {
      if (dot(prev.dir, current.dir) <= 0) return null;
      join = { ...prev.b };
    }
    joins.push(join);
  }
  const count = joins.length;
  for (let i = 0; i < count; i += 1) {
    const next = sub(joins[(i + 1) % count]!, joins[i]!);
    if (dot(segments[i]!.dir, next) <= 1e-8) return null;
  }
  for (let i = 0; i < count; i += 1) {
    for (let j = i + 1; j < count; j += 1) {
      const gap = Math.min(j - i, count - (j - i));
      if (gap <= 1) continue;
      const hit = intersectSegments(
        joins[i]!,
        joins[(i + 1) % count]!,
        joins[j]!,
        joins[(j + 1) % count]!,
        false,
      );
      if (hit) return null;
    }
  }
  if (Math.abs(signedRingArea(joins)) < 1e-8) return null;
  return joins;
}

function offsetClosedPolylineEntity(
  pline: Extract<Entity, { type: 'polyline' }>,
  distanceValue: number,
  sidePoint: Vec2,
  newId: Entity['id'],
): ModifyResult {
  if (!Number.isFinite(distanceValue) || !(distanceValue > EPS)) {
    return fail('Invalid offset distance');
  }
  const ring = ringVertices(pline.geometry.vertices);
  if (!ring) return fail('Invalid polyline');
  const ccw = signedRingArea(ring) > 0;
  const inwardSign = ccw ? 1 : -1;
  const inside = pointInPolygon(sidePoint, ring);
  const signed = distanceValue * (inside ? inwardSign : -inwardSign);
  const joins = offsetClosedRing(ring, signed);
  if (!joins) return fail('Offset collapses geometry');
  return ok([
    {
      ...pline,
      id: newId,
      geometry: { vertices: joins, closed: true },
    },
  ]);
}

/** A point that is unambiguously inside or outside, for side-resolved offsets. */
export function offsetSidePoint(
  entity: Entity,
  side: OffsetSide,
): Vec2 | null {
  if (entity.type === 'rectangle') {
    const b = rectangleBounds(entity);
    const midY = (b.minY + b.maxY) / 2;
    if (side === 'inward') {
      return { x: (b.minX + b.maxX) / 2, y: midY };
    }
    return { x: b.maxX + Math.max(b.width, 1), y: midY };
  }
  if (entity.type === 'polyline' && entity.geometry.closed) {
    const ring = ringVertices(entity.geometry.vertices);
    if (!ring) return null;
    const a = ring[0]!;
    const b = ring[1]!;
    const normal = leftNormal(a, b);
    if (!normal) return null;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const inward = signedRingArea(ring) > 0 ? normal : scale(normal, -1);
    const probe = side === 'inward' ? 1e-3 : -Math.max(1, distance(a, b));
    return add(mid, scale(inward, probe));
  }
  return null;
}

export function offsetRectangleEntity(
  rect: Extract<Entity, { type: 'rectangle' }>,
  distanceValue: number,
  sidePoint: Vec2,
  newId: Entity['id'],
): ModifyResult {
  if (!Number.isFinite(distanceValue) || !(distanceValue > EPS)) {
    return fail('Invalid offset distance');
  }
  const bounds = rectangleBounds(rect);
  if (!(bounds.width > EPS) || !(bounds.height > EPS)) {
    return fail('Invalid rectangle');
  }
  const inside =
    sidePoint.x >= bounds.minX &&
    sidePoint.x <= bounds.maxX &&
    sidePoint.y >= bounds.minY &&
    sidePoint.y <= bounds.maxY;
  if (
    inside &&
    (2 * distanceValue + EPS >= bounds.width ||
      2 * distanceValue + EPS >= bounds.height)
  ) {
    return fail('Offset collapses rectangle');
  }
  const d = inside ? distanceValue : -distanceValue;
  return ok([
    {
      ...rect,
      id: newId,
      geometry: {
        corner1: { x: bounds.minX + d, y: bounds.minY + d },
        corner2: { x: bounds.maxX - d, y: bounds.maxY - d },
      },
    },
  ]);
}

export function offsetEntity(
  entity: Entity,
  distanceValue: number,
  sidePoint: Vec2,
  newId: Entity['id'],
): ModifyResult {
  switch (entity.type) {
    case 'line':
      return offsetLineEntity(entity, distanceValue, sidePoint, newId);
    case 'polyline':
      return offsetPolylineEntity(entity, distanceValue, sidePoint, newId);
    case 'rectangle':
      return offsetRectangleEntity(entity, distanceValue, sidePoint, newId);
    case 'circle':
    case 'dimension':
    case 'text':
    case 'leader':
    case 'wall':
    case 'door':
    case 'window':
    case 'room':
    case 'block':
      return fail(
        entity.type === 'block'
          ? 'Block references cannot be offset'
          : `${entity.type} offset not supported`,
      );
  }
}

// ---------------------------------------------------------------------------
// MIRROR / ROTATE / SCALE
// ---------------------------------------------------------------------------

export function mirrorEntity(
  entity: Entity,
  axisA: Vec2,
  axisB: Vec2,
  newId: Entity['id'],
): Entity | null {
  if (distance(axisA, axisB) < EPS) return null;
  const map = (p: Vec2) => reflectPoint(p, axisA, axisB);
  let next: Entity;
  switch (entity.type) {
    case 'line': {
      const s = map(entity.geometry.start);
      const e = map(entity.geometry.end);
      if (!s || !e) return null;
      next = { ...entity, id: newId, geometry: { start: s, end: e } };
      break;
    }
    case 'rectangle': {
      const c1 = map(entity.geometry.corner1);
      const c2 = map(entity.geometry.corner2);
      if (!c1 || !c2) return null;
      next = { ...entity, id: newId, geometry: { corner1: c1, corner2: c2 } };
      break;
    }
    case 'circle': {
      const c = map(entity.geometry.center);
      if (!c) return null;
      next = {
        ...entity,
        id: newId,
        geometry: { center: c, radius: entity.geometry.radius },
      };
      break;
    }
    case 'polyline': {
      const vertices: Vec2[] = [];
      for (const v of entity.geometry.vertices) {
        const m = map(v);
        if (!m) return null;
        vertices.push(m);
      }
      next = {
        ...entity,
        id: newId,
        geometry: { ...entity.geometry, vertices },
      };
      next = syncArcPolylineMetadata(next, {
        mapPoint: map,
        reverseOrientation: true,
        radiusScale: 1,
      });
      break;
    }
    case 'dimension': {
      const s = map(entity.geometry.start);
      const e = map(entity.geometry.end);
      if (!s || !e) return null;
      next = {
        ...entity,
        id: newId,
        geometry: {
          ...entity.geometry,
          start: s,
          end: e,
          offset: -entity.geometry.offset,
        },
      };
      break;
    }
    case 'text': {
      const p = map(entity.geometry.position);
      if (!p) return null;
      next = {
        ...entity,
        id: newId,
        geometry: { ...entity.geometry, position: p },
      };
      break;
    }
    case 'leader': {
      const arrow = map(entity.geometry.arrow);
      if (!arrow) return null;
      const vertices: Vec2[] = [];
      for (const v of entity.geometry.vertices) {
        const m = map(v);
        if (!m) return null;
        vertices.push(m);
      }
      next = {
        ...entity,
        id: newId,
        geometry: { ...entity.geometry, arrow, vertices },
      };
      break;
    }
    case 'wall': {
      const s = map(entity.geometry.start);
      const e = map(entity.geometry.end);
      if (!s || !e) return null;
      next = {
        ...entity,
        id: newId,
        geometry: { ...entity.geometry, start: s, end: e },
      };
      break;
    }
    case 'door':
    case 'window':
      // Hosted objects mirror with their wall via remapped hostWallId in command layer.
      // Standalone mirror without host remap is invalid.
      return null;
    case 'room':
      // Rooms follow walls — mirror walls instead.
      return null;
    case 'block':
      // Stage A+B does not mirror references. The definition stays unchanged.
      return null;
  }
  return validateEntityGeometry(next) ? next : null;
}

export function rotateEntity(
  entity: Entity,
  origin: Vec2,
  radians: number,
): Entity | null {
  if (!isFiniteVec2(origin) || !Number.isFinite(radians)) return null;
  const map = (p: Vec2) => rotatePoint(p, origin, radians);
  let next: Entity;
  switch (entity.type) {
    case 'line':
      next = {
        ...entity,
        geometry: {
          start: map(entity.geometry.start),
          end: map(entity.geometry.end),
        },
      };
      break;
    case 'rectangle': {
      // Rotate corners — may become non-axis-aligned; store as rectangle of
      // rotated corner1/corner2 AABB is wrong. Convert to polyline for non-ortho,
      // or keep corner1/corner2 as the two rotated opposite corners (axis-aligned
      // assumption breaks). For M4: if rotation is not multiple of 90°, convert
      // rectangle to polyline of 4 corners.
      const { corner1, corner2 } = entity.geometry;
      const corners = [
        { x: corner1.x, y: corner1.y },
        { x: corner2.x, y: corner1.y },
        { x: corner2.x, y: corner2.y },
        { x: corner1.x, y: corner2.y },
      ].map(map);
      const deg = Math.abs(((radians * 180) / Math.PI) % 90);
      const ortho = deg < 1e-6 || Math.abs(deg - 90) < 1e-6;
      if (ortho) {
        next = {
          ...entity,
          geometry: {
            corner1: map(corner1),
            corner2: map(corner2),
          },
        };
      } else {
        next = {
          id: entity.id,
          type: 'polyline',
          layerId: entity.layerId,
          visible: entity.visible,
          locked: entity.locked,
          geometry: { vertices: corners, closed: true },
          properties: { ...entity.properties },
        };
      }
      break;
    }
    case 'circle':
      next = {
        ...entity,
        geometry: {
          center: map(entity.geometry.center),
          radius: entity.geometry.radius,
        },
      };
      break;
    case 'polyline':
      next = {
        ...entity,
        geometry: {
          ...entity.geometry,
          vertices: entity.geometry.vertices.map(map),
        },
      };
      next = syncArcPolylineMetadata(next, {
        mapPoint: map,
        angleDelta: radians,
        radiusScale: 1,
      });
      break;
    case 'dimension':
      next = {
        ...entity,
        geometry: {
          ...entity.geometry,
          start: map(entity.geometry.start),
          end: map(entity.geometry.end),
        },
      };
      break;
    case 'text':
      next = {
        ...entity,
        geometry: {
          ...entity.geometry,
          position: map(entity.geometry.position),
          rotation: entity.geometry.rotation + radians,
        },
      };
      break;
    case 'leader':
      next = {
        ...entity,
        geometry: {
          ...entity.geometry,
          arrow: map(entity.geometry.arrow),
          vertices: entity.geometry.vertices.map(map),
        },
      };
      break;
    case 'wall':
      next = {
        ...entity,
        geometry: {
          ...entity.geometry,
          start: map(entity.geometry.start),
          end: map(entity.geometry.end),
        },
      };
      break;
    case 'door':
    case 'window':
      // Parametric on host — rotate is a no-op on door/window records.
      next = { ...entity };
      break;
    case 'room':
      // Boundary from walls; rotate label with origin so selection feedback works.
      next = {
        ...entity,
        geometry: {
          ...entity.geometry,
          labelPosition: map(entity.geometry.labelPosition),
          polygon: entity.geometry.polygon.map(map),
        },
      };
      break;
    case 'block':
      next = {
        ...entity,
        geometry: {
          ...entity.geometry,
          position: map(entity.geometry.position),
          rotation: entity.geometry.rotation + radians,
        },
      };
      break;
  }
  return validateEntityGeometry(next) ? next : null;
}

export function scaleEntity(
  entity: Entity,
  origin: Vec2,
  factor: number,
): Entity | null {
  if (!isFiniteVec2(origin) || !Number.isFinite(factor) || !(factor > 0)) {
    return null;
  }
  const map = (p: Vec2) => scalePoint(p, origin, factor);
  let next: Entity;
  switch (entity.type) {
    case 'line':
      next = {
        ...entity,
        geometry: {
          start: map(entity.geometry.start),
          end: map(entity.geometry.end),
        },
      };
      break;
    case 'rectangle':
      next = {
        ...entity,
        geometry: {
          corner1: map(entity.geometry.corner1),
          corner2: map(entity.geometry.corner2),
        },
      };
      break;
    case 'circle':
      next = {
        ...entity,
        geometry: {
          center: map(entity.geometry.center),
          radius: entity.geometry.radius * factor,
        },
      };
      break;
    case 'polyline':
      next = {
        ...entity,
        geometry: {
          ...entity.geometry,
          vertices: entity.geometry.vertices.map(map),
        },
      };
      next = syncArcPolylineMetadata(next, {
        mapPoint: map,
        angleDelta: 0,
        radiusScale: factor,
      });
      break;
    case 'dimension':
      next = {
        ...entity,
        geometry: {
          ...entity.geometry,
          start: map(entity.geometry.start),
          end: map(entity.geometry.end),
          offset: entity.geometry.offset * factor,
        },
      };
      break;
    case 'text':
      next = {
        ...entity,
        geometry: {
          ...entity.geometry,
          position: map(entity.geometry.position),
          height: entity.geometry.height * factor,
        },
      };
      break;
    case 'leader':
      next = {
        ...entity,
        geometry: {
          ...entity.geometry,
          arrow: map(entity.geometry.arrow),
          vertices: entity.geometry.vertices.map(map),
          textHeight: entity.geometry.textHeight * factor,
        },
      };
      break;
    case 'wall':
    case 'door':
    case 'window':
    case 'room':
      // Scale is disabled for construction objects — thickness/height/width
      // must not silently scale into incorrect construction data.
      return null;
    case 'block':
      next = {
        ...entity,
        geometry: {
          ...entity.geometry,
          position: map(entity.geometry.position),
          scaleX: entity.geometry.scaleX * factor,
          scaleY: entity.geometry.scaleY * factor,
        },
      };
      break;
  }
  return validateEntityGeometry(next) ? next : null;
}

export function parseAngleDegrees(input: string): number | null {
  const t = input.trim().toLowerCase().replace('°', '');
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return degreesToRadians(n);
}

export function parsePositiveScale(input: string): number | null {
  const n = Number(input.trim());
  if (!Number.isFinite(n) || !(n > 0)) return null;
  return n;
}

export { cloneEntityWithNewId, degreesToRadians };
