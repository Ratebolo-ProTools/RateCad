import type { DrawingDocument, Entity, Vec2 } from '@ratecad/core';
import { distance, midpoint, snapToGrid } from './math.js';

/**
 * Shared snap engine — independent of the renderer.
 *
 * Cursor → Snap Engine → Snap Result → CAD Tool → Command → DrawingDocument
 */

export type SnapKind = 'endpoint' | 'midpoint' | 'center' | 'grid';

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
  grid: 3,
};

function collectEntityCandidates(entity: Entity): SnapCandidate[] {
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
    candidates.push(...collectEntityCandidates(entity));
  }
  return candidates;
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

  const objectCandidates = collectSnapCandidates(doc, options);
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
