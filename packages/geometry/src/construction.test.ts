import { describe, expect, it } from 'vitest';
import type { DoorEntity, WallEntity, WindowEntity } from '@ratecad/core';
import {
  clampHostedPosition,
  doorLayout,
  parseLengthInput,
  projectOntoWall,
  validateDoorGeometry,
  validateWallGeometry,
  validateWindowGeometry,
  wallLength,
  wallLayout,
  wallOutlineSegments,
  windowLayout,
} from './construction.js';

function wall(
  id: string,
  start: { x: number; y: number },
  end: { x: number; y: number },
  thickness = 0.75,
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
      thickness,
      height: 8,
      justification: 'center',
    },
    properties: {},
  };
}

describe('construction geometry', () => {
  it('derives wall body from reference line + thickness', () => {
    const w = wall('w1', { x: 0, y: 0 }, { x: 10, y: 0 }, 1);
    expect(wallLength(w)).toBe(10);
    const layout = wallLayout(w)!;
    expect(layout.halfLeft).toBe(0.5);
    expect(layout.halfRight).toBe(0.5);
    expect(layout.corners[0].y).toBeCloseTo(0.5);
    expect(layout.corners[3].y).toBeCloseTo(-0.5);
  });

  it('cuts openings from wall outline', () => {
    const w = wall('w1', { x: 0, y: 0 }, { x: 20, y: 0 });
    const segs = wallOutlineSegments(w, [{ position: 0.5, width: 4 }]);
    expect(segs.length).toBeGreaterThan(4);
    // No continuous left face across the full wall
    const fullLeft = segs.find(
      ([a, b]) =>
        Math.abs(a.x) < 1e-9 &&
        Math.abs(b.x - 20) < 1e-9 &&
        Math.abs(a.y - b.y) < 1e-9,
    );
    expect(fullLeft).toBeUndefined();
  });

  it('joins L walls by omitting caps and extending sides', () => {
    const a = wall('a', { x: 0, y: 0 }, { x: 10, y: 0 });
    const b = wall('b', { x: 10, y: 0 }, { x: 10, y: 8 });
    const segsA = wallOutlineSegments(a, [], [a, b]);
    const segsB = wallOutlineSegments(b, [], [a, b]);
    // Joined end has no end-cap at (10,0) for wall A
    const endCapA = segsA.find(
      ([p, q]) =>
        Math.abs(p.x - 10) < 1e-6 &&
        Math.abs(q.x - 10) < 1e-6 &&
        Math.abs(Math.abs(p.y - q.y) - a.geometry.thickness) < 1e-6,
    );
    expect(endCapA).toBeUndefined();
    expect(segsA.length).toBeGreaterThan(0);
    expect(segsB.length).toBeGreaterThan(0);
  });

  it('projects points onto walls and clamps hosted positions', () => {
    const w = wall('w1', { x: 0, y: 0 }, { x: 10, y: 0 });
    const proj = projectOntoWall(w, { x: 4, y: 2 })!;
    expect(proj.t).toBeCloseTo(0.4);
    expect(clampHostedPosition(10, 2, 0)).toBeCloseTo(0.1);
    expect(clampHostedPosition(10, 2, 1)).toBeCloseTo(0.9);
  });

  it('layouts door leaf/swing and window symbol from host wall', () => {
    const w = wall('w1', { x: 0, y: 0 }, { x: 20, y: 0 });
    const door: DoorEntity = {
      id: 'd1',
      type: 'door',
      layerId: 'layer-doors',
      visible: true,
      locked: false,
      geometry: {
        hostWallId: w.id,
        position: 0.5,
        width: 3,
        height: 7,
        swing: 'left',
        swingAngle: Math.PI / 2,
      },
      properties: {},
    };
    const win: WindowEntity = {
      id: 'win1',
      type: 'window',
      layerId: 'layer-windows',
      visible: true,
      locked: false,
      geometry: {
        hostWallId: w.id,
        position: 0.25,
        width: 4,
        height: 4,
        sillHeight: 3,
      },
      properties: {},
    };
    const d = doorLayout(door, w)!;
    expect(d.center.x).toBeCloseTo(10);
    expect(Math.hypot(d.leafEnd.x - d.hinge.x, d.leafEnd.y - d.hinge.y)).toBeCloseTo(
      3,
      5,
    );
    const wl = windowLayout(win, w)!;
    expect(wl.width).toBe(4);
    expect(validateWallGeometry(w)).toBe(true);
    expect(validateDoorGeometry(door)).toBe(true);
    expect(validateWindowGeometry(win)).toBe(true);
  });

  it('parses length input in document units', () => {
    expect(parseLengthInput('9 in', 'ft')).toBeCloseTo(0.75);
    expect(parseLengthInput('6"', 'ft')).toBeCloseTo(0.5);
    expect(parseLengthInput('230 mm', 'm')).toBeCloseTo(0.23);
    expect(parseLengthInput('115 mm', 'mm')).toBeCloseTo(115);
    expect(parseLengthInput('bad', 'ft')).toBeNull();
  });

  it('rejects invalid construction dimensions', () => {
    const bad = wall('w', { x: 0, y: 0 }, { x: 0, y: 0 });
    expect(validateWallGeometry(bad)).toBe(false);
    const door: DoorEntity = {
      id: 'd',
      type: 'door',
      layerId: 'layer-doors',
      visible: true,
      locked: false,
      geometry: {
        hostWallId: '',
        position: 0.5,
        width: -1,
        height: 7,
        swing: 'left',
        swingAngle: Math.PI / 2,
      },
      properties: {},
    };
    expect(validateDoorGeometry(door)).toBe(false);
  });
});
