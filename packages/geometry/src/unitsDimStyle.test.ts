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
  ISO25_DIMSTYLE,
  legacyDisplayFromDrawingUnits,
  normalizeDimensionStyleDefinition,
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
    expect(doc.schemaVersion).toBe(12);
    expect(doc.blockDefinitions).toEqual([]);
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

  it('follows architectural drawing units and keeps radius and diameter prefixes', () => {
    const units = {
      ...DEFAULT_DRAWING_UNITS,
      linearFormat: 'architectural' as const,
      insertionUnit: 'ft' as const,
    };
    const measurement = 20;
    expect(formatDimensionLength(measurement, 'ft', STANDARD_DIMSTYLE, { drawingUnits: units })).toBe(
      `20'-0"`,
    );
    expect(measurement).toBe(20);
    expect(formatDimensionLength(12.5, 'ft', STANDARD_DIMSTYLE, { drawingUnits: units })).toBe(`12'-6"`);
    expect(formatDimensionLength(8.75, 'ft', STANDARD_DIMSTYLE, { drawingUnits: units })).toBe(`8'-9"`);
    expect(formatDimensionLength(2.5, 'ft', STANDARD_DIMSTYLE, { drawingUnits: units })).toBe(`2'-6"`);
    expect(
      formatDimensionLength(5, 'ft', STANDARD_DIMSTYLE, { drawingUnits: units, kindPrefix: 'R' }),
    ).toBe(`R 5'-0"`);
    expect(
      formatDimensionLength(10, 'ft', STANDARD_DIMSTYLE, { drawingUnits: units, kindPrefix: 'Ø' }),
    ).toBe(`Ø 10'-0"`);
  });

  it('keeps decimal feet, inches, and metric formats as explicit style overrides', () => {
    const units = DEFAULT_DRAWING_UNITS;
    const explicit = (
      lengthUnit: 'ft' | 'in' | 'mm' | 'cm' | 'm',
      precision: number,
    ) => {
      const style = structuredClone(STANDARD_DIMSTYLE);
      style.primary.followDrawingUnits = false;
      style.primary.unitFormat = 'decimal';
      style.primary.lengthUnit = lengthUnit;
      style.primary.precision = precision;
      return style;
    };
    expect(formatDimensionLength(20, 'ft', explicit('ft', 2), { drawingUnits: units })).toBe('20.00');
    expect(formatDimensionLength(1, 'ft', explicit('in', 2), { drawingUnits: units })).toBe('12.00');
    expect(formatDimensionLength(1, 'ft', explicit('mm', 1), { drawingUnits: units })).toBe('304.8');
    expect(formatDimensionLength(1, 'ft', explicit('cm', 2), { drawingUnits: units })).toBe('30.48');
    expect(formatDimensionLength(1, 'ft', explicit('m', 3), { drawingUnits: units })).toBe('0.305');
    expect(formatDimensionLength(1, 'ft', ISO25_DIMSTYLE, { drawingUnits: units })).toBe('304.80');
    expect(formatDimensionLength(10.5, 'ft', ARCHITECTURAL_DIMSTYLE, { drawingUnits: units })).toContain(
      `10'-6"`,
    );
  });

  it('follows decimal feet, inches, millimeters, centimeters, and meters from drawing units', () => {
    const follow = (
      insertionUnit: 'ft' | 'in' | 'mm' | 'cm' | 'm',
      precision = 2,
    ) =>
      formatDimensionLength(1, 'ft', STANDARD_DIMSTYLE, {
        drawingUnits: {
          ...DEFAULT_DRAWING_UNITS,
          linearFormat: 'decimal',
          linearPrecision: precision,
          insertionUnit,
        },
      });
    expect(follow('ft')).toBe('1.00');
    expect(follow('in')).toBe('12.00');
    expect(follow('mm', 1)).toBe('304.8');
    expect(follow('cm')).toBe('30.48');
    expect(follow('m', 3)).toBe('0.305');
  });

  it('treats a saved unmodified Standard style as following drawing units', () => {
    const opened = normalizeDimensionStyleDefinition(
      {
        id: 'dimstyle-standard',
        name: 'Standard',
        primary: { unitFormat: 'decimal', lengthUnit: 'ft', precision: 2 },
      },
      STANDARD_DIMSTYLE,
    );
    expect(opened.primary.followDrawingUnits).toBe(true);
    const overridden = normalizeDimensionStyleDefinition(
      {
        id: 'dimstyle-standard',
        name: 'Standard',
        primary: {
          unitFormat: 'decimal',
          lengthUnit: 'ft',
          precision: 2,
          followDrawingUnits: false,
        },
      },
      STANDARD_DIMSTYLE,
    );
    expect(overridden.primary.followDrawingUnits).toBe(false);
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
