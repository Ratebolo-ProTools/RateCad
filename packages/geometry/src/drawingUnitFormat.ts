/**
 * AutoCAD-style UNITS display formatting (LUNITS / AUNITS).
 * Geometry is never modified — formatting only.
 */

import type {
  AngularUnitFormat,
  DrawingUnitsSettings,
  LengthUnit,
  LinearUnitFormat,
} from '@ratecad/core';
import {
  ARCH_PRECISION_DENOMINATORS,
  insertionToLengthUnit,
} from '@ratecad/core';
import {
  formatArchitecturalFeet,
  type FractionDenominator,
  worldToDisplay,
} from './unitEngine.js';

function archDenom(precision: number): FractionDenominator {
  const d = ARCH_PRECISION_DENOMINATORS[precision] ?? 16;
  if (d === 1 || d === 2 || d === 4 || d === 8 || d === 16 || d === 32) return d;
  // 64+ not in FractionDenominator — clamp display to 32 for formatter
  return 32;
}

function roundTo(value: number, roundOff: number): number {
  if (!(roundOff > 0)) return value;
  return Math.round(value / roundOff) * roundOff;
}

/** Format a length already expressed in `unit` using LUNITS-style format. */
export function formatLinearByFormat(
  valueInUnit: number,
  format: LinearUnitFormat,
  precision: number,
  unit: LengthUnit,
): string {
  if (!Number.isFinite(valueInUnit)) return '—';
  const sign = valueInUnit < 0 ? '-' : '';
  const abs = Math.abs(valueInUnit);
  const p = Math.max(0, Math.min(8, Math.round(precision)));

  switch (format) {
    case 'scientific':
      return `${sign}${abs.toExponential(p)}`;
    case 'engineering': {
      // Feet and decimal inches: 1'-6.50"
      const feet = unit === 'ft' || unit === 'ft-in' ? abs : worldToDisplay(abs, unit, 'ft');
      const wholeFt = Math.floor(feet + 1e-12);
      const inches = (feet - wholeFt) * 12;
      return `${sign}${wholeFt}'-${inches.toFixed(Math.min(p, 4))}"`;
    }
    case 'architectural': {
      const feet = unit === 'ft' || unit === 'ft-in' ? abs : worldToDisplay(abs, unit, 'ft');
      return sign + formatArchitecturalFeet(feet, archDenom(p));
    }
    case 'fractional': {
      const denom = archDenom(p);
      const whole = Math.floor(abs + 1e-12);
      const frac = abs - whole;
      let numer = Math.round(frac * denom);
      let carry = 0;
      if (numer >= denom) {
        carry = Math.floor(numer / denom);
        numer %= denom;
      }
      const w = whole + carry;
      if (numer === 0) return `${sign}${w}`;
      return `${sign}${w} ${numer}/${denom}`;
    }
    case 'decimal':
    default:
      return `${sign}${abs.toFixed(p)}`;
  }
}

/** Format world length using document Drawing Units (not DIMSTYLE). */
export function formatWorldByDrawingUnits(
  worldValue: number,
  worldUnit: LengthUnit,
  drawingUnits: DrawingUnitsSettings,
): string {
  const displayUnit = insertionToLengthUnit(
    drawingUnits.insertionUnit,
    worldUnit,
  );
  let valueInUnit: number;
  if (
    drawingUnits.linearFormat === 'architectural' ||
    drawingUnits.linearFormat === 'engineering'
  ) {
    valueInUnit = worldToDisplay(worldValue, worldUnit, 'ft');
  } else {
    valueInUnit = worldToDisplay(worldValue, worldUnit, displayUnit);
  }
  const formatted = formatLinearByFormat(
    valueInUnit,
    drawingUnits.linearFormat,
    drawingUnits.linearPrecision,
    displayUnit,
  );
  // Append unit suffix for decimal/scientific when useful
  if (
    drawingUnits.linearFormat === 'decimal' ||
    drawingUnits.linearFormat === 'scientific'
  ) {
    const suffix =
      displayUnit === 'ft'
        ? ' ft'
        : displayUnit === 'in'
          ? '"'
          : displayUnit === 'm'
            ? ' m'
            : displayUnit === 'cm'
              ? ' cm'
              : displayUnit === 'mm'
                ? ' mm'
                : '';
    if (drawingUnits.linearFormat === 'decimal' && suffix) {
      return `${formatted}${suffix === '"' ? '"' : suffix}`;
    }
  }
  return formatted;
}

/** Format an angle in degrees using AUNITS. */
export function formatAngleByDrawingUnits(
  degrees: number,
  format: AngularUnitFormat,
  precision: number,
): string {
  if (!Number.isFinite(degrees)) return '—';
  const p = Math.max(0, Math.min(8, Math.round(precision)));
  const sign = degrees < 0 ? '-' : '';
  const abs = Math.abs(degrees);

  switch (format) {
    case 'gradians': {
      const gon = (abs * 10) / 9;
      return `${sign}${gon.toFixed(p)}g`;
    }
    case 'radians': {
      const rad = (abs * Math.PI) / 180;
      return `${sign}${rad.toFixed(Math.max(p, 4))}r`;
    }
    case 'deg-min-sec': {
      const d = Math.floor(abs + 1e-12);
      const minFloat = (abs - d) * 60;
      const m = Math.floor(minFloat + 1e-12);
      const s = (minFloat - m) * 60;
      if (p <= 0) return `${sign}${d}°`;
      if (p === 1) return `${sign}${d}°${m}'`;
      return `${sign}${d}°${m}'${s.toFixed(Math.max(0, p - 2))}"`;
    }
    case 'surveyor': {
      // Simplified quadrant bearing from +X (east)
      const norm = ((abs % 360) + 360) % 360;
      let bearing: string;
      if (norm <= 90) bearing = `N${norm.toFixed(p)}E`;
      else if (norm <= 180) bearing = `S${(180 - norm).toFixed(p)}E`;
      else if (norm <= 270) bearing = `S${(norm - 180).toFixed(p)}W`;
      else bearing = `N${(360 - norm).toFixed(p)}W`;
      return sign ? `-${bearing}` : bearing;
    }
    case 'decimal-degrees':
    default:
      return `${sign}${abs.toFixed(p)}°`;
  }
}

export { roundTo };
