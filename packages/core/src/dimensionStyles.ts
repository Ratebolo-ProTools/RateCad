/**
 * Named Dimension Style system (DIMSTYLE / DIMLUNIT).
 * Dimension text formatting is controlled here — not by drawing LUNITS.
 */

import type { LengthUnit } from './types.js';
import type { LinearUnitFormat } from './drawingUnits.js';

export type DimensionStyleId = string;

export type DimFractionFormat = 'horizontal' | 'diagonal' | 'not-stacked';
export type DimDecimalSeparator = '.' | ',';
export type DimAlternatePlacement = 'after' | 'below';
export type DimTextPlacement = 'above' | 'centered' | 'outside';
export type DimArrowhead =
  | 'closed'
  | 'open'
  | 'architectural'
  | 'dot'
  | 'none';
export type DimCenterMark = 'none' | 'mark' | 'line';
export type DimFitPolicy =
  | 'best-fit'
  | 'arrows-first'
  | 'text-first'
  | 'both'
  | 'always-keep';
export type DimMoveText =
  | 'beside'
  | 'over-dimline-with-leader'
  | 'over-dimline-no-leader';
export type DimToleranceMethod =
  | 'none'
  | 'symmetrical'
  | 'deviation'
  | 'limits'
  | 'basic';

export interface DimPrimaryUnits {
  unitFormat: LinearUnitFormat;
  /** Display LengthUnit for primary (independent of drawing LUNITS). */
  lengthUnit: LengthUnit;
  precision: number;
  fractionFormat: DimFractionFormat;
  decimalSeparator: DimDecimalSeparator;
  roundOff: number;
  prefix: string;
  suffix: string;
  suppressLeadingZeros: boolean;
  suppressTrailingZeros: boolean;
  suppressZeroFeet: boolean;
  suppressZeroInches: boolean;
}

export interface DimAlternateUnits {
  enabled: boolean;
  unitFormat: LinearUnitFormat;
  lengthUnit: LengthUnit;
  precision: number;
  /** Multiply primary (in primary length unit) → alternate display value. */
  multiplier: number;
  roundOff: number;
  prefix: string;
  suffix: string;
  suppressLeadingZeros: boolean;
  suppressTrailingZeros: boolean;
  placement: DimAlternatePlacement;
}

export interface DimTextSettings {
  styleName: string;
  height: number;
  color: string;
  placement: DimTextPlacement;
  offsetFromDimLine: number;
}

export interface DimLineSettings {
  dimensionLineColor: string;
  extensionLineColor: string;
  lineweight: number;
  extendBeyond: number;
  offsetFromOrigin: number;
}

export interface DimSymbolsSettings {
  arrowhead: DimArrowhead;
  arrowSize: number;
  centerMark: DimCenterMark;
  centerMarkSize: number;
}

export interface DimFitSettings {
  textArrowFit: DimFitPolicy;
  keepTextBetween: boolean;
  moveText: DimMoveText;
  suppressArrowsIfDontFit: boolean;
}

export interface DimToleranceSettings {
  method: DimToleranceMethod;
  precision: number;
  upperValue: number;
  lowerValue: number;
}

/** Full named dimension style definition. */
export interface DimensionStyleDefinition {
  id: DimensionStyleId;
  name: string;
  primary: DimPrimaryUnits;
  alternate: DimAlternateUnits;
  text: DimTextSettings;
  lines: DimLineSettings;
  symbols: DimSymbolsSettings;
  fit: DimFitSettings;
  tolerances: DimToleranceSettings;
}

/** Legacy flat style used by older code paths / migration. */
export interface LegacyDimensionStyle {
  textHeight: number;
  arrowSize: number;
  precision: number;
  extensionGap: number;
  extensionBeyond: number;
}

function basePrimary(
  overrides: Partial<DimPrimaryUnits> = {},
): DimPrimaryUnits {
  return {
    unitFormat: 'decimal',
    lengthUnit: 'ft',
    precision: 2,
    fractionFormat: 'horizontal',
    decimalSeparator: '.',
    roundOff: 0,
    prefix: '',
    suffix: '',
    suppressLeadingZeros: false,
    suppressTrailingZeros: false,
    suppressZeroFeet: false,
    suppressZeroInches: false,
    ...overrides,
  };
}

function baseAlternate(
  overrides: Partial<DimAlternateUnits> = {},
): DimAlternateUnits {
  return {
    enabled: false,
    unitFormat: 'decimal',
    lengthUnit: 'mm',
    precision: 1,
    multiplier: 304.8, // ft → mm when primary is feet
    roundOff: 0,
    prefix: '[',
    suffix: ' mm]',
    suppressLeadingZeros: false,
    suppressTrailingZeros: false,
    placement: 'after',
    ...overrides,
  };
}

function baseText(overrides: Partial<DimTextSettings> = {}): DimTextSettings {
  return {
    styleName: 'Standard',
    height: 0.35,
    color: 'ByBlock',
    placement: 'above',
    offsetFromDimLine: 0.1,
    ...overrides,
  };
}

function baseLines(overrides: Partial<DimLineSettings> = {}): DimLineSettings {
  return {
    dimensionLineColor: 'ByBlock',
    extensionLineColor: 'ByBlock',
    lineweight: 0.18,
    extendBeyond: 0.15,
    offsetFromOrigin: 0.1,
    ...overrides,
  };
}

function baseSymbols(
  overrides: Partial<DimSymbolsSettings> = {},
): DimSymbolsSettings {
  return {
    arrowhead: 'closed',
    arrowSize: 0.25,
    centerMark: 'mark',
    centerMarkSize: 0.1,
    ...overrides,
  };
}

function baseFit(overrides: Partial<DimFitSettings> = {}): DimFitSettings {
  return {
    textArrowFit: 'best-fit',
    keepTextBetween: true,
    moveText: 'beside',
    suppressArrowsIfDontFit: false,
    ...overrides,
  };
}

function baseTolerances(
  overrides: Partial<DimToleranceSettings> = {},
): DimToleranceSettings {
  return {
    method: 'none',
    precision: 2,
    upperValue: 0,
    lowerValue: 0,
    ...overrides,
  };
}

export function createDimensionStyle(
  id: string,
  name: string,
  partial?: Partial<{
    primary: Partial<DimPrimaryUnits>;
    alternate: Partial<DimAlternateUnits>;
    text: Partial<DimTextSettings>;
    lines: Partial<DimLineSettings>;
    symbols: Partial<DimSymbolsSettings>;
    fit: Partial<DimFitSettings>;
    tolerances: Partial<DimToleranceSettings>;
  }>,
): DimensionStyleDefinition {
  return {
    id,
    name,
    primary: basePrimary(partial?.primary),
    alternate: baseAlternate(partial?.alternate),
    text: baseText(partial?.text),
    lines: baseLines(partial?.lines),
    symbols: baseSymbols(partial?.symbols),
    fit: baseFit(partial?.fit),
    tolerances: baseTolerances(partial?.tolerances),
  };
}

export const STANDARD_DIMSTYLE = createDimensionStyle('dimstyle-standard', 'Standard', {
  primary: {
    unitFormat: 'decimal',
    lengthUnit: 'ft',
    precision: 2,
  },
});

export const ISO25_DIMSTYLE = createDimensionStyle('dimstyle-iso25', 'ISO-25', {
  primary: {
    unitFormat: 'decimal',
    lengthUnit: 'mm',
    precision: 2,
    suffix: '',
  },
  alternate: {
    enabled: false,
    lengthUnit: 'in',
    multiplier: 1 / 25.4,
    precision: 3,
    prefix: '[',
    suffix: ' in]',
  },
  text: { height: 2.5, offsetFromDimLine: 0.625 },
  lines: { extendBeyond: 1.25, offsetFromOrigin: 0.625 },
  symbols: { arrowSize: 2.5, centerMarkSize: 1.25 },
});

export const ARCHITECTURAL_DIMSTYLE = createDimensionStyle(
  'dimstyle-architectural',
  'Architectural',
  {
    primary: {
      unitFormat: 'architectural',
      lengthUnit: 'ft-in',
      precision: 4,
      suppressZeroFeet: false,
      suppressZeroInches: false,
    },
    alternate: {
      enabled: true,
      unitFormat: 'decimal',
      lengthUnit: 'mm',
      precision: 1,
      multiplier: 304.8,
      prefix: ' [',
      suffix: ' mm]',
      placement: 'after',
    },
    symbols: { arrowhead: 'architectural', arrowSize: 0.25 },
  },
);

export const DEFAULT_DIMENSION_STYLES: DimensionStyleDefinition[] = [
  STANDARD_DIMSTYLE,
  ISO25_DIMSTYLE,
  ARCHITECTURAL_DIMSTYLE,
];

export const DEFAULT_ACTIVE_DIMSTYLE_NAME = 'Standard';

/** Flatten active style → legacy DimensionStyle fields. */
export function legacyStyleFromDefinition(
  style: DimensionStyleDefinition,
): LegacyDimensionStyle {
  return {
    textHeight: style.text.height,
    arrowSize: style.symbols.arrowSize,
    precision: style.primary.precision,
    extensionGap: style.lines.offsetFromOrigin,
    extensionBeyond: style.lines.extendBeyond,
  };
}

export function findDimensionStyle(
  styles: DimensionStyleDefinition[],
  nameOrId: string,
): DimensionStyleDefinition | null {
  const q = nameOrId.trim().toLowerCase();
  return (
    styles.find((s) => s.name.toLowerCase() === q) ??
    styles.find((s) => s.id.toLowerCase() === q) ??
    null
  );
}

export function getActiveDimensionStyle(
  styles: DimensionStyleDefinition[],
  activeName: string,
): DimensionStyleDefinition {
  return (
    findDimensionStyle(styles, activeName) ??
    styles[0] ??
    STANDARD_DIMSTYLE
  );
}

export function cloneDimensionStyle(
  source: DimensionStyleDefinition,
  newId: string,
  newName: string,
): DimensionStyleDefinition {
  return structuredClone({
    ...source,
    id: newId,
    name: newName,
  });
}

function clampPrec(n: unknown, fallback: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(8, Math.round(n)));
}

function asLengthUnit(raw: unknown, fallback: LengthUnit): LengthUnit {
  if (
    raw === 'ft' ||
    raw === 'ft-in' ||
    raw === 'in' ||
    raw === 'm' ||
    raw === 'cm' ||
    raw === 'mm'
  ) {
    return raw;
  }
  return fallback;
}

export function normalizeDimensionStyleDefinition(
  raw: unknown,
  fallback: DimensionStyleDefinition = STANDARD_DIMSTYLE,
): DimensionStyleDefinition {
  if (!raw || typeof raw !== 'object') return structuredClone(fallback);
  const o = raw as Record<string, unknown>;
  const primaryRaw =
    o.primary && typeof o.primary === 'object'
      ? (o.primary as Record<string, unknown>)
      : {};
  const altRaw =
    o.alternate && typeof o.alternate === 'object'
      ? (o.alternate as Record<string, unknown>)
      : {};
  const textRaw =
    o.text && typeof o.text === 'object' ? (o.text as Record<string, unknown>) : {};
  const linesRaw =
    o.lines && typeof o.lines === 'object' ? (o.lines as Record<string, unknown>) : {};
  const symbolsRaw =
    o.symbols && typeof o.symbols === 'object'
      ? (o.symbols as Record<string, unknown>)
      : {};
  const fitRaw =
    o.fit && typeof o.fit === 'object' ? (o.fit as Record<string, unknown>) : {};
  const tolRaw =
    o.tolerances && typeof o.tolerances === 'object'
      ? (o.tolerances as Record<string, unknown>)
      : {};

  const base = createDimensionStyle(
    typeof o.id === 'string' ? o.id : fallback.id,
    typeof o.name === 'string' ? o.name : fallback.name,
  );

  return {
    ...base,
    primary: {
      ...base.primary,
      unitFormat:
        typeof primaryRaw.unitFormat === 'string'
          ? (primaryRaw.unitFormat as LinearUnitFormat)
          : base.primary.unitFormat,
      lengthUnit: asLengthUnit(primaryRaw.lengthUnit, base.primary.lengthUnit),
      precision: clampPrec(primaryRaw.precision, base.primary.precision),
      fractionFormat:
        primaryRaw.fractionFormat === 'diagonal' ||
        primaryRaw.fractionFormat === 'not-stacked' ||
        primaryRaw.fractionFormat === 'horizontal'
          ? primaryRaw.fractionFormat
          : base.primary.fractionFormat,
      decimalSeparator:
        primaryRaw.decimalSeparator === ',' ? ',' : '.',
      roundOff:
        typeof primaryRaw.roundOff === 'number' ? primaryRaw.roundOff : 0,
      prefix: typeof primaryRaw.prefix === 'string' ? primaryRaw.prefix : '',
      suffix: typeof primaryRaw.suffix === 'string' ? primaryRaw.suffix : '',
      suppressLeadingZeros: !!primaryRaw.suppressLeadingZeros,
      suppressTrailingZeros: !!primaryRaw.suppressTrailingZeros,
      suppressZeroFeet: !!primaryRaw.suppressZeroFeet,
      suppressZeroInches: !!primaryRaw.suppressZeroInches,
    },
    alternate: {
      ...base.alternate,
      enabled: !!altRaw.enabled,
      unitFormat:
        typeof altRaw.unitFormat === 'string'
          ? (altRaw.unitFormat as LinearUnitFormat)
          : base.alternate.unitFormat,
      lengthUnit: asLengthUnit(altRaw.lengthUnit, base.alternate.lengthUnit),
      precision: clampPrec(altRaw.precision, base.alternate.precision),
      multiplier:
        typeof altRaw.multiplier === 'number' && altRaw.multiplier > 0
          ? altRaw.multiplier
          : base.alternate.multiplier,
      roundOff: typeof altRaw.roundOff === 'number' ? altRaw.roundOff : 0,
      prefix: typeof altRaw.prefix === 'string' ? altRaw.prefix : base.alternate.prefix,
      suffix: typeof altRaw.suffix === 'string' ? altRaw.suffix : base.alternate.suffix,
      suppressLeadingZeros: !!altRaw.suppressLeadingZeros,
      suppressTrailingZeros: !!altRaw.suppressTrailingZeros,
      placement: altRaw.placement === 'below' ? 'below' : 'after',
    },
    text: {
      ...base.text,
      styleName:
        typeof textRaw.styleName === 'string' ? textRaw.styleName : base.text.styleName,
      height:
        typeof textRaw.height === 'number' && textRaw.height > 0
          ? textRaw.height
          : base.text.height,
      color: typeof textRaw.color === 'string' ? textRaw.color : base.text.color,
      placement:
        textRaw.placement === 'centered' || textRaw.placement === 'outside'
          ? textRaw.placement
          : 'above',
      offsetFromDimLine:
        typeof textRaw.offsetFromDimLine === 'number'
          ? textRaw.offsetFromDimLine
          : base.text.offsetFromDimLine,
    },
    lines: {
      ...base.lines,
      dimensionLineColor:
        typeof linesRaw.dimensionLineColor === 'string'
          ? linesRaw.dimensionLineColor
          : base.lines.dimensionLineColor,
      extensionLineColor:
        typeof linesRaw.extensionLineColor === 'string'
          ? linesRaw.extensionLineColor
          : base.lines.extensionLineColor,
      lineweight:
        typeof linesRaw.lineweight === 'number'
          ? linesRaw.lineweight
          : base.lines.lineweight,
      extendBeyond:
        typeof linesRaw.extendBeyond === 'number'
          ? linesRaw.extendBeyond
          : base.lines.extendBeyond,
      offsetFromOrigin:
        typeof linesRaw.offsetFromOrigin === 'number'
          ? linesRaw.offsetFromOrigin
          : base.lines.offsetFromOrigin,
    },
    symbols: {
      ...base.symbols,
      arrowhead:
        symbolsRaw.arrowhead === 'open' ||
        symbolsRaw.arrowhead === 'architectural' ||
        symbolsRaw.arrowhead === 'dot' ||
        symbolsRaw.arrowhead === 'none' ||
        symbolsRaw.arrowhead === 'closed'
          ? symbolsRaw.arrowhead
          : base.symbols.arrowhead,
      arrowSize:
        typeof symbolsRaw.arrowSize === 'number'
          ? symbolsRaw.arrowSize
          : base.symbols.arrowSize,
      centerMark:
        symbolsRaw.centerMark === 'none' ||
        symbolsRaw.centerMark === 'line' ||
        symbolsRaw.centerMark === 'mark'
          ? symbolsRaw.centerMark
          : base.symbols.centerMark,
      centerMarkSize:
        typeof symbolsRaw.centerMarkSize === 'number'
          ? symbolsRaw.centerMarkSize
          : base.symbols.centerMarkSize,
    },
    fit: {
      ...base.fit,
      textArrowFit:
        typeof fitRaw.textArrowFit === 'string'
          ? (fitRaw.textArrowFit as DimFitPolicy)
          : base.fit.textArrowFit,
      keepTextBetween:
        typeof fitRaw.keepTextBetween === 'boolean'
          ? fitRaw.keepTextBetween
          : base.fit.keepTextBetween,
      moveText:
        typeof fitRaw.moveText === 'string'
          ? (fitRaw.moveText as DimMoveText)
          : base.fit.moveText,
      suppressArrowsIfDontFit: !!fitRaw.suppressArrowsIfDontFit,
    },
    tolerances: {
      ...base.tolerances,
      method:
        tolRaw.method === 'symmetrical' ||
        tolRaw.method === 'deviation' ||
        tolRaw.method === 'limits' ||
        tolRaw.method === 'basic' ||
        tolRaw.method === 'none'
          ? tolRaw.method
          : 'none',
      precision: clampPrec(tolRaw.precision, base.tolerances.precision),
      upperValue:
        typeof tolRaw.upperValue === 'number' ? tolRaw.upperValue : 0,
      lowerValue:
        typeof tolRaw.lowerValue === 'number' ? tolRaw.lowerValue : 0,
    },
  };
}

/** Migrate legacy flat dimensionStyle → named styles table. */
export function migrateDimensionStylesFromLegacy(
  legacy: Partial<LegacyDimensionStyle> | undefined,
  existingStyles?: unknown,
  activeName?: unknown,
): {
  dimensionStyles: DimensionStyleDefinition[];
  activeDimensionStyleName: string;
  dimensionStyle: LegacyDimensionStyle;
} {
  let styles: DimensionStyleDefinition[];
  if (Array.isArray(existingStyles) && existingStyles.length > 0) {
    styles = existingStyles.map((s, i) =>
      normalizeDimensionStyleDefinition(
        s,
        DEFAULT_DIMENSION_STYLES[i] ?? STANDARD_DIMSTYLE,
      ),
    );
  } else {
    styles = DEFAULT_DIMENSION_STYLES.map((s) => structuredClone(s));
    // Apply legacy sizes onto Standard
    const std = styles.find((s) => s.name === 'Standard') ?? styles[0]!;
    if (legacy) {
      if (typeof legacy.textHeight === 'number') std.text.height = legacy.textHeight;
      if (typeof legacy.arrowSize === 'number') {
        std.symbols.arrowSize = legacy.arrowSize;
      }
      if (typeof legacy.precision === 'number') {
        std.primary.precision = legacy.precision;
      }
      if (typeof legacy.extensionGap === 'number') {
        std.lines.offsetFromOrigin = legacy.extensionGap;
      }
      if (typeof legacy.extensionBeyond === 'number') {
        std.lines.extendBeyond = legacy.extensionBeyond;
      }
    }
  }

  const active =
    typeof activeName === 'string' && findDimensionStyle(styles, activeName)
      ? activeName
      : styles[0]?.name ?? DEFAULT_ACTIVE_DIMSTYLE_NAME;

  const activeStyle = getActiveDimensionStyle(styles, active);
  return {
    dimensionStyles: styles,
    activeDimensionStyleName: active,
    dimensionStyle: legacyStyleFromDefinition(activeStyle),
  };
}
