/**
 * RateCAD Area Engine — deterministic model-space area/perimeter calculations.
 *
 * Always operates on CAD/world coordinates (settings.worldUnit).
 * Never uses screen pixels or zoom.
 */

import type { Entity, EntityId, LengthUnit, Vec2 } from '@ratecad/core';
import { distance } from './math.js';
import {
  pointInPolygon,
  polygonArea,
  polygonCentroid,
  polygonSignedArea,
} from './rooms.js';
import { convertArea, formatWorldArea, formatWorldLength } from './unitEngine.js';
import { intersectSegments } from './intersect.js';

export type AreaCalculationMethod =
  | 'object'
  | 'points'
  | 'boundary'
  | 'room'
  | 'add-subtract'
  | 'circle'
  | 'rectangle'
  | 'polyline';

export type AreaSessionMode = 'add' | 'subtract';

export interface AreaResult {
  ok: true;
  /** Net area in world square units. */
  area: number;
  /** Boundary perimeter (sum of outer + holes unless noted). */
  perimeter: number;
  /** Outer boundary polygon (model coords). */
  outer: Vec2[];
  /** Inner hole polygons. */
  holes: Vec2[][];
  /** Gross outer area before holes. */
  outerArea: number;
  /** Sum of hole areas. */
  holesArea: number;
  calculationMethod: AreaCalculationMethod;
  sourceObjectIds: EntityId[];
  warnings: string[];
  /** Explicit: perimeter is sum of each listed boundary length. */
  perimeterKind: 'boundary-sum';
}

export interface AreaError {
  ok: false;
  reason: string;
  code:
    | 'open'
    | 'self-intersecting'
    | 'invalid'
    | 'unsupported'
    | 'not-found'
    | 'degenerate';
  warnings?: string[];
}

export type AreaComputation = AreaResult | AreaError;

export interface AreaSessionEntry {
  id: string;
  operation: AreaSessionMode;
  result: AreaResult;
  label: string;
}

export interface AreaSession {
  mode: AreaSessionMode;
  entries: AreaSessionEntry[];
  /** Running net total in world square units. */
  totalArea: number;
}

export function createAreaSession(): AreaSession {
  return { mode: 'add', entries: [], totalArea: 0 };
}

export function polygonPerimeter(polygon: Vec2[]): number {
  if (polygon.length < 2) return 0;
  let p = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    p += distance(a, b);
  }
  return p;
}

/** Proper segment intersection excluding shared endpoints (bow-tie detection). */
export function segmentsProperlyIntersect(
  a1: Vec2,
  a2: Vec2,
  b1: Vec2,
  b2: Vec2,
): boolean {
  const hit = intersectSegments(a1, a2, b1, b2, false);
  return hit != null;
}

/** Detect self-intersecting simple polygon (non-adjacent edges cross). */
export function isSelfIntersectingPolygon(polygon: Vec2[]): boolean {
  const n = polygon.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i += 1) {
    const a1 = polygon[i]!;
    const a2 = polygon[(i + 1) % n]!;
    for (let j = i + 1; j < n; j += 1) {
      // Skip adjacent edges and the closing edge pair
      if (Math.abs(i - j) <= 1) continue;
      if (i === 0 && j === n - 1) continue;
      if (j === 0 && i === n - 1) continue;
      // Also skip edges that share a vertex via wrap
      if ((i + 1) % n === j || (j + 1) % n === i) continue;
      const b1 = polygon[j]!;
      const b2 = polygon[(j + 1) % n]!;
      if (segmentsProperlyIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

function ensureClosed(points: Vec2[]): Vec2[] {
  if (points.length < 2) return points.map((p) => ({ ...p }));
  const out = points.map((p) => ({ ...p }));
  const first = out[0]!;
  const last = out[out.length - 1]!;
  if (distance(first, last) > 1e-9) {
    // already open ring of vertices — polygonArea closes implicitly
  }
  return out;
}

export function areaFromPolygon(
  polygon: Vec2[],
  options: {
    holes?: Vec2[][];
    method?: AreaCalculationMethod;
    sourceObjectIds?: EntityId[];
    allowOpenClose?: boolean;
    warnings?: string[];
  } = {},
): AreaComputation {
  const warnings = [...(options.warnings ?? [])];
  if (polygon.length < 3) {
    return {
      ok: false,
      reason: 'Need at least 3 points to form an area',
      code: 'degenerate',
    };
  }
  const outer = ensureClosed(polygon);
  if (isSelfIntersectingPolygon(outer)) {
    return {
      ok: false,
      reason: 'Cannot calculate area: Boundary is self-intersecting.',
      code: 'self-intersecting',
    };
  }
  const outerArea = polygonArea(outer);
  if (!(outerArea > 1e-12)) {
    return {
      ok: false,
      reason: 'Degenerate boundary — area is zero',
      code: 'degenerate',
    };
  }

  const holes: Vec2[][] = [];
  let holesArea = 0;
  for (const hole of options.holes ?? []) {
    if (hole.length < 3) continue;
    if (isSelfIntersectingPolygon(hole)) {
      warnings.push('Skipped self-intersecting hole');
      continue;
    }
    const ha = polygonArea(hole);
    if (!(ha > 1e-12)) continue;
    // Hole must be inside outer
    const c = polygonCentroid(hole);
    if (!pointInPolygon(c, outer)) {
      warnings.push('Skipped hole outside outer boundary');
      continue;
    }
    holes.push(hole.map((p) => ({ ...p })));
    holesArea += ha;
  }

  const net = outerArea - holesArea;
  if (!(net > 1e-12)) {
    return {
      ok: false,
      reason: 'Net area is zero or negative after subtracting holes',
      code: 'invalid',
      warnings,
    };
  }

  let perimeter = polygonPerimeter(outer);
  for (const h of holes) perimeter += polygonPerimeter(h);

  return {
    ok: true,
    area: net,
    perimeter,
    outer,
    holes,
    outerArea,
    holesArea,
    calculationMethod: options.method ?? 'points',
    sourceObjectIds: options.sourceObjectIds ?? [],
    warnings,
    perimeterKind: 'boundary-sum',
  };
}

/** Point-pick area: closes from last point back to first (AutoCAD AREA behavior). */
export function areaFromPoints(
  points: Vec2[],
  explicitClose = true,
): AreaComputation {
  if (points.length < 3) {
    return {
      ok: false,
      reason: 'Need at least 3 points',
      code: 'degenerate',
    };
  }
  const warnings: string[] = [];
  if (explicitClose) {
    warnings.push('Closed temporarily from last point to first point');
  }
  return areaFromPolygon(points, { method: 'points', warnings });
}

export function areaFromCircle(
  center: Vec2,
  radius: number,
  sourceId?: EntityId,
): AreaComputation {
  if (!(radius > 1e-12)) {
    return { ok: false, reason: 'Invalid circle radius', code: 'degenerate' };
  }
  const area = Math.PI * radius * radius;
  const perimeter = 2 * Math.PI * radius;
  // Approximate outer ring for highlight (not used for math)
  const steps = 64;
  const outer: Vec2[] = [];
  for (let i = 0; i < steps; i += 1) {
    const a = (i / steps) * Math.PI * 2;
    outer.push({
      x: center.x + radius * Math.cos(a),
      y: center.y + radius * Math.sin(a),
    });
  }
  return {
    ok: true,
    area,
    perimeter,
    outer,
    holes: [],
    outerArea: area,
    holesArea: 0,
    calculationMethod: 'circle',
    sourceObjectIds: sourceId ? [sourceId] : [],
    warnings: [],
    perimeterKind: 'boundary-sum',
  };
}

export function areaFromRectangle(
  corner1: Vec2,
  corner2: Vec2,
  sourceId?: EntityId,
): AreaComputation {
  // Axis-aligned rectangle from opposite corners — derive length/width from
  // actual geometry extents (survives transform of corner storage).
  const minX = Math.min(corner1.x, corner2.x);
  const maxX = Math.max(corner1.x, corner2.x);
  const minY = Math.min(corner1.y, corner2.y);
  const maxY = Math.max(corner1.y, corner2.y);
  const length = maxX - minX;
  const width = maxY - minY;
  if (!(length > 1e-12) || !(width > 1e-12)) {
    return { ok: false, reason: 'Degenerate rectangle', code: 'degenerate' };
  }
  const outer: Vec2[] = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
  const result = areaFromPolygon(outer, {
    method: 'rectangle',
    sourceObjectIds: sourceId ? [sourceId] : [],
  });
  // Guard: area must equal length × width; perimeter 2×(L+W)
  if (result.ok) {
    const expectedArea = length * width;
    const expectedPeri = 2 * (length + width);
    if (Math.abs(result.area - expectedArea) > 1e-6) {
      return { ...result, area: expectedArea, outerArea: expectedArea };
    }
    if (Math.abs(result.perimeter - expectedPeri) > 1e-6) {
      return { ...result, perimeter: expectedPeri };
    }
  }
  return result;
}

/**
 * Oriented / rotated rectangle from four boundary corners (in order).
 * Uses shoelace — does not assume axis alignment.
 */
export function areaFromOrientedRectangle(
  corners: [Vec2, Vec2, Vec2, Vec2] | Vec2[],
  sourceId?: EntityId,
): AreaComputation {
  if (corners.length !== 4) {
    return {
      ok: false,
      reason: 'Oriented rectangle requires exactly 4 corners',
      code: 'degenerate',
    };
  }
  return areaFromPolygon([...corners], {
    method: 'rectangle',
    sourceObjectIds: sourceId ? [sourceId] : [],
  });
}

export function areaFromPolyline(
  vertices: Vec2[],
  closed: boolean,
  sourceId?: EntityId,
  forceClose = false,
): AreaComputation {
  if (vertices.length < 3) {
    return {
      ok: false,
      reason: 'Polyline needs at least 3 vertices',
      code: 'degenerate',
    };
  }
  if (!closed && !forceClose) {
    return {
      ok: false,
      reason: 'Boundary is open.',
      code: 'open',
      warnings: [
        'Options: Close Temporarily, Create Boundary, or Cancel',
      ],
    };
  }
  const warnings =
    !closed && forceClose
      ? ['Open polyline closed temporarily from last to first vertex']
      : [];
  return areaFromPolygon(vertices, {
    method: 'polyline',
    sourceObjectIds: sourceId ? [sourceId] : [],
    warnings,
  });
}

/** Compute area for a single drawable entity. */
export function areaFromEntity(
  entity: Entity,
  options: { forceCloseOpenPolyline?: boolean } = {},
): AreaComputation {
  switch (entity.type) {
    case 'circle':
      return areaFromCircle(
        entity.geometry.center,
        entity.geometry.radius,
        entity.id,
      );
    case 'rectangle':
      return areaFromRectangle(
        entity.geometry.corner1,
        entity.geometry.corner2,
        entity.id,
      );
    case 'polyline':
      return areaFromPolyline(
        entity.geometry.vertices,
        entity.geometry.closed,
        entity.id,
        options.forceCloseOpenPolyline === true,
      );
    case 'room':
      return areaFromPolygon(entity.geometry.polygon, {
        method: 'room',
        sourceObjectIds: [entity.id],
      });
    case 'line':
    case 'wall':
    case 'dimension':
    case 'text':
    case 'leader':
    case 'door':
    case 'window':
      return {
        ok: false,
        reason: `Selected ${entity.type} is not a closed area boundary`,
        code: 'unsupported',
      };
    default:
      return {
        ok: false,
        reason: 'Unsupported entity type for area',
        code: 'unsupported',
      };
  }
}

export function addAreaEntry(
  session: AreaSession,
  result: AreaResult,
  label: string,
): AreaSession {
  const entry: AreaSessionEntry = {
    id: `area-${Date.now().toString(36)}-${session.entries.length}`,
    operation: session.mode,
    result,
    label,
  };
  const delta = session.mode === 'add' ? result.area : -result.area;
  return {
    ...session,
    entries: [...session.entries, entry],
    totalArea: session.totalArea + delta,
  };
}

export function undoAreaEntry(session: AreaSession): AreaSession {
  if (!session.entries.length) return session;
  const entries = session.entries.slice(0, -1);
  let total = 0;
  for (const e of entries) {
    total += e.operation === 'add' ? e.result.area : -e.result.area;
  }
  return { ...session, entries, totalArea: total };
}

export function setAreaSessionMode(
  session: AreaSession,
  mode: AreaSessionMode,
): AreaSession {
  return { ...session, mode };
}

/** Format an AreaResult using the Units Engine (display only). */
export function formatAreaResult(
  result: AreaResult,
  worldUnit: LengthUnit,
  displayUnit: LengthUnit,
  precision = 2,
): {
  areaText: string;
  perimeterText: string;
  netText: string;
  perimeterLabel: 'Perimeter' | 'Circumference';
} {
  const perimeterLabel =
    result.calculationMethod === 'circle' ? 'Circumference' : 'Perimeter';
  return {
    areaText: formatWorldArea(result.area, worldUnit, displayUnit, precision),
    perimeterText: formatWorldLength(result.perimeter, worldUnit, displayUnit, {
      precision,
    }),
    netText: formatWorldArea(result.area, worldUnit, displayUnit, precision),
    perimeterLabel,
  };
}

export function formatAreaSessionReport(
  session: AreaSession,
  worldUnit: LengthUnit,
  displayUnit: LengthUnit,
  precision = 2,
): string[] {
  const lines: string[] = ['AREA CALCULATION'];
  for (const e of session.entries) {
    const sign = e.operation === 'add' ? '+' : '-';
    const a = formatWorldArea(e.result.area, worldUnit, displayUnit, precision);
    lines.push(`${sign} ${e.label}  ${a}`);
  }
  lines.push('────────────────');
  lines.push(
    `NET = ${formatWorldArea(session.totalArea, worldUnit, displayUnit, precision)}`,
  );
  return lines;
}

/** Live preview while picking points (before commit). */
export function previewAreaFromPoints(points: Vec2[]): {
  area: number;
  perimeter: number;
  valid: boolean;
} {
  if (points.length < 3) {
    let peri = 0;
    for (let i = 1; i < points.length; i += 1) {
      peri += distance(points[i - 1]!, points[i]!);
    }
    return { area: 0, perimeter: peri, valid: false };
  }
  if (isSelfIntersectingPolygon(points)) {
    return { area: 0, perimeter: polygonPerimeter(points), valid: false };
  }
  return {
    area: polygonArea(points),
    perimeter: polygonPerimeter(points),
    valid: true,
  };
}

export {
  convertArea,
  formatWorldArea,
  pointInPolygon,
  polygonArea,
  polygonCentroid,
  polygonSignedArea,
};
