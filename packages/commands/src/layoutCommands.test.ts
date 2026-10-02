import { beforeEach, describe, expect, it } from 'vitest';
import {
  CommandBus,
  CreateViewportCommand,
  MoveViewportCommand,
  ResizeViewportCommand,
  SetViewportLockedCommand,
  SetViewportScaleCommand,
  UpdateViewportViewCommand,
} from '../src/index.js';
import {
  createEmptyDocument,
  createViewportFromRect,
  formatViewportScale,
  getActiveLayout,
  normalizeViewportRect,
  ratioFromScale,
  resetIdCounter,
  scaleFromRatio,
  setActiveLayout,
} from '@ratecad/core';

describe('layout viewport commands', () => {
  beforeEach(() => resetIdCounter());

  function layoutBus() {
    const bus = new CommandBus(createEmptyDocument());
    const doc = bus.getDocument();
    const layoutId = doc.layouts[0]!.id;
    bus.updateWithoutHistory((d) => setActiveLayout(d, layoutId));
    return { bus, layoutId };
  }

  it('creates a viewport via CreateViewportCommand with undo/redo', () => {
    const { bus, layoutId } = layoutBus();
    const beforeCount = getActiveLayout(bus.getDocument())!.viewports.length;
    const vp = createViewportFromRect({ x: 20, y: 20, width: 80, height: 60 });
    bus.execute(new CreateViewportCommand(layoutId, vp));
    expect(getActiveLayout(bus.getDocument())!.viewports.length).toBe(
      beforeCount + 1,
    );
    bus.undo();
    expect(getActiveLayout(bus.getDocument())!.viewports.length).toBe(
      beforeCount,
    );
    bus.redo();
    expect(getActiveLayout(bus.getDocument())!.viewports.length).toBe(
      beforeCount + 1,
    );
  });

  it('moves a viewport with undo', () => {
    const { bus, layoutId } = layoutBus();
    const vp = getActiveLayout(bus.getDocument())!.viewports[0]!;
    const ox = vp.x;
    bus.execute(new MoveViewportCommand(layoutId, vp, { x: 12, y: -5 }));
    const moved = getActiveLayout(bus.getDocument())!.viewports[0]!;
    expect(moved.x).toBeCloseTo(ox + 12);
    expect(moved.y).toBeCloseTo(vp.y - 5);
    bus.undo();
    expect(getActiveLayout(bus.getDocument())!.viewports[0]!.x).toBeCloseTo(ox);
  });

  it('resizes a viewport with minimum size and undo', () => {
    const { bus, layoutId } = layoutBus();
    const vp = getActiveLayout(bus.getDocument())!.viewports[0]!;
    bus.execute(
      new ResizeViewportCommand(layoutId, vp, {
        x: vp.x,
        y: vp.y,
        width: 5,
        height: 5,
      }),
    );
    const after = getActiveLayout(bus.getDocument())!.viewports[0]!;
    expect(after.width).toBeGreaterThanOrEqual(10);
    expect(after.height).toBeGreaterThanOrEqual(10);
    bus.undo();
    expect(getActiveLayout(bus.getDocument())!.viewports[0]!.width).toBe(
      vp.width,
    );
  });

  it('sets standard and custom scales without changing model entities', () => {
    const { bus, layoutId } = layoutBus();
    const doc0 = bus.getDocument();
    const entityCount = doc0.entities.length;
    const vp = getActiveLayout(doc0)!.viewports[0]!;
    bus.execute(
      new SetViewportScaleCommand(layoutId, vp, scaleFromRatio(100)),
    );
    const vp100 = getActiveLayout(bus.getDocument())!.viewports[0]!;
    expect(formatViewportScale(vp100.scale)).toBe('1:100');
    expect(bus.getDocument().entities.length).toBe(entityCount);

    bus.execute(
      new SetViewportScaleCommand(layoutId, vp100, scaleFromRatio(87)),
    );
    const custom = getActiveLayout(bus.getDocument())!.viewports[0]!;
    expect(formatViewportScale(custom.scale)).toContain('Custom');
    expect(Math.round(ratioFromScale(custom.scale))).toBe(87);
  });

  it('locks and unlocks a viewport', () => {
    const { bus, layoutId } = layoutBus();
    const vp = getActiveLayout(bus.getDocument())!.viewports[0]!;
    bus.execute(new SetViewportLockedCommand(layoutId, vp, true));
    expect(getActiveLayout(bus.getDocument())!.viewports[0]!.locked).toBe(true);
    const locked = getActiveLayout(bus.getDocument())!.viewports[0]!;
    bus.execute(new SetViewportLockedCommand(layoutId, locked, false));
    expect(getActiveLayout(bus.getDocument())!.viewports[0]!.locked).toBe(
      false,
    );
    bus.undo();
    expect(getActiveLayout(bus.getDocument())!.viewports[0]!.locked).toBe(true);
  });

  it('keeps independent viewport cameras', () => {
    const { bus, layoutId } = layoutBus();
    const vp2 = createViewportFromRect(
      { x: 40, y: 40, width: 70, height: 50 },
      { modelCenterX: 10, modelCenterY: 20, scale: scaleFromRatio(50) },
    );
    bus.execute(new CreateViewportCommand(layoutId, vp2));
    const layout = getActiveLayout(bus.getDocument())!;
    const a = layout.viewports[0]!;
    const b = layout.viewports[1]!;
    bus.execute(
      new UpdateViewportViewCommand(layoutId, a, {
        modelCenterX: 100,
        modelCenterY: 200,
        scale: scaleFromRatio(25),
      }),
    );
    const next = getActiveLayout(bus.getDocument())!;
    expect(next.viewports[0]!.modelCenterX).toBe(100);
    expect(next.viewports[1]!.modelCenterX).toBe(b.modelCenterX);
    expect(next.viewports[1]!.scale).toBe(b.scale);
  });

  it('normalizeViewportRect enforces minimum size', () => {
    const r = normalizeViewportRect({ x: 0, y: 0 }, { x: 1, y: 1 });
    expect(r.width).toBeGreaterThanOrEqual(10);
    expect(r.height).toBeGreaterThanOrEqual(10);
  });
});
