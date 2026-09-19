export interface Vec2 {
  x: number;
  y: number;
}

export function vec2(x: number, y: number): Vec2 {
  return { x, y };
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(a: Vec2, s: number): Vec2 {
  return { x: a.x * s, y: a.y * s };
}

export function distance(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

export function midpoint(a: Vec2, b: Vec2): Vec2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function snapToGrid(point: Vec2, gridSize: number): Vec2 {
  if (gridSize <= 0) return { ...point };
  return {
    x: Math.round(point.x / gridSize) * gridSize,
    y: Math.round(point.y / gridSize) * gridSize,
  };
}

export interface AABB {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function aabbFromPoints(a: Vec2, b: Vec2): AABB {
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  };
}

export function pointNearSegment(
  point: Vec2,
  a: Vec2,
  b: Vec2,
  tolerance: number,
): boolean {
  const len = distance(a, b);
  if (len === 0) return distance(point, a) <= tolerance;

  const t = Math.max(
    0,
    Math.min(1, ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / (len * len)),
  );
  const proj = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
  return distance(point, proj) <= tolerance;
}

export function pointNearCircle(
  point: Vec2,
  center: Vec2,
  radius: number,
  tolerance: number,
): boolean {
  return Math.abs(distance(point, center) - radius) <= tolerance;
}

export function pointInAABB(point: Vec2, box: AABB, pad = 0): boolean {
  return (
    point.x >= box.minX - pad &&
    point.x <= box.maxX + pad &&
    point.y >= box.minY - pad &&
    point.y <= box.maxY + pad
  );
}

export function formatLength(value: number, precision = 2): string {
  const fixed = value.toFixed(precision);
  return Number.parseFloat(fixed) === 0 ? (0).toFixed(precision) : fixed;
}
