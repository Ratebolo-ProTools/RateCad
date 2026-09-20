import type { Entity, EntityId, Vec2 } from '@ratecad/core';
import { distance } from './math.js';

export function isFiniteVec2(p: Vec2): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

export function translatePoint(p: Vec2, delta: Vec2): Vec2 {
  return { x: p.x + delta.x, y: p.y + delta.y };
}

export function vecDelta(from: Vec2, to: Vec2): Vec2 {
  return { x: to.x - from.x, y: to.y - from.y };
}

/** Translate an entity by a world-space vector. Returns null if invalid. */
export function translateEntity(entity: Entity, delta: Vec2): Entity | null {
  if (!isFiniteVec2(delta)) return null;

  switch (entity.type) {
    case 'line':
      return {
        ...entity,
        geometry: {
          start: translatePoint(entity.geometry.start, delta),
          end: translatePoint(entity.geometry.end, delta),
        },
      };
    case 'rectangle':
      return {
        ...entity,
        geometry: {
          corner1: translatePoint(entity.geometry.corner1, delta),
          corner2: translatePoint(entity.geometry.corner2, delta),
        },
      };
    case 'circle':
      return {
        ...entity,
        geometry: {
          center: translatePoint(entity.geometry.center, delta),
          radius: entity.geometry.radius,
        },
      };
    case 'polyline': {
      if (entity.geometry.vertices.length < 2) return null;
      return {
        ...entity,
        geometry: {
          ...entity.geometry,
          vertices: entity.geometry.vertices.map((v) => translatePoint(v, delta)),
        },
      };
    }
  }
}

export function cloneEntityWithNewId(entity: Entity, newId: EntityId): Entity {
  const cloned = structuredClone(entity);
  cloned.id = newId;
  return cloned;
}

export type GripEditTarget =
  | { kind: 'line-start' }
  | { kind: 'line-end' }
  | { kind: 'rect-corner'; index: 0 | 1 | 2 | 3 }
  | { kind: 'circle-center' }
  | { kind: 'circle-radius' }
  | { kind: 'polyline-vertex'; index: number };

/**
 * Apply a grip edit. Returns null if the result would be invalid geometry.
 */
export function applyGripEdit(
  entity: Entity,
  target: GripEditTarget,
  point: Vec2,
): Entity | null {
  if (!isFiniteVec2(point)) return null;

  switch (entity.type) {
    case 'line': {
      if (target.kind === 'line-start') {
        if (distance(point, entity.geometry.end) < 1e-12) return null;
        return {
          ...entity,
          geometry: { start: { ...point }, end: { ...entity.geometry.end } },
        };
      }
      if (target.kind === 'line-end') {
        if (distance(entity.geometry.start, point) < 1e-12) return null;
        return {
          ...entity,
          geometry: { start: { ...entity.geometry.start }, end: { ...point } },
        };
      }
      return null;
    }
    case 'rectangle': {
      if (target.kind !== 'rect-corner') return null;
      const { corner1, corner2 } = entity.geometry;
      // corners: 0=c1, 1=(c2.x,c1.y), 2=c2, 3=(c1.x,c2.y)
      let next1 = { ...corner1 };
      let next2 = { ...corner2 };
      switch (target.index) {
        case 0:
          next1 = { ...point };
          break;
        case 1:
          next2 = { x: point.x, y: next2.y };
          next1 = { x: next1.x, y: point.y };
          break;
        case 2:
          next2 = { ...point };
          break;
        case 3:
          next1 = { x: point.x, y: next1.y };
          next2 = { x: next2.x, y: point.y };
          break;
      }
      if (Math.abs(next1.x - next2.x) < 1e-12 || Math.abs(next1.y - next2.y) < 1e-12) {
        return null;
      }
      return { ...entity, geometry: { corner1: next1, corner2: next2 } };
    }
    case 'circle': {
      if (target.kind === 'circle-center') {
        return {
          ...entity,
          geometry: { center: { ...point }, radius: entity.geometry.radius },
        };
      }
      if (target.kind === 'circle-radius') {
        const radius = distance(entity.geometry.center, point);
        if (!(radius > 1e-12) || !Number.isFinite(radius)) return null;
        return {
          ...entity,
          geometry: { center: { ...entity.geometry.center }, radius },
        };
      }
      return null;
    }
    case 'polyline': {
      if (target.kind !== 'polyline-vertex') return null;
      const verts = entity.geometry.vertices.map((v) => ({ ...v }));
      if (target.index < 0 || target.index >= verts.length) return null;
      verts[target.index] = { ...point };
      if (verts.length < 2) return null;
      return {
        ...entity,
        geometry: { ...entity.geometry, vertices: verts },
      };
    }
  }
}

export function validateEntityGeometry(entity: Entity): boolean {
  switch (entity.type) {
    case 'line':
      return (
        isFiniteVec2(entity.geometry.start) &&
        isFiniteVec2(entity.geometry.end) &&
        distance(entity.geometry.start, entity.geometry.end) > 1e-12
      );
    case 'rectangle':
      return (
        isFiniteVec2(entity.geometry.corner1) &&
        isFiniteVec2(entity.geometry.corner2) &&
        Math.abs(entity.geometry.corner1.x - entity.geometry.corner2.x) > 1e-12 &&
        Math.abs(entity.geometry.corner1.y - entity.geometry.corner2.y) > 1e-12
      );
    case 'circle':
      return (
        isFiniteVec2(entity.geometry.center) &&
        Number.isFinite(entity.geometry.radius) &&
        entity.geometry.radius > 1e-12
      );
    case 'polyline':
      return (
        entity.geometry.vertices.length >= 2 &&
        entity.geometry.vertices.every(isFiniteVec2)
      );
  }
}
