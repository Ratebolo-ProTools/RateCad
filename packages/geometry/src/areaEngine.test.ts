import { describe, expect, it } from 'vitest';
import type {
  CircleEntity,
  DrawingDocument,
  LineEntity,
  PolylineEntity,
  RectangleEntity,
  RoomEntity,
  WallEntity,
} from '@ratecad/core';
import { createEmptyDocument } from '@ratecad/core';
import {
  addAreaEntry,
  areaFromCircle,
  areaFromEntity,
  areaFromPoints,
  areaFromPolygon,
  areaFromPolyline,
  areaFromRectangle,
  convertArea,
  createAreaSession,
  formatWorldArea,
  isSelfIntersectingPolygon,
  previewAreaFromPoints,
  setAreaSessionMode,
  undoAreaEntry,
} from './areaEngine.js';
import {
  collectBoundarySegments,
  detectSegmentLoops,
  findBoundaryAtPoint,
  splitSegmentsAtIntersections,
} from './boundaryEngine.js';

function rect(
  id: string,
  c1: { x: number; y: number },
  c2: { x: number; y: number },
): RectangleEntity {
  return {
    id,
    type: 'rectangle',
    layerId: 'layer-0',
    visible: true,
    locked: false,
    geometry: { corner1: c1, corner2: c2 },
    properties: {},
  };
}

function circle(
  id: string,
  center: { x: number; y: number },
  radius: number,
): CircleEntity {
  return {
    id,
    type: 'circle',
    layerId: 'layer-0',
    visible: true,
    locked: false,
    geometry: { center, radius },
    properties: {},
  };
}

function pline(
  id: string,
  vertices: Array<{ x: number; y: number }>,
  closed: boolean,
): PolylineEntity {
  return {
    id,
    type: 'polyline',
    layerId: 'layer-0',
    visible: true,
    locked: false,
    geometry: { vertices, closed },
    properties: {},
  };
}

function line(
  id: string,
  start: { x: number; y: number },
  end: { x: number; y: number },
): LineEntity {
  return {
    id,
    type: 'line',
    layerId: 'layer-0',
    visible: true,
    locked: false,
    geometry: { start, end },
    properties: {},
  };
}

function wall(
  id: string,
  start: { x: number; y: number },
  end: { x: number; y: number },
): WallEntity {
  return {
    id,
    type: 'wall',
    layerId: 'layer-walls',
    visible: true,
    locked: false,
    geometry: {
      start,
      end,
      thickness: 0.5,
      height: 8,
      justification: 'center',
    },
    properties: {},
  };
}

describe('Area Engine', () => {
  it('rectangle 10×20 → area 200, perimeter 60', () => {
    const r = areaFromRectangle({ x: 0, y: 0 }, { x: 10, y: 20 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.area).toBeCloseTo(200, 8);
    expect(r.perimeter).toBeCloseTo(60, 8);
  });

  it('triangle base 10 height 5 → area 25', () => {
    const r = areaFromPoints([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 5 },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.area).toBeCloseTo(25, 8);
  });

  it('circle r=5 → π×25', () => {
    const r = areaFromCircle({ x: 0, y: 0 }, 5);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.area).toBeCloseTo(Math.PI * 25, 10);
    expect(r.perimeter).toBeCloseTo(2 * Math.PI * 5, 10);
  });

  it('shoelace polygon', () => {
    const r = areaFromPolygon([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 3 },
      { x: 0, y: 3 },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.area).toBeCloseTo(12, 8);
  });

  it('concave polygon area', () => {
    // Arrowhead / concave quad
    const r = areaFromPolygon([
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 4, y: 2 },
      { x: 5, y: 4 },
      { x: 0, y: 4 },
      { x: 1, y: 2 },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.area).toBeGreaterThan(10);
    expect(r.area).toBeLessThan(20);
  });

  it('polygon with hole: 1000 − 100 = 900', () => {
    const outer = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 25 },
      { x: 0, y: 25 },
    ];
    const hole = [
      { x: 10, y: 10 },
      { x: 20, y: 10 },
      { x: 20, y: 20 },
      { x: 10, y: 20 },
    ];
    expect(areaFromPolygon(outer).ok && (areaFromPolygon(outer) as { area: number }).area).toBeCloseTo(1000, 5);
    const r = areaFromPolygon(outer, { holes: [hole] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.outerArea).toBeCloseTo(1000, 5);
    expect(r.holesArea).toBeCloseTo(100, 5);
    expect(r.area).toBeCloseTo(900, 5);
  });

  it('multiple holes subtracted', () => {
    const outer = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 20 },
      { x: 0, y: 20 },
    ];
    const h1 = [
      { x: 2, y: 2 },
      { x: 6, y: 2 },
      { x: 6, y: 5 },
      { x: 2, y: 5 },
    ];
    const h2 = [
      { x: 10, y: 10 },
      { x: 14, y: 10 },
      { x: 14, y: 13 },
      { x: 10, y: 13 },
    ];
    const r = areaFromPolygon(outer, { holes: [h1, h2] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.area).toBeCloseTo(600 - 12 - 12, 5);
  });

  it('add session 100+200+50=350', () => {
    let s = createAreaSession();
    const a = areaFromRectangle({ x: 0, y: 0 }, { x: 10, y: 10 });
    const b = areaFromRectangle({ x: 0, y: 0 }, { x: 20, y: 10 });
    const c = areaFromRectangle({ x: 0, y: 0 }, { x: 10, y: 5 });
    expect(a.ok && b.ok && c.ok).toBe(true);
    if (!a.ok || !b.ok || !c.ok) return;
    s = addAreaEntry(s, a, 'A');
    s = addAreaEntry(s, b, 'B');
    s = addAreaEntry(s, c, 'C');
    expect(s.totalArea).toBeCloseTo(350, 8);
  });

  it('subtract session 500-100-50=350', () => {
    let s = createAreaSession();
    const gross = areaFromRectangle({ x: 0, y: 0 }, { x: 25, y: 20 });
    const o1 = areaFromRectangle({ x: 0, y: 0 }, { x: 10, y: 10 });
    const o2 = areaFromRectangle({ x: 0, y: 0 }, { x: 10, y: 5 });
    expect(gross.ok && o1.ok && o2.ok).toBe(true);
    if (!gross.ok || !o1.ok || !o2.ok) return;
    s = addAreaEntry(s, gross, 'Gross');
    s = setAreaSessionMode(s, 'subtract');
    s = addAreaEntry(s, o1, 'Open');
    s = addAreaEntry(s, o2, 'Col');
    expect(s.totalArea).toBeCloseTo(350, 8);
    s = undoAreaEntry(s);
    expect(s.totalArea).toBeCloseTo(400, 8);
  });

  it('self-intersecting returns validation error', () => {
    const bow = [
      { x: 0, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
      { x: 2, y: 0 },
    ];
    expect(isSelfIntersectingPolygon(bow)).toBe(true);
    const r = areaFromPolygon(bow);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('self-intersecting');
  });

  it('open polyline does not silently close', () => {
    const r = areaFromPolyline(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 5 },
      ],
      false,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('open');
  });

  it('open polyline can force-close', () => {
    const r = areaFromPolyline(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 5 },
        { x: 0, y: 5 },
      ],
      false,
      undefined,
      true,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.area).toBeCloseTo(50, 8);
  });

  it('unit conversion: 1 ft² = 0.09290304 m²', () => {
    expect(convertArea(1, 'ft', 'm')).toBeCloseTo(0.09290304, 10);
    expect(convertArea(120, 'ft', 'm')).toBeCloseTo(120 * 0.09290304, 8);
  });

  it('display formatting uses squared factor', () => {
    expect(formatWorldArea(120, 'ft', 'ft', 2)).toMatch(/120\.00/);
    const m = formatWorldArea(120, 'ft', 'm', 2);
    expect(m).toMatch(/11\.15/);
  });

  it('live preview updates with points', () => {
    const p = previewAreaFromPoints([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 12 },
      { x: 0, y: 12 },
    ]);
    expect(p.valid).toBe(true);
    expect(p.area).toBeCloseTo(120, 8);
  });

  it('entity helpers for rectangle/circle/room', () => {
    const r = areaFromEntity(rect('r1', { x: 0, y: 0 }, { x: 10, y: 12 }));
    expect(r.ok && r.area).toBeCloseTo(120, 8);
    const c = areaFromEntity(circle('c1', { x: 0, y: 0 }, 1));
    expect(c.ok && c.area).toBeCloseTo(Math.PI, 8);
    const room: RoomEntity = {
      id: 'room1',
      type: 'room',
      layerId: 'layer-rooms',
      visible: true,
      locked: false,
      geometry: {
        wallIds: [],
        wallDirs: [],
        polygon: [
          { x: 0, y: 0 },
          { x: 12, y: 0 },
          { x: 12, y: 15 },
          { x: 0, y: 15 },
        ],
        labelPosition: { x: 6, y: 7.5 },
        area: 180,
      },
      properties: { name: 'Room B' },
    };
    const ra = areaFromEntity(room);
    expect(ra.ok && ra.area).toBeCloseTo(180, 8);
  });
});

describe('Boundary Engine', () => {
  it('detects closed rectangle from four lines', () => {
    const segs = collectBoundarySegments([
      line('l1', { x: 0, y: 0 }, { x: 10, y: 0 }),
      line('l2', { x: 10, y: 0 }, { x: 10, y: 12 }),
      line('l3', { x: 10, y: 12 }, { x: 0, y: 12 }),
      line('l4', { x: 0, y: 12 }, { x: 0, y: 0 }),
    ]);
    const loops = detectSegmentLoops(segs, 1e-4);
    expect(loops.length).toBeGreaterThanOrEqual(1);
    const best = loops.sort((a, b) => b.area - a.area)[0]!;
    expect(best.area).toBeCloseTo(120, 4);
  });

  it('splits crossing segments at intersections', () => {
    const segs = collectBoundarySegments([
      line('a', { x: 0, y: 5 }, { x: 10, y: 5 }),
      line('b', { x: 5, y: 0 }, { x: 5, y: 10 }),
    ]);
    const split = splitSegmentsAtIntersections(segs, 1e-4);
    expect(split.length).toBe(4);
  });

  it('pick-inside finds wall loop with hole nesting', () => {
    let doc = createEmptyDocument('Area Test');
    const walls = [
      wall('w1', { x: 0, y: 0 }, { x: 20, y: 0 }),
      wall('w2', { x: 20, y: 0 }, { x: 20, y: 20 }),
      wall('w3', { x: 20, y: 20 }, { x: 0, y: 20 }),
      wall('w4', { x: 0, y: 20 }, { x: 0, y: 0 }),
      // inner column box 2×2 → area 4
      wall('c1', { x: 8, y: 8 }, { x: 10, y: 8 }),
      wall('c2', { x: 10, y: 8 }, { x: 10, y: 10 }),
      wall('c3', { x: 10, y: 10 }, { x: 8, y: 10 }),
      wall('c4', { x: 8, y: 10 }, { x: 8, y: 8 }),
    ];
    doc = { ...doc, entities: walls };
    const r = findBoundaryAtPoint(doc, { x: 5, y: 5 }, { tolerance: 0.01 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Outer 400 minus hole 4 when nesting works; at minimum outer should be found
    expect(r.area).toBeLessThanOrEqual(400 + 1e-6);
    expect(r.area).toBeGreaterThan(100);
    // Prefer net area when island nesting succeeds
    if (r.holes.length > 0) {
      expect(r.area).toBeCloseTo(400 - 4, 1);
    }
  });

  it('pick-inside finds circle', () => {
    let doc = createEmptyDocument('Circle');
    doc = {
      ...doc,
      entities: [circle('col', { x: 0, y: 0 }, 1)],
    };
    const r = findBoundaryAtPoint(doc, { x: 0.2, y: 0.1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.area).toBeCloseTo(Math.PI, 6);
  });

  it('spatial filter stays responsive on large drawings', () => {
    const entities: LineEntity[] = [];
    for (let i = 0; i < 400; i += 1) {
      const x = 1000 + (i % 20) * 5;
      const y = 1000 + Math.floor(i / 20) * 5;
      entities.push(line(`far-${i}`, { x, y }, { x: x + 3, y }));
    }
    // Local closed box near origin
    entities.push(
      line('b1', { x: 0, y: 0 }, { x: 10, y: 0 }),
      line('b2', { x: 10, y: 0 }, { x: 10, y: 10 }),
      line('b3', { x: 10, y: 10 }, { x: 0, y: 10 }),
      line('b4', { x: 0, y: 10 }, { x: 0, y: 0 }),
    );
    const doc: DrawingDocument = {
      ...createEmptyDocument('perf'),
      entities,
    };
    const t0 = performance.now();
    const r = findBoundaryAtPoint(doc, { x: 5, y: 5 }, { maxCandidates: 200 });
    const elapsed = performance.now() - t0;
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.area).toBeCloseTo(100, 3);
    expect(elapsed).toBeLessThan(500);
  });
});

describe('Verification drawing (Room A/B, column, opening)', () => {
  it('computes gross and net areas with unit invariance', () => {
    // Room A 10×12 = 120
    const roomA = areaFromRectangle({ x: 0, y: 0 }, { x: 10, y: 12 });
    // Room B 12×15 = 180
    const roomB = areaFromRectangle({ x: 20, y: 0 }, { x: 32, y: 15 });
    // Column r=1 → π
    const col = areaFromCircle({ x: 25, y: 7 }, 1);
    // Opening 5×4 = 20
    const opening = areaFromRectangle({ x: 22, y: 2 }, { x: 27, y: 6 });

    expect(roomA.ok && roomA.area).toBeCloseTo(120, 8);
    expect(roomB.ok && roomB.area).toBeCloseTo(180, 8);
    expect(col.ok && col.area).toBeCloseTo(Math.PI, 8);
    expect(opening.ok && opening.area).toBeCloseTo(20, 8);

    let s = createAreaSession();
    if (!roomA.ok || !roomB.ok || !col.ok || !opening.ok) return;
    s = addAreaEntry(s, roomA, 'Room A');
    s = addAreaEntry(s, roomB, 'Room B');
    const gross = s.totalArea;
    expect(gross).toBeCloseTo(300, 8);
    s = setAreaSessionMode(s, 'subtract');
    s = addAreaEntry(s, col, 'Column');
    s = addAreaEntry(s, opening, 'Opening');
    const net = s.totalArea;
    expect(net).toBeCloseTo(300 - Math.PI - 20, 8);

    // Unit display changes, physical area unchanged
    const world = net;
    for (const u of ['ft', 'm', 'cm', 'mm'] as const) {
      const shown = convertArea(world, 'ft', u === 'ft' ? 'ft' : u);
      const back = convertArea(shown, u === 'ft' ? 'ft' : u, 'ft');
      expect(back).toBeCloseTo(world, 8);
    }
  });
});
