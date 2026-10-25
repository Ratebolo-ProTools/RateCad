/**
 * Phase P2 — professional drafting cursor (crosshair + pickbox).
 * Pure overlay math/draw helpers — never creates drawing geometry.
 */

import type { Vec2 } from '@ratecad/core';
import type { Camera } from './camera.js';
import { screenToleranceToWorld } from './camera.js';

export type CrosshairSize = 'small' | 'medium' | 'large' | 'fullscreen';
export type PickboxSize = 'small' | 'medium' | 'large';

/** Context-sensitive drafting cursor mode (CSS + overlay). */
export type DraftingCursorMode =
  | 'select'
  | 'draw'
  | 'modify'
  | 'pan'
  | 'zoom-window'
  | 'text'
  | 'ui'
  | 'hidden';

export const DEFAULT_CROSSHAIR_SIZE: CrosshairSize = 'medium';
export const DEFAULT_PICKBOX_SIZE: PickboxSize = 'medium';

/** Half-length of crosshair arms in CSS pixels (non-fullscreen). */
export const CROSSHAIR_ARM_PX: Record<Exclude<CrosshairSize, 'fullscreen'>, number> =
  {
    small: 40,
    medium: 80,
    large: 160,
  };

/**
 * Pickbox half-size in CSS pixels (square aperture around cursor).
 * Medium = 8 matches the historical selection / hover aperture.
 */
export const PICKBOX_HALF_PX: Record<PickboxSize, number> = {
  small: 4,
  medium: 8,
  large: 12,
};

export function pickboxHalfPx(size: PickboxSize = DEFAULT_PICKBOX_SIZE): number {
  return PICKBOX_HALF_PX[size] ?? PICKBOX_HALF_PX.medium;
}

export function pickboxToleranceWorld(
  camera: Camera,
  size: PickboxSize = DEFAULT_PICKBOX_SIZE,
): number {
  return screenToleranceToWorld(camera, pickboxHalfPx(size));
}

export function crosshairArmLengthPx(
  size: CrosshairSize,
  canvasWidth: number,
  canvasHeight: number,
): number {
  if (size === 'fullscreen') {
    return Math.max(canvasWidth, canvasHeight);
  }
  return CROSSHAIR_ARM_PX[size] ?? CROSSHAIR_ARM_PX.medium;
}

const DRAW_TOOLS = new Set([
  'line',
  'polyline',
  'rectangle',
  'circle',
  'arc',
  'dimension',
  'text',
  'leader',
  'wall',
  'door',
  'window',
  'room',
  'area',
]);

const MODIFY_TOOLS = new Set([
  'move',
  'copy',
  'rotate',
  'scale',
  'mirror',
  'trim',
  'extend',
  'offset',
  'fillet',
  'erase',
  'matchprop',
  'chprop',
]);

export type ResolveDraftingCursorInput = {
  /** Active tool id (ToolSession.activeTool). */
  activeTool: string;
  /** Tool session mode (idle / window / grip / text-input / …). */
  sessionMode?: string | null;
  /** True while Space is held for temporary pan. */
  spacePan?: boolean;
  /** True while middle-button / drag pan is active. */
  isPanning?: boolean;
  /** True when pointer is over the drawing canvas. */
  pointerOverCanvas?: boolean;
  /** Engine command name when a command is running (e.g. ZOOM). */
  engineCommandName?: string | null;
  /** Live engine prompt text (used to detect Zoom Window corners). */
  enginePrompt?: string | null;
  /** True when text annotation dialog is open. */
  textDialogOpen?: boolean;
};

/**
 * Resolve drafting cursor mode from active tool / navigation / UI state.
 * Does not invent a second command state — mirrors existing tool + engine.
 */
export function resolveDraftingCursorMode(
  input: ResolveDraftingCursorInput,
): DraftingCursorMode {
  if (input.pointerOverCanvas === false) return 'hidden';
  if (input.textDialogOpen || input.sessionMode === 'text-input') return 'text';
  if (input.isPanning || input.spacePan || input.activeTool === 'pan') {
    return 'pan';
  }
  const cmd = (input.engineCommandName ?? '').toUpperCase();
  const prompt = (input.enginePrompt ?? '').toLowerCase();
  if (
    cmd === 'ZOOM' &&
    (prompt.includes('corner') ||
      prompt.includes('window') ||
      prompt.includes('other corner'))
  ) {
    return 'zoom-window';
  }
  if (input.activeTool === 'select') return 'select';
  if (DRAW_TOOLS.has(input.activeTool)) return 'draw';
  if (MODIFY_TOOLS.has(input.activeTool)) return 'modify';
  return 'select';
}

export function shouldDrawCrosshair(mode: DraftingCursorMode): boolean {
  return (
    mode === 'select' ||
    mode === 'draw' ||
    mode === 'modify' ||
    mode === 'zoom-window'
  );
}

export function shouldDrawPickbox(mode: DraftingCursorMode): boolean {
  return mode === 'select';
}

/** CSS cursor keyword for the canvas element. */
export function draftingCssCursor(mode: DraftingCursorMode): string {
  switch (mode) {
    case 'pan':
      return 'grab';
    case 'text':
      return 'text';
    case 'ui':
      return 'default';
    case 'hidden':
      return 'default';
    case 'select':
    case 'draw':
    case 'modify':
    case 'zoom-window':
      return 'none';
    default:
      return 'crosshair';
  }
}

export type DraftingCursorDrawOptions = {
  cursorScreen: Vec2;
  canvasWidth: number;
  canvasHeight: number;
  crosshairSize?: CrosshairSize;
  pickboxSize?: PickboxSize;
  showCrosshair?: boolean;
  showPickbox?: boolean;
  color?: string;
  pickboxColor?: string;
};

/**
 * Draw crosshair + optional pickbox in screen pixels.
 * Uses CSS-pixel coordinates (caller must have set DPR transform).
 * pointer-events are canvas-owned — this is paint-only.
 */
export function drawDraftingCursor(
  ctx: CanvasRenderingContext2D,
  options: DraftingCursorDrawOptions,
): void {
  const {
    cursorScreen,
    canvasWidth,
    canvasHeight,
    crosshairSize = DEFAULT_CROSSHAIR_SIZE,
    pickboxSize = DEFAULT_PICKBOX_SIZE,
    showCrosshair = true,
    showPickbox = false,
    color = 'rgba(220, 230, 240, 0.85)',
    pickboxColor = 'rgba(220, 230, 240, 0.95)',
  } = options;

  const x = cursorScreen.x;
  const y = cursorScreen.y;
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x < -2 ||
    y < -2 ||
    x > canvasWidth + 2 ||
    y > canvasHeight + 2
  ) {
    return;
  }

  ctx.save();
  ctx.setLineDash([]);
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';

  if (showCrosshair) {
    const arm = crosshairArmLengthPx(crosshairSize, canvasWidth, canvasHeight);
    const x0 = crosshairSize === 'fullscreen' ? 0 : Math.max(0, x - arm);
    const x1 =
      crosshairSize === 'fullscreen'
        ? canvasWidth
        : Math.min(canvasWidth, x + arm);
    const y0 = crosshairSize === 'fullscreen' ? 0 : Math.max(0, y - arm);
    const y1 =
      crosshairSize === 'fullscreen'
        ? canvasHeight
        : Math.min(canvasHeight, y + arm);

    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0, y + 0.5);
    ctx.lineTo(x1, y + 0.5);
    ctx.moveTo(x + 0.5, y0);
    ctx.lineTo(x + 0.5, y1);
    ctx.stroke();
  }

  if (showPickbox) {
    const half = pickboxHalfPx(pickboxSize);
    ctx.strokeStyle = pickboxColor;
    ctx.lineWidth = 1;
    ctx.strokeRect(x - half + 0.5, y - half + 0.5, half * 2 - 1, half * 2 - 1);
  }

  ctx.restore();
}

/** Clamp / validate preference strings. */
export function normalizeCrosshairSize(raw: unknown): CrosshairSize {
  if (raw === 'small' || raw === 'medium' || raw === 'large' || raw === 'fullscreen') {
    return raw;
  }
  return DEFAULT_CROSSHAIR_SIZE;
}

export function normalizePickboxSize(raw: unknown): PickboxSize {
  if (raw === 'small' || raw === 'medium' || raw === 'large') return raw;
  return DEFAULT_PICKBOX_SIZE;
}
