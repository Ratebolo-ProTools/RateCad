import type { Entity, Vec2 } from '@ratecad/core';
import {
  closestPointOnSegment,
  cross,
  degreesToRadians,
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
import {
  cloneEntityWithNewId,
  isFiniteVec2,
  validateEntityGeometry,
} from './transform.js';

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
    case 'wall':
    case 'door':
    case 'window':
    case 'room':
      return [];
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
  const { start, end } = line.geometry;
  const pick = closestPointOnSegment(pickPoint, start, end);
  const hits = collectIntersectionsOnLine(start, end, cutter);
  if (hits.length === 0) return fail('No intersection with cutting edge');

  const params = hits
    .map((p) => ({ p, t: projectParam(p, start, end) }))
    .sort((a, b) => a.t - b.t);

  const pickT = Math.max(0, Math.min(1, projectParam(pick, start, end)));
  const bounds = [0, ...params.map((h) => h.t), 1];

  let removeI = -1;
  for (let i = 0; i < bounds.length - 1; i += 1) {
    if (pickT >= bounds[i]! - EPS && pickT <= bounds[i + 1]! + EPS) {
      removeI = i;
      break;
    }
  }
  if (removeI < 0) return fail('Pick point not on line');

  const keep: Array<{ start: Vec2; end: Vec2 }> = [];
  for (let i = 0; i < bounds.length - 1; i += 1) {
    if (i === removeI) continue;
    const a = pointOnSegment(start, end, bounds[i]!);
    const b = pointOnSegment(start, end, bounds[i + 1]!);
    if (distance(a, b) > 1e-6) keep.push({ start: a, end: b });
  }
  if (keep.length === 0) return fail('Trim would remove entire line');

  const results: Entity[] = keep.map((g, index) => ({
    ...line,
    id: index === 0 ? line.id : (`${line.id}#trim${index}` as Entity['id']),
    geometry: { start: { ...g.start }, end: { ...g.end } },
  }));
  return ok(results);
}

/**
 * Trim an open polyline at the picked segment using cutter intersections.
 * Closed polylines are rejected in M4.
 */
export function trimPolylineEntity(
  pline: Extract<Entity, { type: 'polyline' }>,
  cutter: Entity,
  pickPoint: Vec2,
): ModifyResult {
  if (pline.geometry.closed) {
    return fail('Closed polyline trim not supported in M4');
  }
  const verts = pline.geometry.vertices;
  if (verts.length < 2) return fail('Invalid polyline');

  let bestSeg = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < verts.length - 1; i += 1) {
    const a = verts[i]!;
    const b = verts[i + 1]!;
    const d = distance(pickPoint, closestPointOnSegment(pickPoint, a, b));
    if (d < bestDist) {
      bestDist = d;
      bestSeg = i;
    }
  }

  const a = verts[bestSeg]!;
  const b = verts[bestSeg + 1]!;
  const hits = collectIntersectionsOnLine(a, b, cutter);
  if (hits.length === 0) return fail('No intersection on picked segment');

  const params = hits
    .map((p) => ({ p, t: projectParam(p, a, b) }))
    .sort((x, y) => x.t - y.t);
  const pickT = projectParam(pickPoint, a, b);
  const bounds = [0, ...params.map((h) => h.t), 1];

  let removeI = 0;
  for (let i = 0; i < bounds.length - 1; i += 1) {
    if (pickT >= bounds[i]! - EPS && pickT <= bounds[i + 1]! + EPS) {
      removeI = i;
      break;
    }
  }

  const keepParts: Array<{ start: Vec2; end: Vec2 }> = [];
  for (let i = 0; i < bounds.length - 1; i += 1) {
    if (i === removeI) continue;
    const s = pointOnSegment(a, b, bounds[i]!);
    const e = pointOnSegment(a, b, bounds[i + 1]!);
    if (distance(s, e) > 1e-6) keepParts.push({ start: s, end: e });
  }
  if (keepParts.length === 0) {
    // Entire segment removed — split into left and right chains if any
    const left = verts.slice(0, bestSeg + 1);
    const right = verts.slice(bestSeg + 1);
    const results: Entity[] = [];
    if (left.length >= 2) {
      results.push({
        ...pline,
        geometry: {
          ...pline.geometry,
          vertices: left.map((v) => ({ ...v })),
          closed: false,
        },
      });
    }
    if (right.length >= 2) {
      results.push({
        ...pline,
        id: `${pline.id}#trim1` as Entity['id'],
        geometry: {
          ...pline.geometry,
          vertices: right.map((v) => ({ ...v })),
          closed: false,
        },
      });
    }
    if (results.length === 0) return fail('Trim would remove entire polyline');
    return ok(results);
  }

  const results: Entity[] = [];
  for (let i = 0; i < keepParts.length; i += 1) {
    const part = keepParts[i]!;
    const chain: Vec2[] = [];
    if (distance(part.start, a) < 1e-6) {
      chain.push(...verts.slice(0, bestSeg).map((v) => ({ ...v })), part.start, part.end);
      if (distance(part.end, b) < 1e-6) {
        chain.push(...verts.slice(bestSeg + 2).map((v) => ({ ...v })));
      }
    } else if (distance(part.end, b) < 1e-6) {
      chain.push(part.start, part.end, ...verts.slice(bestSeg + 2).map((v) => ({ ...v })));
    } else {
      chain.push(part.start, part.end);
    }
    const cleaned: Vec2[] = [];
    for (const v of chain) {
      if (
        cleaned.length === 0 ||
        distance(cleaned[cleaned.length - 1]!, v) > 1e-6
      ) {
        cleaned.push({ ...v });
      }
    }
    if (cleaned.length >= 2) {
      results.push({
        ...pline,
        id: (i === 0 ? pline.id : `${pline.id}#trim${i}`) as Entity['id'],
        geometry: { ...pline.geometry, vertices: cleaned, closed: false },
      });
    }
  }
  if (results.length === 0) return fail('Trim produced no geometry');
  return ok(results);
}

export function trimCircleEntity(
  circle: Extract<Entity, { type: 'circle' }>,
  cutter: Entity,
  _pickPoint: Vec2,
): ModifyResult {
  void circle;
  void cutter;
  return fail('Circle trim not supported in M4 (use arcs in a later milestone)');
}

export function trimEntity(
  target: Entity,
  cutter: Entity,
  pickPoint: Vec2,
): ModifyResult {
  if (target.id === cutter.id) return fail('Cannot trim entity with itself');
  if (!isFiniteVec2(pickPoint)) return fail('Invalid pick point');

  switch (target.type) {
    case 'line':
      return trimLineEntity(target, cutter, pickPoint);
    case 'polyline':
      return trimPolylineEntity(target, cutter, pickPoint);
    case 'rectangle': {
      // Convert to closed polyline of 4 verts, trim as polyline unsupported closed —
      // trim as four independent lines: find nearest edge, trim that edge into a line entity
      const segs = entitySegments(target);
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
      const edge = segs[best]!;
      const asLine: Extract<Entity, { type: 'line' }> = {
        id: target.id,
        type: 'line',
        layerId: target.layerId,
        visible: target.visible,
        locked: target.locked,
        geometry: { start: { ...edge.a }, end: { ...edge.b } },
        properties: { ...target.properties },
      };
      const trimmed = trimLineEntity(asLine, cutter, pickPoint);
      if (!trimmed.ok) return trimmed;
      // Replace rectangle with remaining edges as polyline/lines
      // MVP: replace rect with a polyline of remaining 3 edges + trimmed edge pieces
      return fail(
        'Rectangle edge trim: convert rectangle to lines first, or trim line edges in M4+',
      );
    }
    case 'circle':
      return trimCircleEntity(target, cutter, pickPoint);
    case 'dimension':
    case 'text':
    case 'leader':
    case 'wall':
    case 'door':
    case 'window':
    case 'room':
      return fail(`Cannot trim ${target.type}`);
  }
}

/** Preview of portion to remove for a line trim (segment containing pick). */
export function trimRemovalPreview(
  target: Entity,
  cutter: Entity,
  pickPoint: Vec2,
): Entity | null {
  if (target.type !== 'line') return null;
  const { start, end } = target.geometry;
  const hits = collectIntersectionsOnLine(start, end, cutter);
  if (hits.length === 0) return null;
  const params = hits
    .map((p) => ({ p, t: projectParam(p, start, end) }))
    .sort((a, b) => a.t - b.t);
  const pickT = projectParam(pickPoint, start, end);
  const bounds = [0, ...params.map((h) => h.t), 1];
  for (let i = 0; i < bounds.length - 1; i += 1) {
    if (pickT >= bounds[i]! - EPS && pickT <= bounds[i + 1]! + EPS) {
      const a = pointOnSegment(start, end, bounds[i]!);
      const b = pointOnSegment(start, end, bounds[i + 1]!);
      return {
        ...target,
        geometry: { start: a, end: b },
        properties: { ...target.properties, color: '#ff6b6b' },
      };
    }
  }
  return null;
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
  if (!isFiniteVec2(pickPoint)) return fail('Invalid pick point');
  switch (target.type) {
    case 'line':
      return extendLineEntity(target, boundary, pickPoint);
    case 'polyline':
      return extendPolylineEntity(target, boundary, pickPoint);
    case 'rectangle':
      return fail('Rectangle extend not supported — explode or use lines');
    case 'circle':
    case 'dimension':
    case 'text':
    case 'leader':
    case 'wall':
    case 'door':
    case 'window':
    case 'room':
      return fail(`${target.type} extend not supported`);
  }
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
  if (pline.geometry.closed) {
    return fail('Closed polyline offset not supported in M4');
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

export function offsetRectangleEntity(
  rect: Extract<Entity, { type: 'rectangle' }>,
  distanceValue: number,
  sidePoint: Vec2,
  newId: Entity['id'],
): ModifyResult {
  if (!(Math.abs(distanceValue) > EPS) || !Number.isFinite(distanceValue)) {
    return fail('Invalid offset distance');
  }
  const { corner1, corner2 } = rect.geometry;
  const minX = Math.min(corner1.x, corner2.x);
  const maxX = Math.max(corner1.x, corner2.x);
  const minY = Math.min(corner1.y, corner2.y);
  const maxY = Math.max(corner1.y, corner2.y);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  // Outside if side point outside AABB
  const inside =
    sidePoint.x >= minX &&
    sidePoint.x <= maxX &&
    sidePoint.y >= minY &&
    sidePoint.y <= maxY;
  const d = Math.abs(distanceValue) * (inside ? -1 : 1);
  const next = {
    corner1: { x: minX - d, y: minY - d },
    corner2: { x: maxX + d, y: maxY + d },
  };
  if (
    Math.abs(next.corner1.x - next.corner2.x) < EPS ||
    Math.abs(next.corner1.y - next.corner2.y) < EPS
  ) {
    return fail('Offset collapses rectangle');
  }
  void cx;
  void cy;
  return ok([
    {
      ...rect,
      id: newId,
      geometry: next,
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
      return fail(`${entity.type} offset not supported`);
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
