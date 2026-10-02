/**
 * Focused AutoCAD-style AREA measurement tests (AreaMeasurementEngine).
 */
import { describe, expect, it } from 'vitest';
import type {
  CircleEntity,
  PolylineEntity,
  RectangleEntity,
  RoomEntity,
} from '@ratecad/core';
import {
  addAreaEntry,
  areaFromEntity,
  areaFromOrientedRectangle,
  areaFromPoints,
  areaFromRectangle,
  areaMeasurementEngine,
  convertArea,
  createAreaSession,
  formatWorldArea,
  setAreaSessionMode,
} from './index.js';
import { polygonArea } from './rooms.js';

describe('AreaMeasurementEngine — rectangle / square', () => {
  it('3 m × 4 m rectangle = 12 m² (world meters)', () => {
    const eng = areaMeasurementEngine;
    const r = eng.measureRectangle(
      { x: 0, y: 0 },
      { x: 3, y: 4 },
      'm',
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.measurement.area).toBeCloseTo(12, 8);
    expect(r.measurement.perimeter).toBeCloseTo(14, 8);
    expect(r.measurement.measurementType).toBe('rectangle');
  });

  it('5 m × 5 m square = 25 m²', () => {
    const r = areaMeasurementEngine.measureRectangle(
      { x: 0, y: 0 },
      { x: 5, y: 5 },
      'm',
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.measurement.area).toBeCloseTo(25, 8);
    expect(r.measurement.measurementType).toBe('square');
    expect(r.measurement.perimeter).toBeCloseTo(20, 8);
  });

  it('rotated rectangle area = length × width via shoelace', () => {
    // 3×4 rectangle rotated 30° about origin
    const L = 3;
    const W = 4;
    const a = Math.PI / 6;
    const ux = { x: Math.cos(a), y: Math.sin(a) };
    const uy = { x: -Math.sin(a), y: Math.cos(a) };
    const c0 = { x: 0, y: 0 };
    const c1 = { x: ux.x * L, y: ux.y * L };
    const c2 = { x: c1.x + uy.x * W, y: c1.y + uy.y * W };
    const c3 = { x: uy.x * W, y: uy.y * W };
    const r = areaFromOrientedRectangle([c0, c1, c2, c3]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.area).toBeCloseTo(12, 6);
    expect(r.perimeter).toBeCloseTo(2 * (L + W), 6);
  });
});

describe('AreaMeasurementEngine — circle', () => {
  it('radius 2 m → area π×4, circumference 2π×2', () => {
    const r = areaMeasurementEngine.measureCircle({ x: 0, y: 0 }, 2, 'm');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.measurement.area).toBeCloseTo(Math.PI * 4, 10);
    expect(r.measurement.perimeter).toBeCloseTo(2 * Math.PI * 2, 10);
    expect(r.measurement.perimeterIsCircumference).toBe(true);
    const fmt = areaMeasurementEngine.format(
      r.measurement,
      'm',
      'm',
      3,
    );
    expect(fmt.perimeterLabel).toBe('Circumference');
    expect(fmt.areaText).toMatch(/m²/);
  });
});

describe('AreaMeasurementEngine — polygon / polyline / points', () => {
  it('triangle / closed polygon (shoelace)', () => {
    const r = areaMeasurementEngine.measurePolygon(
      [
        { x: 0, y: 0 },
        { x: 6, y: 0 },
        { x: 0, y: 4 },
      ],
      'm',
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.measurement.area).toBeCloseTo(12, 8);
  });

  it('arbitrary closed polyline', () => {
    const verts = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 5, y: 2 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
      { x: -1, y: 2 },
    ];
    const r = areaMeasurementEngine.measureClosedPolyline(verts, 'ft');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.measurement.area).toBeCloseTo(polygonArea(verts), 8);
  });

  it('point-defined polygon closes without repeating first point', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 6 },
      { x: 0, y: 6 },
    ];
    // User does not re-click (0,0)
    const r = areaFromPoints(points, true);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.area).toBeCloseTo(60, 8);
    expect(r.perimeter).toBeCloseTo(32, 8);
    expect(r.warnings.some((w) => /closed/i.test(w))).toBe(true);
  });
});

describe('AreaMeasurementEngine — Add / Subtract', () => {
  it('Add Area sums selected regions', () => {
    let s = createAreaSession();
    const a = areaFromRectangle({ x: 0, y: 0 }, { x: 3, y: 4 }); // 12
    const b = areaFromRectangle({ x: 0, y: 0 }, { x: 5, y: 5 }); // 25
    const c = areaFromEntity({
      id: 'c1',
      type: 'circle',
      layerId: 'layer-0',
      visible: true,
      locked: false,
      geometry: { center: { x: 0, y: 0 }, radius: 2 },
      properties: {},
    } as CircleEntity);
    expect(a.ok && b.ok && c.ok).toBe(true);
    if (!a.ok || !b.ok || !c.ok) return;
    s = addAreaEntry(s, a, 'Rect');
    s = addAreaEntry(s, b, 'Square');
    s = addAreaEntry(s, c, 'Circle');
    expect(s.totalArea).toBeCloseTo(12 + 25 + Math.PI * 4, 8);
  });

  it('Subtract Area nets outer − openings', () => {
    let s = createAreaSession();
    const outer = areaFromRectangle({ x: 0, y: 0 }, { x: 10, y: 8 }); // 80
    const inner = areaFromRectangle({ x: 0, y: 0 }, { x: 3, y: 4 }); // 12
    const hole = areaFromEntity({
      id: 'c2',
      type: 'circle',
      layerId: 'layer-0',
      visible: true,
      locked: false,
      geometry: { center: { x: 0, y: 0 }, radius: 1 },
      properties: {},
    } as CircleEntity);
    expect(outer.ok && inner.ok && hole.ok).toBe(true);
    if (!outer.ok || !inner.ok || !hole.ok) return;
    s = addAreaEntry(s, outer, 'Outer');
    s = setAreaSessionMode(s, 'subtract');
    s = addAreaEntry(s, inner, 'Inner');
    s = addAreaEntry(s, hole, 'Opening');
    expect(s.totalArea).toBeCloseTo(80 - 12 - Math.PI, 8);
  });
});

describe('AreaMeasurementEngine — units / formatting', () => {
  it('formats metric square units', () => {
    const r = areaMeasurementEngine.measureRectangle(
      { x: 0, y: 0 },
      { x: 3, y: 4 },
      'm',
    );
    if (!r.ok) return;
    const fmt = areaMeasurementEngine.format(r.measurement, 'm', 'm', 2);
    expect(fmt.areaText).toMatch(/12\.00\s*m²/);
    expect(fmt.squareUnitLabel).toBe('m²');
    expect(fmt.perimeterText).toMatch(/m/);
  });

  it('formats feet square units', () => {
    const r = areaMeasurementEngine.measureRectangle(
      { x: 0, y: 0 },
      { x: 10, y: 12 },
      'ft',
    );
    if (!r.ok) return;
    const fmt = areaMeasurementEngine.format(r.measurement, 'ft', 'ft', 2);
    expect(fmt.areaText).toMatch(/120\.00\s*sq ft/);
    expect(fmt.squareUnitLabel).toBe('ft²');
  });

  it('display precision change does not alter stored area', () => {
    const r = areaFromRectangle({ x: 0, y: 0 }, { x: 3, y: 4 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const a = formatWorldArea(r.area, 'm', 'm', 2);
    const b = formatWorldArea(r.area, 'm', 'm', 3);
    expect(r.area).toBeCloseTo(12, 10);
    expect(a).not.toBe(b);
    expect(convertArea(r.area, 'm', 'mm')).toBeCloseTo(12e6, 4);
  });
});

describe('AreaMeasurementEngine — object mode / no mutation / rooms', () => {
  it('object mode measures rectangle / circle / closed polyline entities', () => {
    const rect: RectangleEntity = {
      id: 'r1',
      type: 'rectangle',
      layerId: 'layer-0',
      visible: true,
      locked: false,
      geometry: { corner1: { x: 0, y: 0 }, corner2: { x: 3, y: 4 } },
      properties: {},
    };
    const circ: CircleEntity = {
      id: 'c1',
      type: 'circle',
      layerId: 'layer-0',
      visible: true,
      locked: false,
      geometry: { center: { x: 1, y: 1 }, radius: 2 },
      properties: {},
    };
    const pl: PolylineEntity = {
      id: 'p1',
      type: 'polyline',
      layerId: 'layer-0',
      visible: true,
      locked: false,
      geometry: {
        vertices: [
          { x: 0, y: 0 },
          { x: 4, y: 0 },
          { x: 4, y: 3 },
          { x: 0, y: 3 },
        ],
        closed: true,
      },
      properties: {},
    };
    const mr = areaMeasurementEngine.measureEntity(rect, 'm');
    const mc = areaMeasurementEngine.measureEntity(circ, 'm');
    const mp = areaMeasurementEngine.measureEntity(pl, 'm');
    expect(mr.ok && mc.ok && mp.ok).toBe(true);
    if (!mr.ok || !mc.ok || !mp.ok) return;
    expect(mr.measurement.area).toBeCloseTo(12, 8);
    expect(mc.measurement.area).toBeCloseTo(Math.PI * 4, 8);
    expect(mp.measurement.area).toBeCloseTo(12, 8);
    // Entities unchanged
    expect(rect.geometry.corner2).toEqual({ x: 3, y: 4 });
    expect(circ.geometry.radius).toBe(2);
  });

  it('room area remains correct and matches engine shoelace', () => {
    const polygon = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 12 },
      { x: 0, y: 12 },
    ];
    const room: RoomEntity = {
      id: 'room-1',
      type: 'room',
      layerId: 'layer-rooms',
      visible: true,
      locked: false,
      geometry: {
        wallIds: ['w1', 'w2', 'w3', 'w4'],
        wallDirs: ['forward', 'forward', 'forward', 'forward'],
        polygon,
        area: polygonArea(polygon),
        labelPosition: { x: 5, y: 6 },
      },
      properties: { name: 'Living' },
    };
    expect(room.geometry.area).toBeCloseTo(120, 8);
    const measured = areaMeasurementEngine.measureEntity(room, 'ft');
    expect(measured.ok).toBe(true);
    if (!measured.ok) return;
    expect(measured.measurement.area).toBeCloseTo(120, 8);
    expect(measured.measurement.area).toBeCloseTo(polygonArea(polygon), 10);
    // Room entity not mutated by measurement
    expect(room.geometry.area).toBeCloseTo(120, 8);
  });
});
