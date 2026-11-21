import { describe, expect, it } from 'vitest';
import { createCamera } from './camera.js';
import {
  CROSSHAIR_ARM_PX,
  DEFAULT_CROSSHAIR_SIZE,
  DEFAULT_PICKBOX_SIZE,
  PICKBOX_HALF_PX,
  crosshairArmLengthPx,
  draftingCssCursor,
  drawDraftingCursor,
  normalizeCrosshairSize,
  normalizePickboxSize,
  pickboxHalfPx,
  pickboxToleranceWorld,
  resolveDraftingCursorMode,
  shouldDrawCrosshair,
  shouldDrawPickbox,
} from './draftingCursor.js';

describe('drafting cursor preferences', () => {
  it('defaults to a full-viewport crosshair and medium pickbox', () => {
    expect(DEFAULT_CROSSHAIR_SIZE).toBe('fullscreen');
    expect(DEFAULT_PICKBOX_SIZE).toBe('medium');
    expect(normalizeCrosshairSize('nope')).toBe('fullscreen');
    expect(normalizePickboxSize(null)).toBe('medium');
  });

  it('maps crosshair sizes to arm lengths and fullscreen spans canvas', () => {
    expect(crosshairArmLengthPx('small', 800, 600)).toBe(CROSSHAIR_ARM_PX.small);
    expect(crosshairArmLengthPx('medium', 800, 600)).toBe(CROSSHAIR_ARM_PX.medium);
    expect(crosshairArmLengthPx('large', 800, 600)).toBe(CROSSHAIR_ARM_PX.large);
    expect(crosshairArmLengthPx('fullscreen', 800, 600)).toBe(800);
  });

  it('maps pickbox sizes to screen-pixel half-sizes', () => {
    expect(pickboxHalfPx('small')).toBe(PICKBOX_HALF_PX.small);
    expect(pickboxHalfPx('medium')).toBe(PICKBOX_HALF_PX.medium);
    expect(pickboxHalfPx('large')).toBe(PICKBOX_HALF_PX.large);
  });

  it('converts pickbox aperture to world tolerance that scales with zoom', () => {
    const cam40 = createCamera({ zoom: 40 });
    const cam80 = createCamera({ zoom: 80 });
    const tol40 = pickboxToleranceWorld(cam40, 'medium');
    const tol80 = pickboxToleranceWorld(cam80, 'medium');
    expect(tol40).toBeCloseTo(8 / 40, 6);
    expect(tol80).toBeCloseTo(8 / 80, 6);
    expect(tol80).toBeCloseTo(tol40 / 2, 6);
    expect(pickboxToleranceWorld(cam40, 'small')).toBeLessThan(tol40);
    expect(pickboxToleranceWorld(cam40, 'large')).toBeGreaterThan(tol40);
  });
});

describe('drafting cursor mode', () => {
  it('shows select crosshair + pickbox in Selection Mode', () => {
    const mode = resolveDraftingCursorMode({
      activeTool: 'select',
      pointerOverCanvas: true,
    });
    expect(mode).toBe('select');
    expect(shouldDrawCrosshair(mode)).toBe(true);
    expect(shouldDrawPickbox(mode)).toBe(true);
    expect(draftingCssCursor(mode)).toBe('none');
  });

  it('hides cursor overlay when pointer leaves canvas', () => {
    const mode = resolveDraftingCursorMode({
      activeTool: 'select',
      pointerOverCanvas: false,
    });
    expect(mode).toBe('hidden');
    expect(shouldDrawCrosshair(mode)).toBe(false);
    expect(shouldDrawPickbox(mode)).toBe(false);
  });

  it('uses pan/hand cursor for PAN and Space pan', () => {
    expect(
      resolveDraftingCursorMode({
        activeTool: 'pan',
        pointerOverCanvas: true,
      }),
    ).toBe('pan');
    expect(
      resolveDraftingCursorMode({
        activeTool: 'select',
        spacePan: true,
        pointerOverCanvas: true,
      }),
    ).toBe('pan');
    expect(draftingCssCursor('pan')).toBe('grab');
    expect(shouldDrawCrosshair('pan')).toBe(false);
  });

  it('uses zoom-window mode while ZOOM Window prompts for corners', () => {
    const mode = resolveDraftingCursorMode({
      activeTool: 'select',
      engineCommandName: 'ZOOM',
      enginePrompt: 'Specify opposite corner:',
      pointerOverCanvas: true,
    });
    expect(mode).toBe('zoom-window');
    expect(shouldDrawCrosshair(mode)).toBe(true);
    expect(shouldDrawPickbox(mode)).toBe(false);
  });

  it('uses draw mode for LINE / RECTANGLE / CIRCLE and modify for MOVE', () => {
    expect(
      resolveDraftingCursorMode({
        activeTool: 'line',
        pointerOverCanvas: true,
      }),
    ).toBe('draw');
    expect(
      resolveDraftingCursorMode({
        activeTool: 'rectangle',
        pointerOverCanvas: true,
      }),
    ).toBe('draw');
    expect(
      resolveDraftingCursorMode({
        activeTool: 'circle',
        pointerOverCanvas: true,
      }),
    ).toBe('draw');
    expect(
      resolveDraftingCursorMode({
        activeTool: 'move',
        pointerOverCanvas: true,
      }),
    ).toBe('modify');
    expect(shouldDrawPickbox('draw')).toBe(false);
  });

  it('uses a pickbox while selecting an OFFSET source and a crosshair for the side', () => {
    const picking = resolveDraftingCursorMode({
      activeTool: 'offset',
      pointerOverCanvas: true,
    });
    expect(picking).toBe('pick');
    expect(shouldDrawPickbox(picking)).toBe(true);
    expect(shouldDrawCrosshair(picking)).toBe(false);
    const side = resolveDraftingCursorMode({
      activeTool: 'offset',
      hasReferenceEntity: true,
      pointerOverCanvas: true,
    });
    expect(side).toBe('draw');
    expect(shouldDrawCrosshair(side)).toBe(true);
    expect(shouldDrawPickbox(side)).toBe(false);
  });

  it('uses a pickbox for TRIM and a crosshair while editing a grip', () => {
    const trim = resolveDraftingCursorMode({
      activeTool: 'trim',
      pointerOverCanvas: true,
    });
    expect(trim).toBe('pick');
    expect(shouldDrawPickbox(trim)).toBe(true);
    const grip = resolveDraftingCursorMode({
      activeTool: 'select',
      sessionMode: 'grip',
      pointerOverCanvas: true,
    });
    expect(grip).toBe('grip');
    expect(shouldDrawCrosshair(grip)).toBe(true);
    expect(draftingCssCursor(grip)).toBe('none');
  });

  it('keeps the text cursor when a dialog is open during LINE', () => {
    expect(
      resolveDraftingCursorMode({
        activeTool: 'line',
        textDialogOpen: true,
        pointerOverCanvas: true,
      }),
    ).toBe('text');
  });

  it('uses text cursor while annotation dialog is open', () => {
    expect(
      resolveDraftingCursorMode({
        activeTool: 'text',
        textDialogOpen: true,
        pointerOverCanvas: true,
      }),
    ).toBe('text');
    expect(draftingCssCursor('text')).toBe('text');
  });
});

describe('drawDraftingCursor', () => {
  it('draws crosshair lines through the cursor screen position', () => {
    const ops: string[] = [];
    const ctx = {
      save: () => ops.push('save'),
      restore: () => ops.push('restore'),
      setLineDash: () => undefined,
      beginPath: () => ops.push('begin'),
      moveTo: (x: number, y: number) => ops.push(`m:${x.toFixed(1)},${y.toFixed(1)}`),
      lineTo: (x: number, y: number) => ops.push(`l:${x.toFixed(1)},${y.toFixed(1)}`),
      stroke: () => ops.push('stroke'),
      strokeRect: (x: number, y: number, w: number, h: number) =>
        ops.push(`rect:${x.toFixed(1)},${y.toFixed(1)},${w},${h}`),
      strokeStyle: '',
      lineWidth: 0,
      lineCap: 'butt',
      lineJoin: 'miter',
    } as unknown as CanvasRenderingContext2D;

    drawDraftingCursor(ctx, {
      cursorScreen: { x: 100, y: 50 },
      canvasWidth: 400,
      canvasHeight: 300,
      crosshairSize: 'medium',
      pickboxSize: 'medium',
      showCrosshair: true,
      showPickbox: true,
    });

    expect(ops).toContain('save');
    expect(ops).toContain('restore');
    expect(ops.some((o) => o.startsWith('m:'))).toBe(true);
    expect(ops.some((o) => o.startsWith('l:'))).toBe(true);
    expect(ops.some((o) => o.startsWith('rect:'))).toBe(true);
    // Horizontal arm through y=50.5 (pixel-aligned), vertical through x=100.5
    expect(ops).toContain('m:20.0,50.5');
    expect(ops).toContain('l:180.0,50.5');
    expect(ops).toContain('m:100.5,0.0');
    expect(ops).toContain('l:100.5,130.0');
    expect(ops).toContain('rect:92.5,42.5,15,15');
  });

  it('spans the viewport in CSS pixels for a fullscreen crosshair', () => {
    const ops: string[] = [];
    const ctx = {
      save: () => undefined,
      restore: () => undefined,
      setLineDash: () => undefined,
      beginPath: () => undefined,
      moveTo: (x: number, y: number) => ops.push(`m:${x},${y}`),
      lineTo: (x: number, y: number) => ops.push(`l:${x},${y}`),
      stroke: () => undefined,
      strokeRect: () => undefined,
      strokeStyle: '',
      lineWidth: 0,
      lineCap: 'butt',
      lineJoin: 'miter',
    } as unknown as CanvasRenderingContext2D;
    drawDraftingCursor(ctx, {
      cursorScreen: { x: 120, y: 80 },
      canvasWidth: 800,
      canvasHeight: 600,
      crosshairSize: 'fullscreen',
      showCrosshair: true,
      showPickbox: false,
    });
    expect(ops).toContain('m:0,80.5');
    expect(ops).toContain('l:800,80.5');
    expect(ops).toContain('m:120.5,0');
    expect(ops).toContain('l:120.5,600');
  });

  it('skips drawing when cursor is far outside the canvas', () => {
    let stroked = false;
    const ctx = {
      save: () => undefined,
      restore: () => undefined,
      setLineDash: () => undefined,
      beginPath: () => undefined,
      moveTo: () => undefined,
      lineTo: () => undefined,
      stroke: () => {
        stroked = true;
      },
      strokeRect: () => {
        stroked = true;
      },
      strokeStyle: '',
      lineWidth: 0,
      lineCap: 'butt',
      lineJoin: 'miter',
    } as unknown as CanvasRenderingContext2D;

    drawDraftingCursor(ctx, {
      cursorScreen: { x: -100, y: -100 },
      canvasWidth: 400,
      canvasHeight: 300,
      showCrosshair: true,
      showPickbox: true,
    });
    expect(stroked).toBe(false);
  });
});
