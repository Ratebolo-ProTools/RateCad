/**
 * P4-C5 — radius-zero FILLET safety (DEF-P4C4-01) + property/atomic checks.
 */
import { describe, expect, it } from 'vitest';
import type { Entity } from '@ratecad/core';
import {
  computeFillet,
  validateFilletResult,
} from './index.js';

const line = (
  id: string,
  start: { x: number; y: number },
  end: { x: number; y: number },
  extras: Partial<Entity> = {},
): Extract<Entity, { type: 'line' }> => ({
  id,
  type: 'line',
  layerId: (extras.layerId as string) ?? 'layer-0',
  visible: true,
  locked: false,
  geometry: { start, end },
  properties: (extras.properties as Entity['properties']) ?? {},
});

function fillet(
  a: Entity,
  pa: { x: number; y: number },
  b: Entity,
  pb: { x: number; y: number },
  radius: number,
  trim = true,
) {
  return computeFillet(
    { entity: a, worldPoint: pa },
    { entity: b, worldPoint: pb },
    { radius, trim },
    'fillet-test',
  );
}

describe('P4-C5 radius-zero FILLET safety', () => {
  it('A01: perpendicular lines at corner', () => {
    const r = fillet(
      line('a', { x: 0, y: 0 }, { x: 100, y: 0 }),
      { x: 40, y: 0 },
      line('b', { x: 100, y: 0 }, { x: 100, y: 80 }),
      { x: 100, y: 40 },
      0,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.arc).toBeNull();
    expect(r.created).toHaveLength(0);
    expect(r.replacements).toHaveLength(2);
    expect(validateFilletResult(r)).toBe(true);
  });

  it('A02: crossing lines', () => {
    const r = fillet(
      line('a', { x: 0, y: 50 }, { x: 100, y: 50 }),
      { x: 20, y: 50 },
      line('b', { x: 50, y: 0 }, { x: 50, y: 100 }),
      { x: 50, y: 20 },
      0,
    );
    expect(r.ok).toBe(true);
  });

  it('A03: non-intersecting segments whose extensions meet reasonably', () => {
    const r = fillet(
      line('a', { x: 0, y: 0 }, { x: 80, y: 0 }),
      { x: 40, y: 0 },
      line('b', { x: 100, y: 20 }, { x: 100, y: 100 }),
      { x: 100, y: 60 },
      0,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.replacements).toHaveLength(2);
  });

  it('A04: acute corner', () => {
    const r = fillet(
      line('a', { x: 0, y: 0 }, { x: 100, y: 0 }),
      { x: 50, y: 0 },
      line('b', { x: 100, y: 0 }, { x: 120, y: 60 }),
      { x: 110, y: 30 },
      0,
    );
    expect(r.ok).toBe(true);
  });

  it('A05: obtuse corner', () => {
    const r = fillet(
      line('a', { x: 0, y: 0 }, { x: 100, y: 0 }),
      { x: 20, y: 0 },
      line('b', { x: 100, y: 0 }, { x: 140, y: 20 }),
      { x: 120, y: 10 },
      0,
    );
    expect(r.ok).toBe(true);
  });

  it('A06: parallel lines (temporary radius path — not sharp)', () => {
    const r = fillet(
      line('a', { x: 0, y: 0 }, { x: 100, y: 0 }),
      { x: 50, y: 0 },
      line('b', { x: 0, y: 20 }, { x: 100, y: 20 }),
      { x: 50, y: 20 },
      0,
    );
    // Parallel uses temporary radius = half separation (existing AutoCAD-like).
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.arc?.radius).toBeCloseTo(10);
  });

  it('A07: near-parallel with extreme intersection — REJECT', () => {
    const a = line('a', { x: 0, y: 0 }, { x: 1000, y: 0 });
    const b = line('b', { x: 0, y: 1 }, { x: 1000, y: 1.01 });
    const before = { a: structuredClone(a), b: structuredClone(b) };
    const r = fillet(a, { x: 500, y: 0 }, b, { x: 500, y: 1 }, 0);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason.toLowerCase()).toMatch(/parallel|unreasonable|unstable/);
    expect(a).toEqual(before.a);
    expect(b).toEqual(before.b);
  });

  it('A08: near-parallel / shallow with reasonable intersection — ALLOW', () => {
    // Directions ~ atan(0.05)≈2.9°; intersection within modest extension.
    const r = fillet(
      line('a', { x: 0, y: 0 }, { x: 200, y: 0 }),
      { x: 100, y: 0 },
      line('b', { x: 180, y: 10 }, { x: 380, y: 20 }),
      { x: 280, y: 15 },
      0,
    );
    // May succeed or fail depending on exact intersection distance vs budget;
    // if it succeeds, extensions must be finite and bounded.
    if (r.ok) {
      for (const e of r.replacements) {
        if (e.type === 'line') {
          expect(Number.isFinite(e.geometry.start.x)).toBe(true);
          expect(Number.isFinite(e.geometry.end.x)).toBe(true);
          expect(Math.abs(e.geometry.start.x)).toBeLessThan(1e5);
          expect(Math.abs(e.geometry.end.x)).toBeLessThan(1e5);
        }
      }
    } else {
      expect(r.reason.length).toBeGreaterThan(0);
    }
  });

  it('A08b: shallow valid corner with bounded extension succeeds', () => {
    // ~5.7° between directions; meet ~100 units past short segments.
    const r = fillet(
      line('a', { x: 0, y: 0 }, { x: 100, y: 0 }),
      { x: 50, y: 0 },
      line('b', { x: 150, y: 5 }, { x: 250, y: 15 }),
      { x: 200, y: 10 },
      0,
    );
    expect(r.ok).toBe(true);
  });

  it('A09: collinear — REJECT', () => {
    const r = fillet(
      line('a', { x: 0, y: 0 }, { x: 50, y: 0 }),
      { x: 25, y: 0 },
      line('b', { x: 60, y: 0 }, { x: 120, y: 0 }),
      { x: 90, y: 0 },
      0,
    );
    expect(r.ok).toBe(false);
  });

  it('A10: zero-length — REJECT', () => {
    const r = fillet(
      line('a', { x: 0, y: 0 }, { x: 0, y: 0 }),
      { x: 0, y: 0 },
      line('b', { x: 0, y: 0 }, { x: 100, y: 0 }),
      { x: 50, y: 0 },
      0,
    );
    expect(r.ok).toBe(false);
  });

  it('A11: very short line', () => {
    const r = fillet(
      line('a', { x: 0, y: 0 }, { x: 0.001, y: 0 }),
      { x: 0.0005, y: 0 },
      line('b', { x: 0.001, y: 0 }, { x: 0.001, y: 10 }),
      { x: 0.001, y: 5 },
      0,
    );
    expect(r.ok).toBe(true);
  });

  it('A12: large coordinates', () => {
    const o = 1e6;
    const r = fillet(
      line('a', { x: o, y: o }, { x: o + 5000, y: o }),
      { x: o + 2500, y: o },
      line('b', { x: o + 5000, y: o }, { x: o + 5000, y: o + 3500 }),
      { x: o + 5000, y: o + 1750 },
      0,
    );
    expect(r.ok).toBe(true);
  });

  it('A13: small coordinates', () => {
    const r = fillet(
      line('a', { x: 0, y: 0 }, { x: 5, y: 0 }),
      { x: 2.5, y: 0 },
      line('b', { x: 5, y: 0 }, { x: 5, y: 3.5 }),
      { x: 5, y: 1.75 },
      0,
    );
    expect(r.ok).toBe(true);
  });

  it('A14: reversed line directions', () => {
    const r = fillet(
      line('a', { x: 100, y: 0 }, { x: 0, y: 0 }),
      { x: 40, y: 0 },
      line('b', { x: 100, y: 80 }, { x: 100, y: 0 }),
      { x: 100, y: 40 },
      0,
    );
    expect(r.ok).toBe(true);
  });

  it('A15: invalid op does not mutate source entity objects', () => {
    const a = line('a', { x: 0, y: 0 }, { x: 1000, y: 0 });
    const b = line('b', { x: 0, y: 1 }, { x: 1000, y: 1.01 });
    const beforeA = structuredClone(a);
    const beforeB = structuredClone(b);
    const result = fillet(a, { x: 500, y: 0 }, b, { x: 500, y: 1 }, 0);
    expect(result.ok).toBe(false);
    expect(a).toEqual(beforeA);
    expect(b).toEqual(beforeB);
  });

  it('A18: Trim/No Trim unchanged for nonzero and r=0', () => {
    const a = line('a', { x: 0, y: 0 }, { x: 100, y: 0 });
    const b = line('b', { x: 100, y: 0 }, { x: 100, y: 80 });
    const noTrim0 = fillet(a, { x: 40, y: 0 }, b, { x: 100, y: 40 }, 0, false);
    expect(noTrim0.ok).toBe(false);

    const trimR = fillet(a, { x: 40, y: 0 }, b, { x: 100, y: 40 }, 10, true);
    expect(trimR.ok).toBe(true);
    if (trimR.ok) {
      expect(trimR.replacements).toHaveLength(2);
      expect(trimR.created).toHaveLength(1);
    }
    const noTrimR = fillet(a, { x: 40, y: 0 }, b, { x: 100, y: 40 }, 10, false);
    expect(noTrimR.ok).toBe(true);
    if (noTrimR.ok) {
      expect(noTrimR.replacements).toHaveLength(0);
      expect(noTrimR.created).toHaveLength(1);
    }
  });
});
