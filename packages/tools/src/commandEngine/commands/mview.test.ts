import { beforeEach, describe, expect, it } from 'vitest';
import { CommandBus, CreateViewportCommand } from '@ratecad/commands';
import {
  createEmptyDocument,
  createViewportFromRect,
  getActiveLayout,
  resetIdCounter,
  setActiveLayout,
} from '@ratecad/core';
import { CadCommandEngine } from '../engine.js';
import { createDefaultEngineRegistry } from '../index.js';
import { mviewCommand } from './mview.js';

describe('MVIEW command', () => {
  beforeEach(() => resetIdCounter());

  it('is registered as MVIEW / MV', () => {
    const reg = createDefaultEngineRegistry();
    expect(reg.resolve('MVIEW').ok).toBe(true);
    expect(reg.resolve('MV').ok).toBe(true);
    const r = reg.resolve('MVIEW');
    if (!r.ok) return;
    expect(r.command.id).toBe('mview');
  });

  it('creates a viewport through CommandBus; preview path does not mutate', () => {
    const bus = new CommandBus(createEmptyDocument());
    const layoutId = bus.getDocument().layouts[0]!.id;
    bus.updateWithoutHistory((d) => setActiveLayout(d, layoutId));
    const before = structuredClone(bus.getDocument());
    const countBefore = getActiveLayout(before)!.viewports.length;

    const state: Record<string, unknown> = { bus, layoutId, corner1: null };
    const start = mviewCommand.start({
      units: 'ft',
      worldUnit: 'ft',
      lastPoint: null,
      cursor: null,
      angleOverrideDeg: null,
      selectedIds: [],
    });
    Object.assign(state, start.state ?? {});

    // Preview move — must not mutate document
    mviewCommand.onPoint?.(
      { x: 30, y: 30 },
      start.prompt,
      {
        units: 'ft',
        worldUnit: 'ft',
        lastPoint: null,
        cursor: null,
        angleOverrideDeg: null,
        selectedIds: [],
      },
      state,
    );
    const move = mviewCommand.onMove?.(
      { x: 120, y: 100 },
      { id: 'opposite', message: '', inputType: 'point' },
      {
        units: 'ft',
        worldUnit: 'ft',
        lastPoint: null,
        cursor: null,
        angleOverrideDeg: null,
        selectedIds: [],
      },
      state,
    );
    expect(move?.preview?.kind).toBe('rectangle');
    expect(getActiveLayout(bus.getDocument())!.viewports.length).toBe(
      countBefore,
    );

    const done = mviewCommand.onPoint?.(
      { x: 120, y: 100 },
      { id: 'opposite', message: '', inputType: 'point' },
      {
        units: 'ft',
        worldUnit: 'ft',
        lastPoint: null,
        cursor: null,
        angleOverrideDeg: null,
        selectedIds: [],
      },
      state,
    );
    expect(done?.kind).toBe('complete');
    expect(getActiveLayout(bus.getDocument())!.viewports.length).toBe(
      countBefore + 1,
    );

    bus.undo();
    expect(getActiveLayout(bus.getDocument())!.viewports.length).toBe(
      countBefore,
    );
  });

  it('Escape cancel via onCancel clears corner without creating viewport', () => {
    const bus = new CommandBus(createEmptyDocument());
    const layoutId = bus.getDocument().layouts[0]!.id;
    bus.updateWithoutHistory((d) => setActiveLayout(d, layoutId));
    const count = getActiveLayout(bus.getDocument())!.viewports.length;
    const state: Record<string, unknown> = {
      bus,
      layoutId,
      corner1: { x: 10, y: 10 },
    };
    mviewCommand.onCancel?.(state);
    expect((state as { corner1: unknown }).corner1).toBeNull();
    expect(getActiveLayout(bus.getDocument())!.viewports.length).toBe(count);
  });

  it('rejects when no active layout', () => {
    const bus = new CommandBus(createEmptyDocument());
    // activeLayoutId is null in Model Space
    const boot = mviewCommand.bootstrap?.(bus);
    expect(boot?.status?.toLowerCase()).toContain('layout');
  });

  it('engine cancel does not leave a half-created viewport', () => {
    const bus = new CommandBus(createEmptyDocument());
    const layoutId = bus.getDocument().layouts[0]!.id;
    bus.updateWithoutHistory((d) => setActiveLayout(d, layoutId));
    const host = {
      getUnits: () => 'ft' as const,
      getWorldUnit: () => 'ft' as const,
      getSelectedIds: () => [] as string[],
      getCursor: () => null,
      activateTool: () => {},
      activateSelect: () => {},
    };
    const eng = new CadCommandEngine(
      createDefaultEngineRegistry(),
      bus,
      host,
    );
    eng.start('MVIEW');
    eng.submitPoint({ x: 20, y: 20 });
    const mid = getActiveLayout(bus.getDocument())!.viewports.length;
    eng.cancel(true);
    expect(getActiveLayout(bus.getDocument())!.viewports.length).toBe(mid);
  });

  it('does not duplicate model entities when adding viewports', () => {
    const bus = new CommandBus(createEmptyDocument());
    const layoutId = bus.getDocument().layouts[0]!.id;
    bus.updateWithoutHistory((d) => setActiveLayout(d, layoutId));
    const ents = bus.getDocument().entities.length;
    bus.execute(
      new CreateViewportCommand(
        layoutId,
        createViewportFromRect({ x: 10, y: 10, width: 40, height: 30 }),
      ),
    );
    bus.execute(
      new CreateViewportCommand(
        layoutId,
        createViewportFromRect({ x: 60, y: 10, width: 40, height: 30 }),
      ),
    );
    expect(bus.getDocument().entities.length).toBe(ents);
    expect(getActiveLayout(bus.getDocument())!.viewports.length).toBe(3);
  });
});
