import type { DrawingDocument, Entity, LengthUnit } from '@ratecad/core';
import { formatWorldLength } from '@ratecad/geometry';

export interface EntityDescription {
  id: string;
  type: Entity['type'];
  layerName: string;
  detail: string;
}

function pointLabel(
  point: { x: number; y: number },
  worldUnit: LengthUnit,
  displayUnit: LengthUnit,
): string {
  const fmt = (value: number) =>
    formatWorldLength(value, worldUnit, displayUnit, { precision: 4 });
  return `(${fmt(point.x)}, ${fmt(point.y)})`;
}

export function describeEntity(
  entity: Entity,
  document: DrawingDocument,
): EntityDescription {
  const worldUnit = document.settings.worldUnit ?? 'ft';
  const displayUnit = document.settings.units;
  const layerName =
    document.layers.find((layer) => layer.id === entity.layerId)?.name ??
    entity.layerId;
  const fmt = (value: number) =>
    formatWorldLength(value, worldUnit, displayUnit, { precision: 4 });
  let detail: string = entity.type;
  if (entity.type === 'line') {
    detail = `Line ${pointLabel(entity.geometry.start, worldUnit, displayUnit)} to ${pointLabel(entity.geometry.end, worldUnit, displayUnit)}`;
  } else if (entity.type === 'rectangle') {
    detail = `Rectangle ${pointLabel(entity.geometry.corner1, worldUnit, displayUnit)} to ${pointLabel(entity.geometry.corner2, worldUnit, displayUnit)}`;
  } else if (entity.type === 'circle') {
    detail = `Circle center ${pointLabel(entity.geometry.center, worldUnit, displayUnit)}, radius ${fmt(entity.geometry.radius)}`;
  } else if (entity.type === 'arc') {
    const sweep =
      (((entity.geometry.endAngle - entity.geometry.startAngle) % (Math.PI * 2)) +
        Math.PI * 2) %
      (Math.PI * 2);
    detail = `Arc center ${pointLabel(entity.geometry.center, worldUnit, displayUnit)}, radius ${fmt(entity.geometry.radius)}, sweep ${(sweep * 180 / Math.PI).toFixed(2)}°`;
  } else if (entity.type === 'polyline') {
    const vertices = entity.geometry.vertices;
    const ends =
      vertices.length > 0
        ? `${pointLabel(vertices[0]!, worldUnit, displayUnit)} → ${pointLabel(vertices[vertices.length - 1]!, worldUnit, displayUnit)}`
        : 'no vertices';
    detail = `${entity.geometry.closed ? 'Closed' : 'Open'} polyline, ${vertices.length} vertices, ${ends}`;
  } else if (entity.type === 'block') {
    const definition = document.blockDefinitions.find(
      (item) => item.id === entity.geometry.definitionId,
    );
    const degrees = (entity.geometry.rotation * 180) / Math.PI;
    detail = `Block ${definition?.name ?? entity.geometry.definitionId}, insertion ${pointLabel(entity.geometry.position, worldUnit, displayUnit)}, scale ${entity.geometry.scaleX}, ${entity.geometry.scaleY}, rotation ${degrees.toFixed(2)}°`;
  }
  return { id: entity.id, type: entity.type, layerName, detail };
}

export function describeSelection(document: DrawingDocument): {
  count: number;
  items: EntityDescription[];
} {
  const selected = new Set(document.selection);
  const items = document.entities
    .filter((entity) => selected.has(entity.id))
    .map((entity) => describeEntity(entity, document));
  return { count: items.length, items };
}
