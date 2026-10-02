/**
 * Focused tests: unit conversion, explicit parsing, dim style formatting.
 */
import { describe, expect, it } from 'vitest';
import {
  ARCHITECTURAL_DIMSTYLE,
  createEmptyDocument,
  DEFAULT_DRAWING_UNITS,
  drawingUnitsFromLegacy,
  getActiveDimensionStyle,
  legacyDisplayFromDrawingUnits,
  STANDARD_DIMSTYLE,
} from '@ratecad/core';
import {
  convertLength,
  formatDimensionLength,
  formatLinearByFormat,
  formatWorldByDrawingUnits,
  parseArchitecturalLength,
  parseLength,
} from './index.js';

describe('unit conversions', () => {
  it('converts metric and imperial exactly via mm hub', () => {
    expect(convertLength(1, 'ft', 'mm')).toBeCloseTo(304.8, 10);
    expect(convertLength(1000, 'mm', 'm')).toBeCloseTo(1, 10);
    expect(convertLength(12, 'in', 'ft')).toBeCloseTo(1, 10);
    expect(convertLength(3, 'm', 'cm')).toBeCloseTo(300, 10);
  });
});

describe('explicit unit parsing', () => {
  it('parses metric without spaces', () => {
    const world: 'ft' = 'ft';
    expect(parseLength('3000mm', world, 'ft')?.worldValue).toBeCloseTo(
      convertLength(3000, 'mm', 'ft'),
      8,
    );
    expect(parseLength('300cm', world, 'ft')?.worldValue).toBeCloseTo(
      convertLength(300, 'cm', 'ft'),
      8,
    );
    expect(parseLength('3m', world, 'ft')?.worldValue).toBeCloseTo(
      convertLength(3, 'm', 'ft'),
      8,
    );
  });

  it('parses feet/inches forms', () => {
    expect(parseArchitecturalLength(`10'`)).toBeCloseTo(10, 8);
    expect(parseArchitecturalLength(`10'6"`)).toBeCloseTo(10.5, 8);
    expect(parseArchitecturalLength(`10'-6"`)).toBeCloseTo(10.5, 8);
    expect(parseArchitecturalLength(`10'-6 1/2"`)).toBeCloseTo(10 + 6.5 / 12, 8);
    expect(parseLength(`10ft`, 'ft', 'ft')?.worldValue).toBeCloseTo(10, 8);
    expect(parseLength(`10'`, 'm', 'm')?.worldValue).toBeCloseTo(
      convertLength(10, 'ft', 'm'),
      8,
    );
  });

  it('bare numbers use display default unit', () => {
    const p = parseLength('2.5', 'ft', 'm');
    expect(p?.worldValue).toBeCloseTo(convertLength(2.5, 'm', 'ft'), 8);
    expect(p?.sourceUnit).toBe('m');
  });
});

describe('drawing unit persistence helpers', () => {
  it('legacyDisplayFromDrawingUnits maps architectural precision', () => {
    const legacy = legacyDisplayFromDrawingUnits(
      {
        ...DEFAULT_DRAWING_UNITS,
        linearFormat: 'architectural',
        linearPrecision: 4,
        insertionUnit: 'ft',
      },
      'ft',
    );
    expect(legacy.units).toBe('ft-in');
    expect(legacy.fractionDenominator).toBe(16);
  });

  it('drawingUnitsFromLegacy round-trips ft-in', () => {
    const du = drawingUnitsFromLegacy({
      units: 'ft-in',
      precision: 2,
      fractionDenominator: 16,
      worldUnit: 'ft',
    });
    expect(du.linearFormat).toBe('architectural');
    expect(du.linearPrecision).toBe(4);
  });

  it('createEmptyDocument includes drawingUnits and dimension styles', () => {
    const doc = createEmptyDocument('units-test');
    expect(doc.schemaVersion).toBe(10);
    expect(doc.settings.drawingUnits.linearFormat).toBe('architectural');
    expect(doc.settings.dimensionStyles.length).toBeGreaterThanOrEqual(3);
    expect(doc.settings.activeDimensionStyleName).toBe('Standard');
    const names = doc.settings.dimensionStyles.map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(['Standard', 'ISO-25', 'Architectural']));
  });
});

describe('dimension style formatting', () => {
  it('formats primary decimal with prefix/suffix', () => {
    const style = structuredClone(STANDARD_DIMSTYLE);
    style.primary.unitFormat = 'decimal';
    style.primary.lengthUnit = 'ft';
    style.primary.precision = 2;
    style.primary.prefix = '';
    style.primary.suffix = ' ft';
    const text = formatDimensionLength(10.5, 'ft', style);
    expect(text).toBe('10.50 ft');
  });

  it('formats architectural primary with alternate mm', () => {
    const style = structuredClone(ARCHITECTURAL_DIMSTYLE);
    // 10'-6" = 10.5 ft → 10.5 * 304.8 = 3200.4 mm
    const text = formatDimensionLength(10.5, 'ft', style);
    expect(text).toContain(`10'-6"`);
    expect(text).toMatch(/3200\.4/);
    expect(text).toMatch(/mm/);
  });

  it('applies rounding and zero suppression', () => {
    const style = structuredClone(STANDARD_DIMSTYLE);
    style.primary.roundOff = 0.25;
    style.primary.precision = 2;
    style.primary.suppressTrailingZeros = true;
    style.primary.suffix = '';
    // 1.13 → round to 1.25
    const text = formatDimensionLength(1.13, 'ft', style);
    expect(text).toMatch(/^1\.25/);
  });

  it('active dimension style resolves by name', () => {
    const doc = createEmptyDocument();
    const active = getActiveDimensionStyle(
      doc.settings.dimensionStyles,
      'Architectural',
    );
    expect(active.name).toBe('Architectural');
    expect(active.alternate.enabled).toBe(true);
  });

  it('precision changes display only via formatLinearByFormat', () => {
    const a = formatLinearByFormat(3.14159, 'decimal', 2, 'm');
    const b = formatLinearByFormat(3.14159, 'decimal', 3, 'm');
    expect(a).toBe('3.14');
    expect(b).toBe('3.142');
  });

  it('drawing units format does not require geometry change', () => {
    const world = 3;
    const coarse = formatWorldByDrawingUnits(world, 'ft', {
      ...DEFAULT_DRAWING_UNITS,
      linearFormat: 'decimal',
      linearPrecision: 2,
      insertionUnit: 'ft',
    });
    const fine = formatWorldByDrawingUnits(world, 'ft', {
      ...DEFAULT_DRAWING_UNITS,
      linearFormat: 'decimal',
      linearPrecision: 3,
      insertionUnit: 'ft',
    });
    expect(coarse).toContain('3.00');
    expect(fine).toContain('3.000');
  });
});
