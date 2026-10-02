import type { AppearanceProperties, CurrentAppearance } from './appearance.js';
import type { AnnotationScaleSettings } from './annotationScale.js';
import type { Layout, LayoutId, WorkspaceMode } from './layout.js';

export type { AppearanceProperties, CurrentAppearance } from './appearance.js';
export type { AnnotationScaleSettings } from './annotationScale.js';
export type {
  Layout,
  LayoutId,
  LayoutViewport,
  PageOrientation,
  PageSettings,
  PageUnit,
  PaperSizeId,
  ViewportId,
  WorkspaceMode,
} from './layout.js';

export type EntityId = string;
export type LayerId = string;

export type LengthUnit = 'ft' | 'ft-in' | 'in' | 'm' | 'cm' | 'mm';

export interface Vec2 {
  x: number;
  y: number;
}

export interface Layer {
  id: LayerId;
  name: string;
  /** Explicit layer color (hex). Used when entity color is ByLayer. */
  color: string;
  /** Named linetype id (Continuous, Dashed, …). */
  linetype: string;
  /** Lineweight in millimetres. */
  lineweight: number;
  /** 0 = opaque, 100 = fully transparent. */
  transparency: number;
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
  properties: AppearanceProperties;
}

export interface RectangleEntity extends EntityBase {
  type: 'rectangle';
  geometry: {
    corner1: Vec2;
    corner2: Vec2;
  };
  properties: AppearanceProperties;
}

export interface CircleEntity extends EntityBase {
  type: 'circle';
  geometry: {
    center: Vec2;
    radius: number;
  };
  properties: AppearanceProperties;
}

/** Ordered polyline — one structured entity, not unrelated lines. */
export interface PolylineEntity extends EntityBase {
  type: 'polyline';
  geometry: {
    vertices: Vec2[];
    closed: boolean;
  };
  properties: AppearanceProperties;
}

export type DimensionKind =
  | 'horizontal'
  | 'vertical'
  | 'aligned'
  | 'angular'
  | 'radius'
  | 'diameter';

/**
 * Structured dimension — measurement is always derived from geometry.
 * Offset controls dimension-line placement (world units along the
 * perpendicular from the measured geometry midpoint).
 *
 * kind:
 *  - horizontal / vertical / aligned → linear (start–end)
 *  - radius / diameter → start = center, end = rim point
 *  - angular → start/end define rays from an implied vertex at midpoint offset
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
    /**
     * Angular dimensions: third point (vertex). When omitted, vertex is
     * inferred as the intersection / start point.
     */
    vertex?: Vec2;
  };
  properties: AppearanceProperties & {
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
    /** Horizontal alignment foundation (Paper Space / Model). */
    alignment?: 'left' | 'center' | 'right';
  };
  properties: AppearanceProperties;
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
  properties: AppearanceProperties & {
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
  properties: AppearanceProperties & {
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
  properties: AppearanceProperties & {
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
  properties: AppearanceProperties & {
    windowType?: string;
  };
}

export type WallDir = 'forward' | 'reverse';

/**
 * Semantic room — bounded by WallEntity IDs (walls remain geometry source of truth).
 * polygon/area are derived caches, recalculated when boundary walls change.
 */
export interface RoomEntity extends EntityBase {
  type: 'room';
  geometry: {
    /** Ordered wall IDs forming a closed loop. */
    wallIds: EntityId[];
    /** Direction of each wall along the loop (forward = start→end). */
    wallDirs: WallDir[];
    /** Derived closed polygon (first point not repeated). */
    polygon: Vec2[];
    /** Label anchor in world units. */
    labelPosition: Vec2;
    /** Area in document world square units (derived). */
    area: number;
  };
  properties: AppearanceProperties & {
    name: string;
    roomType?: string;
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
  | WindowEntity
  | RoomEntity;
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
  /**
   * Canonical storage unit for all coordinates/lengths in this document.
   * Changing display `units` must NOT change geometry or worldUnit.
   */
  worldUnit: LengthUnit;
  /** Linear display unit (formatting only). */
  units: LengthUnit;
  /** Decimal display precision (0–4). */
  precision: number;
  /**
   * Architectural fractional-inch denominator when units is `ft-in`
   * (1 | 2 | 4 | 8 | 16 | 32).
   */
  fractionDenominator: number;
  gridSize: number;
  /** Master snap toggle (grid + object snaps). */
  snapToGrid: boolean;
  dimensionStyle: DimensionStyle;
  constructionDefaults: ConstructionDefaults;
  /** TRIM / EXTEND default mode (Quick = all objects as cutters). */
  trimMode: 'quick' | 'standard';
  /** EDGEMODE: whether natural extensions of cutting edges count. */
  edgeMode: 'extend' | 'no-extend';
  /** Projection mode for TRIM/EXTEND (2D uses none). */
  projectMode: 'none' | 'ucs' | 'view';
  /**
   * When true in Quick mode, untrimmable picks may be erased (AutoCAD-like).
   * Default false — RateCAD requires explicit Erase option instead.
   */
  trimEraseUntrimmable: boolean;
  /** Current FILLET radius in world units (does not affect existing fillets). */
  filletRadius: number;
  /** FILLET Trim mode — trim/extend sources to the arc (default true). */
  filletTrim: boolean;
  /** Current (default) appearance for newly created objects. */
  currentAppearance: CurrentAppearance;
  /** Global linetype scale multiplier (model space). */
  linetypeScale: number;
  /** Display setting — when false, draw thin strokes regardless of lineweight. */
  showLineweights: boolean;
  /**
   * Annotation scale foundation for Model Space annotative text/dim/leader.
   * Paper Space annotations ignore this and use paper-unit sizes.
   */
  annotationScale: AnnotationScaleSettings;
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
  /**
   * Model Space entities — the sole source of construction/model geometry.
   * Layouts reference this via viewports; they never duplicate these entities.
   */
  entities: Entity[];
  /**
   * Paper Space layouts (sheets). Always at least Layout1 after migration.
   * Model tab is not a layout — it is represented by activeLayoutId === null.
   */
  layouts: Layout[];
  /**
   * Active layout tab. `null` means the MODEL tab (Model Space).
   * Persisted so reopen restores the last layout tab when appropriate.
   */
  activeLayoutId: LayoutId | null;
  /**
   * Session workspace mode. Prefer App/session ownership; may be present
   * when serializing session snapshots. Not required in .ratecad files.
   */
  workspaceMode?: WorkspaceMode;
  /** Session selection — not required in persisted files */
  selection: EntityId[];
}

export const DEFAULT_LAYER_ID = 'layer-0' as LayerId;
export const WALLS_LAYER_ID = 'layer-walls' as LayerId;
export const DOORS_LAYER_ID = 'layer-doors' as LayerId;
export const WINDOWS_LAYER_ID = 'layer-windows' as LayerId;
export const ROOMS_LAYER_ID = 'layer-rooms' as LayerId;

export const SCHEMA_VERSION = 9;
export const APP_VERSION = '0.9.0';

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
