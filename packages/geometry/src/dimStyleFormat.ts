/**
 * Dimension text formatting from active DimensionStyle (DIMLUNIT / DIMALT*).
 * Independent of drawing LUNITS (UNITS command).
 */

import type {
  DimensionStyleDefinition,
  DimPrimaryUnits,
  LengthUnit,
} from '@ratecad/core';
import { ARCH_PRECISION_DENOMINATORS } from '@ratecad/core';
import {
  convertLength,
  formatArchitecturalFeet,
  type FractionDenominator,
  worldToDisplay,
} from './unitEngine.js';
import { formatLinearByFormat, roundTo } from './drawingUnitFormat.js';

function archDenom(precision: number): FractionDenominator {
  const d = ARCH_PRECISION_DENOMINATORS[Math.min(precision, 5)] ?? 16;
  if (d === 1 || d === 2 || d === 4 || d === 8 || d === 16 || d === 32) return d;
  return 32;
}

function applyZeroSuppression(
  text: string,
  primary: Pick<
    DimPrimaryUnits,
    | 'suppressLeadingZeros'
    | 'suppressTrailingZeros'
    | 'suppressZeroFeet'
    | 'suppressZeroInches'
    | 'unitFormat'
  >,
): string {
  let out = text;
  if (primary.suppressTrailingZeros && /\.\d*0+$/.test(out)) {
    out = out.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  }
  if (primary.suppressLeadingZeros) {
    out = out.replace(/^(-?)0+(?=\.)/, '$1');
  }
  if (primary.unitFormat === 'architectural' || primary.unitFormat === 'engineering') {
    if (primary.suppressZeroFeet) {
      out = out.replace(/^0'-/, '').replace(/^-0'-/, '-');
    }
    if (primary.suppressZeroInches) {
      out = out.replace(/-0"$/, "'").replace(/-0(\s|$)/, "'");
    }
  }
  return out;
}

function formatPrimaryValue(
  worldValue: number,
  worldUnit: LengthUnit,
  primary: DimPrimaryUnits,
): string {
  let v = worldToDisplay(worldValue, worldUnit, primary.lengthUnit === 'ft-in' ? 'ft' : primary.lengthUnit);
  if (primary.lengthUnit === 'ft-in') {
    v = worldToDisplay(worldValue, worldUnit, 'ft');
  }
  v = roundTo(v, primary.roundOff);

  let body: string;
  if (primary.unitFormat === 'architectural') {
    body = formatArchitecturalFeet(Math.abs(v), archDenom(primary.precision));
    if (v < 0) body = `-${body}`;
  } else {
    body = formatLinearByFormat(
      v,
      primary.unitFormat,
      primary.precision,
      primary.lengthUnit,
    );
  }

  if (primary.decimalSeparator === ',') {
    body = body.replace('.', ',');
  }
  body = applyZeroSuppression(body, primary);
  return `${primary.prefix}${body}${primary.suffix}`;
}

function formatAlternateValue(
  worldValue: number,
  worldUnit: LengthUnit,
  style: DimensionStyleDefinition,
): string {
  const alt = style.alternate;
  // Convert world → primary length unit, then apply multiplier
  const primaryUnit =
    style.primary.lengthUnit === 'ft-in' ? 'ft' : style.primary.lengthUnit;
  const inPrimary = worldToDisplay(worldValue, worldUnit, primaryUnit);
  let altValue = inPrimary * alt.multiplier;
  altValue = roundTo(altValue, alt.roundOff);

  let body = formatLinearByFormat(
    altValue,
    alt.unitFormat,
    alt.precision,
    alt.lengthUnit,
  );
  body = applyZeroSuppression(body, {
    ...style.primary,
    unitFormat: alt.unitFormat,
    suppressLeadingZeros: alt.suppressLeadingZeros,
    suppressTrailingZeros: alt.suppressTrailingZeros,
  });
  return `${alt.prefix}${body}${alt.suffix}`;
}

export interface FormatDimensionOptions {
  /** Optional measurement kind prefix when style has empty prefix. */
  kindPrefix?: 'R' | 'Ø' | '';
}

/**
 * Format a world-length measurement using the active dimension style.
 * Example with alternate: 10'-6" [3200.4 mm]
 */
export function formatDimensionLength(
  worldValue: number,
  worldUnit: LengthUnit,
  style: DimensionStyleDefinition,
  opts: FormatDimensionOptions = {},
): string {
  if (!Number.isFinite(worldValue)) return '—';

  let primary = formatPrimaryValue(worldValue, worldUnit, style.primary);
  if (opts.kindPrefix && !style.primary.prefix) {
    primary = `${opts.kindPrefix} ${primary}`;
  }

  if (!style.alternate.enabled) return primary;

  const alt = formatAlternateValue(worldValue, worldUnit, style);
  if (style.alternate.placement === 'below') {
    return `${primary}\n${alt}`;
  }
  return `${primary}${alt}`;
}

/** Tolerance text foundation (rendering of stacked tolerances may be partial). */
export function formatDimensionTolerance(
  style: DimensionStyleDefinition,
): string | null {
  const t = style.tolerances;
  if (t.method === 'none') return null;
  const p = Math.max(0, t.precision);
  switch (t.method) {
    case 'symmetrical':
      return `±${Math.abs(t.upperValue).toFixed(p)}`;
    case 'deviation':
      return `+${t.upperValue.toFixed(p)}/-${Math.abs(t.lowerValue).toFixed(p)}`;
    case 'limits':
      return `${t.upperValue.toFixed(p)} … ${t.lowerValue.toFixed(p)}`;
    case 'basic':
      return '□';
    default:
      return null;
  }
}

/** Convenience: convert between length units via mm hub (re-export style). */
export function dimConversionMultiplier(
  from: LengthUnit,
  to: LengthUnit,
): number {
  const a = from === 'ft-in' ? 'ft' : from;
  const b = to === 'ft-in' ? 'ft' : to;
  return convertLength(1, a, b);
}
