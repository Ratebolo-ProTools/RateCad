export type EntityId = string;
export type LayerId = string;

export type LengthUnit = 'ft' | 'm' | 'mm' | 'in';

export interface Vec2 {
  x: number;
  y: number;
}

export interface Layer {
  id: LayerId;
  name: string;
  color: string;
  visible: boolean;
  locked: boolean;
}

export interface EntityBase {
  id: EntityId;
  layerId: LayerId;
  visible: boolean;
  locked: boolean;
  metadata?: Record<string, unknown>;
}

export interface LineEntity extends EntityBase {
  type: 'line';
  geometry: {
    start: Vec2;
    end: Vec2;
  };
  properties: {
    color?: string;
    lineWeight?: number;
  };
}

export interface RectangleEntity extends EntityBase {
  type: 'rectangle';
  geometry: {
    corner1: Vec2;
    corner2: Vec2;
  };
  properties: {
    color?: string;
    lineWeight?: number;
  };
}

export interface CircleEntity extends EntityBase {
  type: 'circle';
  geometry: {
    center: Vec2;
    radius: number;
  };
  properties: {
    color?: string;
    lineWeight?: number;
  };
}

/** Ordered polyline — one structured entity, not unrelated lines. */
export interface PolylineEntity extends EntityBase {
  type: 'polyline';
  geometry: {
    vertices: Vec2[];
    closed: boolean;
  };
  properties: {
    color?: string;
    lineWeight?: number;
  };
}

export type Entity =
  | LineEntity
  | RectangleEntity
  | CircleEntity
  | PolylineEntity;
export type EntityType = Entity['type'];

export interface DrawingSettings {
  units: LengthUnit;
  precision: number;
  gridSize: number;
  /** Master snap toggle (grid + object snaps). */
  snapToGrid: boolean;
}

export interface DrawingMeta {
  name: string;
  createdAt: string;
  updatedAt: string;
  appVersion: string;
}

export interface DrawingDocument {
  schemaVersion: number;
  meta: DrawingMeta;
  settings: DrawingSettings;
  layers: Layer[];
  entities: Entity[];
  /** Session selection — not required in persisted files */
  selection: EntityId[];
}

export const DEFAULT_LAYER_ID = 'layer-0' as LayerId;
export const SCHEMA_VERSION = 1;
export const APP_VERSION = '0.2.0';
