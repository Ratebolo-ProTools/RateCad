/**
 * AreaMeasurementEngine — reusable AutoCAD-style area/perimeter API.
 *
 * Future consumers (rooms, openings, BOQ, schedules) should call this engine
 * rather than reimplementing area formulas.
 */

import type { Entity, EntityId, LengthUnit, Vec2 } from '@ratecad/core';
import {
  addAreaEntry,
  areaFromCircle,
  areaFromEntity,
  areaFromOrientedRectangle,
  areaFromPoints,
  areaFromPolygon,
  areaFromPolyline,
  areaFromRectangle,
  createAreaSession,
  setAreaSessionMode,
  type AreaComputation,
  type AreaResult,
  type AreaSession,
  type AreaSessionMode,
} from './areaEngine.js';
import { formatWorldArea, formatWorldLength } from './unitEngine.js';

/** Structured measurement payload for UI / reports / future BOQ. */
export interface AreaMeasurement {
  area: number;
  perimeter: number;
  measurementType:
    | 'rectangle'
    | 'square'
    | 'circle'
    | 'polyline'
    | 'polygon'
    | 'points'
    | 'room'
    | 'boundary'
    | 'add-subtract'
    | 'object';
  /** World linear unit of the document (area is in world²). */
  unit: LengthUnit;
  sourceEntityId?: EntityId;
  /** True when perimeter is a circumference (circles). */
  perimeterIsCircumference: boolean;
  objectType?: string;
  warnings: string[];
}

export interface AreaMeasurementDisplay {
  areaText: string;
  perimeterText: string;
  perimeterLabel: 'Perimeter' | 'Circumference';
  objectType: string;
  unitLabel: string;
  squareUnitLabel: string;
  /** Multi-line professional report. */
  lines: string[];
  summary: string;
}

function squareUnitLabel(displayUnit: LengthUnit): string {
  switch (displayUnit) {
    case 'ft':
    case 'ft-in':
      return 'ft²';
    case 'in':
      return 'in²';
    case 'm':
      return 'm²';
    case 'cm':
      return 'cm²';
    case 'mm':
      return 'mm²';
  }
}

function unitLabel(displayUnit: LengthUnit): string {
  switch (displayUnit) {
    case 'ft-in':
      return 'Feet & Inches';
    case 'ft':
      return 'Feet';
    case 'in':
      return 'Inches';
    case 'm':
      return 'Meters';
    case 'cm':
      return 'Centimeters';
    case 'mm':
      return 'Millimeters';
  }
}

function methodToType(
  method: AreaResult['calculationMethod'],
  area: number,
  perimeter: number,
): AreaMeasurement['measurementType'] {
  if (method === 'circle') return 'circle';
  if (method === 'rectangle') {
    // Square when sides equal (within tolerance)
    const side = Math.sqrt(area);
    const expectedPeri = 4 * side;
    if (Math.abs(perimeter - expectedPeri) < 1e-6) return 'square';
    return 'rectangle';
  }
  if (method === 'polyline') return 'polyline';
  if (method === 'points') return 'points';
  if (method === 'room') return 'room';
  if (method === 'boundary') return 'boundary';
  if (method === 'add-subtract') return 'add-subtract';
  return 'object';
}

function objectTypeLabel(
  measurementType: AreaMeasurement['measurementType'],
  entityType?: string,
): string {
  if (entityType) {
    return entityType.charAt(0).toUpperCase() + entityType.slice(1);
  }
  switch (measurementType) {
    case 'circle':
      return 'Circle';
    case 'square':
      return 'Square';
    case 'rectangle':
      return 'Rectangle';
    case 'polyline':
      return 'Polyline';
    case 'polygon':
      return 'Polygon';
    case 'points':
      return 'Point-defined area';
    case 'room':
      return 'Room';
    case 'boundary':
      return 'Boundary';
    default:
      return 'Area';
  }
}

export function toAreaMeasurement(
  result: AreaResult,
  worldUnit: LengthUnit,
  entityType?: string,
): AreaMeasurement {
  const measurementType = methodToType(
    result.calculationMethod,
    result.area,
    result.perimeter,
  );
  return {
    area: result.area,
    perimeter: result.perimeter,
    measurementType,
    unit: worldUnit === 'ft-in' ? 'ft' : worldUnit,
    sourceEntityId: result.sourceObjectIds[0],
    perimeterIsCircumference: result.calculationMethod === 'circle',
    objectType: objectTypeLabel(measurementType, entityType),
    warnings: result.warnings,
  };
}

export function formatAreaMeasurement(
  measurement: AreaMeasurement,
  worldUnit: LengthUnit,
  displayUnit: LengthUnit,
  precision = 2,
): AreaMeasurementDisplay {
  const areaText = formatWorldArea(
    measurement.area,
    worldUnit,
    displayUnit,
    precision,
  );
  const perimeterText = formatWorldLength(
    measurement.perimeter,
    worldUnit,
    displayUnit,
    { precision },
  );
  const perimeterLabel = measurement.perimeterIsCircumference
    ? 'Circumference'
    : 'Perimeter';
  const objectType = measurement.objectType ?? 'Area';
  const sq = squareUnitLabel(displayUnit);
  const lines = [
    `Object: ${objectType}`,
    `Area: ${areaText}`,
    `${perimeterLabel}: ${perimeterText}`,
    `Document unit: ${unitLabel(displayUnit)} (${sq})`,
  ];
  if (measurement.warnings.length) {
    for (const w of measurement.warnings) lines.push(`Note: ${w}`);
  }
  return {
    areaText,
    perimeterText,
    perimeterLabel,
    objectType,
    unitLabel: unitLabel(displayUnit),
    squareUnitLabel: sq,
    lines,
    summary: `Area: ${areaText}  ·  ${perimeterLabel}: ${perimeterText}`,
  };
}

/**
 * Central engine facade — single place for area math used by AREA tool,
 * rooms, and future quantity features.
 */
export class AreaMeasurementEngine {
  measureEntity(
    entity: Entity,
    worldUnit: LengthUnit,
    options?: { forceCloseOpenPolyline?: boolean },
  ): { ok: true; measurement: AreaMeasurement; result: AreaResult } | AreaComputation {
    const computation = areaFromEntity(entity, options);
    if (!computation.ok) return computation;
    return {
      ok: true,
      result: computation,
      measurement: toAreaMeasurement(computation, worldUnit, entity.type),
    };
  }

  measureRectangle(
    corner1: Vec2,
    corner2: Vec2,
    worldUnit: LengthUnit,
    sourceId?: EntityId,
  ) {
    const computation = areaFromRectangle(corner1, corner2, sourceId);
    if (!computation.ok) return computation;
    return {
      ok: true as const,
      result: computation,
      measurement: toAreaMeasurement(computation, worldUnit, 'rectangle'),
    };
  }

  /** Oriented / rotated rectangle from four corner points (order around boundary). */
  measureOrientedRectangle(
    corners: [Vec2, Vec2, Vec2, Vec2],
    worldUnit: LengthUnit,
    sourceId?: EntityId,
  ) {
    const computation = areaFromOrientedRectangle(corners, sourceId);
    if (!computation.ok) return computation;
    return {
      ok: true as const,
      result: computation,
      measurement: toAreaMeasurement(computation, worldUnit, 'rectangle'),
    };
  }

  measureCircle(center: Vec2, radius: number, worldUnit: LengthUnit, sourceId?: EntityId) {
    const computation = areaFromCircle(center, radius, sourceId);
    if (!computation.ok) return computation;
    return {
      ok: true as const,
      result: computation,
      measurement: toAreaMeasurement(computation, worldUnit, 'circle'),
    };
  }

  measureClosedPolyline(
    vertices: Vec2[],
    worldUnit: LengthUnit,
    sourceId?: EntityId,
  ) {
    const computation = areaFromPolyline(vertices, true, sourceId);
    if (!computation.ok) return computation;
    return {
      ok: true as const,
      result: computation,
      measurement: toAreaMeasurement(computation, worldUnit, 'polyline'),
    };
  }

  measurePolygon(vertices: Vec2[], worldUnit: LengthUnit) {
    const computation = areaFromPolygon(vertices, { method: 'points' });
    if (!computation.ok) return computation;
    return {
      ok: true as const,
      result: computation,
      measurement: toAreaMeasurement(computation, worldUnit),
    };
  }

  /** Point sequence — closes last→first without requiring user to re-click first. */
  measurePoints(points: Vec2[], worldUnit: LengthUnit) {
    const computation = areaFromPoints(points, true);
    if (!computation.ok) return computation;
    return {
      ok: true as const,
      result: computation,
      measurement: toAreaMeasurement(computation, worldUnit),
    };
  }

  createSession(): AreaSession {
    return createAreaSession();
  }

  setMode(session: AreaSession, mode: AreaSessionMode): AreaSession {
    return setAreaSessionMode(session, mode);
  }

  add(session: AreaSession, result: AreaResult, label: string): AreaSession {
    return addAreaEntry(session, result, label);
  }

  format(
    measurement: AreaMeasurement,
    worldUnit: LengthUnit,
    displayUnit: LengthUnit,
    precision = 2,
  ): AreaMeasurementDisplay {
    return formatAreaMeasurement(measurement, worldUnit, displayUnit, precision);
  }
}

/** Shared singleton for convenience (stateless). */
export const areaMeasurementEngine = new AreaMeasurementEngine();
