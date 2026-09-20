import type { Entity, EntityId, Vec2, WallEntity } from '@ratecad/core';
import {
  clampHostedPosition,
  dimensionLayout,
  distance,
  midpoint,
  pointAlongWall,
  wallLength,
  type GripEditTarget,
} from '@ratecad/geometry';

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
    case 'dimension': {
      const layout = dimensionLayout(entity.geometry);
      const mid = layout
        ? {
            x: (layout.dimStart.x + layout.dimEnd.x) / 2,
            y: (layout.dimStart.y + layout.dimEnd.y) / 2,
          }
        : midpoint(entity.geometry.start, entity.geometry.end);
      return [
        {
          role: 'start' as const,
          point: { ...entity.geometry.start },
          entityId: entity.id,
          editTarget: { kind: 'dim-start' as const },
        },
        {
          role: 'end' as const,
          point: { ...entity.geometry.end },
          entityId: entity.id,
          editTarget: { kind: 'dim-end' as const },
        },
        {
          role: 'center' as const,
          point: mid,
          entityId: entity.id,
          editTarget: { kind: 'dim-offset' as const },
        },
      ];
    }
    case 'text':
      return [
        {
          role: 'center' as const,
          point: { ...entity.geometry.position },
          entityId: entity.id,
          editTarget: { kind: 'text-origin' as const },
        },
      ];
    case 'leader':
      return [
        {
          role: 'start' as const,
          point: { ...entity.geometry.arrow },
          entityId: entity.id,
          editTarget: { kind: 'leader-arrow' as const },
        },
        ...entity.geometry.vertices.map((v, index) => ({
          role: 'vertex' as const,
          point: { ...v },
          entityId: entity.id,
          index,
          editTarget: { kind: 'leader-vertex' as const, index },
        })),
      ];
    case 'wall':
      return [
        {
          role: 'start' as const,
          point: { ...entity.geometry.start },
          entityId: entity.id,
          editTarget: { kind: 'wall-start' as const },
        },
        {
          role: 'end' as const,
          point: { ...entity.geometry.end },
          entityId: entity.id,
          editTarget: { kind: 'wall-end' as const },
        },
      ];
    case 'door':
    case 'window':
      // World grip requires host wall — filled in by getSelectionGrips(doc)
      return [];
    case 'room':
      return [
        {
          role: 'center' as const,
          point: { ...entity.geometry.labelPosition },
          entityId: entity.id,
          editTarget: { kind: 'room-label' as const },
        },
      ];
  }
}

export function getSelectionGrips(
  entities: Entity[],
  allEntities?: Entity[],
): Grip[] {
  const walls = new Map(
    (allEntities ?? entities)
      .filter((e): e is WallEntity => e.type === 'wall')
      .map((w) => [w.id, w]),
  );
  const grips: Grip[] = [];
  for (const entity of entities) {
    grips.push(...getEntityGrips(entity));
    if (entity.type === 'door' || entity.type === 'window') {
      const wall = walls.get(entity.geometry.hostWallId);
      if (!wall) continue;
      const t = clampHostedPosition(
        wallLength(wall),
        entity.geometry.width,
        entity.geometry.position,
      );
      grips.push({
        role: 'center',
        point: pointAlongWall(wall, t),
        entityId: entity.id,
        editTarget:
          entity.type === 'door'
            ? { kind: 'door-position' }
            : { kind: 'window-position' },
      });
    }
  }
  return grips;
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
