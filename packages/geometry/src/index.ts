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
  isFiniteVec2,
  translateEntity,
  translatePoint,
  validateEntityGeometry,
  vecDelta,
} from './transform.js';
