import { describe, expect, it, beforeEach } from 'vitest';
import {
  createEmptyDocument,
  getEntity,
  resetIdCounter,
} from '@ratecad/core';
import { CommandBus, CreateLineCommand, CreateCircleCommand } from '@ratecad/commands';
import {
  CadCommandEngine,
  createDefaultEngineRegistry,
} from '../index.js';
import type { EngineHost } from '../engine.js';

function host(bus: CommandBus): EngineHost {
  return {
    getUnits: () => bus.getDocument().settings.units,
    getWorldUnit: () => bus.getDocument().settings.worldUnit,
    getSelectedIds: () => bus.getDocument().selection,
    getCursor: () => null,
    activateTool: () => {},
    activateSelect: () => {},
  };
}

describe('TRIM command engine', () => {
  beforeEach(() => resetIdCounter());

  it('resolves TR alias and starts Quick mode by default', () => {
    const bus = new CommandBus(createEmptyDocument());
    const engine = new CadCommandEngine(createDefaultEngineRegistry(), bus, host(bus));
    const started = engine.start('TR');
    expect(started.ok).toBe(true);
    expect(engine.isRunning()).toBe(true);
    expect(engine.getRunningCommand()?.name).toBe('TRIM');
    expect(engine.getStatusMessage()?.includes('QUICK')).toBe(true);
  });

  it('trims a line in Quick mode via click location', () => {
    const bus = new CommandBus(createEmptyDocument());
    const a = new CreateLineCommand({ x: 0, y: 0 }, { x: 10, y: 0 });
    const b = new CreateLineCommand({ x: 5, y: -2 }, { x: 5, y: 2 });
    bus.execute(a);
    bus.execute(b);
    const engine = new CadCommandEngine(createDefaultEngineRegistry(), bus, host(bus));
    engine.start('TRIM');
    // Click the portion to the right of the cutter
    engine.submitPoint({ x: 8, y: 0 });
    const after = getEntity(bus.getDocument(), a.getEntityId());
    expect(after?.type).toBe('line');
    if (after?.type === 'line') {
      expect(after.geometry.end.x).toBeCloseTo(5);
    }
  });

  it('Mode option switches to Standard cutting-edge prompt', () => {
    const bus = new CommandBus(createEmptyDocument());
    const engine = new CadCommandEngine(createDefaultEngineRegistry(), bus, host(bus));
    engine.start('TRIM');
    engine.submitText('mode');
    engine.submitText('standard');
    const ui = engine.getUiState();
    expect(ui.prompt.toLowerCase()).toMatch(/cutting/);
  });

  it('ESC cancels without committing pending preview', () => {
    const bus = new CommandBus(createEmptyDocument());
    const a = new CreateLineCommand({ x: 0, y: 0 }, { x: 10, y: 0 });
    const b = new CreateLineCommand({ x: 5, y: -2 }, { x: 5, y: 2 });
    bus.execute(a);
    bus.execute(b);
    const before = structuredClone(bus.getDocument());
    const engine = new CadCommandEngine(createDefaultEngineRegistry(), bus, host(bus));
    engine.start('TRIM');
    engine.onPointerMove({ x: 8, y: 0 });
    engine.handleEscape();
    expect(engine.isRunning()).toBe(false);
    const line = getEntity(bus.getDocument(), a.getEntityId());
    if (line?.type === 'line') {
      expect(line.geometry.end).toEqual(
        (before.entities.find((e) => e.id === a.getEntityId()) as typeof line)
          .geometry.end,
      );
    }
  });

  it('in-session Undo reverses last trim only', () => {
    const bus = new CommandBus(createEmptyDocument());
    const cutter = new CreateLineCommand({ x: 5, y: -2 }, { x: 5, y: 4 });
    const a = new CreateLineCommand({ x: 0, y: 0 }, { x: 10, y: 0 });
    const b = new CreateLineCommand({ x: 0, y: 2 }, { x: 10, y: 2 });
    bus.execute(cutter);
    bus.execute(a);
    bus.execute(b);
    const engine = new CadCommandEngine(createDefaultEngineRegistry(), bus, host(bus));
    engine.start('TRIM');
    engine.submitPoint({ x: 8, y: 0 });
    engine.submitPoint({ x: 8, y: 2 });
    expect(engine.getStatusMessage()?.toLowerCase()).toMatch(/trim/);
    engine.submitText('undo');
    const restoredB = getEntity(bus.getDocument(), b.getEntityId());
    if (restoredB?.type === 'line') {
      expect(restoredB.geometry.end.x).toBeCloseTo(10);
    }
    const keptA = getEntity(bus.getDocument(), a.getEntityId());
    if (keptA?.type === 'line') {
      expect(keptA.geometry.end.x).toBeCloseTo(5);
    }
  });

  it('circle trim via Quick mode', () => {
    const bus = new CommandBus(createEmptyDocument());
    const c = new CreateCircleCommand({ x: 0, y: 0 }, 5);
    const v = new CreateLineCommand({ x: 0, y: -10 }, { x: 0, y: 10 });
    bus.execute(c);
    bus.execute(v);
    const engine = new CadCommandEngine(createDefaultEngineRegistry(), bus, host(bus));
    engine.start('TRIM');
    engine.submitPoint({ x: 5, y: 0 });
    const after = getEntity(bus.getDocument(), c.getEntityId());
    expect(after?.type).toBe('polyline');
  });
});
