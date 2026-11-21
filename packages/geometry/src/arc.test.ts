import { describe, expect, it } from 'vitest';
import type { ArcEntity } from '@ratecad/core';
import { mirrorEntity, rotateEntity, scaleEntity } from './cadOps.js';
import { trimEntityMulti } from './trimExtendEngine.js';
import { applyGripEdit } from './transform.js';
import { angleOnArc, ccwSweep } from './arc.js';

function arc(): ArcEntity {
  return {
    id: 'a1',
    type: 'arc',
    layerId: 'layer-0',
    visible: true,
    locked: false,
    geometry: {
      center: { x: 0, y: 0 },
      radius: 10,
      startAngle: 0,
      endAngle: Math.PI / 2,
    },
    properties: { color: '#112233', lineweight: 0.25, linetype: 'Continuous' },
  };
}

describe('native arc', () => {
  it('rotates, scales, and mirrors without becoming a polyline', () => {
    const rotated = rotateEntity(arc(), { x: 0, y: 0 }, Math.PI / 2);
    expect(rotated?.type).toBe('arc');
    if (rotated?.type !== 'arc') return;
    expect(rotated.geometry.center).toEqual({ x: 0, y: 0 });
    expect(rotated.geometry.startAngle).toBeCloseTo(Math.PI / 2);
    expect(rotated.geometry.endAngle).toBeCloseTo(Math.PI);
    expect(ccwSweep(rotated.geometry.startAngle, rotated.geometry.endAngle)).toBeCloseTo(
      Math.PI / 2,
    );

    const scaled = scaleEntity(rotated, { x: 0, y: 0 }, 2);
    expect(scaled?.type).toBe('arc');
    if (scaled?.type !== 'arc') return;
    expect(scaled.geometry.radius).toBeCloseTo(20);

    const mirrored = mirrorEntity(arc(), { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(mirrored?.type).toBe('arc');
    if (mirrored?.type !== 'arc') return;
    expect(mirrored.geometry.center.y).toBeCloseTo(0);
    expect(ccwSweep(mirrored.geometry.startAngle, mirrored.geometry.endAngle)).toBeCloseTo(
      Math.PI / 2,
    );
  });

  it('moves the center from the center grip and keeps the sweep', () => {
    const moved = applyGripEdit(arc(), { kind: 'arc-center' }, { x: 4, y: 5 });
    expect(moved?.type).toBe('arc');
    if (moved?.type !== 'arc') return;
    expect(moved.geometry.center).toEqual({ x: 4, y: 5 });
    expect(moved.geometry.radius).toBe(10);
    expect(ccwSweep(moved.geometry.startAngle, moved.geometry.endAngle)).toBeCloseTo(
      Math.PI / 2,
    );
  });

  it('trims the picked semicircle and leaves the other semicircle', () => {
    const circle = {
      id: 'c1',
      type: 'circle' as const,
      layerId: 'layer-0',
      visible: true,
      locked: false,
      geometry: { center: { x: 0, y: 0 }, radius: 5 },
      properties: { color: '#445566', lineweight: 0.25, linetype: 'Continuous' },
    };
    const cutter = {
      id: 'l1',
      type: 'line' as const,
      layerId: 'layer-0',
      visible: true,
      locked: false,
      geometry: { start: { x: 0, y: -10 }, end: { x: 0, y: 10 } },
      properties: { color: '#000000', lineweight: 0.25, linetype: 'Continuous' },
    };
    const right = trimEntityMulti(circle, [cutter], { x: 5, y: 0 });
    expect(right.ok).toBe(true);
    if (!right.ok || right.entities[0]?.type !== 'arc') return;
    expect(right.entities[0].geometry.startAngle).toBeCloseTo(Math.PI / 2);
    expect(right.entities[0].geometry.endAngle).toBeCloseTo((3 * Math.PI) / 2);
    expect(right.entities[0].properties.color).toBe('#445566');

    const left = trimEntityMulti(circle, [cutter], { x: -5, y: 0 });
    expect(left.ok).toBe(true);
    if (!left.ok || left.entities[0]?.type !== 'arc') return;
    expect(left.entities[0].geometry.startAngle).toBeCloseTo((3 * Math.PI) / 2);
    expect(left.entities[0].geometry.endAngle).toBeCloseTo(Math.PI / 2);
  });

  it('keeps each unpicked sector when two lines cut the circle at four points', () => {
    const circle = {
      id: 'c1',
      type: 'circle' as const,
      layerId: 'layer-walls',
      visible: true,
      locked: false,
      geometry: { center: { x: 0, y: 0 }, radius: 5 },
      properties: { color: '#445566', lineweight: 0.35, linetype: 'Dashed' },
    };
    const vertical = {
      id: 'lv',
      type: 'line' as const,
      layerId: 'layer-0',
      visible: true,
      locked: false,
      geometry: { start: { x: 0, y: -10 }, end: { x: 0, y: 10 } },
      properties: { color: '#000000', lineweight: 0.25, linetype: 'Continuous' },
    };
    const horizontal = {
      id: 'lh',
      type: 'line' as const,
      layerId: 'layer-0',
      visible: true,
      locked: false,
      geometry: { start: { x: -10, y: 0 }, end: { x: 10, y: 0 } },
      properties: { color: '#000000', lineweight: 0.25, linetype: 'Continuous' },
    };
    const pick = { x: 5 * Math.cos(Math.PI / 4), y: 5 * Math.sin(Math.PI / 4) };
    const result = trimEntityMulti(circle, [vertical, horizontal], pick);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entities).toHaveLength(3);
    expect(result.entities.every((entity) => entity.type === 'arc')).toBe(true);
    const arcs = result.entities.flatMap((entity) =>
      entity.type === 'arc' ? [entity] : [],
    );
    expect(arcs.map((entity) => [entity.geometry.startAngle, entity.geometry.endAngle])).toEqual([
      [expect.closeTo(Math.PI / 2, 8), expect.closeTo(Math.PI, 8)],
      [expect.closeTo(Math.PI, 8), expect.closeTo((3 * Math.PI) / 2, 8)],
      [expect.closeTo((3 * Math.PI) / 2, 8), expect.closeTo(0, 8)],
    ]);
    for (const entity of arcs) {
      expect(entity.layerId).toBe('layer-walls');
      expect(entity.properties).toEqual(circle.properties);
      expect(entity.geometry.radius).toBe(5);
      expect(entity.geometry.center).toEqual({ x: 0, y: 0 });
      expect(angleOnArc(Math.PI / 4, entity.geometry.startAngle, entity.geometry.endAngle)).toBe(
        false,
      );
      expect(ccwSweep(entity.geometry.startAngle, entity.geometry.endAngle)).toBeCloseTo(
        Math.PI / 2,
      );
    }
    expect(circle.type).toBe('circle');
  });
});
