export type {
  CircleEntity,
  DrawingDocument,
  DrawingMeta,
  DrawingSettings,
  Entity,
  EntityBase,
  EntityId,
  EntityType,
  Layer,
  LayerId,
  LengthUnit,
  LineEntity,
  PolylineEntity,
  RectangleEntity,
  Vec2,
} from './types.js';

export {
  APP_VERSION,
  DEFAULT_LAYER_ID,
  SCHEMA_VERSION,
} from './types.js';

export {
  addEntity,
  clearSelection,
  cloneDocument,
  createDefaultLayer,
  createEmptyDocument,
  createEntityId,
  getEntity,
  getLayer,
  getSelectedEntities,
  removeEntities,
  replaceEntity,
  resetIdCounter,
  setSelection,
  toggleSelectionId,
  touchDocument,
} from './document.js';
