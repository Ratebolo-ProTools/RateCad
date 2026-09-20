import type { DrawingDocument, Entity, EntityId, Vec2, WallEntity } from '@ratecad/core';
import {
  aabbFromPoints,
  dimensionLayout,
  doorLayout,
  pointInAABB,
  pointNearCircle,
  pointNearSegment,
  projectOntoWall,
  wallLayout,
  wallOutlineSegments,
  windowLayout,
} from '@ratecad/geometry';

function aabbFromMany(points: Vec2[]): ReturnType<typeof aabbFromPoints> | null {
  if (points.length === 0) return null;
  let minX = points[0]!.x;
  let minY = points[0]!.y;
  let maxX = points[0]!.x;
  let maxY = points[0]!.y;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

export function hitTestEntity(
  entity: Entity,
  point: Vec2,
  tolerance: number,
  hostWall?: WallEntity,
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
        return verts[0]
          ? pointNearSegment(point, verts[0], verts[0], tolerance)
          : false;
      }
      const count = entity.geometry.closed ? verts.length : verts.length - 1;
      for (let i = 0; i < count; i += 1) {
        const a = verts[i]!;
        const b = verts[(i + 1) % verts.length]!;
        if (pointNearSegment(point, a, b, tolerance)) return true;
      }
      return false;
    }
    case 'dimension': {
      const layout = dimensionLayout(entity.geometry);
      if (!layout) return false;
      if (
        pointNearSegment(point, layout.dimStart, layout.dimEnd, tolerance)
      ) {
        return true;
      }
      if (
        pointNearSegment(
          point,
          entity.geometry.start,
          layout.dimStart,
          tolerance,
        )
      ) {
        return true;
      }
      if (
        pointNearSegment(point, entity.geometry.end, layout.dimEnd, tolerance)
      ) {
        return true;
      }
      const dx = point.x - layout.textPos.x;
      const dy = point.y - layout.textPos.y;
      return Math.hypot(dx, dy) <= tolerance * 3;
    }
    case 'text': {
      const h = entity.geometry.height;
      const w = Math.max(h * entity.geometry.content.length * 0.6, h);
      const box = {
        minX: entity.geometry.position.x - h * 0.2,
        minY: entity.geometry.position.y - h * 0.2,
        maxX: entity.geometry.position.x + w,
        maxY: entity.geometry.position.y + h * 1.2,
      };
      return pointInAABB(point, box, tolerance);
    }
    case 'leader': {
      const pts = [entity.geometry.arrow, ...entity.geometry.vertices];
      for (let i = 0; i < pts.length - 1; i += 1) {
        if (pointNearSegment(point, pts[i]!, pts[i + 1]!, tolerance)) {
          return true;
        }
      }
      const last = pts[pts.length - 1]!;
      const h = entity.geometry.textHeight;
      const w = Math.max(h * entity.geometry.content.length * 0.6, h);
      return pointInAABB(
        point,
        {
          minX: last.x,
          minY: last.y,
          maxX: last.x + w,
          maxY: last.y + h,
        },
        tolerance,
      );
    }
    case 'wall': {
      const layout = wallLayout(entity);
      if (!layout) return false;
      // Hit centerline or near wall body
      if (
        pointNearSegment(
          point,
          entity.geometry.start,
          entity.geometry.end,
          tolerance + entity.geometry.thickness / 2,
        )
      ) {
        return true;
      }
      const proj = projectOntoWall(entity, point);
      return !!proj && proj.distance <= entity.geometry.thickness / 2 + tolerance;
    }
    case 'door': {
      if (!hostWall) return false;
      const layout = doorLayout(entity, hostWall);
      if (!layout) return false;
      if (
        pointNearSegment(point, layout.openStart, layout.openEnd, tolerance)
      ) {
        return true;
      }
      if (pointNearSegment(point, layout.hinge, layout.leafEnd, tolerance)) {
        return true;
      }
      return (
        Math.hypot(point.x - layout.center.x, point.y - layout.center.y) <=
        entity.geometry.width / 2 + tolerance
      );
    }
    case 'window': {
      if (!hostWall) return false;
      const layout = windowLayout(entity, hostWall);
      if (!layout) return false;
      return (
        pointNearSegment(point, layout.openStart, layout.openEnd, tolerance) ||
        pointNearSegment(point, layout.outerA, layout.outerB, tolerance) ||
        pointNearSegment(point, layout.innerA, layout.innerB, tolerance)
      );
    }
  }
}

export function hitTestDocument(
  doc: DrawingDocument,
  point: Vec2,
  tolerance: number,
): EntityId | null {
  const walls = new Map(
    doc.entities
      .filter((e): e is WallEntity => e.type === 'wall')
      .map((w) => [w.id, w]),
  );
  for (let i = doc.entities.length - 1; i >= 0; i -= 1) {
    const entity = doc.entities[i]!;
    if (!entity.visible) continue;
    const layer = doc.layers.find((l) => l.id === entity.layerId);
    if (layer && !layer.visible) continue;
    const host =
      entity.type === 'door' || entity.type === 'window'
        ? walls.get(entity.geometry.hostWallId)
        : undefined;
    if (hitTestEntity(entity, point, tolerance, host)) {
      return entity.id;
    }
  }
  return null;
}

export function entityBounds(
  entity: Entity,
): ReturnType<typeof aabbFromPoints> | null {
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
    case 'dimension': {
      const layout = dimensionLayout(entity.geometry);
      if (!layout) {
        return aabbFromPoints(entity.geometry.start, entity.geometry.end);
      }
      const pts = [
        entity.geometry.start,
        entity.geometry.end,
        layout.dimStart,
        layout.dimEnd,
        layout.textPos,
      ];
      let minX = pts[0]!.x;
      let minY = pts[0]!.y;
      let maxX = pts[0]!.x;
      let maxY = pts[0]!.y;
      for (const p of pts) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
      return { minX, minY, maxX, maxY };
    }
    case 'text': {
      const h = entity.geometry.height;
      const w = Math.max(h * entity.geometry.content.length * 0.6, h);
      const p = entity.geometry.position;
      return { minX: p.x, minY: p.y, maxX: p.x + w, maxY: p.y + h };
    }
    case 'leader': {
      const pts = [entity.geometry.arrow, ...entity.geometry.vertices];
      let minX = pts[0]!.x;
      let minY = pts[0]!.y;
      let maxX = pts[0]!.x;
      let maxY = pts[0]!.y;
      for (const p of pts) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
      return { minX, minY, maxX, maxY };
    }
    case 'wall': {
      const layout = wallLayout(entity);
      if (!layout) {
        return aabbFromPoints(entity.geometry.start, entity.geometry.end);
      }
      return aabbFromMany([...layout.corners]);
    }
    case 'door':
    case 'window':
      return null;
  }
}

export function entityBoundsWithHost(
  entity: Entity,
  hostWall?: WallEntity,
): ReturnType<typeof aabbFromPoints> | null {
  if (entity.type === 'door' && hostWall) {
    const layout = doorLayout(entity, hostWall);
    if (!layout) return null;
    return aabbFromMany([
      layout.openStart,
      layout.openEnd,
      layout.hinge,
      layout.leafEnd,
    ]);
  }
  if (entity.type === 'window' && hostWall) {
    const layout = windowLayout(entity, hostWall);
    if (!layout) return null;
    return aabbFromMany([
      layout.outerA,
      layout.outerB,
      layout.innerA,
      layout.innerB,
    ]);
  }
  return entityBounds(entity);
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

  const resolved: SelectionMode =
    mode === 'auto'
      ? cornerB.x >= cornerA.x
        ? 'window'
        : 'crossing'
      : mode;

  const ids: EntityId[] = [];
  const walls = new Map(
    doc.entities
      .filter((e): e is WallEntity => e.type === 'wall')
      .map((w) => [w.id, w]),
  );
  for (const entity of doc.entities) {
    if (!entity.visible) continue;
    const layer = doc.layers.find((l) => l.id === entity.layerId);
    if (layer && !layer.visible) continue;
    const host =
      entity.type === 'door' || entity.type === 'window'
        ? walls.get(entity.geometry.hostWallId)
        : undefined;
    const bounds = entityBoundsWithHost(entity, host);
    if (!bounds) continue;
    const hit =
      resolved === 'window'
        ? bounds.minX >= box.minX &&
          bounds.maxX <= box.maxX &&
          bounds.minY >= box.minY &&
          bounds.maxY <= box.maxY
        : !(
            bounds.maxX < box.minX ||
            bounds.minX > box.maxX ||
            bounds.maxY < box.minY ||
            bounds.minY > box.maxY
          );
    if (hit) ids.push(entity.id);
  }
  return ids;
}
