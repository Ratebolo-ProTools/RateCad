import type {
  DimensionEntity,
  DoorEntity,
  DrawingDocument,
  Entity,
  Layout,
  LayoutViewport,
  LeaderEntity,
  TextEntity,
  Vec2,
  BlockReferenceEntity,
  ViewportId,
  WallEntity,
  WindowEntity,
  WorkspaceMode,
} from '@ratecad/core';
import {
  getActiveDimensionStyle,
  getHostedByWall,
  isAnnotativeEntity,
  isLayerVisibleInViewport,
  resolveAnnotationSettings,
  resolvePaperHeightMm,
  annotativeScreenPx,
} from '@ratecad/core';
import {
  blockCircleWorldPoints,
  dimensionAnnotationText,
  dimensionLayout,
  dimensionMeasuredValue,
  distance,
  rectangleLocalCorners,
  transformBlockPoint,
  doorLayout,
  formatAngleByDrawingUnits,
  formatAngleDegrees,
  formatDimensionLength,
  formatLengthInUnits,
  formatRoomLabelLines,
  lineweightToScreenPx,
  resolveEffectiveAppearance,
  wallOutlineSegments,
  windowLayout,
  type SnapResult,
} from '@ratecad/geometry';
import {
  type Camera,
  screenToWorld,
  worldToScreen,
} from './camera.js';
import {
  drawDraftingCursor,
  type CrosshairSize,
  type PickboxSize,
} from './draftingCursor.js';
import { getEntityGrips, getSelectionGrips, type Grip } from './grips.js';
import {
  cameraForViewport,
  drawPaperPreviewRect,
  drawPaperSheet,
  drawViewportFrame,
  fitPaperInCanvas,
  layoutSheetLabel,
  paperViewForLayout,
} from './paperSpace.js';
import { drawPaperSpaceEntities } from './paperEntities.js';

/** Annotation render context — Model vs Viewport vs Paper. */
export type AnnotationRenderContext = {
  /** model = Model tab; viewport = through layout VP; paper = paper entities */
  space: 'model' | 'viewport' | 'paper';
  /** For viewport space — paper millimetres → screen. */
  pxPerMm?: number;
  /** Viewport stored scale (model units per paper unit). */
  viewportScale?: number;
};

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
  /**
   * Screen-space drafting cursor (CSS pixels, canvas-local).
   * Preferred for crosshair/pickbox so Model / Paper / Viewport stay accurate.
   */
  cursorScreen?: Vec2 | null;
  /** When false, skip drawn crosshair/pickbox (pan / pointer left canvas). */
  showDraftingCursor?: boolean;
  showPickbox?: boolean;
  crosshairSize?: CrosshairSize;
  pickboxSize?: PickboxSize;
  /** CSS hex color for the crosshair and pickbox. */
  crosshairColor?: string;
  /** When false, draw the pickbox without the crosshair (object selection). */
  showCrosshair?: boolean;
  /** Screen-pixel snap marker size. */
  snapMarkerPx?: number;
  /** Draw the snap kind label next to the marker. */
  showSnapTooltip?: boolean;
  snap?: SnapResult | null;
  grips?: Grip[];
  /** Hide selected originals while showing previewEntities (move). */
  hideEntityIds?: string[];
  /** Preselection hover highlight (not selected). */
  hoveredEntityId?: string | null;
  /**
   * When set with workspaceMode PAPER_SPACE or VIEWPORT_MODEL_SPACE,
   * renders the paper sheet + layout viewports instead of full Model Space.
   */
  paperSpaceLayout?: Layout | null;
  workspaceMode?: WorkspaceMode;
  /** Active viewport when in VIEWPORT_MODEL_SPACE (green frame). */
  activeViewportId?: ViewportId | null;
  /** Selected viewport id in paper space (blue frame). */
  selectedViewportId?: ViewportId | null;
  /**
   * Live paper-space rectangle preview (page units), e.g. MVIEW / resize.
   * Drawn in paper coordinates — never mutates the document.
   */
  paperPreviewRect?: { a: Vec2; b: Vec2 } | null;
  /** Override viewport geometry while dragging (preview only). */
  viewportPreviewOverride?: LayoutViewport | null;
  /** Selected paper-space entity ids (layout.paperSpaceEntities). */
  selectedPaperEntityIds?: string[];
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

function dimensionTextColor(styleColor: string | undefined, fallback: string): string {
  if (!styleColor) return fallback;
  const value = styleColor.trim();
  if (
    !value ||
    value.toUpperCase() === 'BYLAYER' ||
    value.toUpperCase() === 'BYBLOCK'
  ) {
    return fallback;
  }
  return value;
}

function strokeCurvedDimension(
  ctx: CanvasRenderingContext2D,
  entity: DimensionEntity,
  doc: DrawingDocument,
  camera: Camera,
  width: number,
  height: number,
  color: string,
  lineWidth: number,
  sizes: {
    arrow: number;
    textH: number;
    precision: number;
    dimStyleDef: ReturnType<typeof getActiveDimensionStyle>;
    annotative: boolean;
    annotCtx?: AnnotationRenderContext;
  },
): void {
  const vertex = entity.geometry.vertex;
  if (!vertex) return;
  const { start, end, kind, offset } = entity.geometry;
  const startAngle = Math.atan2(start.y - vertex.y, start.x - vertex.x);
  const geometryRadius = Math.hypot(start.x - vertex.x, start.y - vertex.y);
  let sweep = Math.atan2(end.y - vertex.y, end.x - vertex.x) - startAngle;
  while (sweep < 0) sweep += Math.PI * 2;
  while (sweep >= Math.PI * 2) sweep -= Math.PI * 2;
  if (kind === 'arc-length' && typeof entity.metadata?.sweepRadians === 'number') {
    sweep = Math.abs(entity.metadata.sweepRadians as number);
  } else if (entity.metadata?.useCcw !== true && sweep > Math.PI) {
    sweep -= Math.PI * 2;
  }
  const dimRadius = kind === 'arc-length'
    ? Math.max(geometryRadius + offset, Math.max(geometryRadius, 1e-6) * 0.2)
    : Math.max(geometryRadius, 1e-6);
  const at = (angle: number, radius: number): Vec2 => ({
    x: vertex.x + radius * Math.cos(angle),
    y: vertex.y + radius * Math.sin(angle),
  });
  const steps = Math.max(8, Math.ceil(Math.abs(sweep) / (Math.PI / 18)));
  const direction = sweep >= 0 ? 1 : -1;

  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  if (kind === 'arc-length') {
    const gap = sizes.dimStyleDef.lines.offsetFromOrigin;
    const beyond = sizes.dimStyleDef.lines.extendBeyond;
    const drawRadial = (angle: number) => {
      const inner = at(angle, geometryRadius + direction * Math.sign(offset || 1) * gap);
      const outer = at(angle, dimRadius + direction * Math.sign(offset || 1) * beyond);
      const a = worldToScreen(inner, camera, width, height);
      const b = worldToScreen(outer, camera, width, height);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    };
    drawRadial(startAngle);
    drawRadial(startAngle + sweep);
  }
  for (let index = 0; index <= steps; index += 1) {
    const angle = startAngle + (sweep * index) / steps;
    const screen = worldToScreen(at(angle, dimRadius), camera, width, height);
    if (index === 0) ctx.moveTo(screen.x, screen.y);
    else ctx.lineTo(screen.x, screen.y);
  }
  ctx.stroke();

  const startTip = at(startAngle, dimRadius);
  const endTip = at(startAngle + sweep, dimRadius);
  drawArrowHead(
    ctx,
    startTip,
    { x: -Math.sin(startAngle) * direction, y: Math.cos(startAngle) * direction },
    sizes.arrow,
    camera,
    width,
    height,
  );
  const endAngle = startAngle + sweep;
  drawArrowHead(
    ctx,
    endTip,
    { x: Math.sin(endAngle) * direction, y: -Math.cos(endAngle) * direction },
    sizes.arrow,
    camera,
    width,
    height,
  );

  const worldUnit = doc.settings.worldUnit ?? 'ft';
  const measured = dimensionMeasuredValue(entity.geometry, entity.metadata);
  const formatted = kind === 'angular'
    ? (doc.settings.drawingUnits
      ? formatAngleByDrawingUnits(
          measured,
          doc.settings.drawingUnits.angularFormat,
          doc.settings.drawingUnits.angularPrecision,
        )
      : formatAngleDegrees(measured, sizes.precision))
    : kind === 'arc-length'
      ? `Arc ${formatDimensionLength(measured, worldUnit, sizes.dimStyleDef)}`
      : formatDimensionLength(measured, worldUnit, sizes.dimStyleDef);
  const label = dimensionAnnotationText(entity.metadata, formatted);
  const mid = at(startAngle + sweep / 2, dimRadius);
  paintDimensionText(
    ctx,
    label,
    mid,
    { x: -Math.sin(startAngle + sweep / 2), y: Math.cos(startAngle + sweep / 2) },
    dimensionTextColor(sizes.dimStyleDef.text.color, color),
    sizes.textH,
    camera,
    width,
    height,
    sizes.annotative,
    sizes.annotCtx,
  );
}

function paintDimensionText(
  ctx: CanvasRenderingContext2D,
  label: string,
  textPos: Vec2,
  measuredDir: Vec2,
  color: string,
  textH: number,
  camera: Camera,
  width: number,
  height: number,
  annotative: boolean,
  annotCtx: AnnotationRenderContext | undefined,
): void {
  let screenHeight: number;
  if (annotative && annotCtx?.pxPerMm != null) {
    screenHeight = Math.max(11, textH);
  } else {
    screenHeight = Math.max(textH * camera.zoom, 11);
  }
  const tp = worldToScreen(textPos, camera, width, height);
  const ds2 = worldToScreen(
    { x: textPos.x + measuredDir.x, y: textPos.y + measuredDir.y },
    camera,
    width,
    height,
  );
  let drawAngle = Math.atan2(ds2.y - tp.y, ds2.x - tp.x);
  if (drawAngle > Math.PI / 2 || drawAngle < -Math.PI / 2) drawAngle += Math.PI;
  ctx.save();
  ctx.translate(tp.x, tp.y);
  ctx.rotate(drawAngle);
  ctx.font = `${screenHeight}px Cascadia Mono, SF Mono, Consolas, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.lineWidth = 3;
  ctx.strokeStyle = DEFAULT_THEME.background;
  ctx.strokeText(label, 0, -2);
  ctx.fillStyle = color;
  ctx.fillText(label, 0, -2);
  ctx.restore();
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
  annotCtx?: AnnotationRenderContext,
): void {
  const dimStyleDef = getActiveDimensionStyle(
    doc.settings.dimensionStyles ?? [],
    doc.settings.activeDimensionStyleName ?? 'Standard',
  );
  const style = doc.settings.dimensionStyle;
  const ann = resolveAnnotationSettings(doc.settings.annotationScale);
  const gap = dimStyleDef.lines.offsetFromOrigin || style.extensionGap;
  const beyond = dimStyleDef.lines.extendBeyond || style.extensionBeyond;
  let arrow = entity.properties.arrowSize ?? dimStyleDef.symbols.arrowSize ?? style.arrowSize;
  let textH = entity.properties.textHeight ?? dimStyleDef.text.height ?? style.textHeight;
  const precision =
    entity.properties.precision ?? dimStyleDef.primary.precision ?? style.precision;

  // Annotative model dims through a viewport: size from paper mm + this VP scale
  // so text/arrows stay readable when viewport scale changes.
  const annotative =
    annotCtx?.space === 'viewport' && isAnnotativeEntity(entity);
  if (annotative && annotCtx.viewportScale != null && annotCtx.viewportScale > 0) {
    const paperText = resolvePaperHeightMm({
      paperHeightMm:
        typeof entity.metadata?.paperHeightMm === 'number'
          ? entity.metadata.paperHeightMm
          : null,
      modelHeight: textH,
      annotationRatio: ann.ratio,
      fallbackPaperMm: ann.paperDimTextHeightMm,
    });
    const paperArrow =
      typeof entity.metadata?.paperArrowSizeMm === 'number'
        ? entity.metadata.paperArrowSizeMm
        : ann.paperArrowSizeMm;
    arrow = paperArrow * annotCtx.viewportScale;
    textH = paperText * annotCtx.viewportScale;
  }

  if (
    entity.geometry.vertex &&
    (entity.geometry.kind === 'arc-length' || entity.geometry.kind === 'angular')
  ) {
    strokeCurvedDimension(ctx, entity, doc, camera, width, height, color, lineWidth, {
      arrow,
      textH,
      precision,
      dimStyleDef,
      annotative,
      ...(annotCtx ? { annotCtx } : {}),
    });
    return;
  }

  const layout = dimensionLayout(entity.geometry);
  if (!layout) return;

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

  const value = dimensionMeasuredValue(entity.geometry, entity.metadata);
  const worldUnit = doc.settings.worldUnit ?? 'ft';
  const displayUnit = doc.settings.units;
  const frac = doc.settings.fractionDenominator ?? 16;
  let formatted: string;
  if (entity.geometry.kind === 'angular') {
    const units = doc.settings.drawingUnits;
    formatted = units
      ? formatAngleByDrawingUnits(value, units.angularFormat, units.angularPrecision)
      : formatAngleDegrees(value, precision);
  } else if (entity.geometry.kind === 'radius') {
    formatted = formatDimensionLength(value, worldUnit, dimStyleDef, {
      kindPrefix: 'R',
    });
  } else if (entity.geometry.kind === 'diameter') {
    formatted = formatDimensionLength(value, worldUnit, dimStyleDef, {
      kindPrefix: 'Ø',
    });
  } else if (entity.geometry.kind === 'arc-length') {
    formatted = `Arc ${formatDimensionLength(value, worldUnit, dimStyleDef)}`;
  } else {
    // DIMSTYLE primary/alternate units — not drawing LUNITS.
    formatted = formatDimensionLength(value, worldUnit, dimStyleDef);
  }
  // Fallback if style table missing in partially migrated docs
  if (!formatted || formatted === '—') {
    formatted = formatLengthInUnits(value, displayUnit, precision, worldUnit, frac);
  }
  const label = dimensionAnnotationText(entity.metadata, formatted);

  // Screen-stable text: annotative in viewport uses paper mm; else model*zoom
  let screenHeight: number;
  if (annotative && annotCtx.pxPerMm != null) {
    const paperText = resolvePaperHeightMm({
      paperHeightMm:
        typeof entity.metadata?.paperHeightMm === 'number'
          ? entity.metadata.paperHeightMm
          : null,
      modelHeight: entity.properties.textHeight ?? style.textHeight,
      annotationRatio: ann.ratio,
      fallbackPaperMm: ann.paperDimTextHeightMm,
    });
    screenHeight = annotativeScreenPx(paperText, annotCtx.pxPerMm, 11);
  } else {
    screenHeight = Math.max(textH * camera.zoom, 11);
  }
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
  ctx.fillStyle = dimensionTextColor(dimStyleDef.text.color, color);
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
  doc?: DrawingDocument,
  annotCtx?: AnnotationRenderContext,
): void {
  const p = worldToScreen(entity.geometry.position, camera, width, height);
  let screenHeight: number;
  const annotative =
    annotCtx?.space === 'viewport' && isAnnotativeEntity(entity);
  if (annotative && annotCtx.pxPerMm != null && doc) {
    const ann = resolveAnnotationSettings(doc.settings.annotationScale);
    const paperMm = resolvePaperHeightMm({
      paperHeightMm:
        typeof entity.metadata?.paperHeightMm === 'number'
          ? entity.metadata.paperHeightMm
          : null,
      modelHeight: entity.geometry.height,
      annotationRatio: ann.ratio,
      fallbackPaperMm: ann.paperTextHeightMm,
    });
    screenHeight = annotativeScreenPx(paperMm, annotCtx.pxPerMm, 10);
  } else {
    screenHeight = Math.max(entity.geometry.height * camera.zoom, 10);
  }
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
  doc?: DrawingDocument,
  annotCtx?: AnnotationRenderContext,
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

  let arrowSize = entity.properties.arrowSize ?? 0.2;
  const annotative =
    annotCtx?.space === 'viewport' && isAnnotativeEntity(entity);
  if (annotative && annotCtx.viewportScale != null && annotCtx.viewportScale > 0 && doc) {
    const ann = resolveAnnotationSettings(doc.settings.annotationScale);
    const paperArrow =
      typeof entity.metadata?.paperArrowSizeMm === 'number'
        ? entity.metadata.paperArrowSizeMm
        : ann.paperArrowSizeMm;
    arrowSize = paperArrow * annotCtx.viewportScale;
  }
  if (pts.length >= 2) {
    const dir = {
      x: pts[1]!.x - pts[0]!.x,
      y: pts[1]!.y - pts[0]!.y,
    };
    drawArrowHead(ctx, pts[0]!, dir, arrowSize, camera, width, height);
  }

  const last = pts[pts.length - 1]!;
  let screenHeight: number;
  if (annotative && annotCtx.pxPerMm != null && doc) {
    const ann = resolveAnnotationSettings(doc.settings.annotationScale);
    const paperMm = resolvePaperHeightMm({
      paperHeightMm:
        typeof entity.metadata?.paperHeightMm === 'number'
          ? entity.metadata.paperHeightMm
          : null,
      modelHeight: entity.geometry.textHeight,
      annotationRatio: ann.ratio,
      fallbackPaperMm: ann.paperTextHeightMm,
    });
    screenHeight = annotativeScreenPx(paperMm, annotCtx.pxPerMm, 10);
  } else {
    screenHeight = Math.max(entity.geometry.textHeight * camera.zoom, 10);
  }
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

function strokeWorldChain(
  ctx: CanvasRenderingContext2D,
  points: Vec2[],
  camera: Camera,
  width: number,
  height: number,
  closed: boolean,
): void {
  if (points.length === 0) return;
  ctx.beginPath();
  const first = worldToScreen(points[0]!, camera, width, height);
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < points.length; i += 1) {
    const point = worldToScreen(points[i]!, camera, width, height);
    ctx.lineTo(point.x, point.y);
  }
  if (closed && points.length > 2) ctx.closePath();
  ctx.stroke();
}

function strokeBlockText(
  ctx: CanvasRenderingContext2D,
  reference: BlockReferenceEntity,
  position: Vec2,
  rotation: number,
  textHeight: number,
  content: string,
  camera: Camera,
  width: number,
  height: number,
  color: string,
): void {
  const origin = transformBlockPoint(position, reference);
  const right = transformBlockPoint(
    {
      x: position.x + Math.cos(rotation),
      y: position.y + Math.sin(rotation),
    },
    reference,
  );
  const down = transformBlockPoint(
    {
      x: position.x + Math.sin(rotation),
      y: position.y - Math.cos(rotation),
    },
    reference,
  );
  const o = worldToScreen(origin, camera, width, height);
  const r = worldToScreen(right, camera, width, height);
  const d = worldToScreen(down, camera, width, height);
  ctx.save();
  ctx.transform(r.x - o.x, r.y - o.y, d.x - o.x, d.y - o.y, o.x, o.y);
  ctx.font = `${textHeight}px "IBM Plex Sans", system-ui, sans-serif`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(content, 0, 0);
  ctx.restore();
}

function strokeBlockReference(
  ctx: CanvasRenderingContext2D,
  reference: BlockReferenceEntity,
  doc: DrawingDocument,
  camera: Camera,
  width: number,
  height: number,
  color: string,
  lineWidth: number,
  unifiedColor: boolean,
): void {
  const definition = doc.blockDefinitions.find(
    (item) => item.id === reference.geometry.definitionId,
  );
  ctx.lineWidth = lineWidth;
  if (!definition) {
    const p = reference.geometry.position;
    ctx.strokeStyle = color;
    strokeWorldChain(
      ctx,
      [
        { x: p.x - 0.25, y: p.y - 0.25 },
        { x: p.x + 0.25, y: p.y + 0.25 },
      ],
      camera,
      width,
      height,
      false,
    );
    strokeWorldChain(
      ctx,
      [
        { x: p.x - 0.25, y: p.y + 0.25 },
        { x: p.x + 0.25, y: p.y - 0.25 },
      ],
      camera,
      width,
      height,
      false,
    );
    return;
  }

  for (const content of definition.entities) {
    const paint = unifiedColor
      ? color
      : resolveEffectiveAppearance(content, doc, color).colorHex;
    ctx.strokeStyle = paint;
    ctx.fillStyle = paint;
    if (!unifiedColor) {
      const appearance = resolveEffectiveAppearance(content, doc, color);
      ctx.setLineDash(
        appearance.linetypePattern.map((value) =>
          Math.max(0.5, Math.abs(value) * camera.zoom),
        ),
      );
    }
    switch (content.type) {
      case 'line':
        strokeWorldChain(
          ctx,
          [
            transformBlockPoint(content.geometry.start, reference),
            transformBlockPoint(content.geometry.end, reference),
          ],
          camera,
          width,
          height,
          false,
        );
        break;
      case 'rectangle':
        strokeWorldChain(
          ctx,
          rectangleLocalCorners(
            content.geometry.corner1,
            content.geometry.corner2,
          ).map((corner) => transformBlockPoint(corner, reference)),
          camera,
          width,
          height,
          true,
        );
        break;
      case 'circle':
        strokeWorldChain(
          ctx,
          blockCircleWorldPoints(
            content.geometry.center,
            content.geometry.radius,
            reference,
          ),
          camera,
          width,
          height,
          true,
        );
        break;
      case 'polyline':
        strokeWorldChain(
          ctx,
          content.geometry.vertices.map((vertex) =>
            transformBlockPoint(vertex, reference),
          ),
          camera,
          width,
          height,
          content.geometry.closed,
        );
        break;
      case 'text':
        strokeBlockText(
          ctx,
          reference,
          content.geometry.position,
          content.geometry.rotation,
          content.geometry.height,
          content.geometry.content,
          camera,
          width,
          height,
          paint,
        );
        break;
      case 'leader': {
        const points = [content.geometry.arrow, ...content.geometry.vertices].map(
          (vertex) => transformBlockPoint(vertex, reference),
        );
        strokeWorldChain(ctx, points, camera, width, height, false);
        const last =
          content.geometry.vertices[content.geometry.vertices.length - 1] ??
          content.geometry.arrow;
        strokeBlockText(
          ctx,
          reference,
          last,
          0,
          content.geometry.textHeight,
          content.geometry.content,
          camera,
          width,
          height,
          paint,
        );
        break;
      }
    }
  }
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
  dashPatternWorld: number[] = [],
  alpha = 1,
  annotCtx?: AnnotationRenderContext,
  unifiedColor = false,
): void {
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  if (dashPatternWorld.length > 0) {
    ctx.setLineDash(
      dashPatternWorld.map((v) => Math.max(0.5, Math.abs(v) * camera.zoom)),
    );
  } else {
    ctx.setLineDash([]);
  }
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
    case 'arc': {
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      const c = worldToScreen(entity.geometry.center, camera, width, height);
      const r = Math.max(entity.geometry.radius * camera.zoom, 0.5);
      // World Y is up; canvas angles increase clockwise, so negate the CCW angles.
      ctx.arc(
        c.x,
        c.y,
        r,
        -entity.geometry.startAngle,
        -entity.geometry.endAngle,
        true,
      );
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
      strokeDimension(
        ctx,
        entity,
        doc,
        camera,
        width,
        height,
        color,
        lineWidth,
        annotCtx,
      );
      break;
    case 'text':
      strokeTextEntity(
        ctx,
        entity,
        camera,
        width,
        height,
        color,
        doc,
        annotCtx,
      );
      break;
    case 'leader':
      strokeLeader(
        ctx,
        entity,
        camera,
        width,
        height,
        color,
        lineWidth,
        doc,
        annotCtx,
      );
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
      // centerline reference
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      {
        const a = worldToScreen(entity.geometry.start, camera, width, height);
        const b = worldToScreen(entity.geometry.end, camera, width, height);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
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
    case 'block':
      strokeBlockReference(
        ctx,
        entity,
        doc,
        camera,
        width,
        height,
        color,
        lineWidth,
        unifiedColor,
      );
      break;
  }
  ctx.restore();
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
  markerPx = 10,
  showTooltip = true,
): void {
  if (!snap.snapped || !snap.kind) return;
  const p = worldToScreen(snap.point, camera, width, height);
  const s = Math.max(6, markerPx) / 10;
  ctx.save();
  ctx.strokeStyle = theme.snap;
  ctx.fillStyle = theme.snap;
  ctx.lineWidth = 1.5;

  switch (snap.kind) {
    case 'endpoint': {
      ctx.strokeRect(p.x - 6 * s, p.y - 6 * s, 12 * s, 12 * s);
      break;
    }
    case 'midpoint': {
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 7 * s);
      ctx.lineTo(p.x + 7 * s, p.y + 5 * s);
      ctx.lineTo(p.x - 7 * s, p.y + 5 * s);
      ctx.closePath();
      ctx.stroke();
      break;
    }
    case 'center': {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 7 * s, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p.x - 9 * s, p.y);
      ctx.lineTo(p.x + 9 * s, p.y);
      ctx.moveTo(p.x, p.y - 9 * s);
      ctx.lineTo(p.x, p.y + 9 * s);
      ctx.stroke();
      break;
    }
    case 'intersection': {
      ctx.beginPath();
      ctx.moveTo(p.x - 6 * s, p.y - 6 * s);
      ctx.lineTo(p.x + 6 * s, p.y + 6 * s);
      ctx.moveTo(p.x + 6 * s, p.y - 6 * s);
      ctx.lineTo(p.x - 6 * s, p.y + 6 * s);
      ctx.stroke();
      break;
    }
    case 'nearest': {
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 7 * s);
      ctx.lineTo(p.x + 6 * s, p.y);
      ctx.lineTo(p.x, p.y + 7 * s);
      ctx.lineTo(p.x - 6 * s, p.y);
      ctx.closePath();
      ctx.stroke();
      break;
    }
    case 'grid': {
      ctx.beginPath();
      ctx.moveTo(p.x - 5 * s, p.y);
      ctx.lineTo(p.x + 5 * s, p.y);
      ctx.moveTo(p.x, p.y - 5 * s);
      ctx.lineTo(p.x, p.y + 5 * s);
      ctx.stroke();
      break;
    }
  }

  if (showTooltip && snap.label) {
    ctx.font = '11px Cascadia Mono, SF Mono, Consolas, monospace';
    ctx.fillText(snap.label, p.x + 10 * s, p.y - 10 * s);
  }
  ctx.restore();
}

function drawModelEntities(
  ctx: CanvasRenderingContext2D,
  doc: DrawingDocument,
  camera: Camera,
  width: number,
  height: number,
  theme: typeof DEFAULT_THEME,
  options: {
    selected: Set<string>;
    hidden: Set<string>;
    hoveredEntityId?: string | null;
    skipGrips?: boolean;
    /** Per-viewport layer visibility overrides (undefined = Model tab). */
    layerVisibilityOverrides?: Record<string, boolean>;
    annotCtx?: AnnotationRenderContext;
  },
): Grip[] {
  const autoGrips: Grip[] = [];
  for (const entity of doc.entities) {
    if (!entity.visible) continue;
    if (options.hidden.has(entity.id)) continue;
    const layer = doc.layers.find((l) => l.id === entity.layerId);
    if (layer) {
      if (options.layerVisibilityOverrides) {
        if (!isLayerVisibleInViewport(layer, options.layerVisibilityOverrides)) {
          continue;
        }
      } else if (!layer.visible) {
        continue;
      }
    }

    const effective = resolveEffectiveAppearance(entity, doc, theme.entity);
    const isSelected = options.selected.has(entity.id);
    const isHovered =
      !!options.hoveredEntityId &&
      options.hoveredEntityId === entity.id &&
      !isSelected;
    const color = isSelected
      ? theme.selected
      : isHovered
        ? theme.hover
        : effective.colorHex;
    const lineWidth = isSelected
      ? Math.max(
          2,
          lineweightToScreenPx(
            effective.lineweightMm,
            camera.zoom,
            doc.settings.showLineweights ?? true,
            2,
          ),
        )
      : isHovered
        ? 1.75
        : lineweightToScreenPx(
            effective.lineweightMm,
            camera.zoom,
            doc.settings.showLineweights ?? true,
            1.25,
          );
    strokeEntity(
      ctx,
      entity,
      doc,
      camera,
      width,
      height,
      color,
      lineWidth,
      isSelected || isHovered ? [] : effective.linetypePattern,
      isSelected || isHovered ? 1 : effective.alpha,
      options.annotCtx ?? { space: 'model' },
      isSelected || isHovered,
    );
    if (isSelected && !options.skipGrips) {
      autoGrips.push(...getSelectionGrips([entity], doc.entities));
    }
  }
  return autoGrips;
}

/**
 * Render a layout's paper sheet and viewports (Model Space through windows).
 */
export function renderPaperSpace(
  ctx: CanvasRenderingContext2D,
  options: RenderOptions,
  layout: Layout,
): void {
  const theme = { ...DEFAULT_THEME, ...options.theme };
  const { width, height, document: doc } = options;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#12141a';
  ctx.fillRect(0, 0, width, height);

  const view = paperViewForLayout(layout, width, height);
  drawPaperSheet(ctx, view);

  // Sheet label
  ctx.save();
  ctx.fillStyle = '#8b9099';
  ctx.font = '11px "IBM Plex Sans", system-ui, sans-serif';
  ctx.fillText(layoutSheetLabel(layout), view.originX, view.originY - 8);
  ctx.restore();

  const selected = new Set(doc.selection);
  const hidden = new Set(options.hideEntityIds ?? []);

  for (const vpRaw of layout.viewports) {
    if (!vpRaw.visible) continue;
    const vp =
      options.viewportPreviewOverride?.id === vpRaw.id
        ? options.viewportPreviewOverride
        : vpRaw;
    const { camera, screenRect } = cameraForViewport(vp, view);
    if (screenRect.w < 2 || screenRect.h < 2) continue;

    ctx.save();
    ctx.beginPath();
    ctx.rect(screenRect.x, screenRect.y, screenRect.w, screenRect.h);
    ctx.clip();
    // Viewport interior background
    ctx.fillStyle = theme.background;
    ctx.fillRect(screenRect.x, screenRect.y, screenRect.w, screenRect.h);
    if (doc.settings.showGrid !== false) {
      drawGrid(
        ctx,
        camera,
        screenRect.w,
        screenRect.h,
        doc.settings.gridSize,
        theme,
      );
    }
    // Temporarily offset world→screen by translating context so worldToScreen
    // (which assumes full canvas) still works: shift origin to viewport top-left
    // by adjusting via a nested camera trick — use translated canvas + local size.
    ctx.translate(screenRect.x, screenRect.y);
    drawModelEntities(ctx, doc, camera, screenRect.w, screenRect.h, theme, {
      selected:
        options.workspaceMode === 'VIEWPORT_MODEL_SPACE' &&
        options.activeViewportId === vp.id
          ? selected
          : new Set(),
      hidden,
      hoveredEntityId:
        options.workspaceMode === 'VIEWPORT_MODEL_SPACE' &&
        options.activeViewportId === vp.id
          ? options.hoveredEntityId
          : null,
      skipGrips: true,
      layerVisibilityOverrides: vp.layerVisibilityOverrides ?? {},
      annotCtx: {
        space: 'viewport',
        pxPerMm: view.pxPerMm,
        viewportScale: vp.scale,
      },
    });
    ctx.restore();

    drawViewportFrame(
      ctx,
      screenRect,
      options.selectedViewportId === vp.id,
      options.workspaceMode === 'VIEWPORT_MODEL_SPACE' &&
        options.activeViewportId === vp.id,
      vp.locked,
    );
  }

  if (options.paperPreviewRect) {
    drawPaperPreviewRect(
      ctx,
      view,
      options.paperPreviewRect.a,
      options.paperPreviewRect.b,
    );
  }

  // Paper-space annotations / title block (never Model entities)
  drawPaperSpaceEntities(ctx, doc, layout, view, {
    selectedIds: new Set(options.selectedPaperEntityIds ?? []),
    hoveredId: options.hoveredEntityId ?? null,
  });

  paintDraftingCursor(ctx, options);
}

function paintDraftingCursor(
  ctx: CanvasRenderingContext2D,
  options: RenderOptions,
): void {
  if (options.showDraftingCursor === false) return;
  const screen = options.cursorScreen;
  if (!screen) return;
  drawDraftingCursor(ctx, {
    cursorScreen: screen,
    canvasWidth: options.width,
    canvasHeight: options.height,
    crosshairSize: options.crosshairSize,
    pickboxSize: options.pickboxSize,
    showCrosshair: options.showCrosshair !== false,
    showPickbox: options.showPickbox === true,
    color: options.crosshairColor,
    pickboxColor: options.crosshairColor,
  });
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

  if (
    options.paperSpaceLayout &&
    (options.workspaceMode === 'PAPER_SPACE' ||
      options.workspaceMode === 'VIEWPORT_MODEL_SPACE')
  ) {
    renderPaperSpace(ctx, options, options.paperSpaceLayout);
    return;
  }

  const hidden = new Set(options.hideEntityIds ?? []);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, width, height);

  if (doc.settings.showGrid !== false) {
    drawGrid(ctx, camera, width, height, doc.settings.gridSize, theme);
  }

  const selected = new Set(doc.selection);
  const autoGrips = drawModelEntities(ctx, doc, camera, width, height, theme, {
    selected,
    hidden,
    hoveredEntityId: options.hoveredEntityId,
    skipGrips: !!options.previewEntities?.length,
  });

  if (options.previewEntities?.length) {
    ctx.save();
    ctx.setLineDash([5, 4]);
    for (const entity of options.previewEntities) {
      const explicit = entity.properties.color;
      const paint = typeof explicit === 'string' ? explicit : theme.preview;
      strokeEntity(
        ctx,
        entity,
        doc,
        camera,
        width,
        height,
        paint,
        1.5,
        [],
        1,
        undefined,
        true,
      );
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
    drawSnapIndicator(
      ctx,
      options.snap,
      camera,
      width,
      height,
      theme,
      options.snapMarkerPx,
      options.showSnapTooltip !== false,
    );
  }

  paintDraftingCursor(ctx, options);
}
