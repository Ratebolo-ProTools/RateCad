/**
 * Boundary Engine — detect closed loops and islands from CAD geometry.
 *
 * Reuses join-tolerance concepts from the rooms wall graph, but works on
 * generic line/polyline/rectangle/wall segments plus circles.
 */

import type {
  DrawingDocument,
  Entity,
  EntityId,
  Vec2,
  WallEntity,
} from '@ratecad/core';
import { distance } from './math.js';
import { intersectSegments } from './intersect.js';
import {
  areaFromCircle,
  areaFromPolygon,
  type AreaComputation,
} from './areaEngine.js';
import {
  findLoopAtPoint,
  joinToleranceForWalls,
  pointInPolygon,
  polygonArea,
  polygonCentroid,
} from './rooms.js';

export interface BoundarySegment {
  id: string;
  a: Vec2;
  b: Vec2;
  sourceIds: EntityId[];
}

export interface DetectedBoundary {
  outer: Vec2[];
  holes: Vec2[][];
  sourceIds: EntityId[];
  area: number;
  perimeter: number;
}

export interface BoundaryEngineOptions {
  /** Endpoint clustering / join tolerance in world units. */
  tolerance?: number;
  /** Max candidates considered near a pick (spatial filter). */
  maxCandidates?: number;
}

const DEFAULT_TOL = 1e-4;

function nearlyEqual(a: Vec2, b: Vec2, tol: number): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= tol;
}

/** Collect straight segments from supported entities. */
export function collectBoundarySegments(
  entities: Entity[],
): BoundarySegment[] {
  const out: BoundarySegment[] = [];
  let n = 0;
  const push = (a: Vec2, b: Vec2, sourceIds: EntityId[]) => {
    if (distance(a, b) < 1e-12) return;
    out.push({
      id: `seg-${n++}`,
      a: { ...a },
      b: { ...b },
      sourceIds,
    });
  };

  for (const e of entities) {
    if (!e.visible) continue;
    switch (e.type) {
      case 'line':
        push(e.geometry.start, e.geometry.end, [e.id]);
        break;
      case 'wall':
        push(e.geometry.start, e.geometry.end, [e.id]);
        break;
      case 'polyline': {
        const v = e.geometry.vertices;
        for (let i = 0; i < v.length - 1; i += 1) {
          push(v[i]!, v[i + 1]!, [e.id]);
        }
        if (e.geometry.closed && v.length >= 3) {
          push(v[v.length - 1]!, v[0]!, [e.id]);
        }
        break;
      }
      case 'rectangle': {
        const { corner1: c1, corner2: c2 } = e.geometry;
        const minX = Math.min(c1.x, c2.x);
        const maxX = Math.max(c1.x, c2.x);
        const minY = Math.min(c1.y, c2.y);
        const maxY = Math.max(c1.y, c2.y);
        const corners: Vec2[] = [
          { x: minX, y: minY },
          { x: maxX, y: minY },
          { x: maxX, y: maxY },
          { x: minX, y: maxY },
        ];
        for (let i = 0; i < 4; i += 1) {
          push(corners[i]!, corners[(i + 1) % 4]!, [e.id]);
        }
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/** Split segments at proper intersections so crossing lines form nodes. */
export function splitSegmentsAtIntersections(
  segments: BoundarySegment[],
  tol: number,
): BoundarySegment[] {
  if (segments.length < 2) return segments;
  type Cut = { t: number; p: Vec2 };
  const cuts = new Map<string, Cut[]>();
  for (const s of segments) cuts.set(s.id, []);

  for (let i = 0; i < segments.length; i += 1) {
    for (let j = i + 1; j < segments.length; j += 1) {
      const s = segments[i]!;
      const t = segments[j]!;
      const hit = intersectSegments(s.a, s.b, t.a, t.b, true);
      if (!hit) continue;
      // Skip pure endpoint touches (already nodes)
      const onSEnd =
        nearlyEqual(hit, s.a, tol) || nearlyEqual(hit, s.b, tol);
      const onTEnd =
        nearlyEqual(hit, t.a, tol) || nearlyEqual(hit, t.b, tol);
      if (onSEnd && onTEnd) continue;
      const ts =
        distance(s.a, s.b) > 1e-12
          ? distance(s.a, hit) / distance(s.a, s.b)
          : 0;
      const tt =
        distance(t.a, t.b) > 1e-12
          ? distance(t.a, hit) / distance(t.a, t.b)
          : 0;
      if (!onSEnd && ts > 1e-6 && ts < 1 - 1e-6) {
        cuts.get(s.id)!.push({ t: ts, p: hit });
      }
      if (!onTEnd && tt > 1e-6 && tt < 1 - 1e-6) {
        cuts.get(t.id)!.push({ t: tt, p: hit });
      }
    }
  }

  const out: BoundarySegment[] = [];
  let n = 0;
  for (const s of segments) {
    const list = cuts.get(s.id) ?? [];
    if (!list.length) {
      out.push({ ...s, id: `seg-${n++}` });
      continue;
    }
    list.sort((a, b) => a.t - b.t);
    const pts: Vec2[] = [s.a];
    for (const c of list) {
      const last = pts[pts.length - 1]!;
      if (!nearlyEqual(last, c.p, tol)) pts.push(c.p);
    }
    if (!nearlyEqual(pts[pts.length - 1]!, s.b, tol)) pts.push(s.b);
    for (let i = 0; i < pts.length - 1; i += 1) {
      out.push({
        id: `seg-${n++}`,
        a: pts[i]!,
        b: pts[i + 1]!,
        sourceIds: s.sourceIds,
      });
    }
  }
  return out;
}

interface SegGraphEdge {
  segId: string;
  forward: boolean;
  fromIdx: number;
  toIdx: number;
  sourceIds: EntityId[];
}

function buildSegmentGraph(
  segments: BoundarySegment[],
  tol: number,
): { nodes: Vec2[]; edges: SegGraphEdge[] } | null {
  const nodes: Vec2[] = [];
  const findOrAdd = (p: Vec2): number => {
    for (let i = 0; i < nodes.length; i += 1) {
      if (nearlyEqual(nodes[i]!, p, tol)) return i;
    }
    nodes.push({ ...p });
    return nodes.length - 1;
  };
  const edges: SegGraphEdge[] = [];
  for (const s of segments) {
    const a = findOrAdd(s.a);
    const b = findOrAdd(s.b);
    if (a === b) continue;
    edges.push({
      segId: s.id,
      forward: true,
      fromIdx: a,
      toIdx: b,
      sourceIds: s.sourceIds,
    });
    edges.push({
      segId: s.id,
      forward: false,
      fromIdx: b,
      toIdx: a,
      sourceIds: s.sourceIds,
    });
  }
  if (edges.length < 6) return null;
  return { nodes, edges };
}

function outgoingAngle(nodes: Vec2[], fromIdx: number, toIdx: number): number {
  return Math.atan2(
    nodes[toIdx]!.y - nodes[fromIdx]!.y,
    nodes[toIdx]!.x - nodes[fromIdx]!.x,
  );
}

function walkLeftFace(
  startEdge: SegGraphEdge,
  nodes: Vec2[],
  outMap: Map<number, SegGraphEdge[]>,
  maxSteps: number,
): SegGraphEdge[] {
  const path: SegGraphEdge[] = [];
  const visitedDir = new Set<string>();
  let current: SegGraphEdge = startEdge;
  for (let guard = 0; guard < maxSteps; guard += 1) {
    const dirKey = `${current.segId}:${current.forward ? 1 : 0}`;
    if (visitedDir.has(dirKey)) break;
    visitedDir.add(dirKey);
    path.push(current);
    const atNode = current.toIdx;
    const incoming = outgoingAngle(nodes, current.fromIdx, current.toIdx);
    const outs = outMap.get(atNode) ?? [];
    const candidates: SegGraphEdge[] = [];
    for (let i = 0; i < outs.length; i += 1) {
      const cand = outs[i]!;
      if (cand.segId === current.segId && cand.forward === !current.forward) {
        continue;
      }
      candidates.push(cand);
    }
    if (candidates.length === 0) break;
    let best: SegGraphEdge | undefined;
    let bestDelta = Infinity;
    for (let i = 0; i < candidates.length; i += 1) {
      const cand = candidates[i]!;
      const outAng = outgoingAngle(nodes, cand.fromIdx, cand.toIdx);
      let delta = outAng - incoming;
      while (delta <= -Math.PI) delta += Math.PI * 2;
      while (delta > Math.PI) delta -= Math.PI * 2;
      if (delta < bestDelta) {
        bestDelta = delta;
        best = cand;
      }
    }
    if (!best) break;
    if (best.toIdx === startEdge.fromIdx && path.length >= 2) {
      path.push(best);
      break;
    }
    current = best;
    if (path.length > 2 && current.toIdx === startEdge.fromIdx) break;
  }
  return path;
}

/**
 * Left-hand face walk → closed loops from segment graph.
 */
export function detectSegmentLoops(
  segments: BoundarySegment[],
  tol: number = DEFAULT_TOL,
): DetectedBoundary[] {
  const split = splitSegmentsAtIntersections(segments, tol);
  const graph = buildSegmentGraph(split, tol);
  if (!graph) return [];
  const { nodes, edges } = graph;
  const outMap = new Map<number, SegGraphEdge[]>();
  for (const e of edges) {
    const list = outMap.get(e.fromIdx) ?? [];
    list.push(e);
    outMap.set(e.fromIdx, list);
  }

  const cycles: DetectedBoundary[] = [];
  const seen = new Set<string>();

  for (const startEdge of edges) {
    const path = walkLeftFace(startEdge, nodes, outMap, edges.length + 2);

    // Validate cycle: last edge arrives at start
    if (path.length < 3) continue;
    const last = path[path.length - 1]!;
    if (last.toIdx !== startEdge.fromIdx) continue;

    const nodeIds = path.map((e) => e.fromIdx);
    const polygon = nodeIds.map((i) => ({ ...nodes[i]! }));
    let bestKey = '';
    for (let s = 0; s < nodeIds.length; s += 1) {
      const rot = [...nodeIds.slice(s), ...nodeIds.slice(0, s)].join('-');
      if (!bestKey || rot < bestKey) bestKey = rot;
    }
    // Also normalize reversed winding so CW/CCW of same ring collapse
    let revKey = '';
    const rev = [...nodeIds].reverse();
    for (let s = 0; s < rev.length; s += 1) {
      const rot = [...rev.slice(s), ...rev.slice(0, s)].join('-');
      if (!revKey || rot < revKey) revKey = rot;
    }
    const canon = bestKey < revKey ? bestKey : revKey;
    if (seen.has(canon)) continue;
    seen.add(canon);

    const signed = polygon.reduce((sum, p, i, arr) => {
      const q = arr[(i + 1) % arr.length]!;
      return sum + p.x * q.y - q.x * p.y;
    }, 0);
    let poly = polygon;
    if (signed < 0) poly = [...polygon].reverse();
    const area = polygonArea(poly);
    if (!(area > 1e-12)) continue;
    let peri = 0;
    for (let i = 0; i < poly.length; i += 1) {
      peri += distance(poly[i]!, poly[(i + 1) % poly.length]!);
    }
    const sourceIds = [
      ...new Set(path.flatMap((e) => e.sourceIds)),
    ];
    cycles.push({
      outer: poly,
      holes: [],
      sourceIds,
      area,
      perimeter: peri,
    });
  }

  // Nest holes: smaller loops inside larger ones become holes
  cycles.sort((a, b) => b.area - a.area);
  const usedAsHole = new Set<number>();
  const results: DetectedBoundary[] = [];
  for (let i = 0; i < cycles.length; i += 1) {
    if (usedAsHole.has(i)) continue;
    const outer = cycles[i]!;
    const holes: Vec2[][] = [];
    for (let j = i + 1; j < cycles.length; j += 1) {
      if (usedAsHole.has(j)) continue;
      const inner = cycles[j]!;
      const c = polygonCentroid(inner.outer);
      if (pointInPolygon(c, outer.outer) && inner.area < outer.area - 1e-9) {
        holes.push(inner.outer);
        usedAsHole.add(j);
      }
    }
    let holesArea = 0;
    for (const h of holes) holesArea += polygonArea(h);
    let peri = outer.perimeter;
    for (const h of holes) {
      for (let k = 0; k < h.length; k += 1) {
        peri += distance(h[k]!, h[(k + 1) % h.length]!);
      }
    }
    results.push({
      outer: outer.outer,
      holes,
      sourceIds: outer.sourceIds,
      area: outer.area - holesArea,
      perimeter: peri,
    });
  }
  return results;
}

/**
 * Pick-inside: find smallest enclosing boundary at a point.
 * Prefer room/wall loops when available; also search line/polyline/rect graphs
 * and circles.
 */
export function findBoundaryAtPoint(
  doc: DrawingDocument,
  point: Vec2,
  options: BoundaryEngineOptions = {},
): AreaComputation {
  const entities = doc.entities.filter((e) => e.visible && !e.locked);
  const walls = entities.filter((e): e is WallEntity => e.type === 'wall');

  // 1) Circles containing the point
  const circleHits: AreaComputation[] = [];
  for (const e of entities) {
    if (e.type !== 'circle') continue;
    const d = distance(point, e.geometry.center);
    if (d <= e.geometry.radius + 1e-9) {
      circleHits.push(areaFromCircle(e.geometry.center, e.geometry.radius, e.id));
    }
  }

  // 2) Existing room entities
  for (const e of entities) {
    if (e.type !== 'room') continue;
    if (pointInPolygon(point, e.geometry.polygon)) {
      return areaFromPolygon(e.geometry.polygon, {
        method: 'room',
        sourceObjectIds: [e.id],
      });
    }
  }

  // 3) Wall loop detection (existing room engine)
  if (walls.length >= 3) {
    const tol =
      options.tolerance ?? joinToleranceForWalls(walls);
    const at = findLoopAtPoint(walls, point, tol);
    if ('wallIds' in at) {
      // Prefer segment-loop nesting (already computes islands) when available
      const wallSegs = collectBoundarySegments(walls);
      const all = detectSegmentLoops(wallSegs, tol);
      const containing = all.filter((b) => pointInPolygon(point, b.outer));
      containing.sort((a, b) => a.area - b.area);
      if (containing.length) {
        const best = containing[0]!;
        return areaFromPolygon(best.outer, {
          holes: best.holes,
          method: 'boundary',
          sourceObjectIds: best.sourceIds.length
            ? best.sourceIds
            : at.wallIds,
        });
      }
      // Fallback: room-engine loop without re-deriving holes (avoids double-subtract)
      return areaFromPolygon(at.polygon, {
        method: 'boundary',
        sourceObjectIds: at.wallIds,
      });
    }
  }

  // 4) Generic segment graph (lines, polylines, rectangles, walls)
  const tol = options.tolerance ?? DEFAULT_TOL;
  // Spatial filter: candidates near click using AABB pad
  const pad = Math.max(tol * 100, 50);
  const nearby = entities.filter((e) => {
    if (e.type === 'circle') return false;
    const segs = collectBoundarySegments([e]);
    return segs.some(
      (s) =>
        Math.min(s.a.x, s.b.x) <= point.x + pad &&
        Math.max(s.a.x, s.b.x) >= point.x - pad &&
        Math.min(s.a.y, s.b.y) <= point.y + pad &&
        Math.max(s.a.y, s.b.y) >= point.y - pad,
    );
  });
  const pool = nearby.length ? nearby : entities;
  const segments = collectBoundarySegments(pool);
  const max = options.maxCandidates ?? 500;
  const limited = segments.slice(0, max);
  const loops = detectSegmentLoops(limited, tol);
  const containing = loops.filter((b) => pointInPolygon(point, b.outer));
  containing.sort((a, b) => a.area - b.area);

  if (containing.length) {
    const best = containing[0]!;
    // Holes already nested in detectSegmentLoops for that outer
    return areaFromPolygon(best.outer, {
      holes: best.holes,
      method: 'boundary',
      sourceObjectIds: best.sourceIds,
    });
  }

  // Prefer smallest circle if any
  if (circleHits.length) {
    circleHits.sort((a, b) =>
      a.ok && b.ok ? a.area - b.area : 0,
    );
    return circleHits[0]!;
  }

  return {
    ok: false,
    reason: 'No valid boundary found',
    code: 'not-found',
  };
}

/** Default join tolerance from document (snap grid / wall thickness). */
export function defaultBoundaryTolerance(doc: DrawingDocument): number {
  const walls = doc.entities.filter((e): e is WallEntity => e.type === 'wall');
  if (walls.length) return joinToleranceForWalls(walls);
  const g = doc.settings.gridSize;
  return Math.max(DEFAULT_TOL, g * 0.02, 1e-4);
}
