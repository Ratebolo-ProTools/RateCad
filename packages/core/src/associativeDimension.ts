/**
 * Associative paper/layout dimension foundation.
 * Paper dimensions may reference a Model entity through a viewport.
 */

import type {
  DimensionEntity,
  DrawingDocument,
  Entity,
  EntityId,
  Layout,
  LayoutId,
  Vec2,
} from './types.js';
import type { ViewportId } from './layout.js';
import { getLayout } from './layout.js';

export type AssociativeDimKind = 'horizontal' | 'vertical' | 'aligned';

export interface AssociativeDimensionRef {
  viewportId?: ViewportId;
  modelEntityId: EntityId;
  kind: AssociativeDimKind;
  /** When false, measurement is frozen / non-associative. */
  valid: boolean;
  /** Optional tip when reference breaks. */
  brokenReason?: string;
}

export function getAssociativeRef(
  entity: Entity,
): AssociativeDimensionRef | null {
  const raw = entity.metadata?.associative;
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.modelEntityId !== 'string') return null;
  const kind =
    r.kind === 'horizontal' || r.kind === 'vertical' || r.kind === 'aligned'
      ? r.kind
      : 'aligned';
  return {
    viewportId: typeof r.viewportId === 'string' ? r.viewportId : undefined,
    modelEntityId: r.modelEntityId,
    kind,
    valid: r.valid !== false,
    brokenReason:
      typeof r.brokenReason === 'string' ? r.brokenReason : undefined,
  };
}

export function withAssociativeRef(
  entity: DimensionEntity,
  ref: AssociativeDimensionRef,
): DimensionEntity {
  return {
    ...entity,
    metadata: {
      ...(entity.metadata ?? {}),
      paperSpace: true,
      associative: { ...ref },
    },
  };
}

function endpointsFromModelEntity(
  entity: Entity,
): { start: Vec2; end: Vec2 } | null {
  switch (entity.type) {
    case 'line':
    case 'wall':
      return {
        start: { ...entity.geometry.start },
        end: { ...entity.geometry.end },
      };
    case 'rectangle':
      return {
        start: { ...entity.geometry.corner1 },
        end: { ...entity.geometry.corner2 },
      };
    case 'polyline': {
      const v = entity.geometry.vertices;
      if (v.length < 2) return null;
      return { start: { ...v[0]! }, end: { ...v[v.length - 1]! } };
      }
    default:
      return null;
  }
}

/**
 * Refresh associative paper dimensions for one layout.
 * Invalid references are marked non-associative — measurement is left unchanged.
 */
export function refreshAssociativePaperDimensions(
  doc: DrawingDocument,
  layoutId: LayoutId,
): DrawingDocument {
  const layout = getLayout(doc.layouts ?? [], layoutId);
  if (!layout) return doc;
  let changed = false;
  const nextEntities = layout.paperSpaceEntities.map((e) => {
    if (e.type !== 'dimension') return e;
    const ref = getAssociativeRef(e);
    if (!ref || !ref.valid) return e;
    const model = doc.entities.find((m) => m.id === ref.modelEntityId);
    if (!model) {
      changed = true;
      return {
        ...e,
        metadata: {
          ...(e.metadata ?? {}),
          associative: {
            ...ref,
            valid: false,
            brokenReason: 'Model entity missing',
          },
        },
      } as DimensionEntity;
    }
    const ends = endpointsFromModelEntity(model);
    if (!ends) {
      changed = true;
      return {
        ...e,
        metadata: {
          ...(e.metadata ?? {}),
          associative: {
            ...ref,
            valid: false,
            brokenReason: 'Unsupported model entity type',
          },
        },
      } as DimensionEntity;
    }
    // Paper dim stores paper-space measurement points — for foundation we keep
    // the paper placement but update stored measured endpoints in metadata.
    const next: DimensionEntity = {
      ...e,
      metadata: {
        ...(e.metadata ?? {}),
        associative: { ...ref, valid: true },
        modelMeasurement: {
          start: ends.start,
          end: ends.end,
          length: Math.hypot(
            ends.end.x - ends.start.x,
            ends.end.y - ends.start.y,
          ),
        },
      },
    };
    changed = true;
    return next;
  });
  if (!changed) return doc;
  const layouts = (doc.layouts ?? []).map((l) =>
    l.id === layoutId ? { ...l, paperSpaceEntities: nextEntities } : l,
  );
  return { ...doc, layouts };
}

export function refreshAllAssociativePaperDimensions(
  doc: DrawingDocument,
): DrawingDocument {
  let next = doc;
  for (const layout of doc.layouts ?? []) {
    next = refreshAssociativePaperDimensions(next, layout.id);
  }
  return next;
}

export function listAssociativePaperDimensions(
  layout: Layout,
): DimensionEntity[] {
  return layout.paperSpaceEntities.filter(
    (e): e is DimensionEntity =>
      e.type === 'dimension' && getAssociativeRef(e) != null,
  );
}
