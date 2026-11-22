/**
 * Dimension and measurement math in drawing units.
 * Preview and commit both use these functions. Nothing here writes a document.
 */

import type {
  DimensionEntity,
  DimensionKind,
  DrawingDocument,
  Entity,
  Vec2,
} from '@ratecad/core';
import { angleOnArc, ccwSweep, pointOnCircle } from './arc.js';
import { polygonArea } from './rooms.js';
import { rectangleLocalCorners } from './blockTransform.js';
import { offsetFromPlacement } from './transform.js';
import { measuredAngleDeg, measuredLength } from './units.js';

/** A snapped point sits on geometry. This catches that hit without a pixel pickbox. */
export const OBJECT_HIT_TOLERANCE = 1e-4;

export type LinearDimMode = 'smart' | 'linear' | 'aligned';

export interface LinearTarget {
  entityId: string;
  edgeIndex: number;
  start: Vec2;
  end: Vec2;
  distance: number;
}

export interface RadialTarget {
  entityId: string;
  kind: 'circle' | 'arc';
  center: Vec2;
  radius: number;
  startAngle?: number;
  endAngle?: number;
  distance: number;
  atCenter: boolean;
}

export interface DimensionDraft {
  kind: DimensionKind;
  start: Vec2;
  end: Vec2;
  offset: number;
  vertex?: Vec2;
  metadata?: Record<string, unknown>;
}

export interface ModelDimensionBinding {
  role: 'linear' | 'radius' | 'diameter' | 'arc' | 'angular';
  entityId: string;
  edgeIndex?: number;
  secondEntityId?: string;
  secondEdgeIndex?: number;
  directionAngle?: number;
  valid: boolean;
  brokenReason?: string;
}

export interface HoverMeasurement {
  label: string;
  distance?: number;
  angleDeg?: number;
}

interface LinearEdge {
  edgeIndex: number;
  start: Vec2;
  end: Vec2;
}

function copyPoint(point: Vec2): Vec2 {
  return { x: point.x, y: point.y };
}

function segmentHit(
  point: Vec2,
  start: Vec2,
  end: Vec2,
): { distance: number } {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-24) {
    return { distance: Math.hypot(point.x - start.x, point.y - start.y) };
  }
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / len2));
  const x = start.x + t * dx;
  const y = start.y + t * dy;
  return { distance: Math.hypot(point.x - x, point.y - y) };
}

export function linearEdges(entity: Entity): LinearEdge[] {
  if (entity.type === 'line' || entity.type === 'wall') {
    return [{ edgeIndex: 0, start: entity.geometry.start, end: entity.geometry.end }];
  }
  if (entity.type === 'rectangle') {
    const corners = rectangleLocalCorners(entity.geometry.corner1, entity.geometry.corner2);
    return [0, 1, 2, 3].map((index) => ({
      edgeIndex: index,
      start: corners[index]!,
      end: corners[(index + 1) % 4]!,
    }));
  }
  if (entity.type === 'polyline') {
    const vertices = entity.geometry.vertices;
    const count = entity.geometry.closed ? vertices.length : vertices.length - 1;
    const edges: LinearEdge[] = [];
    for (let index = 0; index < count; index += 1) {
      const start = vertices[index];
      const end = vertices[(index + 1) % vertices.length];
      if (start && end) edges.push({ edgeIndex: index, start, end });
    }
    return edges;
  }
  return [];
}

function eligible(entity: Entity): boolean {
  return entity.visible !== false;
}

export function nearestLinearTarget(
  entities: readonly Entity[],
  point: Vec2,
  tolerance = OBJECT_HIT_TOLERANCE,
): LinearTarget | null {
  let best: LinearTarget | null = null;
  for (const entity of entities) {
    if (!eligible(entity)) continue;
    for (const edge of linearEdges(entity)) {
      if (Math.hypot(edge.end.x - edge.start.x, edge.end.y - edge.start.y) < 1e-12) continue;
      const hit = segmentHit(point, edge.start, edge.end);
      if (hit.distance > tolerance) continue;
      if (!best || hit.distance < best.distance - 1e-9) {
        best = {
          entityId: entity.id,
          edgeIndex: edge.edgeIndex,
          start: copyPoint(edge.start),
          end: copyPoint(edge.end),
          distance: hit.distance,
        };
      }
    }
  }
  return best;
}

export function nearestRadialTarget(
  entities: readonly Entity[],
  point: Vec2,
  tolerance = OBJECT_HIT_TOLERANCE,
): RadialTarget | null {
  let best: RadialTarget | null = null;
  for (const entity of entities) {
    if (!eligible(entity)) continue;
    if (entity.type !== 'circle' && entity.type !== 'arc') continue;
    const { center, radius } = entity.geometry;
    if (!(radius > 0)) continue;
    const centerDistance = Math.hypot(point.x - center.x, point.y - center.y);
    const atCenter = centerDistance <= tolerance;
    const curveDistance = Math.abs(centerDistance - radius);
    if (!atCenter && curveDistance > tolerance) continue;
    if (entity.type === 'arc' && !atCenter) {
      const angle = Math.atan2(point.y - center.y, point.x - center.x);
      if (!angleOnArc(angle, entity.geometry.startAngle, entity.geometry.endAngle)) continue;
    }
    const distanceTo = atCenter ? centerDistance : curveDistance;
    if (!best || distanceTo < best.distance - 1e-9) {
      best = {
        entityId: entity.id,
        kind: entity.type,
        center: copyPoint(center),
        radius,
        ...(entity.type === 'arc'
          ? {
              startAngle: entity.geometry.startAngle,
              endAngle: entity.geometry.endAngle,
            }
          : {}),
        distance: distanceTo,
        atCenter,
      };
    }
  }
  return best;
}

export function chooseLinearKind(
  start: Vec2,
  end: Vec2,
  cursor: Vec2,
  mode: LinearDimMode,
  forceKind?: 'horizontal' | 'vertical',
): 'horizontal' | 'vertical' | 'aligned' {
  if (forceKind) return forceKind;
  if (mode === 'aligned') return 'aligned';
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy);
  const axisTolerance = Math.max(len * 0.02, 1e-9);
  if (Math.abs(dy) <= axisTolerance) return 'horizontal';
  if (Math.abs(dx) <= axisTolerance) return 'vertical';
  if (mode === 'linear') {
    const midX = (start.x + end.x) / 2;
    const midY = (start.y + end.y) / 2;
    return Math.abs(cursor.y - midY) >= Math.abs(cursor.x - midX) ? 'horizontal' : 'vertical';
  }
  const t = len > 1e-12
    ? ((cursor.x - start.x) * dx + (cursor.y - start.y) * dy) / (len * len)
    : 0;
  if (t >= -0.25 && t <= 1.25) return 'aligned';
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;
  return Math.abs(cursor.y - midY) >= Math.abs(cursor.x - midX) ? 'horizontal' : 'vertical';
}

export function linearDimensionDraft(
  start: Vec2,
  end: Vec2,
  cursor: Vec2,
  mode: LinearDimMode,
  forceKind?: 'horizontal' | 'vertical',
): DimensionDraft | null {
  if (Math.hypot(end.x - start.x, end.y - start.y) < 1e-12) return null;
  const kind = chooseLinearKind(start, end, cursor, mode, forceKind);
  const offset = offsetFromPlacement(start, end, kind, cursor);
  if (!Number.isFinite(offset)) return null;
  return { kind, start: copyPoint(start), end: copyPoint(end), offset };
}

function pointToward(center: Vec2, radius: number, cursor: Vec2): Vec2 {
  const dx = cursor.x - center.x;
  const dy = cursor.y - center.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-12) return { x: center.x + radius, y: center.y };
  return { x: center.x + (dx / len) * radius, y: center.y + (dy / len) * radius };
}

export function arcLengthMeasurement(
  radius: number,
  startAngle: number,
  endAngle: number,
): number {
  if (!(radius > 0) || !Number.isFinite(startAngle) || !Number.isFinite(endAngle)) {
    return Number.NaN;
  }
  return radius * ccwSweep(startAngle, endAngle);
}

export function radialDimensionDraft(
  target: RadialTarget,
  cursor: Vec2,
  requested: 'smart' | 'radius' | 'diameter' | 'arc',
): DimensionDraft | null {
  if (!(target.radius > 0)) return null;
  if (requested === 'arc') {
    if (target.kind !== 'arc' || target.startAngle == null || target.endAngle == null) return null;
    const sweep = ccwSweep(target.startAngle, target.endAngle);
    const start = pointOnCircle(target.center, target.radius, target.startAngle);
    const end = pointOnCircle(target.center, target.radius, target.startAngle + sweep);
    const offset = Math.hypot(cursor.x - target.center.x, cursor.y - target.center.y) - target.radius;
    if (!Number.isFinite(offset)) return null;
    return {
      kind: 'arc-length',
      start,
      end,
      offset,
      vertex: copyPoint(target.center),
      metadata: { sweepRadians: sweep },
    };
  }
  const fromCenter = Math.hypot(cursor.x - target.center.x, cursor.y - target.center.y);
  const kind: 'radius' | 'diameter' =
    requested === 'radius'
      ? 'radius'
      : requested === 'diameter'
        ? 'diameter'
        : fromCenter < target.radius
          ? 'radius'
          : 'diameter';
  const rim = pointToward(target.center, target.radius, cursor);
  const directionAngle = Math.atan2(rim.y - target.center.y, rim.x - target.center.x);
  return {
    kind,
    start: copyPoint(target.center),
    end: rim,
    offset: 0,
    metadata: { directionAngle },
  };
}

function unitVector(start: Vec2, end: Vec2): Vec2 | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-12) return null;
  return { x: dx / len, y: dy / len };
}

export function infiniteLineIntersection(
  a1: Vec2,
  a2: Vec2,
  b1: Vec2,
  b2: Vec2,
): Vec2 | null {
  const d1x = a2.x - a1.x;
  const d1y = a2.y - a1.y;
  const d2x = b2.x - b1.x;
  const d2y = b2.y - b1.y;
  const cross = d1x * d2y - d1y * d2x;
  if (Math.abs(cross) < 1e-12) return null;
  const t = ((b1.x - a1.x) * d2y - (b1.y - a1.y) * d2x) / cross;
  if (!Number.isFinite(t)) return null;
  return { x: a1.x + t * d1x, y: a1.y + t * d1y };
}

/** Angle of the wedge that contains the cursor. Parallel and zero-length lines return null. */
export function angularDraft(
  a1: Vec2,
  a2: Vec2,
  b1: Vec2,
  b2: Vec2,
  cursor: Vec2,
): { vertex: Vec2; start: Vec2; end: Vec2; degrees: number } | null {
  const directionA = unitVector(a1, a2);
  const directionB = unitVector(b1, b2);
  if (!directionA || !directionB) return null;
  if (Math.abs(directionA.x * directionB.y - directionA.y * directionB.x) < 1e-9) return null;
  const vertex = infiniteLineIntersection(a1, a2, b1, b2);
  if (!vertex) return null;
  const cx = cursor.x - vertex.x;
  const cy = cursor.y - vertex.y;
  const radius = Math.hypot(cx, cy);
  if (radius < 1e-9) return null;
  // Two infinite lines divide the plane into four sectors. The cursor selects
  // the sector it sits in, independent of which line was picked first.
  const rays = [
    directionA,
    { x: -directionA.x, y: -directionA.y },
    directionB,
    { x: -directionB.x, y: -directionB.y },
  ]
    .map((direction) => ({ direction, angle: Math.atan2(direction.y, direction.x) }))
    .sort((left, right) => left.angle - right.angle);
  const cursorAngle = Math.atan2(cy, cx);
  for (let index = 0; index < rays.length; index += 1) {
    const current = rays[index];
    const next = rays[(index + 1) % rays.length];
    if (!current || !next) continue;
    let sweep = next.angle - current.angle;
    if (sweep <= 1e-9) sweep += Math.PI * 2;
    let toCursor = cursorAngle - current.angle;
    if (toCursor < -1e-9) toCursor += Math.PI * 2;
    if (toCursor >= -1e-4 && toCursor <= sweep + 1e-4) {
      return {
        vertex,
        start: {
          x: vertex.x + current.direction.x * radius,
          y: vertex.y + current.direction.y * radius,
        },
        end: {
          x: vertex.x + next.direction.x * radius,
          y: vertex.y + next.direction.y * radius,
        },
        degrees: (sweep * 180) / Math.PI,
      };
    }
  }
  return null;
}

export function threePointAngle(
  vertex: Vec2,
  first: Vec2,
  second: Vec2,
): { vertex: Vec2; start: Vec2; end: Vec2; degrees: number } | null {
  const firstLen = Math.hypot(first.x - vertex.x, first.y - vertex.y);
  const secondLen = Math.hypot(second.x - vertex.x, second.y - vertex.y);
  if (firstLen < 1e-9 || secondLen < 1e-9) return null;
  const radius = secondLen;
  const start = {
    x: vertex.x + ((first.x - vertex.x) / firstLen) * radius,
    y: vertex.y + ((first.y - vertex.y) / firstLen) * radius,
  };
  const end = {
    x: vertex.x + ((second.x - vertex.x) / secondLen) * radius,
    y: vertex.y + ((second.y - vertex.y) / secondLen) * radius,
  };
  const degrees = measuredAngleDeg(vertex, start, end);
  if (!Number.isFinite(degrees) || degrees < 1e-4) return null;
  return { vertex: copyPoint(vertex), start, end, degrees };
}

export function ccwAngleDegrees(vertex: Vec2, start: Vec2, end: Vec2): number {
  const a0 = Math.atan2(start.y - vertex.y, start.x - vertex.x);
  const a1 = Math.atan2(end.y - vertex.y, end.x - vertex.x);
  let degrees = ((a1 - a0) * 180) / Math.PI;
  while (degrees < 0) degrees += 360;
  while (degrees >= 360) degrees -= 360;
  return degrees;
}

export function dimensionMeasuredValue(
  geometry: DimensionEntity['geometry'],
  metadata?: Record<string, unknown> | null,
): number {
  if (geometry.kind === 'angular') {
    const vertex = geometry.vertex ?? geometry.start;
    if (metadata?.useCcw === true) return ccwAngleDegrees(vertex, geometry.start, geometry.end);
    return measuredAngleDeg(vertex, geometry.start, geometry.end);
  }
  if (geometry.kind === 'arc-length') {
    const vertex = geometry.vertex;
    if (!vertex) return 0;
    const radius = Math.hypot(geometry.start.x - vertex.x, geometry.start.y - vertex.y);
    const sweep = typeof metadata?.sweepRadians === 'number'
      ? Math.abs(metadata.sweepRadians)
      : ccwSweep(
          Math.atan2(geometry.start.y - vertex.y, geometry.start.x - vertex.x),
          Math.atan2(geometry.end.y - vertex.y, geometry.end.x - vertex.x),
        );
    return radius * sweep;
  }
  return measuredLength(geometry.start, geometry.end, geometry.kind);
}

export function dimensionAnnotationText(
  metadata: Record<string, unknown> | undefined,
  formatted: string,
): string {
  const custom = metadata?.displayText;
  const body = typeof custom === 'string' && custom.trim().length > 0 ? custom : formatted;
  const binding = metadata?.modelDimension;
  if (
    binding &&
    typeof binding === 'object' &&
    (binding as { valid?: boolean }).valid === false
  ) {
    return `${body} (detached)`;
  }
  return body;
}

function readBinding(metadata: Record<string, unknown> | undefined): ModelDimensionBinding | null {
  const raw = metadata?.modelDimension;
  if (!raw || typeof raw !== 'object') return null;
  const binding = raw as ModelDimensionBinding;
  if (typeof binding.entityId !== 'string' || typeof binding.role !== 'string') return null;
  return binding;
}

function findEntity(doc: DrawingDocument, id: string): Entity | undefined {
  return doc.entities.find((entity) => entity.id === id);
}

function edgeOf(entity: Entity, index: number | undefined): LinearEdge | null {
  const edges = linearEdges(entity);
  if (index == null) return edges[0] ?? null;
  return edges.find((edge) => edge.edgeIndex === index) ?? null;
}

function pointsEqual(a: Vec2, b: Vec2): boolean {
  return a.x === b.x && a.y === b.y;
}

function detach(dim: DimensionEntity, binding: ModelDimensionBinding, reason: string): DimensionEntity {
  if (binding.valid === false && binding.brokenReason === reason) return dim;
  return {
    ...dim,
    metadata: {
      ...(dim.metadata ?? {}),
      modelDimension: { ...binding, valid: false, brokenReason: reason },
    },
  };
}

function attach(
  dim: DimensionEntity,
  binding: ModelDimensionBinding,
  geometry: DimensionEntity['geometry'],
  metadataPatch?: Record<string, unknown>,
): DimensionEntity {
  const sameGeometry =
    pointsEqual(dim.geometry.start, geometry.start) &&
    pointsEqual(dim.geometry.end, geometry.end) &&
    dim.geometry.offset === geometry.offset &&
    dim.geometry.kind === geometry.kind &&
    ((dim.geometry.vertex == null && geometry.vertex == null) ||
      (dim.geometry.vertex != null &&
        geometry.vertex != null &&
        pointsEqual(dim.geometry.vertex, geometry.vertex)));
  const sameSweep = metadataPatch?.sweepRadians == null ||
    dim.metadata?.sweepRadians === metadataPatch.sweepRadians;
  if (sameGeometry && binding.valid !== false && sameSweep) return dim;
  return {
    ...dim,
    geometry,
    metadata: {
      ...(dim.metadata ?? {}),
      ...metadataPatch,
      modelDimension: { ...binding, valid: true, brokenReason: undefined },
    },
  };
}

function directionClosest(edge: LinearEdge, preferred: Vec2): Vec2 | null {
  const unit = unitVector(edge.start, edge.end);
  if (!unit) return null;
  const len = Math.hypot(preferred.x, preferred.y);
  if (len < 1e-12) return unit;
  const dot = unit.x * preferred.x + unit.y * preferred.y;
  return dot >= 0 ? unit : { x: -unit.x, y: -unit.y };
}

/** The stored ray follows whichever source line it actually lies on. */
function rayOnSource(first: LinearEdge, second: LinearEdge, preferred: Vec2): Vec2 | null {
  const firstUnit = unitVector(first.start, first.end);
  const secondUnit = unitVector(second.start, second.end);
  if (!firstUnit || !secondUnit) return null;
  const len = Math.hypot(preferred.x, preferred.y);
  const px = len < 1e-12 ? firstUnit.x : preferred.x / len;
  const py = len < 1e-12 ? firstUnit.y : preferred.y / len;
  const firstAlign = Math.abs(firstUnit.x * px + firstUnit.y * py);
  const secondAlign = Math.abs(secondUnit.x * px + secondUnit.y * py);
  return directionClosest(firstAlign >= secondAlign ? first : second, preferred);
}

function refreshOne(doc: DrawingDocument, dim: DimensionEntity): DimensionEntity {
  const binding = readBinding(dim.metadata);
  if (!binding) return dim;
  const source = findEntity(doc, binding.entityId);
  if (!source) return detach(dim, binding, 'Source geometry missing');

  if (binding.role === 'linear') {
    const edge = edgeOf(source, binding.edgeIndex);
    if (!edge) return detach(dim, binding, 'Source edge missing');
    if (Math.hypot(edge.end.x - edge.start.x, edge.end.y - edge.start.y) < 1e-12) {
      return detach(dim, binding, 'Source length is zero');
    }
    return attach(dim, binding, {
      ...dim.geometry,
      start: copyPoint(edge.start),
      end: copyPoint(edge.end),
    });
  }

  if (binding.role === 'radius' || binding.role === 'diameter') {
    if (source.type !== 'circle' && source.type !== 'arc') {
      return detach(dim, binding, 'Source is no longer circular');
    }
    if (!(source.geometry.radius > 0)) return detach(dim, binding, 'Radius is zero');
    const angle = typeof binding.directionAngle === 'number'
      ? binding.directionAngle
      : typeof dim.metadata?.directionAngle === 'number'
        ? (dim.metadata.directionAngle as number)
        : Math.atan2(dim.geometry.end.y - dim.geometry.start.y, dim.geometry.end.x - dim.geometry.start.x);
    const end = pointOnCircle(source.geometry.center, source.geometry.radius, angle);
    return attach(dim, { ...binding, directionAngle: angle }, {
      ...dim.geometry,
      start: copyPoint(source.geometry.center),
      end,
    });
  }

  if (binding.role === 'arc') {
    if (source.type !== 'arc') return detach(dim, binding, 'Source arc is missing');
    if (!(source.geometry.radius > 0)) return detach(dim, binding, 'Radius is zero');
    const sweep = ccwSweep(source.geometry.startAngle, source.geometry.endAngle);
    const start = pointOnCircle(source.geometry.center, source.geometry.radius, source.geometry.startAngle);
    const end = pointOnCircle(
      source.geometry.center,
      source.geometry.radius,
      source.geometry.startAngle + sweep,
    );
    return attach(
      dim,
      binding,
      {
        ...dim.geometry,
        start,
        end,
        vertex: copyPoint(source.geometry.center),
      },
      { sweepRadians: sweep },
    );
  }

  if (binding.role === 'angular' && source.type === 'arc' && !binding.secondEntityId) {
    const sweep = ccwSweep(source.geometry.startAngle, source.geometry.endAngle);
    const oldVertex = dim.geometry.vertex ?? source.geometry.center;
    const radius = Math.hypot(dim.geometry.start.x - oldVertex.x, dim.geometry.start.y - oldVertex.y);
    const placeRadius = radius > 1e-9 ? radius : source.geometry.radius;
    return attach(
      dim,
      binding,
      {
        ...dim.geometry,
        vertex: copyPoint(source.geometry.center),
        start: pointOnCircle(source.geometry.center, placeRadius, source.geometry.startAngle),
        end: pointOnCircle(
          source.geometry.center,
          placeRadius,
          source.geometry.startAngle + sweep,
        ),
      },
      { useCcw: true },
    );
  }

  if (binding.role === 'angular') {
    if (!binding.secondEntityId) return detach(dim, binding, 'Second line is missing');
    const second = findEntity(doc, binding.secondEntityId);
    if (!second) return detach(dim, binding, 'Second line is missing');
    const firstEdge = edgeOf(source, binding.edgeIndex);
    const secondEdge = edgeOf(second, binding.secondEdgeIndex);
    if (!firstEdge || !secondEdge) return detach(dim, binding, 'Source edge missing');
    const vertex = infiniteLineIntersection(firstEdge.start, firstEdge.end, secondEdge.start, secondEdge.end);
    if (!vertex) return detach(dim, binding, 'Lines are parallel');
    const oldVertex = dim.geometry.vertex ?? vertex;
    const preferredStart = {
      x: dim.geometry.start.x - oldVertex.x,
      y: dim.geometry.start.y - oldVertex.y,
    };
    const preferredEnd = {
      x: dim.geometry.end.x - oldVertex.x,
      y: dim.geometry.end.y - oldVertex.y,
    };
    const radius = Math.hypot(preferredStart.x, preferredStart.y);
    if (radius < 1e-9) return detach(dim, binding, 'Angle radius is zero');
    const dirA = rayOnSource(firstEdge, secondEdge, preferredStart);
    const dirB = rayOnSource(firstEdge, secondEdge, preferredEnd);
    if (!dirA || !dirB) return detach(dim, binding, 'Source length is zero');
    if (Math.abs(dirA.x * dirB.y - dirA.y * dirB.x) < 1e-9) {
      return detach(dim, binding, 'Lines are parallel');
    }
    return attach(dim, binding, {
      ...dim.geometry,
      vertex,
      start: { x: vertex.x + dirA.x * radius, y: vertex.y + dirA.y * radius },
      end: { x: vertex.x + dirB.x * radius, y: vertex.y + dirB.y * radius },
    }, { useCcw: true });
  }

  return dim;
}

/** Recalculate model-space associative dimensions. Paper-space refs are left untouched. */
export function refreshModelSpaceDimensions(doc: DrawingDocument): DrawingDocument {
  let changed = false;
  const entities = doc.entities.map((entity) => {
    if (entity.type !== 'dimension') return entity;
    const next = refreshOne(doc, entity);
    if (next !== entity) changed = true;
    return next;
  });
  if (!changed) return doc;
  return { ...doc, entities };
}

function formatMeasure(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return value.toFixed(8).replace(/\.?0+$/, '');
}

function pointInPolygon(point: Vec2, polygon: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if (!a || !b) continue;
    const crosses = a.y > point.y !== b.y > point.y;
    if (!crosses) continue;
    const x = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (point.x < x) inside = !inside;
  }
  return inside;
}

function perimeterOf(points: readonly Vec2[], closed: boolean): number {
  let total = 0;
  const count = closed ? points.length : points.length - 1;
  for (let index = 0; index < count; index += 1) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    if (start && end) total += Math.hypot(end.x - start.x, end.y - start.y);
  }
  return total;
}

export function describeHover(
  entities: readonly Entity[],
  point: Vec2,
  tolerance = OBJECT_HIT_TOLERANCE,
): HoverMeasurement | null {
  const linear = nearestLinearTarget(entities, point, tolerance);
  if (linear) {
    const dx = linear.end.x - linear.start.x;
    const dy = linear.end.y - linear.start.y;
    const length = Math.hypot(dx, dy);
    return {
      label: `Length ${formatMeasure(length)}  ΔX ${formatMeasure(Math.abs(dx))}  ΔY ${formatMeasure(Math.abs(dy))}`,
      distance: length,
    };
  }
  const radial = nearestRadialTarget(entities, point, tolerance);
  if (radial && !radial.atCenter) {
    if (radial.kind === 'arc' && radial.startAngle != null && radial.endAngle != null) {
      const arcLength = arcLengthMeasurement(radial.radius, radial.startAngle, radial.endAngle);
      return {
        label: `Arc ${formatMeasure(arcLength)}  R ${formatMeasure(radial.radius)}  Ø ${formatMeasure(radial.radius * 2)}`,
        distance: arcLength,
      };
    }
    return {
      label: `R ${formatMeasure(radial.radius)}  Ø ${formatMeasure(radial.radius * 2)}`,
      distance: radial.radius,
    };
  }

  for (const entity of entities) {
    if (!eligible(entity)) continue;
    if (entity.type === 'circle') {
      const { center, radius } = entity.geometry;
      if (Math.hypot(point.x - center.x, point.y - center.y) < radius) {
        const area = Math.PI * radius * radius;
        return {
          label: `Area ${formatMeasure(area)}  Circumference ${formatMeasure(2 * Math.PI * radius)}  R ${formatMeasure(radius)}`,
          distance: area,
        };
      }
    }
    if (entity.type === 'rectangle') {
      const corners = rectangleLocalCorners(entity.geometry.corner1, entity.geometry.corner2);
      if (pointInPolygon(point, corners)) {
        const width = Math.abs(entity.geometry.corner2.x - entity.geometry.corner1.x);
        const height = Math.abs(entity.geometry.corner2.y - entity.geometry.corner1.y);
        return {
          label: `Area ${formatMeasure(width * height)}  Perimeter ${formatMeasure(2 * (width + height))}`,
          distance: width * height,
        };
      }
    }
    if (entity.type === 'polyline' && entity.geometry.closed && entity.geometry.vertices.length >= 3) {
      if (pointInPolygon(point, entity.geometry.vertices)) {
        const area = polygonArea(entity.geometry.vertices);
        const perimeter = perimeterOf(entity.geometry.vertices, true);
        return {
          label: `Area ${formatMeasure(area)}  Perimeter ${formatMeasure(perimeter)}`,
          distance: area,
        };
      }
    }
  }
  return null;
}
