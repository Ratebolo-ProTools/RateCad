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

export type DimensionKind = 'horizontal' | 'vertical' | 'aligned';

/**
 * Structured dimension — measurement is always derived from start/end.
 * Offset controls dimension-line placement (world units along the
 * perpendicular from the measured segment midpoint).
 */
export interface DimensionEntity extends EntityBase {
  type: 'dimension';
  geometry: {
    kind: DimensionKind;
    start: Vec2;
    end: Vec2;
    /** Signed offset distance from measured geometry to dimension line. */
    offset: number;
    /** Optional text shift along the dimension line (0 = centered). */
    textOffset?: number;
  };
  properties: {
    color?: string;
    lineWeight?: number;
    textHeight?: number;
    arrowSize?: number;
    precision?: number;
  };
}

export interface TextEntity extends EntityBase {
  type: 'text';
  geometry: {
    position: Vec2;
    content: string;
    height: number;
    rotation: number;
  };
  properties: {
    color?: string;
  };
}

export interface LeaderEntity extends EntityBase {
  type: 'leader';
  geometry: {
    /** Tip of the arrow (callout point). */
    arrow: Vec2;
    /** Landing / elbow points ending at text anchor. */
    vertices: Vec2[];
    content: string;
    textHeight: number;
  };
  properties: {
    color?: string;
    arrowSize?: number;
  };
}

export type WallJustification = 'center' | 'left' | 'right';

/**
 * Semantic wall — reference line + thickness/height are source of truth.
 * Plan geometry is derived, not stored as boundary lines.
 */
export interface WallEntity extends EntityBase {
  type: 'wall';
  geometry: {
    start: Vec2;
    end: Vec2;
    /** Wall thickness in document world units. */
    thickness: number;
    /** Wall height (elevation) in document world units. */
    height: number;
    justification: WallJustification;
  };
  properties: {
    color?: string;
    material?: string;
    wallType?: string;
  };
}

export type DoorSwing = 'left' | 'right';

/**
 * Hosted door — position is parametric along the host wall [0,1].
 * World placement is always derived from the host WallEntity.
 */
export interface DoorEntity extends EntityBase {
  type: 'door';
  geometry: {
    hostWallId: EntityId;
    /** Parametric center position along host wall, clamped [0,1]. */
    position: number;
    width: number;
    height: number;
    swing: DoorSwing;
    /** Opening angle in radians (typically π/2). */
    swingAngle: number;
  };
  properties: {
    color?: string;
    doorType?: string;
  };
}

/**
 * Hosted window — position is parametric along the host wall [0,1].
 */
export interface WindowEntity extends EntityBase {
  type: 'window';
  geometry: {
    hostWallId: EntityId;
    position: number;
    width: number;
    height: number;
    sillHeight: number;
  };
  properties: {
    color?: string;
    windowType?: string;
  };
}

export type Entity =
  | LineEntity
  | RectangleEntity
  | CircleEntity
  | PolylineEntity
  | DimensionEntity
  | TextEntity
  | LeaderEntity
  | WallEntity
  | DoorEntity
  | WindowEntity;
export type EntityType = Entity['type'];

export interface DimensionStyle {
  textHeight: number;
  arrowSize: number;
  precision: number;
  extensionGap: number;
  extensionBeyond: number;
}

/** Default construction sizes in document world units (typically feet). */
export interface ConstructionDefaults {
  wallThickness: number;
  wallHeight: number;
  doorWidth: number;
  doorHeight: number;
  windowWidth: number;
  windowHeight: number;
  windowSill: number;
}

export interface DrawingSettings {
  units: LengthUnit;
  precision: number;
  gridSize: number;
  /** Master snap toggle (grid + object snaps). */
  snapToGrid: boolean;
  dimensionStyle: DimensionStyle;
  constructionDefaults: ConstructionDefaults;
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
  /** Layer used for newly created entities. */
  currentLayerId: LayerId;
  entities: Entity[];
  /** Session selection — not required in persisted files */
  selection: EntityId[];
}

export const DEFAULT_LAYER_ID = 'layer-0' as LayerId;
export const WALLS_LAYER_ID = 'layer-walls' as LayerId;
export const DOORS_LAYER_ID = 'layer-doors' as LayerId;
export const WINDOWS_LAYER_ID = 'layer-windows' as LayerId;

export const SCHEMA_VERSION = 3;
export const APP_VERSION = '0.4.0';

export const DEFAULT_DIMENSION_STYLE: DimensionStyle = {
  textHeight: 0.35,
  arrowSize: 0.25,
  precision: 2,
  extensionGap: 0.1,
  extensionBeyond: 0.15,
};

/** Defaults assume feet as document units (9" wall, 8' height, 3' door, etc.). */
export const DEFAULT_CONSTRUCTION: ConstructionDefaults = {
  wallThickness: 0.75,
  wallHeight: 8,
  doorWidth: 3,
  doorHeight: 7,
  windowWidth: 3,
  windowHeight: 4,
  windowSill: 3,
};
