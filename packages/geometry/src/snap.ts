import type { DrawingDocument, Entity, Vec2 } from '@ratecad/core';
import { blockContentLocalPoints, transformBlockPoint } from './blockTransform.js';
import { closestPointOnSegment, intersectSegments } from './intersect.js';
import { distance, midpoint, snapToGrid } from './math.js';

/**
 * Shared snap engine — independent of the renderer.
 *
 * Cursor → Snap Engine → Snap Result → CAD Tool → Command → DrawingDocument
 */

export type SnapKind =
  | 'endpoint'
  | 'midpoint'
  | 'center'
  | 'intersection'
  | 'nearest'
  | 'grid';

export interface SnapCandidate {
  kind: SnapKind;
  point: Vec2;
  /** Lower is higher priority when distances are equal */
  priority: number;
  entityId?: string;
  label: string;
}

export interface SnapResult {
  point: Vec2;
  snapped: boolean;
  kind: SnapKind | null;
  label: string | null;
  candidate: SnapCandidate | null;
}

export interface SnapOptions {
  enabled: boolean;
  gridSize: number;
  /** World-unit tolerance (typically screen pixels / zoom) */
  tolerance: number;
}

const KIND_PRIORITY: Record<SnapKind, number> = {
  endpoint: 0,
  midpoint: 1,
  center: 2,
  intersection: 3,
  nearest: 4,
  grid: 5,
};

function collectEntityCandidates(
  entity: Entity,
  doc: DrawingDocument,
): SnapCandidate[] {
  const out: SnapCandidate[] = [];
  switch (entity.type) {
    case 'line': {
      const { start, end } = entity.geometry;
      out.push(
        {
          kind: 'endpoint',
          point: { ...start },
          priority: KIND_PRIORITY.endpoint,
          entityId: entity.id,
          label: 'Endpoint',
        },
        {
          kind: 'endpoint',
          point: { ...end },
          priority: KIND_PRIORITY.endpoint,
          entityId: entity.id,
          label: 'Endpoint',
        },
        {
          kind: 'midpoint',
          point: midpoint(start, end),
          priority: KIND_PRIORITY.midpoint,
          entityId: entity.id,
          label: 'Midpoint',
        },
      );
      break;
    }
    case 'rectangle': {
      const { corner1, corner2 } = entity.geometry;
      const corners = [
        { x: corner1.x, y: corner1.y },
        { x: corner2.x, y: corner1.y },
        { x: corner2.x, y: corner2.y },
        { x: corner1.x, y: corner2.y },
      ];
      for (const c of corners) {
        out.push({
          kind: 'endpoint',
          point: c,
          priority: KIND_PRIORITY.endpoint,
          entityId: entity.id,
          label: 'Endpoint',
        });
      }
      for (let i = 0; i < 4; i += 1) {
        const a = corners[i]!;
        const b = corners[(i + 1) % 4]!;
        out.push({
          kind: 'midpoint',
          point: midpoint(a, b),
          priority: KIND_PRIORITY.midpoint,
          entityId: entity.id,
          label: 'Midpoint',
        });
      }
      break;
    }
    case 'circle': {
      out.push({
        kind: 'center',
        point: { ...entity.geometry.center },
        priority: KIND_PRIORITY.center,
        entityId: entity.id,
        label: 'Center',
      });
      break;
    }
    case 'arc': {
      const { center, radius, startAngle, endAngle } = entity.geometry;
      const start = {
        x: center.x + radius * Math.cos(startAngle),
        y: center.y + radius * Math.sin(startAngle),
      };
      const end = {
        x: center.x + radius * Math.cos(endAngle),
        y: center.y + radius * Math.sin(endAngle),
      };
      const sweep = ((endAngle - startAngle) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
      const midAngle = startAngle + (sweep === 0 ? Math.PI : sweep) / 2;
      out.push(
        {
          kind: 'endpoint',
          point: start,
          priority: KIND_PRIORITY.endpoint,
          entityId: entity.id,
          label: 'Endpoint',
        },
        {
          kind: 'endpoint',
          point: end,
          priority: KIND_PRIORITY.endpoint,
          entityId: entity.id,
          label: 'Endpoint',
        },
        {
          kind: 'midpoint',
          point: {
            x: center.x + radius * Math.cos(midAngle),
            y: center.y + radius * Math.sin(midAngle),
          },
          priority: KIND_PRIORITY.midpoint,
          entityId: entity.id,
          label: 'Midpoint',
        },
        {
          kind: 'center',
          point: { ...center },
          priority: KIND_PRIORITY.center,
          entityId: entity.id,
          label: 'Center',
        },
      );
      break;
    }
    case 'polyline': {
      const verts = entity.geometry.vertices;
      for (const v of verts) {
        out.push({
          kind: 'endpoint',
          point: { ...v },
          priority: KIND_PRIORITY.endpoint,
          entityId: entity.id,
          label: 'Endpoint',
        });
      }
      const n = entity.geometry.closed ? verts.length : verts.length - 1;
      for (let i = 0; i < n; i += 1) {
        const a = verts[i]!;
        const b = verts[(i + 1) % verts.length]!;
        out.push({
          kind: 'midpoint',
          point: midpoint(a, b),
          priority: KIND_PRIORITY.midpoint,
          entityId: entity.id,
          label: 'Midpoint',
        });
      }
      break;
    }
    case 'dimension': {
      const { start, end } = entity.geometry;
      out.push(
        {
          kind: 'endpoint',
          point: { ...start },
          priority: KIND_PRIORITY.endpoint,
          entityId: entity.id,
          label: 'Endpoint',
        },
        {
          kind: 'endpoint',
          point: { ...end },
          priority: KIND_PRIORITY.endpoint,
          entityId: entity.id,
          label: 'Endpoint',
        },
        {
          kind: 'midpoint',
          point: midpoint(start, end),
          priority: KIND_PRIORITY.midpoint,
          entityId: entity.id,
          label: 'Midpoint',
        },
      );
      break;
    }
    case 'text': {
      out.push({
        kind: 'endpoint',
        point: { ...entity.geometry.position },
        priority: KIND_PRIORITY.endpoint,
        entityId: entity.id,
        label: 'Endpoint',
      });
      break;
    }
    case 'leader': {
      out.push({
        kind: 'endpoint',
        point: { ...entity.geometry.arrow },
        priority: KIND_PRIORITY.endpoint,
        entityId: entity.id,
        label: 'Endpoint',
      });
      for (const v of entity.geometry.vertices) {
        out.push({
          kind: 'endpoint',
          point: { ...v },
          priority: KIND_PRIORITY.endpoint,
          entityId: entity.id,
          label: 'Endpoint',
        });
      }
      break;
    }
    case 'wall': {
      const { start, end } = entity.geometry;
      out.push(
        {
          kind: 'endpoint',
          point: { ...start },
          priority: KIND_PRIORITY.endpoint,
          entityId: entity.id,
          label: 'Endpoint',
        },
        {
          kind: 'endpoint',
          point: { ...end },
          priority: KIND_PRIORITY.endpoint,
          entityId: entity.id,
          label: 'Endpoint',
        },
        {
          kind: 'midpoint',
          point: midpoint(start, end),
          priority: KIND_PRIORITY.midpoint,
          entityId: entity.id,
          label: 'Midpoint',
        },
      );
      break;
    }
    case 'door':
    case 'window':
      // World position is derived from host wall — snap candidates come from walls.
      break;
    case 'room':
      out.push({
        kind: 'center',
        point: { ...entity.geometry.labelPosition },
        priority: KIND_PRIORITY.center,
        entityId: entity.id,
        label: 'Room label',
      });
      break;
    case 'block': {
      out.push({
        kind: 'endpoint',
        point: { ...entity.geometry.position },
        priority: KIND_PRIORITY.endpoint,
        entityId: entity.id,
        label: 'Insertion',
      });
      const definition = doc.blockDefinitions.find(
        (item) => item.id === entity.geometry.definitionId,
      );
      if (!definition) break;
      for (const content of definition.entities) {
        if (content.type === 'circle') {
          out.push({
            kind: 'center',
            point: transformBlockPoint(content.geometry.center, entity),
            priority: KIND_PRIORITY.center,
            entityId: entity.id,
            label: 'Center',
          });
        }
        for (const local of blockContentLocalPoints(content)) {
          out.push({
            kind: 'endpoint',
            point: transformBlockPoint(local, entity),
            priority: KIND_PRIORITY.endpoint,
            entityId: entity.id,
            label: 'Endpoint',
          });
        }
      }
      break;
    }
  }
  return out;
}

export function collectSnapCandidates(
  doc: DrawingDocument,
  options: SnapOptions,
): SnapCandidate[] {
  if (!options.enabled) return [];
  const candidates: SnapCandidate[] = [];
  for (const entity of doc.entities) {
    if (!entity.visible) continue;
    const layer = doc.layers.find((l) => l.id === entity.layerId);
    if (layer && !layer.visible) continue;
    candidates.push(...collectEntityCandidates(entity, doc));
  }
  return candidates;
}

function visibleSegments(
  doc: DrawingDocument,
): Array<{ a: Vec2; b: Vec2 }> {
  const segments: Array<{ a: Vec2; b: Vec2 }> = [];
  for (const entity of doc.entities) {
    if (!entity.visible) continue;
    const layer = doc.layers.find((l) => l.id === entity.layerId);
    if (layer && !layer.visible) continue;
    if (entity.type === 'line') {
      segments.push({
        a: entity.geometry.start,
        b: entity.geometry.end,
      });
    } else if (entity.type === 'rectangle') {
      const { corner1, corner2 } = entity.geometry;
      const corners = [
        { x: corner1.x, y: corner1.y },
        { x: corner2.x, y: corner1.y },
        { x: corner2.x, y: corner2.y },
        { x: corner1.x, y: corner2.y },
      ];
      for (let i = 0; i < 4; i += 1) {
        segments.push({ a: corners[i]!, b: corners[(i + 1) % 4]! });
      }
    } else if (entity.type === 'polyline') {
      const verts = entity.geometry.vertices;
      const count = entity.geometry.closed ? verts.length : verts.length - 1;
      for (let i = 0; i < count; i += 1) {
        segments.push({ a: verts[i]!, b: verts[(i + 1) % verts.length]! });
      }
    }
  }
  return segments;
}

function nearestOnSegments(
  cursor: Vec2,
  segments: Array<{ a: Vec2; b: Vec2 }>,
  tolerance: number,
): Vec2 | null {
  let best: Vec2 | null = null;
  let bestDist = tolerance;
  for (const seg of segments) {
    const point = closestPointOnSegment(cursor, seg.a, seg.b);
    const d = distance(cursor, point);
    if (d <= bestDist) {
      best = point;
      bestDist = d;
    }
  }
  return best;
}

function intersectionCandidates(
  segments: Array<{ a: Vec2; b: Vec2 }>,
  cursor: Vec2,
  tolerance: number,
): SnapCandidate[] {
  const out: SnapCandidate[] = [];
  for (let i = 0; i < segments.length; i += 1) {
    for (let j = i + 1; j < segments.length; j += 1) {
      const hit = intersectSegments(
        segments[i]!.a,
        segments[i]!.b,
        segments[j]!.a,
        segments[j]!.b,
      );
      if (!hit || distance(cursor, hit) > tolerance) continue;
      out.push({
        kind: 'intersection',
        point: hit,
        priority: KIND_PRIORITY.intersection,
        label: 'Intersection',
      });
    }
  }
  return out;
}

export function resolveSnap(
  cursor: Vec2,
  doc: DrawingDocument,
  options: SnapOptions,
): SnapResult {
  if (!options.enabled) {
    return {
      point: { ...cursor },
      snapped: false,
      kind: null,
      label: null,
      candidate: null,
    };
  }

  const segments = visibleSegments(doc);
  const objectCandidates = [
    ...collectSnapCandidates(doc, options),
    ...intersectionCandidates(segments, cursor, options.tolerance),
  ];
  let best: SnapCandidate | null = null;
  let bestDist = Number.POSITIVE_INFINITY;

  for (const c of objectCandidates) {
    const d = distance(cursor, c.point);
    if (d > options.tolerance) continue;
    if (
      !best ||
      d < bestDist - 1e-12 ||
      (Math.abs(d - bestDist) < 1e-12 && c.priority < best.priority)
    ) {
      best = c;
      bestDist = d;
    }
  }

  if (best) {
    return {
      point: { ...best.point },
      snapped: true,
      kind: best.kind,
      label: best.label,
      candidate: best,
    };
  }

  const nearest = nearestOnSegments(cursor, segments, options.tolerance);
  if (nearest) {
    return {
      point: nearest,
      snapped: true,
      kind: 'nearest',
      label: 'Nearest',
      candidate: {
        kind: 'nearest',
        point: nearest,
        priority: KIND_PRIORITY.nearest,
        label: 'Nearest',
      },
    };
  }

  const gridPoint = snapToGrid(cursor, options.gridSize);
  return {
    point: gridPoint,
    snapped: true,
    kind: 'grid',
    label: 'Grid',
    candidate: {
      kind: 'grid',
      point: gridPoint,
      priority: KIND_PRIORITY.grid,
      label: 'Grid',
    },
  };
}

function dedupeSnapCandidates(candidates: SnapCandidate[]): SnapCandidate[] {
  const unique = new Map<string, SnapCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.point.x.toFixed(4)},${candidate.point.y.toFixed(4)}`;
    const previous = unique.get(key);
    if (!previous || candidate.priority < previous.priority) {
      unique.set(key, candidate);
    }
  }
  return [...unique.values()];
}

/** Object snaps inside the screen-space aperture, nearest first. Grid is excluded. */
export function snapCandidatesInAperture(
  cursor: Vec2,
  doc: DrawingDocument,
  options: SnapOptions,
): SnapCandidate[] {
  if (!options.enabled) return [];
  const segments = visibleSegments(doc);
  const pooled = [
    ...collectSnapCandidates(doc, options),
    ...intersectionCandidates(segments, cursor, options.tolerance),
  ];
  const nearest = nearestOnSegments(cursor, segments, options.tolerance);
  if (nearest) {
    pooled.push({
      kind: 'nearest',
      point: nearest,
      priority: KIND_PRIORITY.nearest,
      label: 'Nearest',
    });
  }
  return dedupeSnapCandidates(pooled)
    .filter((candidate) => distance(cursor, candidate.point) <= options.tolerance)
    .sort((a, b) => {
      const da = distance(cursor, a.point);
      const db = distance(cursor, b.point);
      if (Math.abs(da - db) > 1e-9) return da - db;
      return a.priority - b.priority;
    });
}

/** Tab cycle. Index 0 matches the nearest in-aperture candidate. */
export function resolveSnapCycle(
  cursor: Vec2,
  doc: DrawingDocument,
  options: SnapOptions,
  cycleIndex: number,
): SnapResult {
  const list = snapCandidatesInAperture(cursor, doc, options);
  if (list.length === 0) return resolveSnap(cursor, doc, options);
  const index = ((cycleIndex % list.length) + list.length) % list.length;
  const best = list[index]!;
  return {
    point: { ...best.point },
    snapped: true,
    kind: best.kind,
    label: best.label,
    candidate: best,
  };
}
