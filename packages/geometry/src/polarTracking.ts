import type { Vec2 } from '@ratecad/core';

/**
 * Reusable Ortho / Polar tracking constraints for CAD point input.
 *
 * Priority (visual tracking only — typed coordinates/angle overrides win elsewhere):
 * 1. Ortho ON → force nearest horizontal / vertical
 * 2. Else Polar ON → snap direction to nearest configured polar angle
 * 3. Else unconstrained
 */

export interface OrthoTrackingOptions {
  enabled: boolean;
}

export interface PolarTrackingOptions {
  enabled: boolean;
  /** Primary angle increment in degrees (e.g. 90 or 45). */
  incrementDeg: number;
  /**
   * Extra absolute angles always tracked when polar is on
   * (e.g. [45] when increment is 90 for optional 45° tracking).
   */
  extraAnglesDeg?: number[];
  /**
   * Max angular distance (degrees) from a polar ray to apply snap.
   * Large values ≈ always snap to nearest angle.
   */
  snapToleranceDeg?: number;
}

export type DirectionConstraintKind = 'ortho' | 'polar' | null;

export interface DirectionConstraintResult {
  point: Vec2;
  /** Constrained absolute direction from origin in degrees, or null if unconstrained. */
  angleDeg: number | null;
  constrained: boolean;
  kind: DirectionConstraintKind;
}

function normalizeAngleDeg(deg: number): number {
  let a = deg % 360;
  if (a < 0) a += 360;
  return a;
}

function angularDistanceDeg(a: number, b: number): number {
  const d = Math.abs(normalizeAngleDeg(a) - normalizeAngleDeg(b)) % 360;
  return d > 180 ? 360 - d : d;
}

/** Build the set of polar tracking angles for the given increment + extras. */
export function buildPolarAngles(
  incrementDeg: number,
  extraAnglesDeg: number[] = [],
): number[] {
  const inc = Math.abs(incrementDeg);
  if (!(inc > 0) || !Number.isFinite(inc)) return [...extraAnglesDeg];
  const angles = new Set<number>();
  for (let a = 0; a < 360 - 1e-9; a += inc) {
    angles.add(normalizeAngleDeg(a));
  }
  for (const e of extraAnglesDeg) {
    if (Number.isFinite(e)) angles.add(normalizeAngleDeg(e));
  }
  return [...angles].sort((x, y) => x - y);
}

export function nearestPolarAngle(
  cursorAngleDeg: number,
  angles: number[],
): { angleDeg: number; deltaDeg: number } | null {
  if (!angles.length) return null;
  let best = angles[0]!;
  let bestDelta = angularDistanceDeg(cursorAngleDeg, best);
  for (let i = 1; i < angles.length; i += 1) {
    const a = angles[i]!;
    const d = angularDistanceDeg(cursorAngleDeg, a);
    if (d < bestDelta) {
      best = a;
      bestDelta = d;
    }
  }
  return { angleDeg: best, deltaDeg: bestDelta };
}

/**
 * Constrain cursor relative to an origin for Ortho / Polar tracking.
 * If origin is null or coincident with cursor, returns the cursor unchanged.
 */
export function applyDirectionConstraint(
  origin: Vec2 | null,
  cursor: Vec2,
  ortho: OrthoTrackingOptions,
  polar: PolarTrackingOptions,
): DirectionConstraintResult {
  if (!origin) {
    return {
      point: { ...cursor },
      angleDeg: null,
      constrained: false,
      kind: null,
    };
  }
  const dx = cursor.x - origin.x;
  const dy = cursor.y - origin.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-12) {
    return {
      point: { ...cursor },
      angleDeg: null,
      constrained: false,
      kind: null,
    };
  }
  const cursorAngleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;

  if (ortho.enabled) {
    const useHorizontal = Math.abs(dx) >= Math.abs(dy);
    const angleDeg = useHorizontal ? (dx >= 0 ? 0 : 180) : dy >= 0 ? 90 : 270;
    const rad = (angleDeg * Math.PI) / 180;
    return {
      point: {
        x: origin.x + dist * Math.cos(rad),
        y: origin.y + dist * Math.sin(rad),
      },
      angleDeg,
      constrained: true,
      kind: 'ortho',
    };
  }

  if (polar.enabled) {
    const angles = buildPolarAngles(
      polar.incrementDeg,
      polar.extraAnglesDeg ?? [],
    );
    const nearest = nearestPolarAngle(cursorAngleDeg, angles);
    const tol = polar.snapToleranceDeg ?? 180;
    if (nearest && nearest.deltaDeg <= tol + 1e-9) {
      const rad = (nearest.angleDeg * Math.PI) / 180;
      return {
        point: {
          x: origin.x + dist * Math.cos(rad),
          y: origin.y + dist * Math.sin(rad),
        },
        angleDeg: nearest.angleDeg,
        constrained: true,
        kind: 'polar',
      };
    }
  }

  return {
    point: { ...cursor },
    angleDeg: normalizeAngleDeg(cursorAngleDeg),
    constrained: false,
    kind: null,
  };
}

/**
 * Session-style polar tracking helper (optional OO wrapper).
 */
export class PolarTrackingEngine {
  constructor(
    private ortho: OrthoTrackingOptions = { enabled: false },
    private polar: PolarTrackingOptions = {
      enabled: false,
      incrementDeg: 90,
      extraAnglesDeg: [45, 135, 225, 315],
      snapToleranceDeg: 180,
    },
  ) {}

  setOrtho(enabled: boolean): void {
    this.ortho = { enabled };
  }

  setPolar(options: Partial<PolarTrackingOptions> & { enabled?: boolean }): void {
    this.polar = { ...this.polar, ...options };
  }

  getOrtho(): OrthoTrackingOptions {
    return { ...this.ortho };
  }

  getPolar(): PolarTrackingOptions {
    return { ...this.polar };
  }

  constrain(origin: Vec2 | null, cursor: Vec2): DirectionConstraintResult {
    return applyDirectionConstraint(origin, cursor, this.ortho, this.polar);
  }
}
