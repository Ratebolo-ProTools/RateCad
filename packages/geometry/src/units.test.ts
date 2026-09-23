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

  it('formats architectural feet-inches via ft-in display', () => {
    expect(formatLengthInUnits(12, 'ft-in', 0, 'ft')).toBe("12'-0\"");
    expect(formatLengthInUnits(12.5, 'ft-in', 0, 'ft')).toBe("12'-6\"");
    expect(formatLengthInUnits(1, 'ft-in', 2, 'ft')).toMatch(/^1'-/);
  });

  it('formats meters, millimeters, and inches from foot world', () => {
    expect(formatLengthInUnits(3.5, 'm', 2, 'm')).toContain('m');
    expect(formatLengthInUnits(3500, 'mm', 0, 'mm')).toContain('mm');
    expect(formatLengthInUnits(18, 'in', 0, 'in')).toContain('"');
    expect(formatLengthInUnits(10, 'm', 4, 'ft')).toBe('3.0480 m');
  });

  it('geometry-driven display updates when endpoints change', () => {
    const start = { x: 0, y: 0 };
    let end = { x: 12, y: 0 };
    expect(
      formatLengthInUnits(measuredLength(start, end, 'horizontal'), 'ft-in', 0, 'ft'),
    ).toBe("12'-0\"");
    end = { x: 14, y: 0 };
    expect(
      formatLengthInUnits(measuredLength(start, end, 'horizontal'), 'ft-in', 0, 'ft'),
    ).toBe("14'-0\"");
  });
});
