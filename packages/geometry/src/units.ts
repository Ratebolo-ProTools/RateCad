import type { LengthUnit } from '@ratecad/core';
import { formatLength } from './math.js';

/** Convert a world length (stored in document units) for display. */
export function formatLengthInUnits(
  value: number,
  units: LengthUnit,
  precision = 2,
): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';

  switch (units) {
    case 'ft': {
      // Architectural feet-inches when precision >= 0
      const totalInches = abs * 12;
      let feet = Math.floor(totalInches / 12 + 1e-9);
      let inches = totalInches - feet * 12;
      // Round inches to precision decimal places
      const factor = 10 ** Math.max(0, precision);
      inches = Math.round(inches * factor) / factor;
      if (inches >= 12 - 1e-9) {
        feet += 1;
        inches = 0;
      }
      if (precision <= 0) {
        inches = Math.round(inches);
        if (inches === 12) {
          feet += 1;
          inches = 0;
        }
        return `${sign}${feet}'-${inches}"`;
      }
      const inchStr =
        Number.isInteger(inches) || precision === 0
          ? String(Math.round(inches * factor) / factor)
          : inches.toFixed(precision).replace(/\.?0+$/, '');
      return `${sign}${feet}'-${inchStr}"`;
    }
    case 'in':
      return `${sign}${formatLength(abs, precision)}"`;
    case 'm':
      return `${sign}${formatLength(abs, precision)} m`;
    case 'mm':
      return `${sign}${formatLength(abs, precision)} mm`;
  }
}

export function measuredLength(
  start: { x: number; y: number },
  end: { x: number; y: number },
  kind: 'horizontal' | 'vertical' | 'aligned',
): number {
  switch (kind) {
    case 'horizontal':
      return Math.abs(end.x - start.x);
    case 'vertical':
      return Math.abs(end.y - start.y);
    case 'aligned':
      return Math.hypot(end.x - start.x, end.y - start.y);
  }
}
