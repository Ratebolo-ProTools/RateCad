import type { Entity, EntityId, Vec2 } from '@ratecad/core';
import { distance, midpoint, type GripEditTarget } from '@ratecad/geometry';

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
  entityId: EntityId;
  index?: number;
  /** Maps this grip to a command edit target */
  editTarget: GripEditTarget;
}

export function getEntityGrips(entity: Entity): Grip[] {
  switch (entity.type) {
    case 'line':
      return [
        {
          role: 'start',
          point: { ...entity.geometry.start },
          entityId: entity.id,
          editTarget: { kind: 'line-start' },
        },
        {
          role: 'end',
          point: { ...entity.geometry.end },
          entityId: entity.id,
          editTarget: { kind: 'line-end' },
        },
      ];
    case 'rectangle': {
      const { corner1, corner2 } = entity.geometry;
      const corners: Array<{ point: Vec2; index: 0 | 1 | 2 | 3 }> = [
        { point: { x: corner1.x, y: corner1.y }, index: 0 },
        { point: { x: corner2.x, y: corner1.y }, index: 1 },
        { point: { x: corner2.x, y: corner2.y }, index: 2 },
        { point: { x: corner1.x, y: corner2.y }, index: 3 },
      ];
      return corners.map((c) => ({
        role: 'corner' as const,
        point: c.point,
        entityId: entity.id,
        index: c.index,
        editTarget: { kind: 'rect-corner' as const, index: c.index },
      }));
    }
    case 'circle': {
      const { center, radius } = entity.geometry;
      return [
        {
          role: 'center',
          point: { ...center },
          entityId: entity.id,
          editTarget: { kind: 'circle-center' },
        },
        {
          role: 'quadrant',
          point: { x: center.x + radius, y: center.y },
          entityId: entity.id,
          index: 0,
          editTarget: { kind: 'circle-radius' },
        },
        {
          role: 'quadrant',
          point: { x: center.x, y: center.y + radius },
          entityId: entity.id,
          index: 1,
          editTarget: { kind: 'circle-radius' },
        },
        {
          role: 'quadrant',
          point: { x: center.x - radius, y: center.y },
          entityId: entity.id,
          index: 2,
          editTarget: { kind: 'circle-radius' },
        },
        {
          role: 'quadrant',
          point: { x: center.x, y: center.y - radius },
          entityId: entity.id,
          index: 3,
          editTarget: { kind: 'circle-radius' },
        },
      ];
    }
    case 'polyline':
      return entity.geometry.vertices.map((v, index) => ({
        role: 'vertex' as const,
        point: { ...v },
        entityId: entity.id,
        index,
        editTarget: { kind: 'polyline-vertex' as const, index },
      }));
  }
}

export function getSelectionGrips(entities: Entity[]): Grip[] {
  return entities.flatMap(getEntityGrips);
}

export function hitTestGrip(
  grips: Grip[],
  world: Vec2,
  tolerance: number,
): Grip | null {
  let best: Grip | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const grip of grips) {
    const d = distance(world, grip.point);
    if (d <= tolerance && d < bestDist) {
      best = grip;
      bestDist = d;
    }
  }
  return best;
}

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
