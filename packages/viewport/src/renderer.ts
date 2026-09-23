import type {
  DimensionEntity,
  DoorEntity,
  DrawingDocument,
  Entity,
  LeaderEntity,
  TextEntity,
  Vec2,
  WallEntity,
  WindowEntity,
} from '@ratecad/core';
import { getHostedByWall } from '@ratecad/core';
import {
  dimensionLayout,
  distance,
  doorLayout,
  formatAngleDegrees,
  formatLengthInUnits,
  formatRoomLabelLines,
  measuredAngleDeg,
  measuredLength,
  wallOutlineSegments,
  windowLayout,
  type SnapResult,
} from '@ratecad/geometry';
import {
  type Camera,
  screenToWorld,
  worldToScreen,
} from './camera.js';
import { getEntityGrips, getSelectionGrips, type Grip } from './grips.js';

export interface PreviewGeometry {
  kind: 'line' | 'rectangle' | 'circle' | 'polyline' | 'area';
  start: Vec2;
  end: Vec2;
  /** Existing polyline vertices while drawing */
  vertices?: Vec2[];
  /** Area highlight outer ring (model coords). */
  areaOuter?: Vec2[];
  /** Area highlight holes (model coords). */
  areaHoles?: Vec2[][];
}

export interface RenderOptions {
  width: number;
  height: number;
  camera: Camera;
  document: DrawingDocument;
  preview?: PreviewGeometry | null;
  /** Live entity previews for move/copy/grip (not committed). */
  previewEntities?: Entity[] | null;
  /** Transient selection window (world coords). */
  selectionRect?: { a: Vec2; b: Vec2 } | null;
  cursorWorld?: Vec2 | null;
  snap?: SnapResult | null;
  grips?: Grip[];
  /** Hide selected originals while showing previewEntities (move). */
  hideEntityIds?: string[];
  /** Preselection hover highlight (not selected). */
  hoveredEntityId?: string | null;
  theme?: {
    background: string;
    gridMajor: string;
    gridMinor: string;
    entity: string;
    selected: string;
    preview: string;
    hover: string;
    axis: string;
    snap: string;
    grip: string;
    gripFill: string;
    windowSelect: string;
    crossingSelect: string;
  };
}

const DEFAULT_THEME = {
  background: '#1a1d21',
  gridMajor: '#2c3238',
  gridMinor: '#23272c',
  entity: '#c8ced6',
  selected: '#4da3ff',
  preview: '#7eb6ff',
  hover: '#9ec9ff',
  axis: '#3a4450',
  snap: '#ffcc33',
  grip: '#4da3ff',
  gripFill: '#0f141a',
  windowSelect: 'rgba(77, 163, 255, 0.15)',
  crossingSelect: 'rgba(77, 200, 120, 0.15)',
};

function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  tip: Vec2,
  dir: Vec2,
  size: number,
  camera: Camera,
  width: number,
  height: number,
): void {
  const len = Math.hypot(dir.x, dir.y) || 1;
  const ux = dir.x / len;
  const uy = dir.y / len;
  const px = -uy;
  const py = ux;
  const base = { x: tip.x - ux * size, y: tip.y - uy * size };
  const left = {
    x: base.x + px * size * 0.45,
    y: base.y + py * size * 0.45,
  };
  const right = {
    x: base.x - px * size * 0.45,
    y: base.y - py * size * 0.45,
  };
  const t = worldToScreen(tip, camera, width, height);
  const l = worldToScreen(left, camera, width, height);
  const r = worldToScreen(right, camera, width, height);
  ctx.beginPath();
  ctx.moveTo(t.x, t.y);
  ctx.lineTo(l.x, l.y);
  ctx.lineTo(r.x, r.y);
  ctx.closePath();
  ctx.fill();
}

function strokeDimension(
  ctx: CanvasRenderingContext2D,
  entity: DimensionEntity,
  doc: DrawingDocument,
  camera: Camera,
  width: number,
  height: number,
  color: string,
  lineWidth: number,
): void {
  const layout = dimensionLayout(entity.geometry);
  if (!layout) return;

  const style = doc.settings.dimensionStyle;
  const gap = style.extensionGap;
  const beyond = style.extensionBeyond;
  const arrow =
    entity.properties.arrowSize ?? style.arrowSize;
  const textH =
    entity.properties.textHeight ?? style.textHeight;
  const precision =
    entity.properties.precision ?? style.precision;

  const { start, end } = entity.geometry;
  const { dimStart, dimEnd, textPos, measuredDir, perp } = layout;

  // Extension lines (with gap from geometry, beyond dim line)
  const ext1a = {
    x: start.x + perp.x * Math.sign(entity.geometry.offset || 1) * gap,
    y: start.y + perp.y * Math.sign(entity.geometry.offset || 1) * gap,
  };
  // Prefer using offset direction from measured to dim
  const offSign = entity.geometry.offset >= 0 ? 1 : -1;
  const ext1Start = {
    x: start.x + perp.x * offSign * gap,
    y: start.y + perp.y * offSign * gap,
  };
  const ext1End = {
    x: dimStart.x + perp.x * offSign * beyond,
    y: dimStart.y + perp.y * offSign * beyond,
  };
  const ext2Start = {
    x: end.x + perp.x * offSign * gap,
    y: end.y + perp.y * offSign * gap,
  };
  const ext2End = {
    x: dimEnd.x + perp.x * offSign * beyond,
    y: dimEnd.y + perp.y * offSign * beyond,
  };
  void ext1a;

  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  const e1s = worldToScreen(ext1Start, camera, width, height);
  const e1e = worldToScreen(ext1End, camera, width, height);
  const e2s = worldToScreen(ext2Start, camera, width, height);
  const e2e = worldToScreen(ext2End, camera, width, height);
  ctx.moveTo(e1s.x, e1s.y);
  ctx.lineTo(e1e.x, e1e.y);
  ctx.moveTo(e2s.x, e2s.y);
  ctx.lineTo(e2e.x, e2e.y);
  const ds = worldToScreen(dimStart, camera, width, height);
  const de = worldToScreen(dimEnd, camera, width, height);
  ctx.moveTo(ds.x, ds.y);
  ctx.lineTo(de.x, de.y);
  ctx.stroke();

  // Arrow heads point inward along dim line
  drawArrowHead(
    ctx,
    dimStart,
    measuredDir,
    arrow,
    camera,
    width,
    height,
  );
  drawArrowHead(
    ctx,
    dimEnd,
    { x: -measuredDir.x, y: -measuredDir.y },
    arrow,
    camera,
    width,
    height,
  );

  const value = measuredLength(start, end, entity.geometry.kind);
  const worldUnit = doc.settings.worldUnit ?? 'ft';
  const displayUnit = doc.settings.units;
  const frac = doc.settings.fractionDenominator ?? 16;
  let label: string;
  if (entity.geometry.kind === 'angular') {
    const vertex = entity.geometry.vertex ?? start;
    const deg = measuredAngleDeg(vertex, start, end);
    label = formatAngleDegrees(deg, precision);
  } else if (entity.geometry.kind === 'radius') {
    label = `R ${formatLengthInUnits(value, displayUnit, precision, worldUnit, frac)}`;
  } else if (entity.geometry.kind === 'diameter') {
    label = `Ø ${formatLengthInUnits(value, displayUnit, precision, worldUnit, frac)}`;
  } else {
    label = formatLengthInUnits(value, displayUnit, precision, worldUnit, frac);
  }

  // Screen-stable minimum text size so annotations stay readable when zoomed out
  const screenHeight = Math.max(textH * camera.zoom, 11);
  const tp = worldToScreen(textPos, camera, width, height);
  const angle = Math.atan2(measuredDir.y, measuredDir.x);
  // Keep text upright-ish
  let drawAngle = -angle; // canvas y is flipped via worldToScreen
  // Recompute from screen direction for correct canvas orientation
  const ds2 = worldToScreen(
    { x: textPos.x + measuredDir.x, y: textPos.y + measuredDir.y },
    camera,
    width,
    height,
  );
  drawAngle = Math.atan2(ds2.y - tp.y, ds2.x - tp.x);
  if (drawAngle > Math.PI / 2 || drawAngle < -Math.PI / 2) {
    drawAngle += Math.PI;
  }

  ctx.save();
  ctx.translate(tp.x, tp.y);
  ctx.rotate(drawAngle);
  ctx.font = `${screenHeight}px Cascadia Mono, SF Mono, Consolas, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  // Halo for readability
  ctx.lineWidth = 3;
  ctx.strokeStyle = DEFAULT_THEME.background;
  ctx.strokeText(label, 0, -2);
  ctx.fillStyle = color;
  ctx.fillText(label, 0, -2);
  ctx.restore();
}

function strokeTextEntity(
  ctx: CanvasRenderingContext2D,
  entity: TextEntity,
  camera: Camera,
  width: number,
  height: number,
  color: string,
): void {
  const p = worldToScreen(entity.geometry.position, camera, width, height);
  const screenHeight = Math.max(entity.geometry.height * camera.zoom, 10);
  const rot = -entity.geometry.rotation; // world CCW → screen (y-down) CW
  // Match screen rotation from a world unit vector
  const tip = worldToScreen(
    {
      x:
        entity.geometry.position.x + Math.cos(entity.geometry.rotation),
      y:
        entity.geometry.position.y + Math.sin(entity.geometry.rotation),
    },
    camera,
    width,
    height,
  );
  const angle = Math.atan2(tip.y - p.y, tip.x - p.x);
  void rot;

  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(angle);
  ctx.font = `${screenHeight}px Cascadia Mono, SF Mono, Consolas, monospace`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.lineWidth = 3;
  ctx.strokeStyle = DEFAULT_THEME.background;
  ctx.strokeText(entity.geometry.content, 0, 0);
  ctx.fillStyle = color;
  ctx.fillText(entity.geometry.content, 0, 0);
  ctx.restore();
}

function strokeLeader(
  ctx: CanvasRenderingContext2D,
  entity: LeaderEntity,
  camera: Camera,
  width: number,
  height: number,
  color: string,
  lineWidth: number,
): void {
  const pts = [entity.geometry.arrow, ...entity.geometry.vertices];
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  const first = worldToScreen(pts[0]!, camera, width, height);
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < pts.length; i += 1) {
    const p = worldToScreen(pts[i]!, camera, width, height);
    ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();

  const arrowSize = entity.properties.arrowSize ?? 0.2;
  if (pts.length >= 2) {
    const dir = {
      x: pts[1]!.x - pts[0]!.x,
      y: pts[1]!.y - pts[0]!.y,
    };
    drawArrowHead(ctx, pts[0]!, dir, arrowSize, camera, width, height);
  }

  const last = pts[pts.length - 1]!;
  const screenHeight = Math.max(entity.geometry.textHeight * camera.zoom, 10);
  const tp = worldToScreen(last, camera, width, height);
  ctx.font = `${screenHeight}px Cascadia Mono, SF Mono, Consolas, monospace`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  ctx.strokeStyle = DEFAULT_THEME.background;
  ctx.strokeText(entity.geometry.content, tp.x + 4, tp.y);
  ctx.fillStyle = color;
  ctx.fillText(entity.geometry.content, tp.x + 4, tp.y);
}

function strokeEntity(
  ctx: CanvasRenderingContext2D,
  entity: Entity,
  doc: DrawingDocument,
  camera: Camera,
  width: number,
  height: number,
  color: string,
  lineWidth: number,
): void {
  switch (entity.type) {
    case 'line': {
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      const s = worldToScreen(entity.geometry.start, camera, width, height);
      const e = worldToScreen(entity.geometry.end, camera, width, height);
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(e.x, e.y);
      ctx.stroke();
      break;
    }
    case 'rectangle': {
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      const a = worldToScreen(entity.geometry.corner1, camera, width, height);
      const b = worldToScreen(entity.geometry.corner2, camera, width, height);
      const x = Math.min(a.x, b.x);
      const y = Math.min(a.y, b.y);
      const w = Math.abs(b.x - a.x);
      const h = Math.abs(b.y - a.y);
      ctx.strokeRect(x, y, w, h);
      break;
    }
    case 'circle': {
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      const c = worldToScreen(entity.geometry.center, camera, width, height);
      const r = entity.geometry.radius * camera.zoom;
      ctx.arc(c.x, c.y, Math.max(r, 0.5), 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'polyline': {
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      const verts = entity.geometry.vertices;
      if (verts.length === 0) break;
      const first = worldToScreen(verts[0]!, camera, width, height);
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < verts.length; i += 1) {
        const p = worldToScreen(verts[i]!, camera, width, height);
        ctx.lineTo(p.x, p.y);
      }
      if (entity.geometry.closed && verts.length > 2) {
        ctx.closePath();
      }
      ctx.stroke();
      break;
    }
    case 'dimension':
      strokeDimension(ctx, entity, doc, camera, width, height, color, lineWidth);
      break;
    case 'text':
      strokeTextEntity(ctx, entity, camera, width, height, color);
      break;
    case 'leader':
      strokeLeader(ctx, entity, camera, width, height, color, lineWidth);
      break;
    case 'wall': {
      const hosted = getHostedByWall(doc, entity.id).map((h) => ({
        position: h.geometry.position,
        width: h.geometry.width,
      }));
      const neighbors = doc.entities.filter(
        (e): e is WallEntity => e.type === 'wall',
      );
      const segs = wallOutlineSegments(entity, hosted, neighbors);
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      for (const [a, b] of segs) {
        const sa = worldToScreen(a, camera, width, height);
        const sb = worldToScreen(b, camera, width, height);
        ctx.moveTo(sa.x, sa.y);
        ctx.lineTo(sb.x, sb.y);
      }
      ctx.stroke();
      // Centerline reference (light)
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      const cs = worldToScreen(entity.geometry.start, camera, width, height);
      const ce = worldToScreen(entity.geometry.end, camera, width, height);
      ctx.moveTo(cs.x, cs.y);
      ctx.lineTo(ce.x, ce.y);
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'door': {
      const wall = doc.entities.find(
        (e): e is WallEntity =>
          e.type === 'wall' && e.id === entity.geometry.hostWallId,
      );
      if (!wall) break;
      const layout = doorLayout(entity, wall);
      if (!layout) break;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = lineWidth;
      // Opening gap already in wall outline; draw leaf + swing arc
      ctx.beginPath();
      const h = worldToScreen(layout.hinge, camera, width, height);
      const leaf = worldToScreen(layout.leafEnd, camera, width, height);
      ctx.moveTo(h.x, h.y);
      ctx.lineTo(leaf.x, leaf.y);
      ctx.stroke();
      // Swing arc
      const r = entity.geometry.width * camera.zoom;
      const startAng = Math.atan2(
        worldToScreen(layout.openEnd, camera, width, height).y - h.y,
        worldToScreen(layout.openEnd, camera, width, height).x - h.x,
      );
      // Approximate arc from closed direction to leaf
      const closedScreen = worldToScreen(
        layout.swing === 'left' ? layout.openEnd : layout.openStart,
        camera,
        width,
        height,
      );
      const a0 = Math.atan2(closedScreen.y - h.y, closedScreen.x - h.x);
      const a1 = Math.atan2(leaf.y - h.y, leaf.x - h.x);
      ctx.beginPath();
      ctx.arc(h.x, h.y, Math.max(r, 2), a0, a1, layout.swing !== 'left');
      ctx.stroke();
      break;
    }
    case 'window': {
      const wall = doc.entities.find(
        (e): e is WallEntity =>
          e.type === 'wall' && e.id === entity.geometry.hostWallId,
      );
      if (!wall) break;
      const layout = windowLayout(entity, wall);
      if (!layout) break;
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      // Double line across opening (classic plan window)
      const oa = worldToScreen(layout.outerA, camera, width, height);
      const ob = worldToScreen(layout.outerB, camera, width, height);
      const ia = worldToScreen(layout.innerA, camera, width, height);
      const ib = worldToScreen(layout.innerB, camera, width, height);
      ctx.moveTo(oa.x, oa.y);
      ctx.lineTo(ob.x, ob.y);
      ctx.moveTo(ia.x, ia.y);
      ctx.lineTo(ib.x, ib.y);
      // Mid glass line
      const midA = {
        x: (layout.outerA.x + layout.innerA.x) / 2,
        y: (layout.outerA.y + layout.innerA.y) / 2,
      };
      const midB = {
        x: (layout.outerB.x + layout.innerB.x) / 2,
        y: (layout.outerB.y + layout.innerB.y) / 2,
      };
      const ma = worldToScreen(midA, camera, width, height);
      const mb = worldToScreen(midB, camera, width, height);
      ctx.moveTo(ma.x, ma.y);
      ctx.lineTo(mb.x, mb.y);
      ctx.stroke();
      break;
    }
    case 'room': {
      const poly = entity.geometry.polygon;
      if (poly.length < 3) break;
      ctx.save();
      ctx.beginPath();
      const first = worldToScreen(poly[0]!, camera, width, height);
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < poly.length; i += 1) {
        const p = worldToScreen(poly[i]!, camera, width, height);
        ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(201, 168, 108, 0.12)';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, lineWidth * 0.75);
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      // Label
      const lines = formatRoomLabelLines(
        entity,
        doc.settings.units,
        doc.settings.precision,
        doc.settings.worldUnit ?? 'ft',
        doc.settings.fractionDenominator ?? 16,
      );
      const lp = worldToScreen(
        entity.geometry.labelPosition,
        camera,
        width,
        height,
      );
      const fontPx = Math.max(11, 0.35 * camera.zoom);
      ctx.font = `${fontPx}px "IBM Plex Sans", system-ui, sans-serif`;
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const lineH = fontPx * 1.15;
      const startY = lp.y - ((lines.length - 1) * lineH) / 2;
      for (let i = 0; i < lines.length; i += 1) {
        ctx.globalAlpha = i === 0 ? 1 : 0.85;
        ctx.fillText(lines[i]!, lp.x, startY + i * lineH);
      }
      ctx.restore();
      break;
    }
  }
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  width: number,
  height: number,
  gridSize: number,
  theme: typeof DEFAULT_THEME,
): void {
  if (gridSize <= 0) return;

  const topLeft = screenToWorld({ x: 0, y: 0 }, camera, width, height);
  const bottomRight = screenToWorld({ x: width, y: height }, camera, width, height);

  const minX = Math.min(topLeft.x, bottomRight.x);
  const maxX = Math.max(topLeft.x, bottomRight.x);
  const minY = Math.min(topLeft.y, bottomRight.y);
  const maxY = Math.max(topLeft.y, bottomRight.y);

  const screenSpacing = gridSize * camera.zoom;
  let step = gridSize;
  let majorEvery = 5;
  if (screenSpacing < 4) {
    const factor = Math.ceil(4 / screenSpacing);
    step = gridSize * factor;
    majorEvery = Math.max(1, Math.round(5 / factor) * factor);
  }

  const startX = Math.floor(minX / step) * step;
  const startY = Math.floor(minY / step) * step;

  for (let x = startX; x <= maxX + step; x += step) {
    const screen = worldToScreen({ x, y: 0 }, camera, width, height);
    const unitIndex = Math.round(x / gridSize);
    const isMajor = Math.abs(unitIndex % majorEvery) < 1e-6;
    const isAxis = Math.abs(x) < 1e-9;
    ctx.strokeStyle = isAxis ? theme.axis : isMajor ? theme.gridMajor : theme.gridMinor;
    ctx.lineWidth = isAxis ? 1.25 : 1;
    ctx.beginPath();
    ctx.moveTo(screen.x + 0.5, 0);
    ctx.lineTo(screen.x + 0.5, height);
    ctx.stroke();
  }

  for (let y = startY; y <= maxY + step; y += step) {
    const screen = worldToScreen({ x: 0, y }, camera, width, height);
    const unitIndex = Math.round(y / gridSize);
    const isMajor = Math.abs(unitIndex % majorEvery) < 1e-6;
    const isAxis = Math.abs(y) < 1e-9;
    ctx.strokeStyle = isAxis ? theme.axis : isMajor ? theme.gridMajor : theme.gridMinor;
    ctx.lineWidth = isAxis ? 1.25 : 1;
    ctx.beginPath();
    ctx.moveTo(0, screen.y + 0.5);
    ctx.lineTo(width, screen.y + 0.5);
    ctx.stroke();
  }
}

function drawPreview(
  ctx: CanvasRenderingContext2D,
  preview: PreviewGeometry,
  camera: Camera,
  width: number,
  height: number,
  color: string,
): void {
  ctx.save();
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.25;
  ctx.beginPath();

  switch (preview.kind) {
    case 'line': {
      const s = worldToScreen(preview.start, camera, width, height);
      const e = worldToScreen(preview.end, camera, width, height);
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(e.x, e.y);
      break;
    }
    case 'rectangle': {
      const a = worldToScreen(preview.start, camera, width, height);
      const b = worldToScreen(preview.end, camera, width, height);
      ctx.strokeRect(
        Math.min(a.x, b.x),
        Math.min(a.y, b.y),
        Math.abs(b.x - a.x),
        Math.abs(b.y - a.y),
      );
      break;
    }
    case 'circle': {
      const c = worldToScreen(preview.start, camera, width, height);
      const r = distance(preview.start, preview.end) * camera.zoom;
      ctx.arc(c.x, c.y, Math.max(r, 0.5), 0, Math.PI * 2);
      break;
    }
    case 'polyline': {
      const verts = preview.vertices ?? [];
      if (verts.length > 0) {
        const first = worldToScreen(verts[0]!, camera, width, height);
        ctx.moveTo(first.x, first.y);
        for (let i = 1; i < verts.length; i += 1) {
          const p = worldToScreen(verts[i]!, camera, width, height);
          ctx.lineTo(p.x, p.y);
        }
        const end = worldToScreen(preview.end, camera, width, height);
        ctx.lineTo(end.x, end.y);
      }
      break;
    }
    case 'area': {
      const outer = preview.areaOuter ?? preview.vertices ?? [];
      if (outer.length >= 3) {
        const first = worldToScreen(outer[0]!, camera, width, height);
        ctx.moveTo(first.x, first.y);
        for (let i = 1; i < outer.length; i += 1) {
          const p = worldToScreen(outer[i]!, camera, width, height);
          ctx.lineTo(p.x, p.y);
        }
        ctx.closePath();
        ctx.fillStyle = 'rgba(77, 163, 255, 0.18)';
        ctx.fill();
        ctx.stroke();
        for (const hole of preview.areaHoles ?? []) {
          if (hole.length < 3) continue;
          ctx.beginPath();
          const hf = worldToScreen(hole[0]!, camera, width, height);
          ctx.moveTo(hf.x, hf.y);
          for (let i = 1; i < hole.length; i += 1) {
            const p = worldToScreen(hole[i]!, camera, width, height);
            ctx.lineTo(p.x, p.y);
          }
          ctx.closePath();
          ctx.fillStyle = 'rgba(26, 29, 33, 0.55)';
          ctx.fill();
          ctx.stroke();
        }
        ctx.restore();
        return;
      }
      break;
    }
  }

  ctx.stroke();
  ctx.restore();
}

function drawGrips(
  ctx: CanvasRenderingContext2D,
  grips: Grip[],
  camera: Camera,
  width: number,
  height: number,
  theme: typeof DEFAULT_THEME,
): void {
  const size = 5;
  for (const grip of grips) {
    const p = worldToScreen(grip.point, camera, width, height);
    ctx.fillStyle = theme.gripFill;
    ctx.strokeStyle = theme.grip;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.rect(p.x - size, p.y - size, size * 2, size * 2);
    ctx.fill();
    ctx.stroke();
  }
}

function drawSnapIndicator(
  ctx: CanvasRenderingContext2D,
  snap: SnapResult,
  camera: Camera,
  width: number,
  height: number,
  theme: typeof DEFAULT_THEME,
): void {
  if (!snap.snapped || !snap.kind) return;
  const p = worldToScreen(snap.point, camera, width, height);
  ctx.save();
  ctx.strokeStyle = theme.snap;
  ctx.fillStyle = theme.snap;
  ctx.lineWidth = 1.5;

  switch (snap.kind) {
    case 'endpoint': {
      ctx.strokeRect(p.x - 6, p.y - 6, 12, 12);
      break;
    }
    case 'midpoint': {
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 7);
      ctx.lineTo(p.x + 7, p.y + 5);
      ctx.lineTo(p.x - 7, p.y + 5);
      ctx.closePath();
      ctx.stroke();
      break;
    }
    case 'center': {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p.x - 9, p.y);
      ctx.lineTo(p.x + 9, p.y);
      ctx.moveTo(p.x, p.y - 9);
      ctx.lineTo(p.x, p.y + 9);
      ctx.stroke();
      break;
    }
    case 'grid': {
      ctx.beginPath();
      ctx.moveTo(p.x - 5, p.y);
      ctx.lineTo(p.x + 5, p.y);
      ctx.moveTo(p.x, p.y - 5);
      ctx.lineTo(p.x, p.y + 5);
      ctx.stroke();
      break;
    }
  }

  if (snap.label) {
    ctx.font = '11px Cascadia Mono, SF Mono, Consolas, monospace';
    ctx.fillText(snap.label, p.x + 10, p.y - 10);
  }
  ctx.restore();
}

/**
 * Pure projection of DrawingDocument → canvas.
 * Never mutates the document.
 */
export function renderDocument(
  ctx: CanvasRenderingContext2D,
  options: RenderOptions,
): void {
  const theme = { ...DEFAULT_THEME, ...options.theme };
  const { width, height, camera, document: doc } = options;
  const hidden = new Set(options.hideEntityIds ?? []);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, width, height);

  drawGrid(ctx, camera, width, height, doc.settings.gridSize, theme);

  const selected = new Set(doc.selection);
  const autoGrips: Grip[] = [];

  for (const entity of doc.entities) {
    if (!entity.visible) continue;
    if (hidden.has(entity.id)) continue;
    const layer = doc.layers.find((l) => l.id === entity.layerId);
    if (layer && !layer.visible) continue;

    const isSelected = selected.has(entity.id);
    const isHovered =
      !!options.hoveredEntityId &&
      options.hoveredEntityId === entity.id &&
      !isSelected;
    strokeEntity(
      ctx,
      entity,
      doc,
      camera,
      width,
      height,
      isSelected
        ? theme.selected
        : isHovered
          ? theme.hover
          : entity.properties.color ?? layer?.color ?? theme.entity,
      isSelected ? 2 : isHovered ? 1.75 : 1.25,
    );
    if (isSelected && !options.previewEntities?.length) {
      autoGrips.push(
        ...getSelectionGrips([entity], doc.entities),
      );
    }
  }

  if (options.previewEntities?.length) {
    ctx.save();
    ctx.setLineDash([5, 4]);
    for (const entity of options.previewEntities) {
      strokeEntity(ctx, entity, doc, camera, width, height, theme.preview, 1.5);
    }
    ctx.restore();
  }

  if (options.preview) {
    drawPreview(ctx, options.preview, camera, width, height, theme.preview);
  }

  if (options.selectionRect) {
    const a = worldToScreen(options.selectionRect.a, camera, width, height);
    const b = worldToScreen(options.selectionRect.b, camera, width, height);
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x);
    const h = Math.abs(b.y - a.y);
    const isWindow = options.selectionRect.b.x >= options.selectionRect.a.x;
    ctx.fillStyle = isWindow ? theme.windowSelect : theme.crossingSelect;
    ctx.strokeStyle = isWindow ? theme.selected : '#3ecf8e';
    ctx.lineWidth = 1;
    ctx.setLineDash(isWindow ? [] : [4, 3]);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
  }

  const grips = options.grips ?? autoGrips;
  if (grips.length > 0) {
    drawGrips(ctx, grips, camera, width, height, theme);
  }

  if (options.snap) {
    drawSnapIndicator(ctx, options.snap, camera, width, height, theme);
  }
}
