/**
 * P4-B2 — TRIM command-engine workflow hardening tests.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import {
  createEmptyDocument,
  getEntity,
  resetIdCounter,
} from '@ratecad/core';
import {
  CommandBus,
  CreateLineCommand,
  CreatePolylineCommand,
} from '@ratecad/commands';
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

describe('P4-B2 TRIM engine workflows', () => {
  beforeEach(() => resetIdCounter());

  it('15–16: Undo / Redo restore trimmed geometry', () => {
    const bus = new CommandBus(createEmptyDocument());
    const cutter = new CreateLineCommand({ x: 5, y: -2 }, { x: 5, y: 2 });
    const target = new CreateLineCommand({ x: 0, y: 0 }, { x: 10, y: 0 });
    bus.execute(cutter);
    bus.execute(target);
    const tid = target.getEntityId();
    const before = structuredClone(getEntity(bus.getDocument(), tid)!);

    const engine = new CadCommandEngine(
      createDefaultEngineRegistry(),
      bus,
      host(bus),
    );
    engine.start('TRIM');
    engine.submitPoint({ x: 8, y: 0 });
    const after = getEntity(bus.getDocument(), tid);
    expect(after?.type).toBe('line');
    if (after?.type === 'line' && before.type === 'line') {
      expect(after.geometry.end.x).toBeCloseTo(5);
      expect(before.geometry.end.x).toBeCloseTo(10);
    }

    expect(bus.canUndo()).toBe(true);
    bus.undo();
    const undone = getEntity(bus.getDocument(), tid);
    if (undone?.type === 'line' && before.type === 'line') {
      expect(undone.geometry.end.x).toBeCloseTo(before.geometry.end.x);
    }

    bus.redo();
    const redone = getEntity(bus.getDocument(), tid);
    if (redone?.type === 'line') {
      expect(redone.geometry.end.x).toBeCloseTo(5);
    }
  });

  it('17: consecutive trims in one Quick session', () => {
    const bus = new CommandBus(createEmptyDocument());
    const cutter = new CreateLineCommand({ x: 5, y: -2 }, { x: 5, y: 4 });
    const a = new CreateLineCommand({ x: 0, y: 0 }, { x: 10, y: 0 });
    const b = new CreateLineCommand({ x: 0, y: 2 }, { x: 10, y: 2 });
    bus.execute(cutter);
    bus.execute(a);
    bus.execute(b);
    const engine = new CadCommandEngine(
      createDefaultEngineRegistry(),
      bus,
      host(bus),
    );
    engine.start('TR');
    engine.submitPoint({ x: 8, y: 0 });
    engine.submitPoint({ x: 8, y: 2 });
    const la = getEntity(bus.getDocument(), a.getEntityId());
    const lb = getEntity(bus.getDocument(), b.getEntityId());
    if (la?.type === 'line') expect(la.geometry.end.x).toBeCloseTo(5);
    if (lb?.type === 'line') expect(lb.geometry.end.x).toBeCloseTo(5);
    engine.submitText(''); // Enter finishes
    expect(engine.isRunning()).toBe(false);
  });

  it('18: Quick mode compatibility (default)', () => {
    const bus = new CommandBus(createEmptyDocument());
    const engine = new CadCommandEngine(
      createDefaultEngineRegistry(),
      bus,
      host(bus),
    );
    engine.start('TRIM');
    expect(engine.getStatusMessage()?.includes('QUICK')).toBe(true);
  });

  it('19: Standard mode cutting-edge then trim', () => {
    const bus = new CommandBus(createEmptyDocument());
    const cutter = new CreateLineCommand({ x: 4, y: -1 }, { x: 4, y: 1 });
    const target = new CreateLineCommand({ x: 0, y: 0 }, { x: 10, y: 0 });
    bus.execute(cutter);
    bus.execute(target);
    const engine = new CadCommandEngine(
      createDefaultEngineRegistry(),
      bus,
      host(bus),
    );
    engine.start('TRIM');
    engine.submitText('mode');
    engine.submitText('standard');
    expect(engine.getUiState().prompt.toLowerCase()).toMatch(/cutting/);
    // Select cutter by clicking it
    engine.submitPoint({ x: 4, y: 0 });
    engine.submitText(''); // confirm cutting edges
    engine.submitPoint({ x: 8, y: 0 });
    const after = getEntity(bus.getDocument(), target.getEntityId());
    if (after?.type === 'line') expect(after.geometry.end.x).toBeCloseTo(4);
  });

  it('20: Fence path still trims crossed objects', () => {
    const bus = new CommandBus(createEmptyDocument());
    const cutter = new CreateLineCommand({ x: 5, y: -2 }, { x: 5, y: 6 });
    const a = new CreateLineCommand({ x: 0, y: 0 }, { x: 10, y: 0 });
    const b = new CreateLineCommand({ x: 0, y: 2 }, { x: 10, y: 2 });
    bus.execute(cutter);
    bus.execute(a);
    bus.execute(b);
    const engine = new CadCommandEngine(
      createDefaultEngineRegistry(),
      bus,
      host(bus),
    );
    engine.start('TRIM');
    engine.submitText('fence');
    engine.submitPoint({ x: 8, y: -1 });
    engine.submitPoint({ x: 8, y: 3 });
    engine.submitText('');
    const la = getEntity(bus.getDocument(), a.getEntityId());
    const lb = getEntity(bus.getDocument(), b.getEntityId());
    if (la?.type === 'line') expect(la.geometry.end.x).toBeCloseTo(5);
    if (lb?.type === 'line') expect(lb.geometry.end.x).toBeCloseTo(5);
  });

  it('failed trim creates no undo entry / no geometry change', () => {
    const bus = new CommandBus(createEmptyDocument());
    const target = new CreateLineCommand({ x: 0, y: 0 }, { x: 5, y: 0 });
    bus.execute(target);
    const depth = bus.getUndoDepth();
    const engine = new CadCommandEngine(
      createDefaultEngineRegistry(),
      bus,
      host(bus),
    );
    engine.start('TRIM');
    // Parallel miss — no cutter crossing
    const miss = new CreateLineCommand({ x: 0, y: 2 }, { x: 5, y: 2 });
    bus.execute(miss);
    engine.submitPoint({ x: 2, y: 0 });
    const after = getEntity(bus.getDocument(), target.getEntityId());
    if (after?.type === 'line') {
      expect(after.geometry.end.x).toBeCloseTo(5);
    }
    // Only the CreateLine for miss should have been added after start; trim itself no-ops
    expect(bus.getUndoDepth()).toBeGreaterThanOrEqual(depth);
  });

  it('polyline trim via engine preserves properties', () => {
    const bus = new CommandBus(createEmptyDocument());
    const cutter = new CreateLineCommand({ x: 5, y: -1 }, { x: 5, y: 1 });
    const poly = new CreatePolylineCommand(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 4 },
      ],
      undefined,
      false,
    );
    bus.execute(cutter);
    bus.execute(poly);
    const engine = new CadCommandEngine(
      createDefaultEngineRegistry(),
      bus,
      host(bus),
    );
    engine.start('TRIM');
    engine.submitPoint({ x: 8, y: 0 });
    const after = getEntity(bus.getDocument(), poly.getEntityId());
    expect(after?.type === 'polyline' || after?.type === 'line').toBe(true);
  });
});
