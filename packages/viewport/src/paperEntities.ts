/**
 * Paper-space entity drawing and hit-testing (page units → screen).
 */

import type {
  DimensionEntity,
  DrawingDocument,
  Entity,
  Layout,
  LeaderEntity,
  TextEntity,
  Vec2,
} from '@ratecad/core';
import {
  dimensionLayout,
  distance,
  formatLengthInUnits,
  resolveEffectiveAppearance,
} from '@ratecad/geometry';
import type { PaperViewTransform } from './paperSpace.js';
import { paperToScreen } from './paperSpace.js';

function pageUnitToPx(view: PaperViewTransform, pageUnits: number): number {
  const mm =
    view.page.units === 'inch' ? pageUnits * 25.4 : pageUnits;
  return mm * view.pxPerMm;
}

export function drawPaperSpaceEntities(
  ctx: CanvasRenderingContext2D,
  doc: DrawingDocument,
  layout: Layout,
  view: PaperViewTransform,
  options: {
    selectedIds?: Set<string>;
    hoveredId?: string | null;
  } = {},
): void {
  const selected = options.selectedIds ?? new Set<string>();
  for (const entity of layout.paperSpaceEntities) {
    if (!entity.visible) continue;
    const layer = doc.layers.find((l) => l.id === entity.layerId);
    if (layer && !layer.visible) continue;
    const effective = resolveEffectiveAppearance(entity, doc);
    const isSelected = selected.has(entity.id);
    const isHovered = options.hoveredId === entity.id;
    ctx.save();
    ctx.strokeStyle = isSelected
      ? '#4da3ff'
      : isHovered
        ? '#9ec9ff'
        : effective.colorHex;
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = isSelected || isHovered ? 2 : 1.25;
    ctx.globalAlpha = effective.alpha;

    switch (entity.type) {
      case 'line': {
        const a = paperToScreen(entity.geometry.start, view);
        const b = paperToScreen(entity.geometry.end, view);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        break;
      }
      case 'rectangle': {
        const a = paperToScreen(entity.geometry.corner1, view);
        const b = paperToScreen(entity.geometry.corner2, view);
        ctx.strokeRect(
          Math.min(a.x, b.x),
          Math.min(a.y, b.y),
          Math.abs(b.x - a.x),
          Math.abs(b.y - a.y),
        );
        break;
      }
      case 'circle': {
        const c = paperToScreen(entity.geometry.center, view);
        const r = pageUnitToPx(view, entity.geometry.radius);
        ctx.beginPath();
        ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case 'polyline': {
        const verts = entity.geometry.vertices;
        if (verts.length < 2) break;
        ctx.beginPath();
        const p0 = paperToScreen(verts[0]!, view);
        ctx.moveTo(p0.x, p0.y);
        for (let i = 1; i < verts.length; i += 1) {
          const p = paperToScreen(verts[i]!, view);
          ctx.lineTo(p.x, p.y);
        }
        if (entity.geometry.closed) ctx.closePath();
        ctx.stroke();
        break;
      }
      case 'text':
        strokePaperText(ctx, entity, view, isSelected || isHovered);
        break;
      case 'dimension':
        strokePaperDimension(ctx, entity, view, isSelected || isHovered);
        break;
      case 'leader':
        strokePaperLeader(ctx, entity, view, isSelected || isHovered);
        break;
      default:
        break;
    }
    ctx.restore();
  }
}

function strokePaperText(
  ctx: CanvasRenderingContext2D,
  entity: TextEntity,
  view: PaperViewTransform,
  highlight: boolean,
): void {
  const pos = paperToScreen(entity.geometry.position, view);
  const pxH = Math.max(8, pageUnitToPx(view, entity.geometry.height));
  ctx.font = `${pxH}px "IBM Plex Sans", system-ui, sans-serif`;
  ctx.textBaseline = 'bottom';
  const align = entity.geometry.alignment ?? 'left';
  ctx.textAlign = align === 'center' ? 'center' : align === 'right' ? 'right' : 'left';
  ctx.fillStyle = highlight ? '#4da3ff' : ctx.fillStyle;
  const lines = entity.geometry.content.split('\n');
  const rot = entity.geometry.rotation ?? 0;
  ctx.save();
  ctx.translate(pos.x, pos.y);
  ctx.rotate(-rot);
  lines.forEach((line, i) => {
    ctx.fillText(line, 0, -i * pxH * 1.15);
  });
  ctx.restore();
}

function strokePaperDimension(
  ctx: CanvasRenderingContext2D,
  entity: DimensionEntity,
  view: PaperViewTransform,
  highlight: boolean,
): void {
  const kind = entity.geometry.kind;
  if (kind !== 'horizontal' && kind !== 'vertical' && kind !== 'aligned') {
    const a = paperToScreen(entity.geometry.start, view);
    const b = paperToScreen(entity.geometry.end, view);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    return;
  }
  const layout = dimensionLayout(entity.geometry);
  if (!layout) return;
  const drawSeg = (p: Vec2, q: Vec2) => {
    const a = paperToScreen(p, view);
    const b = paperToScreen(q, view);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  };
  const { start, end } = entity.geometry;
  const { dimStart, dimEnd, textPos, perp } = layout;
  const offSign = entity.geometry.offset >= 0 ? 1 : -1;
  const gap = 1.2;
  const beyond = 1.5;
  drawSeg(
    {
      x: start.x + perp.x * offSign * gap,
      y: start.y + perp.y * offSign * gap,
    },
    {
      x: dimStart.x + perp.x * offSign * beyond,
      y: dimStart.y + perp.y * offSign * beyond,
    },
  );
  drawSeg(
    {
      x: end.x + perp.x * offSign * gap,
      y: end.y + perp.y * offSign * gap,
    },
    {
      x: dimEnd.x + perp.x * offSign * beyond,
      y: dimEnd.y + perp.y * offSign * beyond,
    },
  );
  drawSeg(dimStart, dimEnd);
  const mid = paperToScreen(textPos, view);
  const pxH = Math.max(
    8,
    pageUnitToPx(view, entity.properties.textHeight ?? 2.5),
  );
  ctx.font = `${pxH}px "IBM Plex Sans", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = highlight ? '#4da3ff' : ctx.strokeStyle;
  const len = distance(entity.geometry.start, entity.geometry.end);
  ctx.fillText(
    formatLengthInUnits(len, view.page.units === 'inch' ? 'in' : 'mm', 1),
    mid.x,
    mid.y,
  );
}

function strokePaperLeader(
  ctx: CanvasRenderingContext2D,
  entity: LeaderEntity,
  view: PaperViewTransform,
  highlight: boolean,
): void {
  const pts = [entity.geometry.arrow, ...entity.geometry.vertices];
  if (pts.length < 2) return;
  ctx.beginPath();
  const p0 = paperToScreen(pts[0]!, view);
  ctx.moveTo(p0.x, p0.y);
  for (let i = 1; i < pts.length; i += 1) {
    const p = paperToScreen(pts[i]!, view);
    ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  // Arrowhead foundation
  const tip = paperToScreen(entity.geometry.arrow, view);
  const next = paperToScreen(pts[1]!, view);
  const ang = Math.atan2(tip.y - next.y, tip.x - next.x);
  const size = pageUnitToPx(view, entity.properties.arrowSize ?? 2.5);
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(
    tip.x - size * Math.cos(ang - 0.4),
    tip.y - size * Math.sin(ang - 0.4),
  );
  ctx.lineTo(
    tip.x - size * Math.cos(ang + 0.4),
    tip.y - size * Math.sin(ang + 0.4),
  );
  ctx.closePath();
  ctx.fill();
  const anchor = paperToScreen(pts[pts.length - 1]!, view);
  const pxH = Math.max(8, pageUnitToPx(view, entity.geometry.textHeight));
  ctx.font = `${pxH}px "IBM Plex Sans", system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = highlight ? '#4da3ff' : ctx.strokeStyle;
  ctx.fillText(entity.geometry.content, anchor.x + 4, anchor.y);
}

/** Hit-test paper-space entities (top-most first). Tolerance in page units. */
export function hitTestPaperSpaceEntities(
  layout: Layout,
  paper: Vec2,
  tol: number,
): Entity | null {
  for (let i = layout.paperSpaceEntities.length - 1; i >= 0; i -= 1) {
    const e = layout.paperSpaceEntities[i]!;
    if (!e.visible) continue;
    if (hitPaperEntity(e, paper, tol)) return e;
  }
  return null;
}

function hitPaperEntity(entity: Entity, paper: Vec2, tol: number): boolean {
  switch (entity.type) {
    case 'line': {
      return pointNearSegment(
        paper,
        entity.geometry.start,
        entity.geometry.end,
        tol,
      );
    }
    case 'rectangle': {
      const a = entity.geometry.corner1;
      const b = entity.geometry.corner2;
      const minX = Math.min(a.x, b.x) - tol;
      const maxX = Math.max(a.x, b.x) + tol;
      const minY = Math.min(a.y, b.y) - tol;
      const maxY = Math.max(a.y, b.y) + tol;
      const inside =
        paper.x >= minX &&
        paper.x <= maxX &&
        paper.y >= minY &&
        paper.y <= maxY;
      if (!inside) return false;
      // Prefer border hit
      const nearBorder =
        Math.abs(paper.x - minX) <= tol * 2 ||
        Math.abs(paper.x - maxX) <= tol * 2 ||
        Math.abs(paper.y - minY) <= tol * 2 ||
        Math.abs(paper.y - maxY) <= tol * 2;
      return nearBorder || inside;
    }
    case 'circle': {
      const d = distance(paper, entity.geometry.center);
      return Math.abs(d - entity.geometry.radius) <= tol;
    }
    case 'polyline': {
      const verts = entity.geometry.vertices;
      for (let i = 0; i < verts.length - 1; i += 1) {
        if (pointNearSegment(paper, verts[i]!, verts[i + 1]!, tol)) return true;
      }
      if (
        entity.geometry.closed &&
        verts.length > 1 &&
        pointNearSegment(paper, verts[verts.length - 1]!, verts[0]!, tol)
      ) {
        return true;
      }
      return false;
    }
    case 'text': {
      const p = entity.geometry.position;
      const h = entity.geometry.height;
      const w = Math.max(h * 4, entity.geometry.content.length * h * 0.55);
      return (
        paper.x >= p.x - tol &&
        paper.x <= p.x + w + tol &&
        paper.y >= p.y - h - tol &&
        paper.y <= p.y + tol
      );
    }
    case 'dimension': {
      return (
        pointNearSegment(
          paper,
          entity.geometry.start,
          entity.geometry.end,
          tol * 2,
        ) ||
        distance(paper, entity.geometry.start) <= tol * 2 ||
        distance(paper, entity.geometry.end) <= tol * 2
      );
    }
    case 'leader': {
      const pts = [entity.geometry.arrow, ...entity.geometry.vertices];
      for (let i = 0; i < pts.length - 1; i += 1) {
        if (pointNearSegment(paper, pts[i]!, pts[i + 1]!, tol)) return true;
      }
      return false;
    }
    default:
      return false;
  }
}

function pointNearSegment(
  p: Vec2,
  a: Vec2,
  b: Vec2,
  tol: number,
): boolean {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  if (len2 < 1e-12) return distance(p, a) <= tol;
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2;
  t = Math.max(0, Math.min(1, t));
  const proj = { x: a.x + t * abx, y: a.y + t * aby };
  return distance(p, proj) <= tol;
}
