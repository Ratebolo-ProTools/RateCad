/**
 * FilletEngine — tangent circular fillets in model coordinates.
 * Reuses intersect helpers; arcs stored as polylines with analytical metadata
 * (RateCAD has no native Arc entity yet — same pattern as circle TRIM).
 */
import type { Entity, EntityId, Vec2 } from '@ratecad/core';
import {
  closestPointOnSegment,
  cross,
  dot,
  intersectLineCircle,
  normalize,
  pointOnSegment,
  projectParam,
} from './intersect.js';
import { add, distance, scale, sub } from './math.js';
import { cuttingSegments, intersectInfiniteLines } from './trimExtendEngine.js';
import { isFiniteVec2, validateEntityGeometry } from './transform.js';

const EPS = 1e-9;
const HIT_EPS = 1e-6;
const ANGLE_EPS = 1e-6;

export interface FilletOptions {
  radius: number;
  /** Trim/extend sources to fillet endpoints (default true). */
  trim: boolean;
}

export interface FilletPick {
  entity: Entity;
  worldPoint: Vec2;
  segmentIndex?: number;
}

export interface FilletArcSpec {
  center: Vec2;
  radius: number;
  startAngle: number;
  endAngle: number;
  ccw: boolean;
  tangent1: Vec2;
  tangent2: Vec2;
}

export type FilletComputeResult =
  | {
      ok: true;
      arc: FilletArcSpec | null;
      replacements: Entity[];
      created: Entity[];
      previewEntities: Entity[];
      hideEntityIds: EntityId[];
      message?: string;
    }
  | { ok: false; reason: string };

type LinearEdge = {
  a: Vec2;
  b: Vec2;
  source: Entity;
  segmentIndex: number;
};

function fail(reason: string): FilletComputeResult {
  return { ok: false, reason };
}

function normalizeAngle(a: number): number {
  let x = a;
  while (x < 0) x += Math.PI * 2;
  while (x >= Math.PI * 2) x -= Math.PI * 2;
  return x;
}

function angleOf(center: Vec2, p: Vec2): number {
  return Math.atan2(p.y - center.y, p.x - center.x);
}

function projectOntoInfinite(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  return pointOnSegment(a, b, projectParam(p, a, b));
}

function signedDistToLine(p: Vec2, a: Vec2, b: Vec2): number {
  const d = sub(b, a);
  const len = Math.hypot(d.x, d.y);
  if (len < EPS) return 0;
  return cross(d, sub(p, a)) / len;
}

export function sampleFilletArc(spec: FilletArcSpec, segments = 0): Vec2[] {
  const { center, radius, startAngle, endAngle, ccw } = spec;
  let sweep = ccw
    ? normalizeAngle(endAngle - startAngle)
    : -normalizeAngle(startAngle - endAngle);
  if (Math.abs(sweep) < EPS) {
    sweep = ccw ? Math.PI * 2 - EPS : -(Math.PI * 2 - EPS);
  }
  if (!ccw && sweep > 0) sweep -= Math.PI * 2;
  if (ccw && sweep < 0) sweep += Math.PI * 2;
  const steps =
    segments > 0
      ? segments
      : Math.max(8, Math.ceil((Math.abs(sweep) / (Math.PI * 2)) * 48));
  const verts: Vec2[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const ang = startAngle + sweep * (i / steps);
    verts.push({
      x: center.x + radius * Math.cos(ang),
      y: center.y + radius * Math.sin(ang),
    });
  }
  return verts;
}

export function makeArcPolylineEntity(
  template: Entity,
  spec: FilletArcSpec,
  id: EntityId,
): Entity {
  return {
    id,
    type: 'polyline',
    layerId: template.layerId,
    visible: template.visible,
    locked: false,
    geometry: { vertices: sampleFilletArc(spec), closed: false },
    properties: { color: (template.properties as { color?: string }).color },
    metadata: {
      arc: {
        center: { ...spec.center },
        radius: spec.radius,
        startAngle: spec.startAngle,
        endAngle: spec.endAngle,
        ccw: spec.ccw,
        fillet: true,
      },
    },
  };
}

export function resolveLinearEdge(pick: FilletPick): LinearEdge | null {
  const e = pick.entity;
  if (e.type === 'line' || e.type === 'wall') {
    return {
      a: { ...e.geometry.start },
      b: { ...e.geometry.end },
      source: e,
      segmentIndex: 0,
    };
  }
  if (e.type === 'polyline') {
    const v = e.geometry.vertices;
    if (v.length < 2) return null;
    const count = e.geometry.closed ? v.length : v.length - 1;
    let best = pick.segmentIndex ?? 0;
    if (pick.segmentIndex == null) {
      let bestD = Number.POSITIVE_INFINITY;
      for (let i = 0; i < count; i += 1) {
        const d = distance(
          pick.worldPoint,
          closestPointOnSegment(pick.worldPoint, v[i]!, v[(i + 1) % v.length]!),
        );
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    }
    return {
      a: { ...v[best]! },
      b: { ...v[(best + 1) % v.length]! },
      source: e,
      segmentIndex: best,
    };
  }
  if (e.type === 'rectangle') {
    const segs = cuttingSegments(e);
    let best = 0;
    let bestD = Number.POSITIVE_INFINITY;
    for (let i = 0; i < segs.length; i += 1) {
      const d = distance(
        pick.worldPoint,
        closestPointOnSegment(pick.worldPoint, segs[i]!.a, segs[i]!.b),
      );
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    const s = segs[best]!;
    return { a: { ...s.a }, b: { ...s.b }, source: e, segmentIndex: best };
  }
  return null;
}

/**
 * Keep the portion of segment [a,b] on the pick side of `tangent`,
 * measured from intersection `vertex` along the keep direction.
 */
function trimSegmentToFillet(
  a: Vec2,
  b: Vec2,
  tangent: Vec2,
  vertex: Vec2,
  pickPoint: Vec2,
): { start: Vec2; end: Vec2 } | null {
  const pickOnLine = projectOntoInfinite(pickPoint, a, b);
  let dirKeep = normalize(sub(pickOnLine, vertex));
  if (!dirKeep) {
    const da = distance(tangent, a);
    const db = distance(tangent, b);
    if (da < HIT_EPS && db < HIT_EPS) return null;
    return da >= db
      ? { start: { ...tangent }, end: { ...a } }
      : { start: { ...tangent }, end: { ...b } };
  }
  const origin = vertex;
  const axis = add(origin, dirKeep);
  const tTan = projectParam(tangent, origin, axis);
  const candidates = [
    { p: a, t: projectParam(a, origin, axis) },
    { p: b, t: projectParam(b, origin, axis) },
  ].filter((c) => c.t >= tTan - EPS);
  if (!candidates.length) {
    const len = Math.max(distance(a, b), HIT_EPS * 10);
    return {
      start: { ...tangent },
      end: add(tangent, scale(dirKeep, len)),
    };
  }
  const far = candidates.reduce((best, c) => (c.t > best.t ? c : best));
  if (distance(tangent, far.p) < HIT_EPS) return null;
  return { start: { ...tangent }, end: { ...far.p } };
}

function tint(entity: Entity): Entity {
  return {
    ...entity,
    properties: { ...entity.properties, color: '#7eb6ff' },
  } as Entity;
}

function applyLineTrim(
  source: Extract<Entity, { type: 'line' | 'wall' }>,
  edge: LinearEdge,
  tangent: Vec2,
  vertex: Vec2,
  pick: Vec2,
): Entity | null {
  const trimmed = trimSegmentToFillet(edge.a, edge.b, tangent, vertex, pick);
  if (!trimmed || distance(trimmed.start, trimmed.end) < HIT_EPS) return null;
  if (source.type === 'wall') {
    return {
      ...source,
      geometry: {
        ...source.geometry,
        start: trimmed.start,
        end: trimmed.end,
      },
    };
  }
  return {
    ...source,
    geometry: { start: trimmed.start, end: trimmed.end },
  };
}

function buildArcSpec(
  center: Vec2,
  radius: number,
  T1: Vec2,
  T2: Vec2,
  interiorRef: Vec2,
): FilletArcSpec {
  const a1 = angleOf(center, T1);
  const a2 = angleOf(center, T2);
  const ccwSweep = normalizeAngle(a2 - a1);
  const midCcw = {
    x: center.x + radius * Math.cos(a1 + ccwSweep / 2),
    y: center.y + radius * Math.sin(a1 + ccwSweep / 2),
  };
  const cwSweep = normalizeAngle(a1 - a2);
  const midCw = {
    x: center.x + radius * Math.cos(a1 - cwSweep / 2),
    y: center.y + radius * Math.sin(a1 - cwSweep / 2),
  };
  const useCcw = distance(midCcw, interiorRef) <= distance(midCw, interiorRef);
  return {
    center,
    radius,
    startAngle: a1,
    endAngle: a2,
    ccw: useCcw,
    tangent1: T1,
    tangent2: T2,
  };
}

function filletPolylineVertex(
  pline: Extract<Entity, { type: 'polyline' }>,
  segA: number,
  segB: number,
  T1: Vec2,
  T2: Vec2,
  spec: FilletArcSpec,
): { ok: true; entity: Entity } | { ok: false; reason: string } {
  const v = pline.geometry.vertices;
  const closed = pline.geometry.closed;
  const mod = closed ? v.length : Math.max(v.length - 1, 1);
  let s0 = segA;
  let tNear = T1;
  let tFar = T2;
  if ((segA + 1) % mod !== segB) {
    if ((segB + 1) % mod === segA) {
      s0 = segB;
      tNear = T2;
      tFar = T1;
    } else {
      return { ok: false, reason: 'Polyline segments must meet at a vertex' };
    }
  }
  const vertexIndex = (s0 + 1) % v.length;
  const arcVerts = sampleFilletArc(spec);
  if (distance(arcVerts[0]!, tNear) > distance(arcVerts[0]!, tFar)) {
    arcVerts.reverse();
  }

  const rebuilt: Vec2[] = [];
  if (!closed) {
    for (let j = 0; j < s0; j += 1) rebuilt.push({ ...v[j]! });
    rebuilt.push({ ...tNear });
    for (let k = 1; k < arcVerts.length - 1; k += 1) {
      rebuilt.push({ ...arcVerts[k]! });
    }
    rebuilt.push({ ...tFar });
    for (let i = s0 + 2; i < v.length; i += 1) rebuilt.push({ ...v[i]! });
  } else {
    for (let i = 0; i < v.length; i += 1) {
      if (i === vertexIndex) {
        rebuilt.push({ ...tNear });
        for (let k = 1; k < arcVerts.length - 1; k += 1) {
          rebuilt.push({ ...arcVerts[k]! });
        }
        rebuilt.push({ ...tFar });
      } else {
        rebuilt.push({ ...v[i]! });
      }
    }
  }

  const cleaned: Vec2[] = [];
  for (const p of rebuilt) {
    if (
      cleaned.length === 0 ||
      distance(cleaned[cleaned.length - 1]!, p) > HIT_EPS
    ) {
      cleaned.push(p);
    }
  }
  if (cleaned.length < (closed ? 3 : 2)) {
    return { ok: false, reason: 'Polyline fillet collapsed' };
  }
  const entity: Entity = {
    ...pline,
    geometry: { vertices: cleaned, closed },
    metadata: {
      ...(pline.metadata ?? {}),
      lastFillet: { center: spec.center, radius: spec.radius, vertexIndex },
    },
  };
  if (!validateEntityGeometry(entity)) {
    return { ok: false, reason: 'Invalid filleted polyline' };
  }
  return { ok: true, entity };
}

export function filletLineLine(
  edge1: LinearEdge,
  edge2: LinearEdge,
  pick1: Vec2,
  pick2: Vec2,
  options: FilletOptions,
  arcId: EntityId,
): FilletComputeResult {
  const { radius, trim } = options;
  if (!Number.isFinite(radius) || radius < 0) return fail('Invalid fillet radius');

  const X = intersectInfiniteLines(edge1.a, edge1.b, edge2.a, edge2.b);
  if (!X || !isFiniteVec2(X)) {
    return filletParallelLines(edge1, edge2, pick1, pick2, options, arcId);
  }

  const p1 = projectOntoInfinite(pick1, edge1.a, edge1.b);
  const p2 = projectOntoInfinite(pick2, edge2.a, edge2.b);
  let d1 = normalize(sub(p1, X));
  let d2 = normalize(sub(p2, X));
  if (!d1) {
    d1 = normalize(
      sub(distance(X, edge1.a) >= distance(X, edge1.b) ? edge1.a : edge1.b, X),
    );
  }
  if (!d2) {
    d2 = normalize(
      sub(distance(X, edge2.a) >= distance(X, edge2.b) ? edge2.a : edge2.b, X),
    );
  }
  if (!d1 || !d2) {
    return fail('Unable to determine fillet side from pick locations');
  }

  const cos = Math.max(-1, Math.min(1, dot(d1, d2)));
  const theta = Math.acos(cos);
  if (theta < ANGLE_EPS || theta > Math.PI - ANGLE_EPS) {
    return fail('Lines are nearly collinear — cannot fillet');
  }

  if (radius <= EPS) {
    return sharpCorner(edge1, edge2, X, pick1, pick2, trim);
  }

  const half = theta / 2;
  const tLen = radius / Math.tan(half);
  if (!(tLen > EPS) || !Number.isFinite(tLen)) {
    return fail('Unable to create fillet. Specified radius is too large.');
  }

  const T1 = add(X, scale(d1, tLen));
  const T2 = add(X, scale(d2, tLen));
  const bis = normalize(add(d1, d2));
  if (!bis) return fail('Degenerate angle bisector');
  const center = add(X, scale(bis, radius / Math.sin(half)));

  if (Math.abs(distance(center, T1) - radius) > 1e-4) {
    return fail('Fillet failed tangency validation');
  }
  if (Math.abs(distance(center, T2) - radius) > 1e-4) {
    return fail('Fillet failed tangency validation');
  }
  if (
    projectParam(T1, X, add(X, d1)) < -EPS ||
    projectParam(T2, X, add(X, d2)) < -EPS
  ) {
    return fail('Unable to create fillet. Specified radius is too large.');
  }

  const interiorRef = add(X, scale(bis, (radius / Math.sin(half)) * 0.5));
  const spec = buildArcSpec(center, radius, T1, T2, interiorRef);
  const arcEntity = makeArcPolylineEntity(edge1.source, spec, arcId);
  if (!validateEntityGeometry(arcEntity)) {
    return fail('Fillet produced invalid arc geometry');
  }

  const samePolyline =
    edge1.source.id === edge2.source.id && edge1.source.type === 'polyline';

  if (trim && samePolyline && edge1.source.type === 'polyline') {
    const plined = filletPolylineVertex(
      edge1.source,
      edge1.segmentIndex,
      edge2.segmentIndex,
      T1,
      T2,
      spec,
    );
    if (!plined.ok) return fail(plined.reason);
    return {
      ok: true,
      arc: spec,
      replacements: [plined.entity],
      created: [],
      previewEntities: [tint(plined.entity), tint(arcEntity)],
      hideEntityIds: [edge1.source.id],
    };
  }

  const replacements: Entity[] = [];
  const hideEntityIds: EntityId[] = [];
  const previewModified: Entity[] = [];

  if (trim) {
    for (const [edge, T, pick] of [
      [edge1, T1, pick1] as const,
      [edge2, T2, pick2] as const,
    ]) {
      if (edge.source.type === 'line' || edge.source.type === 'wall') {
        const next = applyLineTrim(edge.source, edge, T, X, pick);
        if (!next) {
          return fail('Unable to create fillet. Specified radius is too large.');
        }
        if (!validateEntityGeometry(next)) {
          return fail('Fillet produced invalid line geometry');
        }
        replacements.push(next);
        hideEntityIds.push(edge.source.id);
        previewModified.push(tint(next));
      } else if (edge.source.type === 'rectangle') {
        return fail(
          'Fillet rectangle corners with Polyline option (P), or explode to lines',
        );
      } else if (edge.source.type === 'polyline') {
        return fail('Select two segments of the same polyline to fillet a corner');
      }
    }
  }

  return {
    ok: true,
    arc: spec,
    replacements: trim ? replacements : [],
    created: [arcEntity],
    previewEntities: trim
      ? [...previewModified, tint(arcEntity)]
      : [tint(arcEntity)],
    hideEntityIds: trim ? hideEntityIds : [],
  };
}

function sharpCorner(
  edge1: LinearEdge,
  edge2: LinearEdge,
  X: Vec2,
  pick1: Vec2,
  pick2: Vec2,
  trim: boolean,
): FilletComputeResult {
  if (!trim) return fail('Radius 0 with Trim OFF does nothing');

  if (edge1.source.id === edge2.source.id && edge1.source.type === 'polyline') {
    const pl = edge1.source;
    const v = pl.geometry.vertices.map((p) => ({ ...p }));
    const mod = pl.geometry.closed ? v.length : Math.max(v.length - 1, 1);
    let vertexIndex = (edge1.segmentIndex + 1) % v.length;
    if ((edge1.segmentIndex + 1) % mod !== edge2.segmentIndex) {
      vertexIndex = (edge2.segmentIndex + 1) % v.length;
    }
    v[vertexIndex] = { ...X };
    const entity: Entity = {
      ...pl,
      geometry: { ...pl.geometry, vertices: v },
    };
    if (!validateEntityGeometry(entity)) {
      return fail('Sharp corner produced invalid polyline');
    }
    return {
      ok: true,
      arc: null,
      replacements: [entity],
      created: [],
      previewEntities: [tint(entity)],
      hideEntityIds: [pl.id],
    };
  }

  const replacements: Entity[] = [];
  const hide: EntityId[] = [];
  const preview: Entity[] = [];
  for (const [edge, pick] of [
    [edge1, pick1] as const,
    [edge2, pick2] as const,
  ]) {
    if (edge.source.type !== 'line' && edge.source.type !== 'wall') {
      return fail('Radius 0 supports lines/walls and same-polyline vertices');
    }
    const next = applyLineTrim(edge.source, edge, X, X, pick);
    if (!next) return fail('Cannot form sharp corner');
    // Force endpoint exactly at X
    const g =
      next.type === 'line' || next.type === 'wall' ? next.geometry : null;
    if (!g) return fail('Cannot form sharp corner');
    const startCloser = distance(g.start, X) <= distance(g.end, X);
    let fixed: Entity;
    if (next.type === 'wall') {
      fixed = {
        ...next,
        geometry: {
          ...next.geometry,
          start: startCloser ? { ...X } : { ...g.start },
          end: startCloser ? { ...g.end } : { ...X },
        },
      };
    } else if (next.type === 'line') {
      fixed = {
        ...next,
        geometry: {
          start: startCloser ? { ...X } : { ...g.start },
          end: startCloser ? { ...g.end } : { ...X },
        },
      };
    } else {
      return fail('Cannot form sharp corner');
    }
    if (!validateEntityGeometry(fixed)) return fail('Invalid sharp-corner geometry');
    replacements.push(fixed);
    hide.push(edge.source.id);
    preview.push(tint(fixed));
  }
  return {
    ok: true,
    arc: null,
    replacements,
    created: [],
    previewEntities: preview,
    hideEntityIds: hide,
  };
}

function filletParallelLines(
  edge1: LinearEdge,
  edge2: LinearEdge,
  pick1: Vec2,
  pick2: Vec2,
  options: FilletOptions,
  arcId: EntityId,
): FilletComputeResult {
  const along = normalize(sub(edge1.b, edge1.a));
  if (!along) return fail('Degenerate line');
  const sep = Math.abs(signedDistToLine(edge2.a, edge1.a, edge1.b));
  if (sep < EPS) return fail('Lines are coincident — cannot fillet');

  // AutoCAD: temporary radius = half separation
  const r = sep / 2;
  const mid1 = projectOntoInfinite(pick1, edge1.a, edge1.b);
  const left = { x: -along.y, y: along.x };
  const to2 = sub(edge2.a, edge1.a);
  const nrm = normalize(dot(left, to2) >= 0 ? left : scale(left, -1));
  if (!nrm) return fail('Parallel fillet failed');

  const T1 = { ...mid1 };
  const T2 = add(mid1, scale(nrm, sep));
  const center = add(mid1, scale(nrm, r));
  const spec = buildArcSpec(center, r, T1, T2, center);
  const arcEntity = makeArcPolylineEntity(edge1.source, spec, arcId);

  if (!options.trim) {
    return {
      ok: true,
      arc: spec,
      replacements: [],
      created: [arcEntity],
      previewEntities: [tint(arcEntity)],
      hideEntityIds: [],
      message: `Parallel fillet (radius temporarily ${r.toFixed(4)})`,
    };
  }

  const replacements: Entity[] = [];
  const hide: EntityId[] = [];
  const preview: Entity[] = [];
  for (const [edge, T, pick] of [
    [edge1, T1, pick1] as const,
    [edge2, T2, pick2] as const,
  ]) {
    if (edge.source.type !== 'line' && edge.source.type !== 'wall') {
      return fail('Parallel fillet currently supports lines/walls');
    }
    const next = applyLineTrim(edge.source, edge, T, T, pick);
    if (!next) return fail('Parallel fillet trim failed');
    replacements.push(next);
    hide.push(edge.source.id);
    preview.push(tint(next));
  }
  void pick2;
  return {
    ok: true,
    arc: spec,
    replacements,
    created: [arcEntity],
    previewEntities: [...preview, tint(arcEntity)],
    hideEntityIds: hide,
    message: `Parallel fillet (radius temporarily ${r.toFixed(4)})`,
  };
}

export function filletLineCircle(
  lineEdge: LinearEdge,
  circle: Extract<Entity, { type: 'circle' }>,
  pickLine: Vec2,
  pickCircle: Vec2,
  options: FilletOptions,
  arcId: EntityId,
): FilletComputeResult {
  const { radius, trim } = options;
  if (radius <= EPS) return fail('Radius 0 is not applicable to circle fillets');
  const C = circle.geometry.center;
  const R = circle.geometry.radius;
  if (!(R > EPS)) return fail('Invalid circle');

  const n = normalize(sub(lineEdge.b, lineEdge.a));
  if (!n) return fail('Degenerate line');
  const left = { x: -n.y, y: n.x };
  const sideCirc = signedDistToLine(C, lineEdge.a, lineEdge.b);

  const candidates: Vec2[] = [];
  for (const sign of [1, -1] as const) {
    const oA = add(lineEdge.a, scale(left, sign * radius));
    const oB = add(lineEdge.b, scale(left, sign * radius));
    for (const rr of [R + radius, Math.abs(R - radius)]) {
      if (!(rr > EPS)) continue;
      for (const p of intersectLineCircle(oA, oB, C, rr)) candidates.push(p);
    }
  }
  if (!candidates.length) {
    return fail('Unable to create fillet. Specified radius is too large.');
  }

  let best = candidates[0]!;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    const side = signedDistToLine(c, lineEdge.a, lineEdge.b);
    const penalty = Math.sign(side) === Math.sign(sideCirc) || sideCirc === 0 ? 0 : 1e3;
    const score = distance(c, pickLine) + distance(c, pickCircle) + penalty;
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }

  const center = best;
  const T1on = projectOntoInfinite(center, lineEdge.a, lineEdge.b);
  // Push foot onto circle of radius `radius` around center along line normal
  const nrm = normalize(sub(T1on, center));
  const Tline = nrm ? add(center, scale(nrm, radius)) : T1on;
  const T1 = projectOntoInfinite(Tline, lineEdge.a, lineEdge.b);

  const distCenters = distance(center, C);
  const external =
    Math.abs(distCenters - (R + radius)) <=
    Math.abs(distCenters - Math.abs(R - radius));
  const toC = normalize(sub(C, center));
  if (!toC) return fail('Fillet failed');
  const Tcirc = add(center, scale(toC, external ? radius : -radius));

  const spec = buildArcSpec(center, radius, T1, Tcirc, center);
  const arcEntity = makeArcPolylineEntity(lineEdge.source, spec, arcId);

  const replacements: Entity[] = [];
  const hide: EntityId[] = [];
  const preview: Entity[] = [];
  // Circle is NEVER trimmed
  if (trim && (lineEdge.source.type === 'line' || lineEdge.source.type === 'wall')) {
    const next = applyLineTrim(lineEdge.source, lineEdge, T1, T1, pickLine);
    if (next) {
      replacements.push(next);
      hide.push(lineEdge.source.id);
      preview.push(tint(next));
    }
  }

  return {
    ok: true,
    arc: spec,
    replacements,
    created: [arcEntity],
    previewEntities: [...preview, tint(arcEntity)],
    hideEntityIds: hide,
  };
}

export function filletPolylineAll(
  pline: Extract<Entity, { type: 'polyline' }>,
  options: FilletOptions,
): FilletComputeResult {
  if (options.radius <= EPS) {
    return fail('Polyline option requires a positive radius');
  }
  let current: Extract<Entity, { type: 'polyline' }> = structuredClone(pline);
  let applied = 0;
  const skipped: string[] = [];

  for (let guard = 0; guard < 64; guard += 1) {
    const verts = current.geometry.vertices;
    const n = verts.length;
    const cornerCount = current.geometry.closed ? n : Math.max(0, n - 2);
    let did = false;
    for (let ci = 0; ci < cornerCount; ci += 1) {
      const vertexIndex = current.geometry.closed ? ci : ci + 1;
      const i0 = current.geometry.closed
        ? (vertexIndex - 1 + n) % n
        : vertexIndex - 1;
      const i1 = vertexIndex;
      const i2 = current.geometry.closed
        ? (vertexIndex + 1) % n
        : vertexIndex + 1;
      const A = verts[i0]!;
      const B = verts[i1]!;
      const C = verts[i2]!;
      const edge1: LinearEdge = {
        a: A,
        b: B,
        source: current,
        segmentIndex: i0,
      };
      const edge2: LinearEdge = {
        a: B,
        b: C,
        source: current,
        segmentIndex: current.geometry.closed ? i1 : i1,
      };
      const result = filletLineLine(
        edge1,
        edge2,
        { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 },
        { x: (B.x + C.x) / 2, y: (B.y + C.y) / 2 },
        { radius: options.radius, trim: true },
        `${pline.id}#fillet-tmp` as EntityId,
      );
      if (!result.ok) {
        skipped.push(`v${vertexIndex}: ${result.reason}`);
        continue;
      }
      const repl = result.replacements.find((e) => e.type === 'polyline');
      if (!repl || repl.type !== 'polyline') {
        skipped.push(`v${vertexIndex}: no polyline result`);
        continue;
      }
      current = repl;
      applied += 1;
      did = true;
      break;
    }
    if (!did) break;
  }

  if (applied === 0) {
    return fail(
      skipped[0] ? `No vertices filleted. ${skipped[0]}` : 'No eligible vertices',
    );
  }

  return {
    ok: true,
    arc: null,
    replacements: [current],
    created: [],
    previewEntities: [tint(current)],
    hideEntityIds: [pline.id],
    message: `Filleted ${applied} vertex(ies)` + (skipped.length ? `; skipped ${skipped.length}` : ''),
  };
}

export function computeFillet(
  first: FilletPick,
  second: FilletPick,
  options: FilletOptions,
  arcId: EntityId,
): FilletComputeResult {
  if (first.entity.type === 'circle' && second.entity.type === 'circle') {
    return fail('Circle–circle fillet is not supported in this version');
  }
  if (first.entity.type === 'circle') {
    const edge = resolveLinearEdge(second);
    if (!edge) return fail('Unsupported geometry for circle fillet');
    return filletLineCircle(
      edge,
      first.entity,
      second.worldPoint,
      first.worldPoint,
      options,
      arcId,
    );
  }
  if (second.entity.type === 'circle') {
    const edge = resolveLinearEdge(first);
    if (!edge) return fail('Unsupported geometry for circle fillet');
    return filletLineCircle(
      edge,
      second.entity,
      first.worldPoint,
      second.worldPoint,
      options,
      arcId,
    );
  }

  const e1 = resolveLinearEdge(first);
  const e2 = resolveLinearEdge(second);
  if (!e1 || !e2) {
    return fail('Fillet requires linear edges (line, wall, polyline segment)');
  }
  return filletLineLine(
    e1,
    e2,
    first.worldPoint,
    second.worldPoint,
    options,
    arcId,
  );
}

export function validateFilletResult(result: FilletComputeResult): boolean {
  if (!result.ok) return false;
  for (const e of [...result.replacements, ...result.created]) {
    if (!validateEntityGeometry(e)) return false;
  }
  if (result.arc) {
    const { center, radius, tangent1, tangent2 } = result.arc;
    if (Math.abs(distance(center, tangent1) - radius) > 1e-3) return false;
    if (Math.abs(distance(center, tangent2) - radius) > 1e-3) return false;
  }
  return true;
}

export function defaultFilletSettings(): {
  filletRadius: number;
  filletTrim: boolean;
} {
  return { filletRadius: 0, filletTrim: true };
}
