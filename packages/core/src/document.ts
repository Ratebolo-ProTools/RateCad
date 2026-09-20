import type {
  DrawingDocument,
  DrawingMeta,
  DrawingSettings,
  Entity,
  EntityId,
  Layer,
  LayerId,
} from './types.js';
import {
  APP_VERSION,
  DEFAULT_LAYER_ID,
  SCHEMA_VERSION,
} from './types.js';

let idCounter = 0;

export function createEntityId(prefix = 'ent'): EntityId {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

export function resetIdCounter(): void {
  idCounter = 0;
}

export function createDefaultLayer(): Layer {
  return {
    id: DEFAULT_LAYER_ID,
    name: '0',
    color: '#d4d4d4',
    visible: true,
    locked: false,
  };
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

  return {
    schemaVersion: SCHEMA_VERSION,
    meta,
    settings: {
      units: 'ft',
      precision: 2,
      gridSize: 1,
      snapToGrid: true,
      ...settings,
    },
    layers: [createDefaultLayer()],
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
