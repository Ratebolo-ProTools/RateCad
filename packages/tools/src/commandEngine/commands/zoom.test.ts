import { describe, expect, it, vi } from 'vitest';
import { CommandBus } from '@ratecad/commands';
import { createEmptyDocument } from '@ratecad/core';
import { CadCommandEngine, createDefaultEngineRegistry } from '../index.js';
import type { EngineHost } from '../engine.js';
import type { NavigationHost } from './zoom.js';

function host(
  nav: Partial<NavigationHost> & Pick<
    NavigationHost,
    'zoomExtents' | 'zoomWindow' | 'zoomPrevious' | 'beginPanTool'
  >,
): EngineHost & NavigationHost {
  return {
    getUnits: () => 'ft' as const,
    getWorldUnit: () => 'ft' as const,
    getSelectedIds: () => [],
    getCursor: () => ({ x: 0, y: 0 }),
    activateTool: vi.fn(),
    activateSelect: vi.fn(),
    clearSelection: vi.fn(),
    ...nav,
  };
}

describe('ZOOM / PAN commands', () => {
  it('resolves ZOOM and Z aliases', () => {
    const reg = createDefaultEngineRegistry();
    expect(reg.resolve('ZOOM').ok).toBe(true);
    expect(reg.resolve('Z').ok).toBe(true);
    expect(reg.resolve('ZE').ok).toBe(true);
    expect(reg.resolve('PAN').ok).toBe(true);
    expect(reg.resolve('P').ok).toBe(true);
  });

  it('ZOOM E runs extents', () => {
    const zoomExtents = vi.fn(() => ({ ok: true, message: 'ZOOM Extents' }));
    const bus = new CommandBus(createEmptyDocument());
    const engine = new CadCommandEngine(
      createDefaultEngineRegistry(),
      bus,
      host({
        zoomExtents,
        zoomWindow: () => ({ ok: false, message: 'no' }),
        zoomPrevious: () => ({ ok: false, message: 'no' }),
        beginPanTool: () => undefined,
      }),
    );
    expect(engine.start('Z').ok).toBe(true);
    engine.setBuffer('E');
    engine.confirm('enter');
    expect(zoomExtents).toHaveBeenCalled();
    expect(engine.isRunning()).toBe(false);
    expect(engine.getLastCompletedName()).toBe('ZOOM');
  });

  it('ZOOM W then two corners calls zoomWindow', () => {
    const zoomWindow = vi.fn(() => ({ ok: true, message: 'ZOOM Window' }));
    const bus = new CommandBus(createEmptyDocument());
    const engine = new CadCommandEngine(
      createDefaultEngineRegistry(),
      bus,
      host({
        zoomExtents: () => ({ ok: false, message: 'no' }),
        zoomWindow,
        zoomPrevious: () => ({ ok: false, message: 'no' }),
        beginPanTool: () => undefined,
      }),
    );
    engine.start('ZOOM');
    engine.setBuffer('W');
    engine.confirm('enter');
    engine.submitPoint({ x: 0, y: 0 });
    engine.submitPoint({ x: 10, y: 5 });
    expect(zoomWindow).toHaveBeenCalledWith(
      { x: 0, y: 0 },
      { x: 10, y: 5 },
    );
    expect(engine.isRunning()).toBe(false);
  });

  it('ZOOM Window cancel via ESC does not call zoomWindow', () => {
    const zoomWindow = vi.fn(() => ({ ok: true, message: 'ZOOM Window' }));
    const bus = new CommandBus(createEmptyDocument());
    const engine = new CadCommandEngine(
      createDefaultEngineRegistry(),
      bus,
      host({
        zoomExtents: () => ({ ok: false, message: 'no' }),
        zoomWindow,
        zoomPrevious: () => ({ ok: false, message: 'no' }),
        beginPanTool: () => undefined,
      }),
    );
    engine.start('Z');
    engine.setBuffer('W');
    engine.confirm('enter');
    engine.submitPoint({ x: 1, y: 1 });
    engine.handleEscape();
    expect(zoomWindow).not.toHaveBeenCalled();
    expect(engine.isRunning()).toBe(false);
  });

  it('ZOOM P calls zoomPrevious', () => {
    const zoomPrevious = vi.fn(() => ({ ok: true, message: 'ZOOM Previous' }));
    const bus = new CommandBus(createEmptyDocument());
    const engine = new CadCommandEngine(
      createDefaultEngineRegistry(),
      bus,
      host({
        zoomExtents: () => ({ ok: false, message: 'no' }),
        zoomWindow: () => ({ ok: false, message: 'no' }),
        zoomPrevious,
        beginPanTool: () => undefined,
      }),
    );
    engine.start('ZOOM');
    engine.setBuffer('P');
    engine.confirm('enter');
    expect(zoomPrevious).toHaveBeenCalled();
  });

  it('rejects zero-size window via host', () => {
    const zoomWindow = vi.fn(() => ({
      ok: false,
      message: 'Null view window',
    }));
    const bus = new CommandBus(createEmptyDocument());
    const engine = new CadCommandEngine(
      createDefaultEngineRegistry(),
      bus,
      host({
        zoomExtents: () => ({ ok: false, message: 'no' }),
        zoomWindow,
        zoomPrevious: () => ({ ok: false, message: 'no' }),
        beginPanTool: () => undefined,
      }),
    );
    engine.start('Z');
    engine.submitPoint({ x: 2, y: 2 });
    engine.submitPoint({ x: 2, y: 2 });
    expect(zoomWindow).toHaveBeenCalled();
    expect(engine.isRunning()).toBe(true);
  });

  it('PAN handoff activates pan tool', () => {
    const beginPanTool = vi.fn();
    const activateTool = vi.fn();
    const bus = new CommandBus(createEmptyDocument());
    const h = host({
      zoomExtents: () => ({ ok: false, message: 'no' }),
      zoomWindow: () => ({ ok: false, message: 'no' }),
      zoomPrevious: () => ({ ok: false, message: 'no' }),
      beginPanTool,
    });
    h.activateTool = activateTool;
    const engine = new CadCommandEngine(createDefaultEngineRegistry(), bus, h);
    expect(engine.start('PAN').ok).toBe(true);
    expect(beginPanTool).toHaveBeenCalled();
    expect(activateTool).toHaveBeenCalledWith('pan');
  });

  it('ZE runs extents immediately', () => {
    const zoomExtents = vi.fn(() => ({ ok: true, message: 'ZOOM Extents' }));
    const bus = new CommandBus(createEmptyDocument());
    const engine = new CadCommandEngine(
      createDefaultEngineRegistry(),
      bus,
      host({
        zoomExtents,
        zoomWindow: () => ({ ok: false, message: 'no' }),
        zoomPrevious: () => ({ ok: false, message: 'no' }),
        beginPanTool: () => undefined,
      }),
    );
    expect(engine.start('ZE').ok).toBe(true);
    expect(zoomExtents).toHaveBeenCalled();
    expect(engine.isRunning()).toBe(false);
  });
});
