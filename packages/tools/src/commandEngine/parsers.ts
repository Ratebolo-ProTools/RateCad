import type { LengthUnit, Vec2 } from '@ratecad/core';
import { parseLengthInput } from '@ratecad/geometry';
import type {
  CadCommandOption,
  CadParsedAngle,
  CadParsedDistance,
  CadParsedOption,
  CadParsedPoint,
  CadPointContext,
} from './types.js';

const DEG2RAD = Math.PI / 180;

function parseNumberToken(raw: string): number | null {
  const n = Number(raw.trim());
  return Number.isFinite(n) ? n : null;
}

function parseCoordComponent(
  raw: string,
  units: LengthUnit,
  worldUnit: LengthUnit,
): number | null {
  const text = raw.trim();
  if (!text) return null;
  // Allow zero for coordinates (unlike positive-only lengths)
  const plain = Number(text);
  if (Number.isFinite(plain)) {
    // Bare coordinate component is in display units → world
    const parsed = parseLengthInput(String(plain), units, worldUnit);
    // parseLengthInput rejects 0; allow zero coords explicitly
    if (plain === 0) return 0;
    return parsed;
  }
  return parseLengthInput(text, units, worldUnit);
}

/**
 * Parse CAD-style point input.
 * Supports:
 *   10,20          absolute Cartesian
 *   @10,20         relative Cartesian
 *   10<45          absolute polar (from origin)
 *   @10<45         relative polar from last point
 *   <30            angle override (degrees)
 *   10             direct distance along cursor direction (needs last+cursor)
 */
export function parsePointInput(
  raw: string,
  ctx: CadPointContext,
): CadParsedPoint | { ok: true; angleOverrideDeg: number } | CadParsedDistance {
  const text = raw.trim();
  if (!text) return { ok: false, error: 'Empty point input' };

  // Angle override: <30
  const angleOnly = text.match(/^<\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (angleOnly) {
    const degrees = Number(angleOnly[1]);
    if (!Number.isFinite(degrees)) return { ok: false, error: 'Invalid angle' };
    return { ok: true, angleOverrideDeg: degrees };
  }

  // Polar: [@]dist<angle
  const polar = text.match(/^(@)?\s*(.+?)\s*<\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (polar) {
    const relative = !!polar[1];
    const dist = parseLengthInput(polar[2]!, ctx.units, ctx.worldUnit);
    const ang = Number(polar[3]);
    if (dist == null || !(dist > 0) || !Number.isFinite(ang)) {
      return { ok: false, error: 'Invalid polar coordinates' };
    }
    const rad = ang * DEG2RAD;
    const dx = dist * Math.cos(rad);
    const dy = dist * Math.sin(rad);
    if (relative) {
      if (!ctx.lastPoint) {
        return { ok: false, error: 'No base point for relative coordinates' };
      }
      return {
        ok: true,
        point: { x: ctx.lastPoint.x + dx, y: ctx.lastPoint.y + dy },
      };
    }
    return { ok: true, point: { x: dx, y: dy } };
  }

  // Cartesian: [@]x,y
  const cart = text.match(/^(@)?\s*([^,]+)\s*,\s*(.+)\s*$/);
  if (cart) {
    const relative = !!cart[1];
    const x = parseCoordComponent(cart[2]!, ctx.units, ctx.worldUnit);
    const y = parseCoordComponent(cart[3]!, ctx.units, ctx.worldUnit);
    if (x == null || y == null) {
      return { ok: false, error: 'Invalid coordinates' };
    }
    if (relative) {
      if (!ctx.lastPoint) {
        return { ok: false, error: 'No base point for relative coordinates' };
      }
      return {
        ok: true,
        point: { x: ctx.lastPoint.x + x, y: ctx.lastPoint.y + y },
      };
    }
    return { ok: true, point: { x, y } };
  }

  // Direct distance: single length token
  const dist = parseLengthInput(text, ctx.units, ctx.worldUnit);
  if (dist != null && dist > 0) {
    return { ok: true, value: dist };
  }

  return { ok: false, error: 'Invalid point input' };
}

/** Apply direct distance from lastPoint toward cursor (or angle override). */
export function pointFromDirectDistance(
  lastPoint: Vec2,
  cursor: Vec2 | null,
  distance: number,
  angleOverrideDeg: number | null,
): Vec2 | null {
  if (!(distance > 0)) return null;
  let angle: number;
  if (angleOverrideDeg != null && Number.isFinite(angleOverrideDeg)) {
    angle = angleOverrideDeg * DEG2RAD;
  } else if (cursor) {
    const dx = cursor.x - lastPoint.x;
    const dy = cursor.y - lastPoint.y;
    if (Math.hypot(dx, dy) < 1e-12) return null;
    angle = Math.atan2(dy, dx);
  } else {
    return null;
  }
  return {
    x: lastPoint.x + distance * Math.cos(angle),
    y: lastPoint.y + distance * Math.sin(angle),
  };
}

export function parseDistanceInput(
  raw: string,
  units: LengthUnit,
  worldUnit: LengthUnit = units === 'ft-in' ? 'ft' : units,
): CadParsedDistance {
  const text = raw.trim();
  if (!text) return { ok: false, error: 'Empty distance' };
  const value = parseLengthInput(text, units, worldUnit);
  if (value == null || !(value > 0)) {
    return { ok: false, error: 'Invalid distance' };
  }
  return { ok: true, value };
}

export function parseAngleInput(raw: string): CadParsedAngle {
  const text = raw.trim().replace(/^</, '').replace(/°$/, '');
  if (!text) return { ok: false, error: 'Empty angle' };
  const degrees = parseNumberToken(text);
  if (degrees == null) return { ok: false, error: 'Invalid angle' };
  return { ok: true, degrees };
}

export function matchOption(
  raw: string,
  options: CadCommandOption[] | undefined,
): CadParsedOption {
  if (!options?.length) {
    return { ok: false, error: 'No options available' };
  }
  const key = raw.trim().toUpperCase().replace(/\s+/g, '');
  if (!key) return { ok: false, error: 'Empty option' };
  for (const opt of options) {
    const names = [opt.id, opt.label, ...opt.aliases].map((a) =>
      a.toUpperCase().replace(/\s+/g, ''),
    );
    if (names.includes(key)) {
      return { ok: true, optionId: opt.id };
    }
    // Prefix match when unique
  }
  const prefixHits = options.filter((opt) => {
    const names = [opt.id, opt.label, ...opt.aliases].map((a) =>
      a.toUpperCase().replace(/\s+/g, ''),
    );
    return names.some((n) => n.startsWith(key));
  });
  if (prefixHits.length === 1) {
    return { ok: true, optionId: prefixHits[0]!.id };
  }
  if (prefixHits.length > 1) {
    return { ok: false, error: 'Ambiguous option' };
  }
  return { ok: false, error: 'Invalid option' };
}

export function formatOptionsHint(options: CadCommandOption[] | undefined): string {
  if (!options?.length) return '';
  return `[${options.map((o) => o.label).join('/')}]`;
}

export function formatDefaultHint(value: string | number | null | undefined): string {
  if (value == null || value === '') return '';
  return `<${value}>`;
}

export function isAngleOverrideResult(
  r: unknown,
): r is { ok: true; angleOverrideDeg: number } {
  return (
    !!r &&
    typeof r === 'object' &&
    (r as { ok?: boolean }).ok === true &&
    'angleOverrideDeg' in (r as object)
  );
}

export function isDistanceResult(r: unknown): r is CadParsedDistance & { ok: true } {
  return (
    !!r &&
    typeof r === 'object' &&
    (r as { ok?: boolean }).ok === true &&
    'value' in (r as object) &&
    !('point' in (r as object))
  );
}

export function isPointResult(r: unknown): r is { ok: true; point: Vec2 } {
  return (
    !!r &&
    typeof r === 'object' &&
    (r as { ok?: boolean }).ok === true &&
    'point' in (r as object)
  );
}
