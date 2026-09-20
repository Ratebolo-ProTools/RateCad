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
