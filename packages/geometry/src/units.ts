import type { LengthUnit } from '@ratecad/core';
import {
  formatWorldLength,
  type FractionDenominator,
} from './unitEngine.js';

/**
 * Format a world-storage length for display.
 *
 * @param value World-unit length (document settings.worldUnit)
 * @param units Display unit (document settings.units)
 * @param precision Decimal digits (ignored for pure architectural fraction mode)
 * @param worldUnit Canonical storage unit — defaults to `units` for legacy callers
 * @param fractionDenominator Architectural fraction denominator when units is ft-in
 */
export function formatLengthInUnits(
  value: number,
  units: LengthUnit,
  precision = 2,
  worldUnit: LengthUnit = units === 'ft-in' ? 'ft' : units,
  fractionDenominator: number = 16,
): string {
  const denom = ([1, 2, 4, 8, 16, 32].includes(fractionDenominator)
    ? fractionDenominator
    : 16) as FractionDenominator;
  return formatWorldLength(value, worldUnit, units, {
    precision,
    fractionDenominator: denom,
  });
}

export function measuredLength(
  start: { x: number; y: number },
  end: { x: number; y: number },
  kind: 'horizontal' | 'vertical' | 'aligned' | 'radius' | 'diameter' | 'angular',
): number {
  switch (kind) {
    case 'horizontal':
      return Math.abs(end.x - start.x);
    case 'vertical':
      return Math.abs(end.y - start.y);
    case 'aligned':
      return Math.hypot(end.x - start.x, end.y - start.y);
    case 'radius':
      return Math.hypot(end.x - start.x, end.y - start.y);
    case 'diameter':
      return Math.hypot(end.x - start.x, end.y - start.y) * 2;
    case 'angular':
      return 0;
  }
}

/** Measured angle in degrees between two rays from vertex. */
export function measuredAngleDeg(
  vertex: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const ang = (p: { x: number; y: number }) =>
    Math.atan2(p.y - vertex.y, p.x - vertex.x);
  let deg = ((ang(b) - ang(a)) * 180) / Math.PI;
  while (deg < 0) deg += 360;
  while (deg > 360) deg -= 360;
  if (deg > 180) deg = 360 - deg;
  return deg;
}

export function formatAngleDegrees(degrees: number, precision = 2): string {
  if (!Number.isFinite(degrees)) return '—';
  return `${degrees.toFixed(Math.max(0, precision))}°`;
}
