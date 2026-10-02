/**
 * RateCAD central unit conversion engine.
 *
 * Canonical interchange unit: millimeters (mm).
 * Document geometry is stored in settings.worldUnit (often 'ft' for legacy docs).
 * Display uses settings.units — changing display units never rewrites geometry.
 *
 * Exact constants (international foot):
 *   1 in = 25.4 mm
 *   1 ft = 12 in = 304.8 mm = 0.3048 m
 */

import type { LengthUnit } from '@ratecad/core';

/** Millimeters per unit (exact). */
export const MM_PER: Record<LengthUnit, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
  ft: 304.8,
  'ft-in': 304.8,
};

export const SUPPORTED_LENGTH_UNITS: LengthUnit[] = [
  'in',
  'ft-in',
  'ft',
  'm',
  'cm',
  'mm',
];

export const LENGTH_UNIT_LABELS: Record<LengthUnit, string> = {
  in: 'Inches',
  'ft-in': 'Feet & Inches',
  ft: 'Feet',
  m: 'Meters',
  cm: 'Centimeters',
  mm: 'Millimeters',
};

/** Architectural fractional-inch denominators. */
export type FractionDenominator = 1 | 2 | 4 | 8 | 16 | 32;

export const FRACTION_DENOMINATORS: FractionDenominator[] = [
  1, 2, 4, 8, 16, 32,
];

export type DecimalPrecision = 0 | 1 | 2 | 3 | 4;

export const DECIMAL_PRECISIONS: DecimalPrecision[] = [0, 1, 2, 3, 4];

/** Convert a length from one unit to another via exact mm hub. */
export function convertLength(
  value: number,
  from: LengthUnit,
  to: LengthUnit,
): number {
  if (!Number.isFinite(value)) return value;
  if (from === to) return value;
  const mm = value * MM_PER[from];
  return mm / MM_PER[to];
}

/** Convert length to canonical millimeters. */
export function toMillimeters(value: number, from: LengthUnit): number {
  return convertLength(value, from, 'mm');
}

/** Convert millimeters into a target unit. */
export function fromMillimeters(mm: number, to: LengthUnit): number {
  return convertLength(mm, 'mm', to);
}

/** World-storage length → display-unit length. */
export function worldToDisplay(
  worldValue: number,
  worldUnit: LengthUnit,
  displayUnit: LengthUnit,
): number {
  return convertLength(worldValue, worldUnit, displayUnit);
}

/** Display/typed length → world-storage length. */
export function displayToWorld(
  displayValue: number,
  displayUnit: LengthUnit,
  worldUnit: LengthUnit,
): number {
  return convertLength(displayValue, displayUnit, worldUnit);
}

/** Area: square of the linear conversion factor. */
export function convertArea(
  value: number,
  from: LengthUnit,
  to: LengthUnit,
): number {
  if (!Number.isFinite(value)) return value;
  if (from === to) return value;
  const factor = MM_PER[from] / MM_PER[to];
  return value * factor * factor;
}

/** Volume: cube of the linear conversion factor. */
export function convertVolume(
  value: number,
  from: LengthUnit,
  to: LengthUnit,
): number {
  if (!Number.isFinite(value)) return value;
  if (from === to) return value;
  const factor = MM_PER[from] / MM_PER[to];
  return value * factor * factor * factor;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

/**
 * Format a length that is already expressed in `unit`.
 * For architectural feet-inches use unit `'ft-in'` (value in feet).
 */
export function formatLengthValue(
  valueInUnit: number,
  unit: LengthUnit,
  options: {
    precision?: number;
    fractionDenominator?: FractionDenominator;
  } = {},
): string {
  if (!Number.isFinite(valueInUnit)) return '—';
  const precision = options.precision ?? 2;
  const abs = Math.abs(valueInUnit);
  const sign = valueInUnit < 0 ? '-' : '';

  switch (unit) {
    case 'ft-in':
      return (
        sign +
        formatArchitecturalFeet(
          abs,
          options.fractionDenominator ?? 16,
        )
      );
    case 'ft':
      return `${sign}${abs.toFixed(Math.max(0, precision))} ft`;
    case 'in':
      return `${sign}${abs.toFixed(Math.max(0, precision))}"`;
    case 'm':
      return `${sign}${abs.toFixed(Math.max(0, precision))} m`;
    case 'cm':
      return `${sign}${abs.toFixed(Math.max(0, precision))} cm`;
    case 'mm':
      return `${sign}${abs.toFixed(Math.max(0, precision))} mm`;
  }
}

/** Format world-storage length for the current display unit. */
export function formatWorldLength(
  worldValue: number,
  worldUnit: LengthUnit,
  displayUnit: LengthUnit,
  options: {
    precision?: number;
    fractionDenominator?: FractionDenominator;
  } = {},
): string {
  const display = worldToDisplay(worldValue, worldUnit, displayUnit);
  // Architectural formatter expects feet; convert display 'ft-in' from world via feet.
  if (displayUnit === 'ft-in') {
    const feet = worldToDisplay(worldValue, worldUnit, 'ft');
    return formatLengthValue(feet, 'ft-in', options);
  }
  return formatLengthValue(display, displayUnit, options);
}

export function formatArchitecturalFeet(
  feet: number,
  denominator: FractionDenominator = 16,
): string {
  if (!Number.isFinite(feet)) return '—';
  const sign = feet < 0 ? '-' : '';
  const abs = Math.abs(feet);
  const totalInches = abs * 12;
  const wholeInches = Math.floor(totalInches + 1e-12);
  const fracPart = totalInches - wholeInches;

  let numer = Math.round(fracPart * denominator);
  let carry = 0;
  if (numer >= denominator) {
    carry = Math.floor(numer / denominator);
    numer = numer % denominator;
  }
  let inches = wholeInches + carry;
  let ft = Math.floor(inches / 12);
  inches = inches % 12;

  if (numer === 0) {
    return `${sign}${ft}'-${inches}"`;
  }
  const g = gcd(numer, denominator);
  const n = numer / g;
  const d = denominator / g;
  return `${sign}${ft}'-${inches} ${n}/${d}"`;
}

/**
 * Parse architectural length strings into feet.
 * Supports: 3'-4", 3'4", 3'-4 3/16", 10'-6 1/2", 0'-6", 12", 3', 3.5'
 */
export function parseArchitecturalLength(raw: string): number | null {
  const text = raw.trim().toLowerCase().replace(/,/g, '');
  if (!text) return null;

  // 3'-4 3/16" or 10'-6 1/2" or 3' - 4 3/16"
  const withFrac = text.match(
    /^(-?\d+)\s*'\s*-?\s*(\d+)\s+(\d+)\s*\/\s*(\d+)\s*"?$/,
  );
  if (withFrac) {
    const feet = Number(withFrac[1]);
    const inches = Number(withFrac[2]);
    const n = Number(withFrac[3]);
    const d = Number(withFrac[4]);
    if (![feet, inches, n, d].every(Number.isFinite) || d === 0) return null;
    return feet + (inches + n / d) / 12;
  }

  // Fractional inches only: 6 1/2"
  const inchesFrac = text.match(/^(-?\d+)\s+(\d+)\s*\/\s*(\d+)\s*"$/);
  if (inchesFrac) {
    const inches = Number(inchesFrac[1]);
    const n = Number(inchesFrac[2]);
    const d = Number(inchesFrac[3]);
    if (![inches, n, d].every(Number.isFinite) || d === 0) return null;
    return (inches + n / d) / 12;
  }

  // 3'-4" or 3'4" or 3'-4 or 10'6"
  const arch = text.match(/^(-?\d+)\s*'\s*-?\s*(\d+(?:\.\d+)?)\s*"?$/);
  if (arch) {
    const feet = Number(arch[1]);
    const inches = Number(arch[2]);
    if (!Number.isFinite(feet) || !Number.isFinite(inches)) return null;
    return feet + inches / 12;
  }

  // 12" or 12.5"
  const inchesOnly = text.match(/^(-?\d+(?:\.\d+)?)\s*"$/);
  if (inchesOnly) {
    const inches = Number(inchesOnly[1]);
    if (!Number.isFinite(inches)) return null;
    return inches / 12;
  }

  // 3' or 3.5'
  const feetOnly = text.match(/^(-?\d+(?:\.\d+)?)\s*'$/);
  if (feetOnly) {
    const feet = Number(feetOnly[1]);
    return Number.isFinite(feet) ? feet : null;
  }

  return null;
}

const UNIT_ALIASES: Record<string, LengthUnit> = {
  in: 'in',
  inch: 'in',
  inches: 'in',
  '"': 'in',
  ft: 'ft',
  foot: 'ft',
  feet: 'ft',
  "'": 'ft',
  'ft-in': 'ft-in',
  'feet-inches': 'ft-in',
  'feet & inches': 'ft-in',
  m: 'm',
  meter: 'm',
  meters: 'm',
  metre: 'm',
  metres: 'm',
  cm: 'cm',
  centimeter: 'cm',
  centimeters: 'cm',
  centimetre: 'cm',
  centimetres: 'cm',
  mm: 'mm',
  millimeter: 'mm',
  millimeters: 'mm',
  millimetre: 'mm',
  millimetres: 'mm',
};

export function resolveUnitAlias(token: string): LengthUnit | null {
  const key = token.trim().toLowerCase();
  return UNIT_ALIASES[key] ?? null;
}

export interface ParsedLength {
  /** Value in world storage units. */
  worldValue: number;
  /** Unit the user expressed (before conversion to world). */
  sourceUnit: LengthUnit;
}

/**
 * Parse a user length string into world storage units.
 * Bare numbers are interpreted in `defaultUnit` (normally the display unit).
 *
 * Explicit unit examples (space optional):
 *   3000mm, 300cm, 3m, 10ft, 10', 10'6", 10'-6", 10'-6 1/2"
 */
export function parseLength(
  raw: string,
  worldUnit: LengthUnit,
  defaultUnit: LengthUnit = worldUnit,
): ParsedLength | null {
  const text = raw.trim().replace(/,/g, '');
  if (!text) return null;

  // Architectural forms → feet → world (10'6", 10'-6 1/2", 3'-4", …)
  const archFeet = parseArchitecturalLength(text);
  if (archFeet != null) {
    return {
      worldValue: convertLength(archFeet, 'ft', worldUnit),
      sourceUnit: 'ft-in',
    };
  }

  // Compact feet+inches without separator: 10'6" or 10'6
  const compactArch = text.match(/^(-?\d+)\s*'\s*(\d+(?:\.\d+)?)\s*"?$/);
  if (compactArch) {
    const feet = Number(compactArch[1]);
    const inches = Number(compactArch[2]);
    if (Number.isFinite(feet) && Number.isFinite(inches)) {
      return {
        worldValue: convertLength(feet + inches / 12, 'ft', worldUnit),
        sourceUnit: 'ft-in',
      };
    }
  }

  // Number + unit suffix — space optional (3000mm, 3.5 m, 10ft, 120")
  const withUnit = text.match(
    /^(-?\d+(?:\.\d+)?)\s*(mm|cm|m|in|ft|inches|inch|feet|foot|meters?|metres?|centimeters?|centimetres?|millimeters?|millimetres?|"|')$/i,
  );
  if (withUnit) {
    const n = Number(withUnit[1]);
    if (!Number.isFinite(n)) return null;
    // Allow zero only for explicit typed values (rare); reject for bare unitless elsewhere.
    if (n === 0) {
      return { worldValue: 0, sourceUnit: defaultUnit === 'ft-in' ? 'ft' : defaultUnit };
    }
    const alias = resolveUnitAlias(withUnit[2]!);
    if (!alias) return null;
    const source: LengthUnit = alias === 'ft-in' ? 'ft' : alias;
    return {
      worldValue: convertLength(n, source, worldUnit),
      sourceUnit: source,
    };
  }

  const plain = Number(text);
  if (!Number.isFinite(plain) || plain === 0) return null;
  const source = defaultUnit === 'ft-in' ? 'ft' : defaultUnit;
  return {
    worldValue: convertLength(plain, source, worldUnit),
    sourceUnit: source,
  };
}

/** Format world area for display. */
export function formatWorldArea(
  worldArea: number,
  worldUnit: LengthUnit,
  displayUnit: LengthUnit,
  precision = 2,
): string {
  if (!Number.isFinite(worldArea) || worldArea < 0) return '—';
  const linearDisplay: LengthUnit =
    displayUnit === 'ft-in' ? 'ft' : displayUnit;
  const area = convertArea(worldArea, worldUnit, linearDisplay);
  const p = Math.max(0, precision);
  switch (displayUnit) {
    case 'ft-in':
    case 'ft':
      return `${area.toFixed(p)} sq ft`;
    case 'in':
      return `${area.toFixed(p)} sq in`;
    case 'm':
      return `${area.toFixed(p)} m²`;
    case 'cm':
      return `${area.toFixed(p)} cm²`;
    case 'mm':
      return `${area.toFixed(p)} mm²`;
  }
}

/** Format world volume for display. */
export function formatWorldVolume(
  worldVolume: number,
  worldUnit: LengthUnit,
  displayUnit: LengthUnit,
  precision = 2,
): string {
  if (!Number.isFinite(worldVolume) || worldVolume < 0) return '—';
  const linearDisplay: LengthUnit =
    displayUnit === 'ft-in' ? 'ft' : displayUnit;
  const vol = convertVolume(worldVolume, worldUnit, linearDisplay);
  const p = Math.max(0, precision);
  switch (displayUnit) {
    case 'ft-in':
    case 'ft':
      return `${vol.toFixed(p)} cu ft`;
    case 'in':
      return `${vol.toFixed(p)} cu in`;
    case 'm':
      return `${vol.toFixed(p)} m³`;
    case 'cm':
      return `${vol.toFixed(p)} cm³`;
    case 'mm':
      return `${vol.toFixed(p)} mm³`;
  }
}

/**
 * Suggested grid size in world units for a display unit.
 * Keeps the grid visually useful (≈ 1 major display unit).
 */
export function suggestedGridSize(
  worldUnit: LengthUnit,
  displayUnit: LengthUnit,
): number {
  const oneDisplay =
    displayUnit === 'ft-in' || displayUnit === 'ft'
      ? 1
      : displayUnit === 'in'
        ? 12
        : displayUnit === 'm'
          ? 1
          : displayUnit === 'cm'
            ? 100
            : 1000;
  // oneDisplay is in a convenient display scale; convert to world
  if (displayUnit === 'ft-in' || displayUnit === 'ft') {
    return convertLength(1, 'ft', worldUnit);
  }
  if (displayUnit === 'in') {
    return convertLength(1, 'in', worldUnit);
  }
  if (displayUnit === 'm') {
    return convertLength(1, 'm', worldUnit);
  }
  if (displayUnit === 'cm') {
    return convertLength(10, 'cm', worldUnit); // 10 cm
  }
  return convertLength(100, 'mm', worldUnit); // 100 mm
  void oneDisplay;
}

/** Normalize legacy unit tokens from saved files. */
export function normalizeLengthUnit(raw: unknown): LengthUnit {
  if (raw === 'ft-in' || raw === 'ft' || raw === 'in' || raw === 'm' || raw === 'cm' || raw === 'mm') {
    return raw;
  }
  // Legacy: 'ft' meant architectural feet-inches display of foot world coords.
  return 'ft';
}
