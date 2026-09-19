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
  }
}

export function hitTestDocument(
  doc: DrawingDocument,
  point: Vec2,
  tolerance: number,
): EntityId | null {
  // Topmost last-drawn wins
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
