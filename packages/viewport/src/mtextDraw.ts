import type { TextEntity } from '@ratecad/core';
import {
  isMText,
  layoutMText,
  type MTextRun,
  type ResolvedMTextSpan,
} from '@ratecad/geometry';
import { worldToScreen, type Camera } from './camera.js';

export function mtextFontCss(
  span: Pick<ResolvedMTextSpan, 'bold' | 'italic' | 'fontFamily'>,
  px: number,
): string {
  const style = span.italic ? 'italic' : 'normal';
  const weight = span.bold ? 'bold' : 'normal';
  const family = /[\s"]/.test(span.fontFamily) ? `"${span.fontFamily}"` : span.fontFamily;
  return `${style} ${weight} ${Math.max(px, 0.5)}px ${family}, sans-serif`;
}

/** True when the browser has a real face for this style. Missing faces are still synthesized. */
export function mtextFaceAvailable(
  span: Pick<ResolvedMTextSpan, 'bold' | 'italic' | 'fontFamily'>,
): boolean {
  if (typeof document === 'undefined' || !document.fonts?.check) return true;
  try {
    return document.fonts.check(mtextFontCss(span, 16));
  } catch {
    return true;
  }
}

function drawnHeight(span: ResolvedMTextSpan): number {
  return span.baseline === 'normal' ? span.height : span.height * 0.6;
}

/** World-unit width of a run, using the same canvas font the editor and the drawing share. */
export function measureMTextText(
  ctx: CanvasRenderingContext2D,
  text: string,
  span: ResolvedMTextSpan,
  zoom: number,
): number {
  if (!text || !(zoom > 0)) return 0;
  ctx.save();
  ctx.font = mtextFontCss(span, drawnHeight(span) * zoom);
  let width = 0;
  for (let index = 0; index < text.length; index += 1) {
    width += ctx.measureText(text[index]!).width * span.widthFactor;
    if (index < text.length - 1) width += span.tracking * zoom;
  }
  ctx.restore();
  return width / zoom;
}

function screenAngle(
  ctx: CanvasRenderingContext2D,
  run: MTextRun,
  rotation: number,
  camera: Camera,
  width: number,
  height: number,
): number {
  void ctx;
  const origin = worldToScreen({ x: run.x, y: run.y }, camera, width, height);
  const tip = worldToScreen(
    {
      x: run.x + Math.cos(rotation),
      y: run.y + Math.sin(rotation),
    },
    camera,
    width,
    height,
  );
  return Math.atan2(tip.y - origin.y, tip.x - origin.x);
}

export function strokeMTextEntity(
  ctx: CanvasRenderingContext2D,
  entity: TextEntity,
  camera: Camera,
  width: number,
  height: number,
  fallbackColor: string,
  highlight = false,
): void {
  if (!isMText(entity)) return;
  const layout = layoutMText(entity.geometry, fallbackColor, (text, span) =>
    measureMTextText(ctx, text, span, camera.zoom),
  );
  if (!layout) return;
  for (const run of layout.runs) {
    const origin = worldToScreen({ x: run.x, y: run.y }, camera, width, height);
    const angle = screenAngle(ctx, run, entity.geometry.rotation, camera, width, height);
    const px = drawnHeight(run.span) * camera.zoom;
    const shift = run.span.baseline === 'super' ? -px * 0.45 : run.span.baseline === 'sub' ? px * 0.2 : 0;
    const paint = run.span.color || fallbackColor;
    ctx.save();
    ctx.translate(origin.x, origin.y);
    ctx.rotate(angle);
    ctx.font = mtextFontCss(run.span, px);
    ctx.fillStyle = paint;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    let cursor = 0;
    let drawn = 0;
    for (const character of run.text) {
      ctx.save();
      ctx.translate(cursor, shift);
      ctx.scale(run.span.widthFactor, 1);
      ctx.fillText(character, 0, 0);
      ctx.restore();
      const advance = ctx.measureText(character).width * run.span.widthFactor;
      cursor += advance + run.charGap * camera.zoom;
      drawn += advance;
    }
    drawn += run.charGap * camera.zoom * Math.max(0, run.text.length - 1);
    ctx.strokeStyle = paint;
    ctx.lineWidth = Math.max(1, px * 0.06);
    ctx.beginPath();
    if (run.span.underline) {
      const y = shift + px * 0.15;
      ctx.moveTo(0, y);
      ctx.lineTo(drawn, y);
    }
    if (run.span.strikethrough) {
      const y = shift - px * 0.3;
      ctx.moveTo(0, y);
      ctx.lineTo(drawn, y);
    }
    if (run.span.overline) {
      const y = shift - px * 0.9;
      ctx.moveTo(0, y);
      ctx.lineTo(drawn, y);
    }
    ctx.stroke();
    ctx.restore();
  }
  if (highlight) {
    ctx.save();
    ctx.strokeStyle = fallbackColor;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    layout.corners.forEach((corner, index) => {
      const screen = worldToScreen(corner, camera, width, height);
      if (index === 0) ctx.moveTo(screen.x, screen.y);
      else ctx.lineTo(screen.x, screen.y);
    });
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
}
