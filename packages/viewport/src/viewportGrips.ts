/**
 * Paper-space viewport grips (move / corner / edge resize).
 * Coordinates are page units unless noted as screen.
 */

import {
  MIN_VIEWPORT_SIZE,
  type LayoutViewport,
} from '@ratecad/core';
import type { Vec2 } from '@ratecad/geometry';
import type { PaperViewTransform } from './paperSpace.js';
import { paperToScreen } from './paperSpace.js';

export type ViewportGripRole =
  | 'move'
  | 'nw'
  | 'n'
  | 'ne'
  | 'e'
  | 'se'
  | 's'
  | 'sw'
  | 'w';

export interface ViewportGrip {
  role: ViewportGripRole;
  /** Grip center in paper units. */
  paper: Vec2;
  /** Grip center in screen pixels. */
  screen: Vec2;
}

export function getViewportGrips(
  vp: LayoutViewport,
  view: PaperViewTransform,
): ViewportGrip[] {
  const x0 = vp.x;
  const y0 = vp.y;
  const x1 = vp.x + vp.width;
  const y1 = vp.y + vp.height;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const points: Array<{ role: ViewportGripRole; paper: Vec2 }> = [
    { role: 'nw', paper: { x: x0, y: y1 } },
    { role: 'n', paper: { x: cx, y: y1 } },
    { role: 'ne', paper: { x: x1, y: y1 } },
    { role: 'e', paper: { x: x1, y: cy } },
    { role: 'se', paper: { x: x1, y: y0 } },
    { role: 's', paper: { x: cx, y: y0 } },
    { role: 'sw', paper: { x: x0, y: y0 } },
    { role: 'w', paper: { x: x0, y: cy } },
  ];
  return points.map((p) => ({
    role: p.role,
    paper: p.paper,
    screen: paperToScreen(p.paper, view),
  }));
}

export function hitTestViewportGrip(
  grips: ViewportGrip[],
  screen: Vec2,
  tolPx = 8,
): ViewportGrip | null {
  let best: ViewportGrip | null = null;
  let bestDist = tolPx;
  for (const g of grips) {
    const dx = g.screen.x - screen.x;
    const dy = g.screen.y - screen.y;
    const d = Math.hypot(dx, dy);
    if (d <= bestDist) {
      bestDist = d;
      best = g;
    }
  }
  return best;
}

/** Apply a resize grip drag. `cursor` is current paper point. */
export function applyViewportGripResize(
  original: LayoutViewport,
  role: ViewportGripRole,
  cursor: Vec2,
  minSize = MIN_VIEWPORT_SIZE,
): LayoutViewport {
  let left = original.x;
  let right = original.x + original.width;
  let bottom = original.y;
  let top = original.y + original.height;

  if (role === 'nw' || role === 'w' || role === 'sw') {
    left = Math.min(cursor.x, right - minSize);
  }
  if (role === 'ne' || role === 'e' || role === 'se') {
    right = Math.max(cursor.x, left + minSize);
  }
  if (role === 'sw' || role === 's' || role === 'se') {
    bottom = Math.min(cursor.y, top - minSize);
  }
  if (role === 'nw' || role === 'n' || role === 'ne') {
    top = Math.max(cursor.y, bottom + minSize);
  }

  return {
    ...structuredClone(original),
    x: left,
    y: bottom,
    width: Math.max(minSize, right - left),
    height: Math.max(minSize, top - bottom),
  };
}

export function applyViewportMove(
  original: LayoutViewport,
  delta: Vec2,
): LayoutViewport {
  return {
    ...structuredClone(original),
    x: original.x + delta.x,
    y: original.y + delta.y,
  };
}

/** Zoom viewport model view about its center (updates scale only). */
export function zoomViewportScale(
  vp: LayoutViewport,
  factor: number,
): LayoutViewport {
  const next = Math.max(1e-9, vp.scale / factor);
  return { ...structuredClone(vp), scale: next };
}

/** Pan viewport model view by model-space delta. */
export function panViewportModel(
  vp: LayoutViewport,
  modelDelta: Vec2,
): LayoutViewport {
  return {
    ...structuredClone(vp),
    modelCenterX: vp.modelCenterX + modelDelta.x,
    modelCenterY: vp.modelCenterY + modelDelta.y,
  };
}
