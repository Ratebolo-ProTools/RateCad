/**
 * AutoCAD-style Drawing Units (UNITS command / LUNITS / AUNITS / INSUNITS).
 *
 * Display formatting only — never rewrites internal geometry (worldUnit).
 * LUNITS does NOT control dimension text (that is DIMSTYLE / DIMLUNIT).
 */

import type { LengthUnit } from './types.js';

/** AutoCAD LUNITS linear display formats. */
export type LinearUnitFormat =
  | 'scientific'
  | 'decimal'
  | 'engineering'
  | 'architectural'
  | 'fractional';

/** AutoCAD AUNITS angular display formats. */
export type AngularUnitFormat =
  | 'decimal-degrees'
  | 'deg-min-sec'
  | 'gradians'
  | 'radians'
  | 'surveyor';

/** AutoCAD INSUNITS insertion scale. */
export type InsertionUnit = 'unitless' | 'in' | 'ft' | 'mm' | 'cm' | 'm';

export interface DrawingUnitsSettings {
  /** LUNITS — linear display format. */
  linearFormat: LinearUnitFormat;
  /** LUPREC — 0–8. */
  linearPrecision: number;
  /** AUNITS — angular display format. */
  angularFormat: AngularUnitFormat;
  /** AUPREC — 0–8. */
  angularPrecision: number;
  /** INSUNITS — insertion scale for blocks/xrefs (metadata). */
  insertionUnit: InsertionUnit;
}

export const LINEAR_UNIT_FORMATS: LinearUnitFormat[] = [
  'scientific',
  'decimal',
  'engineering',
  'architectural',
  'fractional',
];

export const ANGULAR_UNIT_FORMATS: AngularUnitFormat[] = [
  'decimal-degrees',
  'deg-min-sec',
  'gradians',
  'radians',
  'surveyor',
];

export const INSERTION_UNITS: InsertionUnit[] = [
  'unitless',
  'in',
  'ft',
  'mm',
  'cm',
  'm',
];

export const LINEAR_UNIT_FORMAT_LABELS: Record<LinearUnitFormat, string> = {
  scientific: 'Scientific',
  decimal: 'Decimal',
  engineering: 'Engineering',
  architectural: 'Architectural',
  fractional: 'Fractional',
};

export const ANGULAR_UNIT_FORMAT_LABELS: Record<AngularUnitFormat, string> = {
  'decimal-degrees': 'Decimal Degrees',
  'deg-min-sec': 'Deg/Min/Sec',
  gradians: 'Gradians',
  radians: 'Radians',
  surveyor: "Surveyor's Units",
};

export const INSERTION_UNIT_LABELS: Record<InsertionUnit, string> = {
  unitless: 'Unitless',
  in: 'Inches',
  ft: 'Feet',
  mm: 'Millimeters',
  cm: 'Centimeters',
  m: 'Meters',
};

/** Architectural / fractional LUPREC → inch denominator. */
export const ARCH_PRECISION_DENOMINATORS: Record<number, number> = {
  0: 1,
  1: 2,
  2: 4,
  3: 8,
  4: 16,
  5: 32,
  6: 64,
  7: 128,
  8: 256,
};

export const DEFAULT_DRAWING_UNITS: DrawingUnitsSettings = {
  linearFormat: 'architectural',
  linearPrecision: 4, // 1/16"
  angularFormat: 'decimal-degrees',
  angularPrecision: 0,
  insertionUnit: 'ft',
};

export function clampUnitPrecision(n: unknown, fallback = 2): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(8, Math.round(n)));
}

/** Map insertion unit → LengthUnit (unitless falls back to world). */
export function insertionToLengthUnit(
  insertion: InsertionUnit,
  worldUnit: LengthUnit,
): LengthUnit {
  if (insertion === 'unitless') return worldUnit === 'ft-in' ? 'ft' : worldUnit;
  return insertion;
}

/**
 * Derive legacy display fields (units / precision / fractionDenominator)
 * from AutoCAD-style drawingUnits so existing UI/formatters keep working.
 */
export function legacyDisplayFromDrawingUnits(
  du: DrawingUnitsSettings,
  worldUnit: LengthUnit,
): {
  units: LengthUnit;
  precision: number;
  fractionDenominator: number;
} {
  const prec = clampUnitPrecision(du.linearPrecision, 2);
  const denomRaw = ARCH_PRECISION_DENOMINATORS[prec] ?? 16;
  const fractionDenominator = ([1, 2, 4, 8, 16, 32].includes(denomRaw)
    ? denomRaw
    : 16) as 1 | 2 | 4 | 8 | 16 | 32;

  switch (du.linearFormat) {
    case 'architectural':
      return { units: 'ft-in', precision: Math.min(prec, 4), fractionDenominator };
    case 'engineering':
      return { units: 'ft', precision: Math.min(prec, 4), fractionDenominator };
    case 'fractional':
      return {
        units: insertionToLengthUnit(du.insertionUnit, worldUnit) === 'in' ? 'in' : 'ft-in',
        precision: Math.min(prec, 4),
        fractionDenominator,
      };
    case 'scientific':
    case 'decimal':
    default: {
      const u = insertionToLengthUnit(du.insertionUnit, worldUnit);
      return {
        units: u === 'ft' || u === 'in' || u === 'm' || u === 'cm' || u === 'mm' ? u : 'ft',
        precision: Math.min(prec, 4),
        fractionDenominator,
      };
    }
  }
}

/** Build drawingUnits from legacy settings (migration / defaults). */
export function drawingUnitsFromLegacy(input: {
  units?: LengthUnit;
  precision?: number;
  fractionDenominator?: number;
  worldUnit?: LengthUnit;
}): DrawingUnitsSettings {
  const units = input.units ?? 'ft-in';
  const precision = clampUnitPrecision(input.precision, 2);
  const denom = input.fractionDenominator ?? 16;
  const world = input.worldUnit ?? 'ft';

  if (units === 'ft-in') {
    let linearPrecision = 4;
    for (const [p, d] of Object.entries(ARCH_PRECISION_DENOMINATORS)) {
      if (d === denom) {
        linearPrecision = Number(p);
        break;
      }
    }
    return {
      ...DEFAULT_DRAWING_UNITS,
      linearFormat: 'architectural',
      linearPrecision,
      insertionUnit: world === 'in' ? 'in' : 'ft',
    };
  }

  const insertion: InsertionUnit =
    units === 'ft' || units === 'in' || units === 'mm' || units === 'cm' || units === 'm'
      ? units
      : 'ft';

  return {
    ...DEFAULT_DRAWING_UNITS,
    linearFormat: units === 'ft' ? 'engineering' : 'decimal',
    linearPrecision: precision,
    insertionUnit: insertion,
  };
}

export function normalizeDrawingUnits(raw: unknown): DrawingUnitsSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_DRAWING_UNITS };
  const o = raw as Record<string, unknown>;
  const linearFormat = LINEAR_UNIT_FORMATS.includes(o.linearFormat as LinearUnitFormat)
    ? (o.linearFormat as LinearUnitFormat)
    : DEFAULT_DRAWING_UNITS.linearFormat;
  const angularFormat = ANGULAR_UNIT_FORMATS.includes(
    o.angularFormat as AngularUnitFormat,
  )
    ? (o.angularFormat as AngularUnitFormat)
    : DEFAULT_DRAWING_UNITS.angularFormat;
  const insertionUnit = INSERTION_UNITS.includes(o.insertionUnit as InsertionUnit)
    ? (o.insertionUnit as InsertionUnit)
    : DEFAULT_DRAWING_UNITS.insertionUnit;
  return {
    linearFormat,
    linearPrecision: clampUnitPrecision(
      o.linearPrecision,
      DEFAULT_DRAWING_UNITS.linearPrecision,
    ),
    angularFormat,
    angularPrecision: clampUnitPrecision(
      o.angularPrecision,
      DEFAULT_DRAWING_UNITS.angularPrecision,
    ),
    insertionUnit,
  };
}

/** Apply drawingUnits patch and sync legacy display fields. */
export function applyDrawingUnits(
  settings: {
    worldUnit: LengthUnit;
    units: LengthUnit;
    precision: number;
    fractionDenominator: number;
    drawingUnits: DrawingUnitsSettings;
  },
  patch: Partial<DrawingUnitsSettings>,
): {
  drawingUnits: DrawingUnitsSettings;
  units: LengthUnit;
  precision: number;
  fractionDenominator: number;
} {
  const drawingUnits = normalizeDrawingUnits({
    ...settings.drawingUnits,
    ...patch,
  });
  const legacy = legacyDisplayFromDrawingUnits(drawingUnits, settings.worldUnit);
  return { drawingUnits, ...legacy };
}
