import type {
  DimensionEntity,
  DimensionKind,
  Entity,
  EntityId,
  Vec2,
} from '@ratecad/core';
import { distance } from './math.js';
import { cross, normalize, pointOnSegment, rotatePoint } from './intersect.js';

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
    case 'dimension':
      return {
        ...entity,
        geometry: {
          ...entity.geometry,
          start: translatePoint(entity.geometry.start, delta),
          end: translatePoint(entity.geometry.end, delta),
        },
      };
    case 'text':
      return {
        ...entity,
        geometry: {
          ...entity.geometry,
          position: translatePoint(entity.geometry.position, delta),
        },
      };
    case 'leader':
      return {
        ...entity,
        geometry: {
          ...entity.geometry,
          arrow: translatePoint(entity.geometry.arrow, delta),
          vertices: entity.geometry.vertices.map((v) => translatePoint(v, delta)),
        },
      };
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
  | { kind: 'polyline-vertex'; index: number }
  | { kind: 'dim-start' }
  | { kind: 'dim-end' }
  | { kind: 'dim-offset' }
  | { kind: 'text-origin' }
  | { kind: 'leader-arrow' }
  | { kind: 'leader-vertex'; index: number };

/**
 * Compute dimension line placement from start/end/kind/offset.
 */
export function dimensionLayout(dim: DimensionEntity['geometry']): {
  dimStart: Vec2;
  dimEnd: Vec2;
  textPos: Vec2;
  measuredDir: Vec2;
  perp: Vec2;
} | null {
  const { start, end, kind, offset, textOffset = 0 } = dim;
  let a = { ...start };
  let b = { ...end };
  if (kind === 'horizontal') {
    const y = start.y;
    a = { x: start.x, y };
    b = { x: end.x, y };
  } else if (kind === 'vertical') {
    const x = start.x;
    a = { x, y: start.y };
    b = { x, y: end.y };
  }
  const dir = normalize({ x: b.x - a.x, y: b.y - a.y });
  if (!dir) return null;
  const perp = { x: -dir.y, y: dir.x };
  const dimStart = {
    x: a.x + perp.x * offset,
    y: a.y + perp.y * offset,
  };
  const dimEnd = {
    x: b.x + perp.x * offset,
    y: b.y + perp.y * offset,
  };
  const mid = pointOnSegment(dimStart, dimEnd, 0.5);
  const textPos = {
    x: mid.x + dir.x * textOffset,
    y: mid.y + dir.y * textOffset,
  };
  return { dimStart, dimEnd, textPos, measuredDir: dir, perp };
}

export function offsetFromPlacement(
  start: Vec2,
  end: Vec2,
  kind: DimensionKind,
  place: Vec2,
): number {
  let a = { ...start };
  let b = { ...end };
  if (kind === 'horizontal') {
    a = { x: start.x, y: start.y };
    b = { x: end.x, y: start.y };
  } else if (kind === 'vertical') {
    a = { x: start.x, y: start.y };
    b = { x: start.x, y: end.y };
  }
  const ab = { x: b.x - a.x, y: b.y - a.y };
  const len = Math.hypot(ab.x, ab.y);
  if (len < 1e-12) {
    // Degenerate measured segment — use placement relative to start
    return distance(start, place);
  }
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const perp = { x: -ab.y / len, y: ab.x / len };
  return (place.x - mid.x) * perp.x + (place.y - mid.y) * perp.y;
}

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
    case 'dimension': {
      if (target.kind === 'dim-start') {
        if (distance(point, entity.geometry.end) < 1e-12) return null;
        return {
          ...entity,
          geometry: { ...entity.geometry, start: { ...point } },
        };
      }
      if (target.kind === 'dim-end') {
        if (distance(entity.geometry.start, point) < 1e-12) return null;
        return {
          ...entity,
          geometry: { ...entity.geometry, end: { ...point } },
        };
      }
      if (target.kind === 'dim-offset') {
        const offset = offsetFromPlacement(
          entity.geometry.start,
          entity.geometry.end,
          entity.geometry.kind,
          point,
        );
        if (!Number.isFinite(offset)) return null;
        return {
          ...entity,
          geometry: { ...entity.geometry, offset },
        };
      }
      return null;
    }
    case 'text': {
      if (target.kind !== 'text-origin') return null;
      return {
        ...entity,
        geometry: { ...entity.geometry, position: { ...point } },
      };
    }
    case 'leader': {
      if (target.kind === 'leader-arrow') {
        return {
          ...entity,
          geometry: { ...entity.geometry, arrow: { ...point } },
        };
      }
      if (target.kind === 'leader-vertex') {
        const verts = entity.geometry.vertices.map((v) => ({ ...v }));
        if (target.index < 0 || target.index >= verts.length) return null;
        verts[target.index] = { ...point };
        return {
          ...entity,
          geometry: { ...entity.geometry, vertices: verts },
        };
      }
      return null;
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
    case 'dimension':
      return (
        isFiniteVec2(entity.geometry.start) &&
        isFiniteVec2(entity.geometry.end) &&
        Number.isFinite(entity.geometry.offset) &&
        distance(entity.geometry.start, entity.geometry.end) > 1e-12
      );
    case 'text':
      return (
        isFiniteVec2(entity.geometry.position) &&
        typeof entity.geometry.content === 'string' &&
        Number.isFinite(entity.geometry.height) &&
        entity.geometry.height > 0 &&
        Number.isFinite(entity.geometry.rotation)
      );
    case 'leader':
      return (
        isFiniteVec2(entity.geometry.arrow) &&
        entity.geometry.vertices.length >= 1 &&
        entity.geometry.vertices.every(isFiniteVec2) &&
        typeof entity.geometry.content === 'string' &&
        Number.isFinite(entity.geometry.textHeight) &&
        entity.geometry.textHeight > 0
      );
  }
}

// re-export helpers used by cadOps for annotation transforms
export { cross, rotatePoint };
