import type {
  DoorEntity,
  DrawingDocument,
  EntityId,
  RoomEntity,
  Vec2,
  WallDir,
  WallEntity,
  WindowEntity,
  LengthUnit,
} from '@ratecad/core';
import {
  findRoomsUsingWalls,
  getRoom,
  getWall,
} from '@ratecad/core';
import { distance } from './math.js';
import { formatLengthInUnits } from './units.js';

export interface DetectedLoop {
  wallIds: EntityId[];
  wallDirs: WallDir[];
  polygon: Vec2[];
  area: number;
}

export interface RoomDetectionResult {
  ok: true;
  loops: DetectedLoop[];
}

export interface RoomDetectionError {
  ok: false;
  reason: string;
}

const DEFAULT_JOIN_TOL = 1e-3;

function nearlyEqual(a: Vec2, b: Vec2, tol: number): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= tol;
}

/** Signed polygon area (positive = CCW). */
export function polygonSignedArea(polygon: Vec2[]): number {
  if (polygon.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

export function polygonArea(polygon: Vec2[]): number {
  return Math.abs(polygonSignedArea(polygon));
}

export function polygonCentroid(polygon: Vec2[]): Vec2 {
  if (polygon.length === 0) return { x: 0, y: 0 };
  const signed = polygonSignedArea(polygon);
  if (Math.abs(signed) < 1e-18) {
    const sx = polygon.reduce((s, p) => s + p.x, 0);
    const sy = polygon.reduce((s, p) => s + p.y, 0);
    return { x: sx / polygon.length, y: sy / polygon.length };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    const cross = a.x * b.y - b.x * a.y;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  const f = 1 / (6 * signed);
  return { x: cx * f, y: cy * f };
}

/** Ray-cast point-in-polygon (boundary counts as inside). */
export function pointInPolygon(point: Vec2, polygon: Vec2[]): boolean {
  if (polygon.length < 3) return false;
  // On-edge check
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const apx = point.x - a.x;
    const apy = point.y - a.y;
    const lenSq = abx * abx + aby * aby;
    if (lenSq < 1e-18) continue;
    const t = (apx * abx + apy * aby) / lenSq;
    if (t >= -1e-9 && t <= 1 + 1e-9) {
      const proj = { x: a.x + abx * t, y: a.y + aby * t };
      if (Math.hypot(point.x - proj.x, point.y - proj.y) <= 1e-6) return true;
    }
  }
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const pi = polygon[i]!;
    const pj = polygon[j]!;
    const intersect =
      pi.y > point.y !== pj.y > point.y &&
      point.x <
        ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y + 1e-18) + pi.x;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function formatAreaInUnits(
  area: number,
  units: LengthUnit,
  precision = 2,
): string {
  if (!Number.isFinite(area) || area < 0) return '—';
  switch (units) {
    case 'ft':
      return `${area.toFixed(Math.max(0, precision))} sq ft`;
    case 'in':
      return `${area.toFixed(Math.max(0, precision))} sq in`;
    case 'm':
      return `${area.toFixed(Math.max(0, precision))} m²`;
    case 'mm':
      return `${area.toFixed(Math.max(0, precision))} mm²`;
  }
}

/** Bounding dimensions of a polygon AABB for label secondary line. */
export function polygonAABBSize(polygon: Vec2[]): { width: number; height: number } {
  if (polygon.length === 0) return { width: 0, height: 0 };
  let minX = polygon[0]!.x;
  let maxX = polygon[0]!.x;
  let minY = polygon[0]!.y;
  let maxY = polygon[0]!.y;
  for (const p of polygon) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  return { width: maxX - minX, height: maxY - minY };
}

export function formatRoomLabelLines(
  room: RoomEntity,
  units: LengthUnit,
  precision = 2,
): string[] {
  const name = (room.properties.name || 'ROOM').toUpperCase();
  const { width, height } = polygonAABBSize(room.geometry.polygon);
  const sizeLine =
    width > 1e-9 && height > 1e-9
      ? `${formatLengthInUnits(width, units, precision)} × ${formatLengthInUnits(height, units, precision)}`
      : '';
  const areaLine = formatAreaInUnits(room.geometry.area, units, precision);
  return sizeLine ? [name, sizeLine, areaLine] : [name, areaLine];
}

function wallEndpoints(wall: WallEntity, dir: WallDir): { from: Vec2; to: Vec2 } {
  if (dir === 'forward') {
    return { from: wall.geometry.start, to: wall.geometry.end };
  }
  return { from: wall.geometry.end, to: wall.geometry.start };
}

export function joinToleranceForWalls(walls: WallEntity[]): number {
  if (walls.length === 0) return DEFAULT_JOIN_TOL;
  const avg =
    walls.reduce((s, w) => s + w.geometry.thickness, 0) / walls.length;
  return Math.max(DEFAULT_JOIN_TOL, avg * 0.15, 0.05);
}

interface GraphEdge {
  wallId: EntityId;
  /** true if traversing wall start→end */
  forward: boolean;
  from: number;
  to: number;
}

/**
 * Build a node-clustered wall graph. Endpoints within `tol` share a node.
 */
function buildWallGraph(
  walls: WallEntity[],
  tol: number,
): { nodes: Vec2[]; edges: GraphEdge[] } | null {
  const nodes: Vec2[] = [];
  const findOrAdd = (p: Vec2): number => {
    for (let i = 0; i < nodes.length; i += 1) {
      if (nearlyEqual(nodes[i]!, p, tol)) return i;
    }
    nodes.push({ ...p });
    return nodes.length - 1;
  };

  const edges: GraphEdge[] = [];
  for (const wall of walls) {
    if (distance(wall.geometry.start, wall.geometry.end) < 1e-9) continue;
    const a = findOrAdd(wall.geometry.start);
    const b = findOrAdd(wall.geometry.end);
    if (a === b) continue;
    edges.push({ wallId: wall.id, forward: true, from: a, to: b });
    edges.push({ wallId: wall.id, forward: false, from: b, to: a });
  }
  if (edges.length < 6) return null; // need ≥3 walls × 2 dirs
  return { nodes, edges };
}

function outgoingAngle(
  nodes: Vec2[],
  from: number,
  to: number,
): number {
  return Math.atan2(nodes[to]!.y - nodes[from]!.y, nodes[to]!.x - nodes[from]!.x);
}

/**
 * Left-hand face walk: from each directed edge, always take the leftmost turn.
 * Collect unique interior (CCW) cycles.
 */
export function detectClosedLoops(
  walls: WallEntity[],
  tol?: number,
): RoomDetectionResult | RoomDetectionError {
  if (walls.length < 3) {
    return { ok: false, reason: 'Need at least 3 walls to form a room' };
  }
  const joinTol = tol ?? joinToleranceForWalls(walls);
  const graph = buildWallGraph(walls, joinTol);
  if (!graph) {
    return {
      ok: false,
      reason: 'Wall network is open or incomplete — endpoints must meet',
    };
  }
  const { nodes, edges } = graph;
  const wallMap = new Map(walls.map((w) => [w.id, w]));

  // Adjacency: from node → outgoing directed edges
  const out = new Map<number, GraphEdge[]>();
  for (const e of edges) {
    const list = out.get(e.from) ?? [];
    list.push(e);
    out.set(e.from, list);
  }

  const cycles: DetectedLoop[] = [];
  const seen = new Set<string>();

  const cycleKey = (wallIds: EntityId[], dirs: WallDir[]): string => {
    // Normalize: rotate so smallest wallId is first; flip if needed for consistency
    let best = '';
    for (let start = 0; start < wallIds.length; start += 1) {
      const ids = [...wallIds.slice(start), ...wallIds.slice(0, start)];
      const ds = [...dirs.slice(start), ...dirs.slice(0, start)];
      const key = ids.map((id, i) => `${id}:${ds[i]}`).join('|');
      if (!best || key < best) best = key;
    }
    return best;
  };

  for (const startEdge of edges) {
    const wallIds: EntityId[] = [];
    const wallDirs: WallDir[] = [];
    let edge: GraphEdge = startEdge;
    let steps = 0;
    const maxSteps = edges.length + 2;
    let closed = false;

    while (steps < maxSteps) {
      wallIds.push(edge.wallId);
      wallDirs.push(edge.forward ? 'forward' : 'reverse');
      const at = edge.to;
      const incomingAngle = outgoingAngle(nodes, edge.from, edge.to);
      const candidates = (out.get(at) ?? []).filter(
        (e) => !(e.wallId === edge.wallId && e.forward === !edge.forward),
      );
      if (candidates.length === 0) break;

      // Leftmost turn: maximize CCW delta from reverse of incoming
      let best: GraphEdge | null = null;
      let bestDelta = -Infinity;
      for (const c of candidates) {
        const ang = outgoingAngle(nodes, c.from, c.to);
        let delta = ang - (incomingAngle + Math.PI);
        while (delta <= -Math.PI) delta += Math.PI * 2;
        while (delta > Math.PI) delta -= Math.PI * 2;
        // Prefer largest (most left / CCW) turn
        if (delta > bestDelta) {
          bestDelta = delta;
          best = c;
        }
      }
      if (!best) break;
      edge = best;
      steps += 1;
      if (edge.wallId === startEdge.wallId && edge.forward === startEdge.forward) {
        closed = true;
        break;
      }
    }

    if (!closed || wallIds.length < 3) continue;

    // Build polygon from wall endpoints along dirs
    const polygon: Vec2[] = [];
    for (let i = 0; i < wallIds.length; i += 1) {
      const wall = wallMap.get(wallIds[i]!);
      if (!wall) {
        return { ok: false, reason: `Missing wall ${wallIds[i]}` };
      }
      const { from } = wallEndpoints(wall, wallDirs[i]!);
      polygon.push({ ...from });
    }

    // Verify closure
    const first = polygon[0]!;
    const lastWall = wallMap.get(wallIds[wallIds.length - 1]!)!;
    const lastTo = wallEndpoints(lastWall, wallDirs[wallIds.length - 1]!).to;
    if (!nearlyEqual(first, lastTo, joinTol * 2)) continue;

    const signed = polygonSignedArea(polygon);
    // Keep CCW (interior) faces only
    if (signed <= 1e-9) continue;

    const key = cycleKey(wallIds, wallDirs);
    if (seen.has(key)) continue;
    seen.add(key);

    cycles.push({
      wallIds: [...wallIds],
      wallDirs: [...wallDirs],
      polygon,
      area: Math.abs(signed),
    });
  }

  if (cycles.length === 0) {
    return {
      ok: false,
      reason:
        'No closed wall loop found — ensure wall endpoints meet (L/T junctions)',
    };
  }

  // Sort smallest area first (prefer tight rooms over outer envelopes)
  cycles.sort((a, b) => a.area - b.area);
  return { ok: true, loops: cycles };
}

/**
 * Pick the smallest detected loop containing `point`.
 * Rejects when zero loops contain the point.
 */
export function findLoopAtPoint(
  walls: WallEntity[],
  point: Vec2,
  tol?: number,
): DetectedLoop | RoomDetectionError {
  const detected = detectClosedLoops(walls, tol);
  if (!detected.ok) return detected;
  const containing = detected.loops.filter((loop) =>
    pointInPolygon(point, loop.polygon),
  );
  if (containing.length === 0) {
    return {
      ok: false,
      reason: 'Click is not inside a closed wall loop',
    };
  }
  // Smallest area among containing loops
  containing.sort((a, b) => a.area - b.area);
  return containing[0]!;
}

export function rebuildRoomGeometry(
  room: RoomEntity,
  wallsById: Map<EntityId, WallEntity>,
  joinTol?: number,
): RoomEntity | null {
  const { wallIds, wallDirs } = room.geometry;
  if (wallIds.length < 3 || wallIds.length !== wallDirs.length) return null;

  const polygon: Vec2[] = [];
  for (let i = 0; i < wallIds.length; i += 1) {
    const wall = wallsById.get(wallIds[i]!);
    if (!wall) return null;
    const { from } = wallEndpoints(wall, wallDirs[i]!);
    polygon.push({ ...from });
  }

  const first = polygon[0]!;
  const lastWall = wallsById.get(wallIds[wallIds.length - 1]!)!;
  const lastTo = wallEndpoints(lastWall, wallDirs[wallIds.length - 1]!).to;
  const tol = joinTol ?? joinToleranceForWalls([...wallsById.values()]);
  if (!nearlyEqual(first, lastTo, tol * 2)) return null;

  const area = polygonArea(polygon);
  if (!(area > 1e-9)) return null;

  let labelPosition = { ...room.geometry.labelPosition };
  if (!pointInPolygon(labelPosition, polygon)) {
    labelPosition = polygonCentroid(polygon);
  }

  return {
    ...room,
    geometry: {
      ...room.geometry,
      polygon,
      area,
      labelPosition,
    },
  };
}

export function recalculateRoomFromDocument(
  doc: DrawingDocument,
  room: RoomEntity,
): RoomEntity | null {
  const wallsById = new Map(
    doc.entities
      .filter((e): e is WallEntity => e.type === 'wall')
      .map((w) => [w.id, w]),
  );
  return rebuildRoomGeometry(room, wallsById);
}

/** Recalculate all rooms that reference any of the given walls. */
export function recalculateAffectedRooms(
  doc: DrawingDocument,
  wallIds: EntityId[],
): { updated: RoomEntity[]; broken: RoomEntity[] } {
  const affected = findRoomsUsingWalls(doc, wallIds);
  const updated: RoomEntity[] = [];
  const broken: RoomEntity[] = [];
  for (const room of affected) {
    const next = recalculateRoomFromDocument(doc, room);
    if (!next) broken.push(room);
    else updated.push(next);
  }
  return { updated, broken };
}

export function validateRoomGeometry(
  room: RoomEntity,
  walls?: WallEntity[],
): boolean {
  const { wallIds, wallDirs, polygon, area, labelPosition } = room.geometry;
  if (wallIds.length < 3) return false;
  if (wallIds.length !== wallDirs.length) return false;
  if (polygon.length < 3) return false;
  if (!polygon.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) {
    return false;
  }
  if (!(area > 1e-9) || !Number.isFinite(area)) return false;
  if (!Number.isFinite(labelPosition.x) || !Number.isFinite(labelPosition.y)) {
    return false;
  }
  if (typeof room.properties.name !== 'string' || !room.properties.name.trim()) {
    return false;
  }
  if (walls) {
    const map = new Map(walls.map((w) => [w.id, w]));
    if (wallIds.some((id) => !map.has(id))) return false;
    const rebuilt = rebuildRoomGeometry(room, map);
    if (!rebuilt) return false;
  }
  return true;
}

// ── Semantic queries ──────────────────────────────────────────────

export function findRooms(doc: DrawingDocument): RoomEntity[] {
  return doc.entities.filter((e): e is RoomEntity => e.type === 'room');
}

export function findRoomById(
  doc: DrawingDocument,
  id: EntityId,
): RoomEntity | undefined {
  return getRoom(doc, id);
}

export function findWallsForRoom(
  doc: DrawingDocument,
  roomId: EntityId,
): WallEntity[] {
  const room = getRoom(doc, roomId);
  if (!room) return [];
  return room.geometry.wallIds
    .map((id) => getWall(doc, id))
    .filter((w): w is WallEntity => !!w);
}

export function findDoorsForRoom(
  doc: DrawingDocument,
  roomId: EntityId,
): DoorEntity[] {
  const room = getRoom(doc, roomId);
  if (!room) return [];
  const wallSet = new Set(room.geometry.wallIds);
  return doc.entities.filter(
    (e): e is DoorEntity =>
      e.type === 'door' && wallSet.has(e.geometry.hostWallId),
  );
}

export function findWindowsForRoom(
  doc: DrawingDocument,
  roomId: EntityId,
): WindowEntity[] {
  const room = getRoom(doc, roomId);
  if (!room) return [];
  const wallSet = new Set(room.geometry.wallIds);
  return doc.entities.filter(
    (e): e is WindowEntity =>
      e.type === 'window' && wallSet.has(e.geometry.hostWallId),
  );
}

export function findRoomsContainingPoint(
  doc: DrawingDocument,
  point: Vec2,
): RoomEntity[] {
  return findRooms(doc)
    .filter((r) => pointInPolygon(point, r.geometry.polygon))
    .sort((a, b) => a.geometry.area - b.geometry.area);
}

export function findAffectedRoomsForWall(
  doc: DrawingDocument,
  wallId: EntityId,
): RoomEntity[] {
  return findRoomsUsingWalls(doc, [wallId]);
}

/**
 * Rooms whose boundary includes the door's host wall.
 * When a wall is shared by two rooms, both are returned (door connects them).
 */
export function findRoomsForDoor(
  doc: DrawingDocument,
  doorId: EntityId,
): RoomEntity[] {
  const door = doc.entities.find((e) => e.id === doorId && e.type === 'door');
  if (!door || door.type !== 'door') return [];
  return findAffectedRoomsForWall(doc, door.geometry.hostWallId);
}

export function findRoomsForWindow(
  doc: DrawingDocument,
  windowId: EntityId,
): RoomEntity[] {
  const win = doc.entities.find((e) => e.id === windowId && e.type === 'window');
  if (!win || win.type !== 'window') return [];
  return findAffectedRoomsForWall(doc, win.geometry.hostWallId);
}
