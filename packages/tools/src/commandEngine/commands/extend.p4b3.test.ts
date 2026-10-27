/**
 * P4-B3 — EXTEND CadCommandEngine workflow tests.
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

describe('P4-B3 EXTEND engine workflows', () => {
  beforeEach(() => resetIdCounter());

  it('21/22: keyboard EX and EXTEND resolve and start engine command', () => {
    const reg = createDefaultEngineRegistry();
    for (const alias of ['EX', 'EXTEND', 'extend']) {
      const r = reg.resolve(alias);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.command.id).toBe('extend');
        expect(r.command.handoffToTool).not.toBe(true);
        expect(r.command.name).toBe('EXTEND');
      }
    }

    const bus = new CommandBus(createEmptyDocument());
    const engine = new CadCommandEngine(
      createDefaultEngineRegistry(),
      bus,
      host(bus),
    );
    engine.start('EX');
    expect(engine.isRunning()).toBe(true);
    expect(engine.getUiState().commandName).toBe('EXTEND');
    // P4-B4 default Quick mode prompts for targets (boundaries = all geometry).
    expect(engine.getUiState().prompt.toLowerCase()).toMatch(
      /object to extend|boundary/,
    );
  });

  it('18/19: Undo / Redo restore extended geometry', () => {
    const bus = new CommandBus(createEmptyDocument());
    const boundary = new CreateLineCommand({ x: 8, y: -2 }, { x: 8, y: 2 });
    const target = new CreateLineCommand({ x: 0, y: 0 }, { x: 3, y: 0 });
    bus.execute(boundary);
    bus.execute(target);
    const tid = target.getEntityId();

    const engine = new CadCommandEngine(
      createDefaultEngineRegistry(),
      bus,
      host(bus),
    );
    engine.start('EXTEND');
    // Quick mode: all entities are boundaries — click target near end
    engine.submitPoint({ x: 3, y: 0 });
    const after = getEntity(bus.getDocument(), tid);
    if (after?.type === 'line') {
      expect(after.geometry.end.x).toBeCloseTo(8);
    }

    bus.undo();
    const undone = getEntity(bus.getDocument(), tid);
    if (undone?.type === 'line') {
      expect(undone.geometry.end.x).toBeCloseTo(3);
    }
    bus.redo();
    const redone = getEntity(bus.getDocument(), tid);
    if (redone?.type === 'line') {
      expect(redone.geometry.end.x).toBeCloseTo(8);
    }
  });

  it('20: consecutive extensions in one session', () => {
    const bus = new CommandBus(createEmptyDocument());
    const boundary = new CreateLineCommand({ x: 6, y: -3 }, { x: 6, y: 5 });
    const a = new CreateLineCommand({ x: 0, y: 0 }, { x: 2, y: 0 });
    const b = new CreateLineCommand({ x: 0, y: 2 }, { x: 2, y: 2 });
    bus.execute(boundary);
    bus.execute(a);
    bus.execute(b);
    const engine = new CadCommandEngine(
      createDefaultEngineRegistry(),
      bus,
      host(bus),
    );
    engine.start('EX');
    // Quick mode — click each target near its end
    engine.submitPoint({ x: 2, y: 0 });
    engine.submitPoint({ x: 2, y: 2 });
    const la = getEntity(bus.getDocument(), a.getEntityId());
    const lb = getEntity(bus.getDocument(), b.getEntityId());
    if (la?.type === 'line') expect(la.geometry.end.x).toBeCloseTo(6);
    if (lb?.type === 'line') expect(lb.geometry.end.x).toBeCloseTo(6);
    engine.submitText('');
    expect(engine.isRunning()).toBe(false);
  });

  it('23: ESC cancels incomplete EXTEND', () => {
    const bus = new CommandBus(createEmptyDocument());
    const engine = new CadCommandEngine(
      createDefaultEngineRegistry(),
      bus,
      host(bus),
    );
    engine.start('EXTEND');
    expect(engine.isRunning()).toBe(true);
    engine.cancel();
    expect(engine.isRunning()).toBe(false);
  });

  it('24: ribbon parity — start("extend") same as EX', () => {
    const bus = new CommandBus(createEmptyDocument());
    const engine = new CadCommandEngine(
      createDefaultEngineRegistry(),
      bus,
      host(bus),
    );
    engine.start('extend');
    expect(engine.getUiState().commandName).toBe('EXTEND');
    expect(engine.getUiState().prompt.toLowerCase()).toMatch(
      /object to extend|boundary/,
    );
  });

  it('failed extend creates no geometry change', () => {
    const bus = new CommandBus(createEmptyDocument());
    const boundary = new CreateLineCommand({ x: 0, y: 2 }, { x: 5, y: 2 });
    const target = new CreateLineCommand({ x: 0, y: 0 }, { x: 4, y: 0 });
    bus.execute(boundary);
    bus.execute(target);
    const depth = bus.getUndoDepth();
    const engine = new CadCommandEngine(
      createDefaultEngineRegistry(),
      bus,
      host(bus),
    );
    engine.start('EXTEND');
    engine.submitPoint({ x: 4, y: 0 }); // parallel — reject
    const after = getEntity(bus.getDocument(), target.getEntityId());
    if (after?.type === 'line') {
      expect(after.geometry.end.x).toBeCloseTo(4);
    }
    expect(bus.getUndoDepth()).toBe(depth); // no ExtendEntityCommand pushed
  });

  it('14: open polyline extend via engine', () => {
    const bus = new CommandBus(createEmptyDocument());
    const boundary = new CreateLineCommand({ x: -1, y: 5 }, { x: 4, y: 5 });
    const poly = new CreatePolylineCommand(
      [
        { x: 0, y: 0 },
        { x: 0, y: 2 },
      ],
      undefined,
      false,
    );
    bus.execute(boundary);
    bus.execute(poly);
    const engine = new CadCommandEngine(
      createDefaultEngineRegistry(),
      bus,
      host(bus),
    );
    engine.start('EX');
    engine.submitPoint({ x: 0, y: 2 });
    const after = getEntity(bus.getDocument(), poly.getEntityId());
    expect(after?.type).toBe('polyline');
    if (after?.type === 'polyline') {
      expect(after.geometry.vertices[after.geometry.vertices.length - 1]!.y).toBeCloseTo(
        5,
      );
    }
  });

  it('28: TRIM still works after EXTEND registry change', () => {
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
    engine.submitPoint({ x: 8, y: 0 });
    const after = getEntity(bus.getDocument(), target.getEntityId());
    if (after?.type === 'line') expect(after.geometry.end.x).toBeCloseTo(4);
  });
});
