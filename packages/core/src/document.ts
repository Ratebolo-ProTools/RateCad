import type {
  DoorEntity,
  DrawingDocument,
  DrawingMeta,
  DrawingSettings,
  Entity,
  EntityId,
  Layer,
  LayerId,
  RoomEntity,
  WallEntity,
  WindowEntity,
} from './types.js';
import {
  APP_VERSION,
  DEFAULT_CONSTRUCTION,
  DEFAULT_DIMENSION_STYLE,
  DEFAULT_LAYER_ID,
  DOORS_LAYER_ID,
  ROOMS_LAYER_ID,
  SCHEMA_VERSION,
  WALLS_LAYER_ID,
  WINDOWS_LAYER_ID,
} from './types.js';

let idCounter = 0;

export function createEntityId(prefix = 'ent'): EntityId {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

export function createLayerId(prefix = 'layer'): LayerId {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}` as LayerId;
}

export function resetIdCounter(): void {
  idCounter = 0;
}

export function createDefaultLayers(): Layer[] {
  return [
    { id: DEFAULT_LAYER_ID, name: '0', color: '#d4d4d4', visible: true, locked: false },
    { id: WALLS_LAYER_ID, name: 'Walls', color: '#e8e8e8', visible: true, locked: false },
    { id: DOORS_LAYER_ID, name: 'Doors', color: '#8ec8ff', visible: true, locked: false },
    { id: WINDOWS_LAYER_ID, name: 'Windows', color: '#7ad4c8', visible: true, locked: false },
    { id: ROOMS_LAYER_ID, name: 'Rooms', color: '#c9a86c', visible: true, locked: false },
    { id: 'layer-dimensions' as LayerId, name: 'Dimensions', color: '#f0c674', visible: true, locked: false },
    { id: 'layer-text' as LayerId, name: 'Text', color: '#c8ced6', visible: true, locked: false },
    { id: 'layer-construction' as LayerId, name: 'Construction', color: '#6a737d', visible: true, locked: false },
    { id: 'layer-annotations' as LayerId, name: 'Annotations', color: '#d2a8ff', visible: true, locked: false },
  ];
}

/** @deprecated use createDefaultLayers — kept for callers expecting a single layer */
export function createDefaultLayer(): Layer {
  return createDefaultLayers()[0]!;
}

export function createEmptyDocument(
  name = 'Untitled Drawing',
  settings?: Partial<DrawingSettings>,
): DrawingDocument {
  const now = new Date().toISOString();
  const meta: DrawingMeta = {
    name,
    createdAt: now,
    updatedAt: now,
    appVersion: APP_VERSION,
  };

  const layers = createDefaultLayers();

  return {
    schemaVersion: SCHEMA_VERSION,
    meta,
    settings: {
      units: 'ft',
      precision: 2,
      gridSize: 1,
      snapToGrid: true,
      ...settings,
      dimensionStyle: {
        ...DEFAULT_DIMENSION_STYLE,
        ...(settings?.dimensionStyle ?? {}),
      },
      constructionDefaults: {
        ...DEFAULT_CONSTRUCTION,
        ...(settings?.constructionDefaults ?? {}),
      },
    },
    layers,
    currentLayerId: DEFAULT_LAYER_ID,
    entities: [],
    selection: [],
  };
}

export function cloneDocument(doc: DrawingDocument): DrawingDocument {
  return structuredClone(doc);
}

export function touchDocument(doc: DrawingDocument): DrawingDocument {
  return {
    ...doc,
    meta: {
      ...doc.meta,
      updatedAt: new Date().toISOString(),
    },
  };
}

export function getEntity(
  doc: DrawingDocument,
  id: EntityId,
): Entity | undefined {
  return doc.entities.find((e) => e.id === id);
}

export function getLayer(
  doc: DrawingDocument,
  id: LayerId,
): Layer | undefined {
  return doc.layers.find((l) => l.id === id);
}

export function getCurrentLayer(doc: DrawingDocument): Layer {
  return getLayer(doc, doc.currentLayerId) ?? doc.layers[0]!;
}

export function getSelectedEntities(doc: DrawingDocument): Entity[] {
  const selected = new Set(doc.selection);
  return doc.entities.filter((e) => selected.has(e.id));
}

export function setSelection(
  doc: DrawingDocument,
  ids: EntityId[],
): DrawingDocument {
  return {
    ...doc,
    selection: [...ids],
  };
}

export function toggleSelectionId(
  doc: DrawingDocument,
  id: EntityId,
): DrawingDocument {
  const set = new Set(doc.selection);
  if (set.has(id)) {
    set.delete(id);
  } else {
    set.add(id);
  }
  return setSelection(doc, [...set]);
}

export function clearSelection(doc: DrawingDocument): DrawingDocument {
  return setSelection(doc, []);
}

export function addEntity(
  doc: DrawingDocument,
  entity: Entity,
): DrawingDocument {
  return touchDocument({
    ...doc,
    entities: [...doc.entities, entity],
  });
}

export function removeEntities(
  doc: DrawingDocument,
  ids: EntityId[],
): DrawingDocument {
  const remove = new Set(ids);
  return touchDocument({
    ...doc,
    entities: doc.entities.filter((e) => !remove.has(e.id)),
    selection: doc.selection.filter((id) => !remove.has(id)),
  });
}

export function replaceEntity(
  doc: DrawingDocument,
  entity: Entity,
): DrawingDocument {
  const index = doc.entities.findIndex((e) => e.id === entity.id);
  if (index < 0) {
    return doc;
  }
  const entities = [...doc.entities];
  entities[index] = entity;
  return touchDocument({ ...doc, entities });
}

export function setCurrentLayer(
  doc: DrawingDocument,
  layerId: LayerId,
): DrawingDocument {
  if (!getLayer(doc, layerId)) return doc;
  return touchDocument({ ...doc, currentLayerId: layerId });
}

export function addLayer(doc: DrawingDocument, layer: Layer): DrawingDocument {
  if (doc.layers.some((l) => l.id === layer.id)) return doc;
  return touchDocument({
    ...doc,
    layers: [...doc.layers, layer],
  });
}

export function updateLayer(
  doc: DrawingDocument,
  layerId: LayerId,
  patch: Partial<Omit<Layer, 'id'>>,
): DrawingDocument {
  const layers = doc.layers.map((l) =>
    l.id === layerId ? { ...l, ...patch, id: l.id } : l,
  );
  return touchDocument({ ...doc, layers });
}

export function removeLayer(
  doc: DrawingDocument,
  layerId: LayerId,
  moveToLayerId?: LayerId,
): DrawingDocument {
  if (layerId === DEFAULT_LAYER_ID) {
    throw new Error('Cannot delete the default layer "0"');
  }
  const hasEntities = doc.entities.some((e) => e.layerId === layerId);
  if (hasEntities) {
    if (!moveToLayerId || !getLayer(doc, moveToLayerId)) {
      throw new Error('Move entities to another layer before deleting');
    }
  }
  const target = moveToLayerId ?? DEFAULT_LAYER_ID;
  const entities = doc.entities.map((e) =>
    e.layerId === layerId ? { ...e, layerId: target } : e,
  );
  const layers = doc.layers.filter((l) => l.id !== layerId);
  const currentLayerId =
    doc.currentLayerId === layerId ? target : doc.currentLayerId;
  return touchDocument({
    ...doc,
    layers,
    entities,
    currentLayerId,
  });
}

export function isEntityModifiable(doc: DrawingDocument, entity: Entity): boolean {
  if (entity.locked) return false;
  const layer = getLayer(doc, entity.layerId);
  if (!layer) return true;
  if (!layer.visible) return false;
  if (layer.locked) return false;
  return true;
}

export function isEntitySelectable(doc: DrawingDocument, entity: Entity): boolean {
  if (!entity.visible) return false;
  const layer = getLayer(doc, entity.layerId);
  if (layer && !layer.visible) return false;
  return true;
}

export function getWall(doc: DrawingDocument, id: EntityId): WallEntity | undefined {
  const e = getEntity(doc, id);
  return e?.type === 'wall' ? e : undefined;
}

export function getRoom(doc: DrawingDocument, id: EntityId): RoomEntity | undefined {
  const e = getEntity(doc, id);
  return e?.type === 'room' ? e : undefined;
}

/** Doors and windows hosted by a given wall. */
export function getHostedByWall(
  doc: DrawingDocument,
  wallId: EntityId,
): Array<DoorEntity | WindowEntity> {
  return doc.entities.filter(
    (e): e is DoorEntity | WindowEntity =>
      (e.type === 'door' || e.type === 'window') &&
      e.geometry.hostWallId === wallId,
  );
}

export function getHostedDoorIds(doc: DrawingDocument, wallId: EntityId): EntityId[] {
  return getHostedByWall(doc, wallId)
    .filter((e) => e.type === 'door')
    .map((e) => e.id);
}

export function getHostedWindowIds(
  doc: DrawingDocument,
  wallId: EntityId,
): EntityId[] {
  return getHostedByWall(doc, wallId)
    .filter((e) => e.type === 'window')
    .map((e) => e.id);
}

/** Rooms that reference any of the given wall IDs in their boundary. */
export function findRoomsUsingWalls(
  doc: DrawingDocument,
  wallIds: EntityId[],
): RoomEntity[] {
  const set = new Set(wallIds);
  return doc.entities.filter(
    (e): e is RoomEntity =>
      e.type === 'room' && e.geometry.wallIds.some((id) => set.has(id)),
  );
}

/** Wall deletion must cascade hosted doors/windows — collect full set. */
export function expandDeleteIds(
  doc: DrawingDocument,
  ids: EntityId[],
): EntityId[] {
  const out = new Set(ids);
  for (const id of ids) {
    const ent = getEntity(doc, id);
    if (ent?.type === 'wall') {
      for (const hosted of getHostedByWall(doc, id)) {
        out.add(hosted.id);
      }
      // Rooms that lose a boundary wall become invalid — delete them too
      for (const room of findRoomsUsingWalls(doc, [id])) {
        out.add(room.id);
      }
    }
  }
  return [...out];
}

export function findOrphanHosted(
  doc: DrawingDocument,
): Array<DoorEntity | WindowEntity> {
  return doc.entities.filter((e): e is DoorEntity | WindowEntity => {
    if (e.type !== 'door' && e.type !== 'window') return false;
    return !getWall(doc, e.geometry.hostWallId);
  });
}

/** Rooms whose wallIds reference missing walls. */
export function findInvalidRooms(doc: DrawingDocument): RoomEntity[] {
  return doc.entities.filter((e): e is RoomEntity => {
    if (e.type !== 'room') return false;
    if (e.geometry.wallIds.length < 3) return true;
    if (e.geometry.wallIds.length !== e.geometry.wallDirs.length) return true;
    return e.geometry.wallIds.some((id) => !getWall(doc, id));
  });
}
