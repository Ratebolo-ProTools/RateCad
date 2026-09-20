import type { DrawingDocument, Entity, EntityId, Vec2 } from '@ratecad/core';
import {
  aabbFromPoints,
  pointInAABB,
  pointNearCircle,
  pointNearSegment,
} from '@ratecad/geometry';

export function hitTestEntity(
  entity: Entity,
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
      const { corner1, corner2 } = entity.geometry;
      const corners = [
        { x: corner1.x, y: corner1.y },
        { x: corner2.x, y: corner1.y },
        { x: corner2.x, y: corner2.y },
        { x: corner1.x, y: corner2.y },
      ];
      for (let i = 0; i < 4; i += 1) {
        const a = corners[i]!;
        const b = corners[(i + 1) % 4]!;
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
      const verts = entity.geometry.vertices;
      if (verts.length < 2) {
        return verts[0] ? pointNearSegment(point, verts[0], verts[0], tolerance) : false;
      }
      const count = entity.geometry.closed ? verts.length : verts.length - 1;
      for (let i = 0; i < count; i += 1) {
        const a = verts[i]!;
        const b = verts[(i + 1) % verts.length]!;
        if (pointNearSegment(point, a, b, tolerance)) return true;
      }
      return false;
    }
  }
}

export function hitTestDocument(
  doc: DrawingDocument,
  point: Vec2,
  tolerance: number,
): EntityId | null {
  for (let i = doc.entities.length - 1; i >= 0; i -= 1) {
    const entity = doc.entities[i]!;
    if (!entity.visible || entity.locked) continue;
    if (hitTestEntity(entity, point, tolerance)) {
      return entity.id;
    }
  }
  return null;
}

export function entityBounds(entity: Entity): ReturnType<typeof aabbFromPoints> | null {
  switch (entity.type) {
    case 'line':
      return aabbFromPoints(entity.geometry.start, entity.geometry.end);
    case 'rectangle':
      return aabbFromPoints(entity.geometry.corner1, entity.geometry.corner2);
    case 'circle': {
      const { center, radius } = entity.geometry;
      return {
        minX: center.x - radius,
        minY: center.y - radius,
        maxX: center.x + radius,
        maxY: center.y + radius,
      };
    }
    case 'polyline': {
      const verts = entity.geometry.vertices;
      if (verts.length === 0) return null;
      let minX = verts[0]!.x;
      let minY = verts[0]!.y;
      let maxX = verts[0]!.x;
      let maxY = verts[0]!.y;
      for (const v of verts) {
        minX = Math.min(minX, v.x);
        minY = Math.min(minY, v.y);
        maxX = Math.max(maxX, v.x);
        maxY = Math.max(maxY, v.y);
      }
      return { minX, minY, maxX, maxY };
    }
  }
}

export function isPointNearEntityBounds(
  entity: Entity,
  point: Vec2,
  pad: number,
): boolean {
  const bounds = entityBounds(entity);
  if (!bounds) return false;
  return pointInAABB(point, bounds, pad);
}

export type SelectionMode = 'window' | 'crossing';

function entityFullyInside(
  entity: Entity,
  box: { minX: number; minY: number; maxX: number; maxY: number },
): boolean {
  const bounds = entityBounds(entity);
  if (!bounds) return false;
  return (
    bounds.minX >= box.minX &&
    bounds.maxX <= box.maxX &&
    bounds.minY >= box.minY &&
    bounds.maxY <= box.maxY
  );
}

function entityIntersectsBox(
  entity: Entity,
  box: { minX: number; minY: number; maxX: number; maxY: number },
): boolean {
  const bounds = entityBounds(entity);
  if (!bounds) return false;
  return !(
    bounds.maxX < box.minX ||
    bounds.minX > box.maxX ||
    bounds.maxY < box.minY ||
    bounds.minY > box.maxY
  );
}

/**
 * Window selection: entities whose bounds are fully inside the rectangle.
 * Crossing selection: entities whose bounds intersect the rectangle.
 * Direction heuristic (CAD-style): left→right = window, right→left = crossing
 * when mode is auto via corners.
 */
export function selectByRectangle(
  doc: DrawingDocument,
  cornerA: Vec2,
  cornerB: Vec2,
  mode: SelectionMode | 'auto' = 'auto',
): EntityId[] {
  const minX = Math.min(cornerA.x, cornerB.x);
  const maxX = Math.max(cornerA.x, cornerB.x);
  const minY = Math.min(cornerA.y, cornerB.y);
  const maxY = Math.max(cornerA.y, cornerB.y);
  const box = { minX, minY, maxX, maxY };

  let resolved: SelectionMode = mode === 'auto'
    ? cornerB.x >= cornerA.x
      ? 'window'
      : 'crossing'
    : mode;

  const ids: EntityId[] = [];
  for (const entity of doc.entities) {
    if (!entity.visible || entity.locked) continue;
    const hit =
      resolved === 'window'
        ? entityFullyInside(entity, box)
        : entityIntersectsBox(entity, box);
    if (hit) ids.push(entity.id);
  }
  return ids;
}

