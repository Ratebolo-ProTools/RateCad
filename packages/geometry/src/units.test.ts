import { describe, expect, it } from 'vitest';
import { formatLengthInUnits, measuredLength } from '../src/units.js';

describe('units / measuredLength', () => {
  it('measures horizontal, vertical, and aligned lengths', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 12, y: 5 };
    expect(measuredLength(a, b, 'horizontal')).toBe(12);
    expect(measuredLength(a, b, 'vertical')).toBe(5);
    expect(measuredLength(a, b, 'aligned')).toBeCloseTo(13, 10);
  });

  it('formats architectural feet-inches', () => {
    expect(formatLengthInUnits(12, 'ft', 0)).toBe("12'-0\"");
    expect(formatLengthInUnits(12.5, 'ft', 0)).toBe("12'-6\"");
    expect(formatLengthInUnits(1, 'ft', 2)).toMatch(/^1'-/);
  });

  it('formats meters, millimeters, and inches', () => {
    expect(formatLengthInUnits(3.5, 'm', 2)).toContain('m');
    expect(formatLengthInUnits(3500, 'mm', 0)).toContain('mm');
    expect(formatLengthInUnits(18, 'in', 0)).toContain('"');
  });

  it('geometry-driven display updates when endpoints change', () => {
    const start = { x: 0, y: 0 };
    let end = { x: 12, y: 0 };
    expect(formatLengthInUnits(measuredLength(start, end, 'horizontal'), 'ft', 0)).toBe(
      "12'-0\"",
    );
    end = { x: 14, y: 0 };
    expect(formatLengthInUnits(measuredLength(start, end, 'horizontal'), 'ft', 0)).toBe(
      "14'-0\"",
    );
  });
});
