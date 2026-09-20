import type { Entity, Vec2 } from '@ratecad/core';
import { midpoint } from '@ratecad/geometry';

export type GripRole =
  | 'start'
  | 'end'
  | 'corner'
  | 'center'
  | 'quadrant'
  | 'vertex';

export interface Grip {
  role: GripRole;
  point: Vec2;
  index?: number;
}

/** Visual/non-editable grips for selected entities (M2 foundation). */
export function getEntityGrips(entity: Entity): Grip[] {
  switch (entity.type) {
    case 'line':
      return [
        { role: 'start', point: { ...entity.geometry.start } },
        { role: 'end', point: { ...entity.geometry.end } },
      ];
    case 'rectangle': {
      const { corner1, corner2 } = entity.geometry;
      return [
        { role: 'corner', point: { x: corner1.x, y: corner1.y }, index: 0 },
        { role: 'corner', point: { x: corner2.x, y: corner1.y }, index: 1 },
        { role: 'corner', point: { x: corner2.x, y: corner2.y }, index: 2 },
        { role: 'corner', point: { x: corner1.x, y: corner2.y }, index: 3 },
      ];
    }
    case 'circle': {
      const { center, radius } = entity.geometry;
      return [
        { role: 'center', point: { ...center } },
        { role: 'quadrant', point: { x: center.x + radius, y: center.y }, index: 0 },
        { role: 'quadrant', point: { x: center.x, y: center.y + radius }, index: 1 },
        { role: 'quadrant', point: { x: center.x - radius, y: center.y }, index: 2 },
        { role: 'quadrant', point: { x: center.x, y: center.y - radius }, index: 3 },
      ];
    }
    case 'polyline':
      return entity.geometry.vertices.map((v, index) => ({
        role: 'vertex' as const,
        point: { ...v },
        index,
      }));
  }
}

export function getSelectionGrips(entities: Entity[]): Grip[] {
  return entities.flatMap(getEntityGrips);
}

/** Helper used by tests — midpoint of first segment where applicable. */
export function firstSegmentMidpoint(entity: Entity): Vec2 | null {
  switch (entity.type) {
    case 'line':
      return midpoint(entity.geometry.start, entity.geometry.end);
    case 'polyline': {
      const v = entity.geometry.vertices;
      if (v.length < 2) return null;
      return midpoint(v[0]!, v[1]!);
    }
    default:
      return null;
  }
}
