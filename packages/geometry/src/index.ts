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

export { formatLengthInUnits, measuredLength } from './units.js';

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
