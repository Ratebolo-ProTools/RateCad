import type {
  DoorEntity,
  DoorSwing,
  LengthUnit,
  Vec2,
  WallEntity,
  WallJustification,
  WindowEntity,
} from '@ratecad/core';
import { distance } from './math.js';
import { normalize } from './intersect.js';
import { convertLength, parseLength } from './unitEngine.js';

export interface WallLayout {
  start: Vec2;
  end: Vec2;
  dir: Vec2;
  normal: Vec2;
  length: number;
  /** Outer polygon corners (CCW): start-left, end-left, end-right, start-right. */
  corners: [Vec2, Vec2, Vec2, Vec2];
  halfLeft: number;
  halfRight: number;
}

function offsetAmounts(
  thickness: number,
  justification: WallJustification,
): { left: number; right: number } {
  switch (justification) {
    case 'left':
      return { left: thickness, right: 0 };
    case 'right':
      return { left: 0, right: thickness };
    case 'center':
    default:
      return { left: thickness / 2, right: thickness / 2 };
  }
}

export function wallLength(wall: WallEntity): number {
  return distance(wall.geometry.start, wall.geometry.end);
}

export function wallDirection(wall: WallEntity): Vec2 | null {
  return normalize({
    x: wall.geometry.end.x - wall.geometry.start.x,
    y: wall.geometry.end.y - wall.geometry.start.y,
  });
}

/** Unit normal rotated 90° CCW from wall direction (left side). */
export function wallNormal(wall: WallEntity): Vec2 | null {
  const dir = wallDirection(wall);
  if (!dir) return null;
  return { x: -dir.y, y: dir.x };
}

export function wallLayout(wall: WallEntity): WallLayout | null {
  const dir = wallDirection(wall);
  if (!dir) return null;
  const normal = { x: -dir.y, y: dir.x };
  const { left, right } = offsetAmounts(
    wall.geometry.thickness,
    wall.geometry.justification,
  );
  const { start, end } = wall.geometry;
  const length = distance(start, end);
  const corners: [Vec2, Vec2, Vec2, Vec2] = [
    { x: start.x + normal.x * left, y: start.y + normal.y * left },
    { x: end.x + normal.x * left, y: end.y + normal.y * left },
    { x: end.x - normal.x * right, y: end.y - normal.y * right },
    { x: start.x - normal.x * right, y: start.y - normal.y * right },
  ];
  return {
    start: { ...start },
    end: { ...end },
    dir,
    normal,
    length,
    corners,
    halfLeft: left,
    halfRight: right,
  };
}

export function pointAlongWall(wall: WallEntity, t: number): Vec2 {
  const { start, end } = wall.geometry;
  const tt = Math.min(1, Math.max(0, t));
  return {
    x: start.x + (end.x - start.x) * tt,
    y: start.y + (end.y - start.y) * tt,
  };
}

export function projectOntoWall(
  wall: WallEntity,
  point: Vec2,
): { t: number; point: Vec2; distance: number } | null {
  const { start, end } = wall.geometry;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-18) return null;
  let t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lenSq;
  t = Math.min(1, Math.max(0, t));
  const p = {
    x: start.x + dx * t,
    y: start.y + dy * t,
  };
  return {
    t,
    point: p,
    distance: Math.hypot(point.x - p.x, point.y - p.y),
  };
}

/** Clamp hosted opening so it stays fully on the wall. */
export function clampHostedPosition(
  wallLengthValue: number,
  width: number,
  position: number,
): number {
  if (!(wallLengthValue > 1e-9)) return 0.5;
  const half = width / (2 * wallLengthValue);
  const min = Math.min(Math.max(half, 0), 0.5);
  const max = 1 - min;
  if (max < min) return 0.5;
  return Math.min(max, Math.max(min, position));
}

export interface OpeningLayout {
  center: Vec2;
  dir: Vec2;
  normal: Vec2;
  /** Opening endpoints on wall centerline. */
  openStart: Vec2;
  openEnd: Vec2;
  /** Outer face corners of the opening cut. */
  outerA: Vec2;
  outerB: Vec2;
  innerA: Vec2;
  innerB: Vec2;
  width: number;
  angle: number;
}

function openingLayout(
  wall: WallEntity,
  position: number,
  width: number,
): OpeningLayout | null {
  const layout = wallLayout(wall);
  if (!layout || layout.length < 1e-9) return null;
  const t = clampHostedPosition(layout.length, width, position);
  const halfParam = width / (2 * layout.length);
  const center = pointAlongWall(wall, t);
  const openStart = pointAlongWall(wall, t - halfParam);
  const openEnd = pointAlongWall(wall, t + halfParam);
  const { dir, normal, halfLeft, halfRight } = layout;
  return {
    center,
    dir,
    normal,
    openStart,
    openEnd,
    outerA: {
      x: openStart.x + normal.x * halfLeft,
      y: openStart.y + normal.y * halfLeft,
    },
    outerB: {
      x: openEnd.x + normal.x * halfLeft,
      y: openEnd.y + normal.y * halfLeft,
    },
    innerA: {
      x: openStart.x - normal.x * halfRight,
      y: openStart.y - normal.y * halfRight,
    },
    innerB: {
      x: openEnd.x - normal.x * halfRight,
      y: openEnd.y - normal.y * halfRight,
    },
    width,
    angle: Math.atan2(dir.y, dir.x),
  };
}

export function doorLayout(
  door: DoorEntity,
  wall: WallEntity,
): (OpeningLayout & {
  swing: DoorSwing;
  swingAngle: number;
  hinge: Vec2;
  leafEnd: Vec2;
}) | null {
  const base = openingLayout(wall, door.geometry.position, door.geometry.width);
  if (!base) return null;
  const swing = door.geometry.swing;
  const swingAngle = door.geometry.swingAngle;
  const hinge = swing === 'left' ? base.openStart : base.openEnd;
  // Closed leaf direction along the opening (from hinge toward strike)
  const closedDir =
    swing === 'left'
      ? { ...base.dir }
      : { x: -base.dir.x, y: -base.dir.y };
  // Swing into the +normal side of the wall (CCW from closed for left hinge)
  const sign = swing === 'left' ? 1 : -1;
  const ca = Math.cos(sign * swingAngle);
  const sa = Math.sin(sign * swingAngle);
  const leafUnit = {
    x: closedDir.x * ca - closedDir.y * sa,
    y: closedDir.x * sa + closedDir.y * ca,
  };
  const len = Math.hypot(leafUnit.x, leafUnit.y) || 1;
  const leafEnd = {
    x: hinge.x + (leafUnit.x / len) * door.geometry.width,
    y: hinge.y + (leafUnit.y / len) * door.geometry.width,
  };
  return {
    ...base,
    swing,
    swingAngle,
    hinge,
    leafEnd,
  };
}

export function windowLayout(
  window: WindowEntity,
  wall: WallEntity,
): OpeningLayout | null {
  return openingLayout(wall, window.geometry.position, window.geometry.width);
}

/**
 * Wall body outline with openings cut out (plan view).
 * Returns stroke segments. When `neighbors` are provided, endpoints that meet
 * another wall omit end caps and slightly extend side faces so L/T junctions
 * do not leave an obvious rectangular gap (basic cleanup — not full cleanup).
 */
export function wallOutlineSegments(
  wall: WallEntity,
  openings: Array<{ position: number; width: number }>,
  neighbors: WallEntity[] = [],
): Array<[Vec2, Vec2]> {
  const layout = wallLayout(wall);
  if (!layout) return [];

  const segments: Array<[Vec2, Vec2]> = [];
  // Sort openings along wall
  const sorted = openings
    .map((o) => ({
      ...o,
      t: clampHostedPosition(layout.length, o.width, o.position),
      half: o.width / (2 * layout.length),
    }))
    .sort((a, b) => a.t - b.t);

  const { corners, dir, normal, halfLeft, halfRight, start, end, length } =
    layout;

  const joinTol = Math.max(wall.geometry.thickness * 0.05, 1e-4);
  const joinedStart = neighbors.some(
    (n) =>
      n.id !== wall.id &&
      (distance(n.geometry.start, start) <= joinTol ||
        distance(n.geometry.end, start) <= joinTol),
  );
  const joinedEnd = neighbors.some(
    (n) =>
      n.id !== wall.id &&
      (distance(n.geometry.start, end) <= joinTol ||
        distance(n.geometry.end, end) <= joinTol),
  );
  // Overlap extension hides the square-end gap at L/T junctions
  const extParam =
    length > 1e-9
      ? Math.min(0.5, wall.geometry.thickness / (2 * length))
      : 0;
  const tStart = joinedStart ? -extParam : 0;
  const tEnd = joinedEnd ? 1 + extParam : 1;

  // Side faces: left and right, broken by openings
  type Interval = { a: number; b: number };
  const solid: Interval[] = [{ a: tStart, b: tEnd }];
  for (const o of sorted) {
    const lo = Math.max(tStart, o.t - o.half);
    const hi = Math.min(tEnd, o.t + o.half);
    const next: Interval[] = [];
    for (const s of solid) {
      if (hi <= s.a || lo >= s.b) {
        next.push(s);
        continue;
      }
      if (lo > s.a) next.push({ a: s.a, b: lo });
      if (hi < s.b) next.push({ a: hi, b: s.b });
    }
    solid.length = 0;
    solid.push(...next);
  }

  const along = (t: number): Vec2 => ({
    x: start.x + dir.x * length * t,
    y: start.y + dir.y * length * t,
  });
  const leftAt = (t: number): Vec2 => {
    const p = along(t);
    return { x: p.x + normal.x * halfLeft, y: p.y + normal.y * halfLeft };
  };
  const rightAt = (t: number): Vec2 => {
    const p = along(t);
    return { x: p.x - normal.x * halfRight, y: p.y - normal.y * halfRight };
  };

  for (const s of solid) {
    segments.push([leftAt(s.a), leftAt(s.b)]);
    segments.push([rightAt(s.a), rightAt(s.b)]);
  }

  // End caps (full thickness) when no opening at ends and not joined
  const openAtStart = sorted.some((o) => o.t - o.half <= 1e-9);
  const openAtEnd = sorted.some((o) => o.t + o.half >= 1 - 1e-9);
  if (!openAtStart && !joinedStart) {
    segments.push([corners[0], corners[3]]);
  }
  if (!openAtEnd && !joinedEnd) {
    segments.push([corners[1], corners[2]]);
  }

  // Jambs at each opening
  for (const o of sorted) {
    const lo = Math.max(0, o.t - o.half);
    const hi = Math.min(1, o.t + o.half);
    segments.push([leftAt(lo), rightAt(lo)]);
    segments.push([leftAt(hi), rightAt(hi)]);
  }

  return segments;
}

/**
 * Parse a length typed by the user into world storage units.
 *
 * @param units Display / default unit for bare numbers (settings.units)
 * @param worldUnit Canonical storage unit (settings.worldUnit) — defaults to units
 */
export function parseLengthInput(
  raw: string,
  units: LengthUnit,
  worldUnit: LengthUnit = units === 'ft-in' ? 'ft' : units,
): number | null {
  const parsed = parseLength(raw, worldUnit, units);
  return parsed ? parsed.worldValue : null;
}

/** Convert a length expressed in `from` into document world units (`world`). */
export function convertToWorld(
  value: number,
  from: LengthUnit,
  world: LengthUnit,
): number {
  const fromUnit: LengthUnit = from === 'ft-in' ? 'ft' : from;
  const toUnit: LengthUnit = world === 'ft-in' ? 'ft' : world;
  return convertLength(value, fromUnit, toUnit);
}

export function validateWallGeometry(wall: WallEntity): boolean {
  return (
    Number.isFinite(wall.geometry.start.x) &&
    Number.isFinite(wall.geometry.start.y) &&
    Number.isFinite(wall.geometry.end.x) &&
    Number.isFinite(wall.geometry.end.y) &&
    distance(wall.geometry.start, wall.geometry.end) > 1e-9 &&
    Number.isFinite(wall.geometry.thickness) &&
    wall.geometry.thickness > 1e-9 &&
    Number.isFinite(wall.geometry.height) &&
    wall.geometry.height > 0
  );
}

export function validateDoorGeometry(door: DoorEntity): boolean {
  return (
    typeof door.geometry.hostWallId === 'string' &&
    door.geometry.hostWallId.length > 0 &&
    Number.isFinite(door.geometry.position) &&
    door.geometry.position >= 0 &&
    door.geometry.position <= 1 &&
    Number.isFinite(door.geometry.width) &&
    door.geometry.width > 1e-9 &&
    Number.isFinite(door.geometry.height) &&
    door.geometry.height > 0 &&
    Number.isFinite(door.geometry.swingAngle) &&
    door.geometry.swingAngle > 0
  );
}

export function validateWindowGeometry(window: WindowEntity): boolean {
  return (
    typeof window.geometry.hostWallId === 'string' &&
    window.geometry.hostWallId.length > 0 &&
    Number.isFinite(window.geometry.position) &&
    window.geometry.position >= 0 &&
    window.geometry.position <= 1 &&
    Number.isFinite(window.geometry.width) &&
    window.geometry.width > 1e-9 &&
    Number.isFinite(window.geometry.height) &&
    window.geometry.height > 0 &&
    Number.isFinite(window.geometry.sillHeight) &&
    window.geometry.sillHeight >= 0
  );
}
