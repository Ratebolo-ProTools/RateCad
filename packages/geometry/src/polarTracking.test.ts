import { describe, expect, it } from 'vitest';
import {
  PolarTrackingEngine,
  applyDirectionConstraint,
  buildPolarAngles,
  nearestPolarAngle,
} from './polarTracking.js';

describe('polar tracking', () => {
  it('builds 90° increments plus optional 45° diagonals', () => {
    const angles = buildPolarAngles(90, [45, 135, 225, 315]);
    expect(angles).toEqual([0, 45, 90, 135, 180, 225, 270, 315]);
  });

  it('builds 45° increments', () => {
    const angles = buildPolarAngles(45);
    expect(angles).toContain(0);
    expect(angles).toContain(45);
    expect(angles).toContain(135);
    expect(angles).toHaveLength(8);
  });

  it('finds nearest polar angle', () => {
    const n = nearestPolarAngle(40, buildPolarAngles(90, [45, 135, 225, 315]));
    expect(n?.angleDeg).toBe(45);
  });

  it('Ortho takes priority over Polar', () => {
    const origin = { x: 0, y: 0 };
    const cursor = { x: 10, y: 8 };
    const r = applyDirectionConstraint(
      origin,
      cursor,
      { enabled: true },
      { enabled: true, incrementDeg: 45 },
    );
    expect(r.kind).toBe('ortho');
    expect(r.constrained).toBe(true);
    expect(Math.abs(r.point.y)).toBeLessThan(1e-9);
    expect(r.point.x).toBeCloseTo(Math.hypot(10, 8));
  });

  it('Polar snaps to nearest configured angle', () => {
    const origin = { x: 0, y: 0 };
    const cursor = { x: 10, y: 9 }; // ~42°
    const r = applyDirectionConstraint(
      origin,
      cursor,
      { enabled: false },
      { enabled: true, incrementDeg: 90, extraAnglesDeg: [45, 135, 225, 315] },
    );
    expect(r.kind).toBe('polar');
    expect(r.angleDeg).toBe(45);
    expect(r.point.x).toBeCloseTo(Math.hypot(10, 9) * Math.cos((45 * Math.PI) / 180));
  });

  it('PolarTrackingEngine constrains via instance API', () => {
    const eng = new PolarTrackingEngine();
    eng.setPolar({ enabled: true, incrementDeg: 90 });
    eng.setOrtho(false);
    const r = eng.constrain({ x: 0, y: 0 }, { x: 1, y: 0.1 });
    expect(r.kind).toBe('polar');
    expect(r.angleDeg).toBe(0);
  });
});
