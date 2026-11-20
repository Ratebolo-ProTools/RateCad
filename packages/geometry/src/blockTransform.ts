import type {
  BlockContentEntity,
  BlockDefinition,
  BlockReferenceEntity,
  Vec2,
} from '@ratecad/core';
import { distance, pointNearCircle, pointNearSegment } from './math.js';

export interface BlockBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Finite and not zero. Negative scales are allowed. */
export function isUsableBlockScale(value: number): boolean {
  return Number.isFinite(value) && value !== 0;
}

/**
 * Local point → world.
 * Order: scale X/Y, rotate about the local origin, translate to the insertion point.
 */
export function transformBlockPoint(
  local: Vec2,
  reference: Pick<BlockReferenceEntity, 'geometry'>,
): Vec2 {
  const { position, scaleX, scaleY, rotation } = reference.geometry;
  const sx = local.x * scaleX;
  const sy = local.y * scaleY;
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  return {
    x: position.x + sx * c - sy * s,
    y: position.y + sx * s + sy * c,
  };
}

/** World point → definition-local. Null when a scale is zero or not finite. */
export function inverseBlockPoint(
  world: Vec2,
  reference: Pick<BlockReferenceEntity, 'geometry'>,
): Vec2 | null {
  const { position, scaleX, scaleY, rotation } = reference.geometry;
  if (!isUsableBlockScale(scaleX) || !isUsableBlockScale(scaleY)) return null;
  const dx = world.x - position.x;
  const dy = world.y - position.y;
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  const rx = dx * c + dy * s;
  const ry = -dx * s + dy * c;
  return { x: rx / scaleX, y: ry / scaleY };
}

function shift(point: Vec2, base: Vec2): Vec2 {
  return { x: point.x - base.x, y: point.y - base.y };
}

/** Copy definition content into local coordinates. Keeps the original entity id. */
export function contentToLocal<T extends BlockContentEntity>(
  entity: T,
  base: Vec2,
): T {
  const next = structuredClone(entity);
  switch (next.type) {
    case 'line':
      next.geometry = {
        start: shift(next.geometry.start, base),
        end: shift(next.geometry.end, base),
      };
      return next;
    case 'rectangle':
      next.geometry = {
        corner1: shift(next.geometry.corner1, base),
        corner2: shift(next.geometry.corner2, base),
      };
      return next;
    case 'circle':
      next.geometry = {
        center: shift(next.geometry.center, base),
        radius: next.geometry.radius,
      };
      return next;
    case 'polyline':
      next.geometry = {
        ...next.geometry,
        vertices: next.geometry.vertices.map((vertex) => shift(vertex, base)),
      };
      return next;
    case 'text':
      next.geometry = {
        ...next.geometry,
        position: shift(next.geometry.position, base),
      };
      return next;
    case 'leader':
      next.geometry = {
        ...next.geometry,
        arrow: shift(next.geometry.arrow, base),
        vertices: next.geometry.vertices.map((vertex) => shift(vertex, base)),
      };
      return next;
  }
}

export function rectangleLocalCorners(corner1: Vec2, corner2: Vec2): Vec2[] {
  return [
    { x: corner1.x, y: corner1.y },
    { x: corner2.x, y: corner1.y },
    { x: corner2.x, y: corner2.y },
    { x: corner1.x, y: corner2.y },
  ];
}

export function blockContentLocalPoints(entity: BlockContentEntity): Vec2[] {
  switch (entity.type) {
    case 'line':
      return [entity.geometry.start, entity.geometry.end];
    case 'rectangle':
      return rectangleLocalCorners(entity.geometry.corner1, entity.geometry.corner2);
    case 'circle': {
      const { center, radius } = entity.geometry;
      const points: Vec2[] = [];
      const count = 16;
      for (let i = 0; i < count; i += 1) {
        const angle = (i / count) * Math.PI * 2;
        points.push({
          x: center.x + radius * Math.cos(angle),
          y: center.y + radius * Math.sin(angle),
        });
      }
      return points;
    }
    case 'polyline':
      return entity.geometry.vertices.map((vertex) => ({ ...vertex }));
    case 'text':
      return [{ ...entity.geometry.position }];
    case 'leader':
      return [entity.geometry.arrow, ...entity.geometry.vertices].map((vertex) => ({
        ...vertex,
      }));
  }
}

export function blockCircleWorldPoints(
  center: Vec2,
  radius: number,
  reference: BlockReferenceEntity,
  segments = 48,
): Vec2[] {
  const points: Vec2[] = [];
  for (let i = 0; i < segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    points.push(
      transformBlockPoint(
        {
          x: center.x + radius * Math.cos(angle),
          y: center.y + radius * Math.sin(angle),
        },
        reference,
      ),
    );
  }
  return points;
}

function boundsFromPoints(points: Vec2[]): BlockBounds | null {
  if (points.length === 0) return null;
  let minX = points[0]!.x;
  let minY = points[0]!.y;
  let maxX = points[0]!.x;
  let maxY = points[0]!.y;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

export function blockReferenceBounds(
  reference: BlockReferenceEntity,
  definitions: readonly BlockDefinition[],
): BlockBounds {
  const definition = definitions.find(
    (item) => item.id === reference.geometry.definitionId,
  );
  const points: Vec2[] = [{ ...reference.geometry.position }];
  if (definition) {
    for (const entity of definition.entities) {
      for (const local of blockContentLocalPoints(entity)) {
        points.push(transformBlockPoint(local, reference));
      }
    }
  }
  return boundsFromPoints(points)!;
}

export function suggestBlockBasePoint(entities: readonly BlockContentEntity[]): Vec2 {
  const points = entities.flatMap((entity) => blockContentLocalPoints(entity));
  if (points.length === 0) return { x: 0, y: 0 };
  const sum = points.reduce(
    (acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }),
    { x: 0, y: 0 },
  );
  return { x: sum.x / points.length, y: sum.y / points.length };
}

function hitLocalContent(
  entity: BlockContentEntity,
  point: Vec2,
  tolerance: number,
): boolean {
  switch (entity.type) {
    case 'line':
      return pointNearSegment(
        point,
        entity.geometry.start,
        entity.geometry.end,
        tolerance,
      );
    case 'rectangle': {
      const corners = rectangleLocalCorners(
        entity.geometry.corner1,
        entity.geometry.corner2,
      );
      for (let i = 0; i < corners.length; i += 1) {
        const a = corners[i]!;
        const b = corners[(i + 1) % corners.length]!;
        if (pointNearSegment(point, a, b, tolerance)) return true;
      }
      return false;
    }
    case 'circle':
      return pointNearCircle(
        point,
        entity.geometry.center,
        entity.geometry.radius,
        tolerance,
      );
    case 'polyline': {
      const vertices = entity.geometry.vertices;
      const count = entity.geometry.closed ? vertices.length : vertices.length - 1;
      for (let i = 0; i < count; i += 1) {
        const a = vertices[i]!;
        const b = vertices[(i + 1) % vertices.length]!;
        if (pointNearSegment(point, a, b, tolerance)) return true;
      }
      return false;
    }
    case 'text':
      return distance(point, entity.geometry.position) <= entity.geometry.height + tolerance;
    case 'leader': {
      const points = [entity.geometry.arrow, ...entity.geometry.vertices];
      for (let i = 0; i < points.length - 1; i += 1) {
        if (pointNearSegment(point, points[i]!, points[i + 1]!, tolerance)) return true;
      }
      return distance(point, points[points.length - 1]!) <= tolerance;
    }
  }
}

/**
 * Hit the reference as one object. Inner definition entities are not separate targets.
 * The test runs in definition-local space so rotation and nonuniform scale stay exact.
 */
export function hitTestBlockReference(
  reference: BlockReferenceEntity,
  definitions: readonly BlockDefinition[],
  point: Vec2,
  tolerance: number,
): boolean {
  if (distance(point, reference.geometry.position) <= tolerance) return true;
  const definition = definitions.find(
    (item) => item.id === reference.geometry.definitionId,
  );
  if (!definition) return false;
  const local = inverseBlockPoint(point, reference);
  if (!local) return false;
  const minScale = Math.min(
    Math.abs(reference.geometry.scaleX),
    Math.abs(reference.geometry.scaleY),
  );
  const localTolerance = tolerance / minScale;
  return definition.entities.some((entity) =>
    hitLocalContent(entity, local, localTolerance),
  );
}
