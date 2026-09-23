import { describe, expect, it } from 'vitest';
import {
  convertArea,
  convertLength,
  convertVolume,
  formatArchitecturalFeet,
  formatWorldLength,
  parseArchitecturalLength,
  parseLength,
  toMillimeters,
  worldToDisplay,
} from './unitEngine.js';
import { formatLengthInUnits, measuredLength } from './units.js';

describe('unit engine constants', () => {
  it('uses exact international foot relationships', () => {
    expect(convertLength(1, 'in', 'mm')).toBeCloseTo(25.4, 10);
    expect(convertLength(1, 'in', 'cm')).toBeCloseTo(2.54, 10);
    expect(convertLength(1, 'in', 'm')).toBeCloseTo(0.0254, 10);
    expect(convertLength(1, 'ft', 'in')).toBeCloseTo(12, 10);
    expect(convertLength(1, 'ft', 'mm')).toBeCloseTo(304.8, 10);
    expect(convertLength(1, 'ft', 'cm')).toBeCloseTo(30.48, 10);
    expect(convertLength(1, 'ft', 'm')).toBeCloseTo(0.3048, 10);
    expect(convertLength(1, 'm', 'mm')).toBeCloseTo(1000, 10);
    expect(convertLength(1, 'm', 'cm')).toBeCloseTo(100, 10);
  });

  it('converts architectural examples exactly', () => {
    expect(convertLength(3, 'ft', 'm')).toBeCloseTo(0.9144, 10);
    expect(toMillimeters(3 + 4 / 12, 'ft')).toBeCloseTo(1016, 10);
    expect(convertLength(3 + 4 / 12, 'ft', 'm')).toBeCloseTo(1.016, 10);
    expect(convertLength(10, 'ft', 'm')).toBeCloseTo(3.048, 10);
    expect(convertLength(12.5, 'ft', 'm')).toBeCloseTo(3.81, 10);
    expect(convertLength(1000, 'mm', 'm')).toBeCloseTo(1, 10);
    expect(convertLength(100, 'cm', 'm')).toBeCloseTo(1, 10);
  });

  it('round-trips without drift', () => {
    const cases: Array<[number, 'ft' | 'in' | 'm' | 'cm' | 'mm']> = [
      [10, 'ft'],
      [3 + 4 / 12, 'ft'],
      [36, 'in'],
      [3.048, 'm'],
      [304.8, 'cm'],
      [3048, 'mm'],
    ];
    for (const [v, u] of cases) {
      const mm = convertLength(v, u, 'mm');
      const back = convertLength(mm, 'mm', u);
      expect(back).toBeCloseTo(v, 10);
    }
  });
});

describe('architectural format/parse', () => {
  it('formats feet-inches with fractions', () => {
    expect(formatArchitecturalFeet(3)).toBe(`3'-0"`);
    expect(formatArchitecturalFeet(3 + 4 / 12)).toBe(`3'-4"`);
    expect(formatArchitecturalFeet(0.5)).toBe(`0'-6"`);
    expect(formatArchitecturalFeet(3 + 4 / 12 + 3 / 16 / 12, 16)).toBe(
      `3'-4 3/16"`,
    );
  });

  it('parses architectural strings', () => {
    expect(parseArchitecturalLength(`3'-0"`)).toBeCloseTo(3, 10);
    expect(parseArchitecturalLength(`3'-4"`)).toBeCloseTo(3 + 4 / 12, 10);
    expect(parseArchitecturalLength(`0'-6"`)).toBeCloseTo(0.5, 10);
    expect(parseArchitecturalLength(`3'-4 3/16"`)).toBeCloseTo(
      3 + 4 / 12 + 3 / 16 / 12,
      10,
    );
    expect(parseArchitecturalLength(`12"`)).toBeCloseTo(1, 10);
    expect(parseArchitecturalLength(`3'`)).toBeCloseTo(3, 10);
  });

  it('formats world lengths across display units without geometry change', () => {
    const world = 10; // 10 ft stored
    expect(formatWorldLength(world, 'ft', 'ft-in', { precision: 0 })).toBe(
      `10'-0"`,
    );
    expect(formatWorldLength(world, 'ft', 'm', { precision: 4 })).toBe(
      '3.0480 m',
    );
    expect(formatWorldLength(world, 'ft', 'cm', { precision: 2 })).toBe(
      '304.80 cm',
    );
    expect(formatWorldLength(world, 'ft', 'mm', { precision: 1 })).toBe(
      '3048.0 mm',
    );
    expect(formatWorldLength(world, 'ft', 'in', { precision: 0 })).toBe('120"');
    expect(formatWorldLength(world, 'ft', 'ft', { precision: 3 })).toBe(
      '10.000 ft',
    );
  });

  it('3\'-4" equals exact metric conversions', () => {
    const worldFt = 3 + 4 / 12;
    expect(worldToDisplay(worldFt, 'ft', 'mm')).toBeCloseTo(1016, 10);
    expect(worldToDisplay(worldFt, 'ft', 'm')).toBeCloseTo(1.016, 10);
    expect(worldToDisplay(worldFt, 'ft', 'cm')).toBeCloseTo(101.6, 10);
    expect(worldToDisplay(worldFt, 'ft', 'in')).toBeCloseTo(40, 10);
    expect(formatWorldLength(worldFt, 'ft', 'ft-in')).toBe(`3'-4"`);
  });
});

describe('parseLength into world units', () => {
  it('parses unit suffixes into feet world', () => {
    expect(parseLength('10 ft', 'ft')?.worldValue).toBeCloseTo(10, 10);
    expect(parseLength('10 feet', 'ft')?.worldValue).toBeCloseTo(10, 10);
    expect(parseLength(`10'`, 'ft')?.worldValue).toBeCloseTo(10, 10);
    expect(parseLength('120 in', 'ft')?.worldValue).toBeCloseTo(10, 10);
    expect(parseLength('120"', 'ft')?.worldValue).toBeCloseTo(10, 10);
    expect(parseLength('3.048 m', 'ft')?.worldValue).toBeCloseTo(10, 10);
    expect(parseLength('304.8 cm', 'ft')?.worldValue).toBeCloseTo(10, 10);
    expect(parseLength('3048 mm', 'ft')?.worldValue).toBeCloseTo(10, 10);
  });

  it('bare numbers use display default unit', () => {
    expect(parseLength('10', 'ft', 'ft')?.worldValue).toBeCloseTo(10, 10);
    expect(parseLength('3048', 'ft', 'mm')?.worldValue).toBeCloseTo(10, 10);
  });
});

describe('area / volume', () => {
  it('converts area and volume via linear factor squared/cubed', () => {
    // 1000 sq ft → m²
    expect(convertArea(1000, 'ft', 'm')).toBeCloseTo(92.90304, 4);
    expect(convertVolume(1, 'm', 'mm')).toBeCloseTo(1e9, 6);
    expect(convertVolume(1, 'ft', 'in')).toBeCloseTo(12 ** 3, 10);
  });
});

describe('formatLengthInUnits compatibility', () => {
  it('formats with worldUnit + display unit', () => {
    expect(formatLengthInUnits(12, 'ft-in', 0, 'ft')).toBe(`12'-0"`);
    expect(formatLengthInUnits(12.5, 'ft-in', 0, 'ft')).toBe(`12'-6"`);
    expect(formatLengthInUnits(10, 'm', 4, 'ft')).toBe('3.0480 m');
  });

  it('measures lengths', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 12, y: 5 };
    expect(measuredLength(a, b, 'horizontal')).toBe(12);
    expect(measuredLength(a, b, 'vertical')).toBe(5);
    expect(measuredLength(a, b, 'aligned')).toBeCloseTo(13, 10);
    expect(measuredLength(a, b, 'radius')).toBeCloseTo(13, 10);
    expect(measuredLength(a, b, 'diameter')).toBeCloseTo(26, 10);
  });
});
