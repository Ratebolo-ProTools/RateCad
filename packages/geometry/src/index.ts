export type { AABB, Vec2 } from './math.js';
export {
  aabbFromPoints,
  add,
  distance,
  formatLength,
  midpoint,
  pointInAABB,
  pointNearCircle,
  pointNearSegment,
  scale,
  snapToGrid,
  sub,
  vec2,
} from './math.js';

export type { SnapCandidate, SnapKind, SnapOptions, SnapResult } from './snap.js';
export { collectSnapCandidates, resolveSnap } from './snap.js';

export type {
  DirectionConstraintKind,
  DirectionConstraintResult,
  OrthoTrackingOptions,
  PolarTrackingOptions,
} from './polarTracking.js';
export {
  PolarTrackingEngine,
  applyDirectionConstraint,
  buildPolarAngles,
  nearestPolarAngle,
} from './polarTracking.js';

export type { GripEditTarget } from './transform.js';
export {
  applyGripEdit,
  cloneEntityWithNewId,
  dimensionLayout,
  isFiniteVec2,
  offsetFromPlacement,
  translateEntity,
  translatePoint,
  validateEntityGeometry,
  vecDelta,
} from './transform.js';

export {
  formatAngleDegrees,
  formatLengthInUnits,
  measuredAngleDeg,
  measuredLength,
} from './units.js';

export type {
  DecimalPrecision,
  FractionDenominator,
  ParsedLength,
} from './unitEngine.js';
export {
  DECIMAL_PRECISIONS,
  FRACTION_DENOMINATORS,
  LENGTH_UNIT_LABELS,
  MM_PER,
  SUPPORTED_LENGTH_UNITS,
  convertArea,
  convertLength,
  convertVolume,
  displayToWorld,
  formatArchitecturalFeet,
  formatLengthValue,
  formatWorldArea,
  formatWorldLength,
  formatWorldVolume,
  fromMillimeters,
  normalizeLengthUnit,
  parseArchitecturalLength,
  parseLength,
  resolveUnitAlias,
  suggestedGridSize,
  toMillimeters,
  worldToDisplay,
} from './unitEngine.js';

export {
  formatAngleByDrawingUnits,
  formatLinearByFormat,
  formatWorldByDrawingUnits,
  roundTo,
} from './drawingUnitFormat.js';

export {
  dimConversionMultiplier,
  formatDimensionLength,
  formatDimensionTolerance,
} from './dimStyleFormat.js';
export type { FormatDimensionOptions } from './dimStyleFormat.js';

export {
  AreaMeasurementEngine,
  areaMeasurementEngine,
  formatAreaMeasurement,
  toAreaMeasurement,
} from './areaMeasurementEngine.js';
export type {
  AreaMeasurement,
  AreaMeasurementDisplay,
} from './areaMeasurementEngine.js';

export type { OpeningLayout, WallLayout } from './construction.js';
export {
  clampHostedPosition,
  convertToWorld,
  doorLayout,
  parseLengthInput,
  pointAlongWall,
  projectOntoWall,
  validateDoorGeometry,
  validateWallGeometry,
  validateWindowGeometry,
  wallDirection,
  wallLayout,
  wallLength,
  wallNormal,
  wallOutlineSegments,
  windowLayout,
} from './construction.js';

export type { DetectedLoop, RoomDetectionError, RoomDetectionResult } from './rooms.js';
export {
  detectClosedLoops,
  findAffectedRoomsForWall,
  findDoorsForRoom,
  findLoopAtPoint,
  findRoomById,
  findRooms,
  findRoomsContainingPoint,
  findRoomsForDoor,
  findRoomsForWindow,
  findWallsForRoom,
  findWindowsForRoom,
  formatAreaInUnits,
  formatRoomLabelLines,
  joinToleranceForWalls,
  pointInPolygon,
  polygonAABBSize,
  polygonArea,
  polygonCentroid,
  polygonSignedArea,
  recalculateAffectedRooms,
  recalculateRoomFromDocument,
  rebuildRoomGeometry,
  validateRoomGeometry,
} from './rooms.js';

export {
  angleBetween,
  closestPointOnSegment,
  cross,
  degreesToRadians,
  dot,
  intersectLineCircle,
  intersectRaySegment,
  intersectSegmentCircle,
  intersectSegments,
  leftNormal,
  normalize,
  pointOnSegment,
  projectParam,
  radiansToDegrees,
  reflectPoint,
  rotatePoint,
  scalePoint,
} from './intersect.js';

export type { ModifyResult } from './cadOps.js';
export {
  entitySegments,
  extendEntity,
  extendLineEntity,
  extendPolylineEntity,
  mirrorEntity,
  offsetEntity,
  offsetLineEntity,
  offsetPolylineEntity,
  offsetRectangleEntity,
  parseAngleDegrees,
  parsePositiveScale,
  rotateEntity,
  scaleEntity,
  trimEntity,
  trimLineEntity,
  trimPolylineEntity,
  trimRemovalPreview,
} from './cadOps.js';

export type {
  CurveInterval,
  EdgeMode,
  ProjectMode,
  TrimExtendOperation,
  TrimExtendOptions,
  TrimMode,
  TrimPick,
} from './trimExtendEngine.js';
export type {
  OpenSegmentExtendPlan,
  PolylineExtendPlan,
} from './trimExtendEngine.js';
export {
  applyTrimExtend,
  buildIntervals,
  canExtendEntity,
  canTrimEntity,
  collectIntersectionsOnSegment,
  collectIntersectionsWithCutters,
  cuttingSegments,
  defaultTrimSettings,
  entitiesCrossedByFence,
  extendEntityMulti,
  extendPreviewMulti,
  fencePickPoint,
  intersectInfiniteLineSegment,
  intersectInfiniteLines,
  nearbyCutters,
  planOpenSegmentExtend,
  planOpenSegmentTrim,
  planPolylineExtend,
  resolvePickInterval,
  segmentsAreCollinear,
  segmentsAreParallel,
  sortHitsAlongSegment,
  trimEntityMulti,
  trimRemovalPreviewMulti,
} from './trimExtendEngine.js';

export type {
  FilletArcSpec,
  FilletComputeResult,
  FilletOptions,
  FilletPick,
} from './filletEngine.js';
export {
  computeFillet,
  defaultFilletSettings,
  filletLineCircle,
  filletLineLine,
  filletPolylineAll,
  makeArcPolylineEntity,
  resolveLinearEdge,
  sampleFilletArc,
  validateFilletResult,
} from './filletEngine.js';

export type {
  AreaCalculationMethod,
  AreaComputation,
  AreaError,
  AreaResult,
  AreaSession,
  AreaSessionEntry,
  AreaSessionMode,
} from './areaEngine.js';
export {
  addAreaEntry,
  areaFromCircle,
  areaFromEntity,
  areaFromOrientedRectangle,
  areaFromPoints,
  areaFromPolygon,
  areaFromPolyline,
  areaFromRectangle,
  createAreaSession,
  formatAreaResult,
  formatAreaSessionReport,
  isSelfIntersectingPolygon,
  polygonPerimeter,
  previewAreaFromPoints,
  segmentsProperlyIntersect,
  setAreaSessionMode,
  undoAreaEntry,
} from './areaEngine.js';

export type {
  BoundaryEngineOptions,
  BoundarySegment,
  DetectedBoundary,
} from './boundaryEngine.js';
export {
  collectBoundarySegments,
  defaultBoundaryTolerance,
  detectSegmentLoops,
  findBoundaryAtPoint,
  splitSegmentsAtIntersections,
} from './boundaryEngine.js';

export type {
  AppearancePatch,
  PropertyCategory,
  PropertyDataType,
  PropertyDescriptor,
  ResolvedPropertyPair,
  StoredAppearanceView,
} from './propertyEngine.js';
export {
  appearanceForNewEntity,
  applyAppearancePatch,
  applyGeometryPropertyEdit,
  canEditEntityProperties,
  colorEqual,
  commonValue,
  formatColorLabel,
  formatLinetypeLabel,
  formatLineweightLabel,
  formatTransparencyLabel,
  getCurrentAppearance,
  getGeneralPropertyDescriptors,
  getGeometryPropertyValue,
  getPropertyDescriptors,
  getStoredAppearance,
  isArcPolyline,
  isLayerLocked,
  lineweightToScreenPx,
  matchPropPatch,
  registerGeometryProperties,
  resolveEffectiveAppearance,
  resolvePropertyPair,
  setByLayerPatch,
} from './propertyEngine.js';
