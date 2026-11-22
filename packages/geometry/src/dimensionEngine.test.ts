import { describe, expect, it } from 'vitest';
import {
  STANDARD_DIMSTYLE,
  createEmptyDocument,
  type DimensionEntity,
  type LineEntity,
} from '@ratecad/core';
import { formatDimensionLength } from './dimStyleFormat.js';
import { formatAngleByDrawingUnits } from './drawingUnitFormat.js';
import {
  angularDraft,
  arcLengthMeasurement,
  chooseLinearKind,
  describeHover,
  dimensionAnnotationText,
  dimensionMeasuredValue,
  linearDimensionDraft,
  nearestLinearTarget,
  refreshModelSpaceDimensions,
  threePointAngle,
} from './dimensionEngine.js';

function line(id: string, x2: number, y2: number): LineEntity {
  return {
    id,
    type: 'line',
    layerId: '0',
    visible: true,
    locked: false,
    geometry: { start: { x: 0, y: 0 }, end: { x: x2, y: y2 } },
    properties: {},
  };
}

describe('dimension measurement', () => {
  it('measures horizontal, vertical, and aligned lengths from geometry', () => {
    const horizontal = linearDimensionDraft(
      { x: 0, y: 0 },
      { x: 12, y: 0 },
      { x: 6, y: 4 },
      'smart',
    );
    const vertical = linearDimensionDraft(
      { x: 0, y: 0 },
      { x: 0, y: 5 },
      { x: -3, y: 2 },
      'smart',
    );
    const aligned = linearDimensionDraft(
      { x: 0, y: 0 },
      { x: 3, y: 4 },
      { x: 0.7, y: 2.6 },
      'smart',
    );
    expect(horizontal?.kind).toBe('horizontal');
    expect(vertical?.kind).toBe('vertical');
    expect(aligned?.kind).toBe('aligned');
    expect(dimensionMeasuredValue(horizontal!)).toBeCloseTo(12);
    expect(dimensionMeasuredValue(vertical!)).toBeCloseTo(5);
    expect(dimensionMeasuredValue(aligned!)).toBeCloseTo(5);
  });

  it('uses the segment endpoints, not the distance from the pick', () => {
    const entities = [line('a', 10, 0)];
    const hit = nearestLinearTarget(entities, { x: 5, y: 1e-6 });
    expect(hit).not.toBeNull();
    const draft = linearDimensionDraft(hit!.start, hit!.end, { x: 5, y: 2 }, 'smart');
    expect(dimensionMeasuredValue(draft!)).toBeCloseTo(10);
    expect(nearestLinearTarget(entities, { x: 5, y: 1 })).toBeNull();
  });

  it('chooses aligned beside a slope and horizontal or vertical past the ends', () => {
    const start = { x: 0, y: 0 };
    const end = { x: 3000, y: 4000 };
    expect(chooseLinearKind(start, end, { x: 1100, y: 2300 }, 'smart')).toBe('aligned');
    expect(chooseLinearKind(start, end, { x: 1500, y: 8000 }, 'linear')).not.toBe('aligned');
    expect(chooseLinearKind(start, end, { x: 1100, y: 2300 }, 'aligned')).toBe('aligned');
  });

  it('measures arc length from radius and sweep, including a sweep that crosses 0', () => {
    expect(arcLengthMeasurement(1000, 0, Math.PI / 2)).toBeCloseTo((1000 * Math.PI) / 2, 6);
    expect(arcLengthMeasurement(1000, (7 * Math.PI) / 4, Math.PI / 4)).toBeCloseTo(
      (1000 * Math.PI) / 2,
      6,
    );
    expect(arcLengthMeasurement(0, 0, 1)).toBeNaN();
  });

  it('places a 90 degree wedge and rejects parallel or zero-length lines', () => {
    const wedge = angularDraft(
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      { x: 3, y: 3 },
    );
    expect(wedge?.degrees).toBeCloseTo(90, 5);
    const reversed = angularDraft(
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 3, y: 3 },
    );
    expect(reversed?.degrees).toBeCloseTo(90, 5);
    const opposite = angularDraft(
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      { x: -3, y: -3 },
    );
    expect(opposite?.degrees).toBeCloseTo(90, 5);
    const obtuse = angularDraft(
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 0 },
      { x: 10, y: 10 / Math.sqrt(3) },
      { x: -1, y: 2 },
    );
    expect(obtuse?.degrees).toBeCloseTo(150, 4);
    expect(
      angularDraft(
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 0, y: 2 },
        { x: 10, y: 2 },
        { x: 5, y: 1 },
      ),
    ).toBeNull();
    expect(
      angularDraft(
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ),
    ).toBeNull();
    expect(threePointAngle({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 })?.degrees).toBeCloseTo(90);
    expect(threePointAngle({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeNull();
  });

  it('formats length in the dimension style unit, separate from drawing units', () => {
    expect(formatDimensionLength(5000, 'ft', STANDARD_DIMSTYLE)).toBe('5000.00');
    const millimeters = {
      ...STANDARD_DIMSTYLE,
      primary: { ...STANDARD_DIMSTYLE.primary, lengthUnit: 'mm' as const, precision: 1 },
    };
    expect(formatDimensionLength(1, 'ft', millimeters)).toBe('304.8');
    const trimmed = {
      ...STANDARD_DIMSTYLE,
      primary: { ...STANDARD_DIMSTYLE.primary, suppressTrailingZeros: true },
    };
    expect(formatDimensionLength(5000, 'ft', trimmed)).toBe('5000');
    expect(formatAngleByDrawingUnits(90.5, 'deg-min-sec', 4)).toContain('90°');
  });

  it('keeps the true measurement when display text is overridden', () => {
    const draft = linearDimensionDraft(
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 4, y: 2 },
      'smart',
    )!;
    const metadata = { displayText: 'OPENING' };
    expect(dimensionMeasuredValue(draft, metadata)).toBeCloseTo(8);
    expect(dimensionAnnotationText(metadata, '8.00')).toBe('OPENING');
  });

  it('updates an associative dimension and detaches a missing source', () => {
    const base = createEmptyDocument('Dim');
    const source = line('line-1', 10, 0);
    const dimension: DimensionEntity = {
      id: 'dim-1',
      type: 'dimension',
      layerId: base.layers[0]!.id,
      visible: true,
      locked: false,
      geometry: {
        kind: 'horizontal',
        start: { x: 0, y: 0 },
        end: { x: 10, y: 0 },
        offset: 2,
      },
      properties: {},
      metadata: {
        modelDimension: { role: 'linear', entityId: 'line-1', edgeIndex: 0, valid: true },
      },
    };
    const stretched = refreshModelSpaceDimensions({
      ...base,
      entities: [{ ...source, geometry: { start: { x: 0, y: 0 }, end: { x: 20, y: 0 } } }, dimension],
    });
    const updated = stretched.entities.find((entity) => entity.id === 'dim-1');
    expect(updated?.type).toBe('dimension');
    if (updated?.type === 'dimension') {
      expect(dimensionMeasuredValue(updated.geometry, updated.metadata)).toBeCloseTo(20);
      expect(updated.geometry.offset).toBe(2);
    }
    const detached = refreshModelSpaceDimensions({ ...base, entities: [dimension] });
    const broken = detached.entities[0];
    expect(broken?.type).toBe('dimension');
    if (broken?.type === 'dimension') {
      expect(dimensionMeasuredValue(broken.geometry, broken.metadata)).toBeCloseTo(10);
      expect(dimensionAnnotationText(broken.metadata, '10.00')).toContain('detached');
    }
  });

  it('reports a hover measurement without inventing a dimension', () => {
    const hover = describeHover([line('a', 3, 4)], { x: 1.5, y: 2 });
    expect(hover?.distance).toBeCloseTo(5);
    expect(hover?.label).toContain('Length');
  });
});
