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

describe('FILLET command engine', () => {
  beforeEach(() => resetIdCounter());

  it('resolves F alias and starts FILLET', () => {
    const bus = new CommandBus(createEmptyDocument());
    const engine = new CadCommandEngine(
      createDefaultEngineRegistry(),
      bus,
      host(bus),
    );
    expect(engine.start('F').ok).toBe(true);
    expect(engine.getRunningCommand()?.name).toBe('FILLET');
  });

  it('sets radius via R option then fillets two lines', () => {
    const bus = new CommandBus(createEmptyDocument());
    // world unit ft — radius 1
    const a = new CreateLineCommand({ x: 0, y: 5 }, { x: 0, y: 0 });
    const b = new CreateLineCommand({ x: 0, y: 0 }, { x: 5, y: 0 });
    bus.execute(a);
    bus.execute(b);
    const engine = new CadCommandEngine(
      createDefaultEngineRegistry(),
      bus,
      host(bus),
    );
    engine.start('FILLET');
    engine.submitText('radius');
    engine.submitText('1');
    engine.submitPoint({ x: 0, y: 2 });
    engine.submitPoint({ x: 2, y: 0 });
    expect(engine.isRunning()).toBe(false);
    const lines = bus.getDocument().entities.filter((e) => e.type === 'line');
    const arcs = bus
      .getDocument()
      .entities.filter(
        (e) => e.type === 'polyline' && e.metadata?.arc,
      );
    expect(arcs.length).toBeGreaterThanOrEqual(1);
    expect(lines.length).toBe(2);
    const la = getEntity(bus.getDocument(), a.getEntityId());
    if (la?.type === 'line') {
      // Trimmed away from origin
      const nearOrigin =
        Math.hypot(la.geometry.start.x, la.geometry.start.y) < 0.1 ||
        Math.hypot(la.geometry.end.x, la.geometry.end.y) < 0.1;
      expect(nearOrigin).toBe(false);
    }
  });

  it('Multiple mode allows repeated fillets', () => {
    const bus = new CommandBus(createEmptyDocument());
    bus.execute(new CreateLineCommand({ x: 0, y: 3 }, { x: 0, y: 0 }));
    bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 3, y: 0 }));
    bus.execute(new CreateLineCommand({ x: 10, y: 3 }, { x: 10, y: 0 }));
    bus.execute(new CreateLineCommand({ x: 10, y: 0 }, { x: 13, y: 0 }));
    const engine = new CadCommandEngine(
      createDefaultEngineRegistry(),
      bus,
      host(bus),
    );
    engine.start('FILLET');
    engine.submitText('radius');
    engine.submitText('0.5');
    engine.submitText('multiple');
    engine.submitPoint({ x: 0, y: 1 });
    engine.submitPoint({ x: 1, y: 0 });
    expect(engine.isRunning()).toBe(true);
    engine.submitPoint({ x: 10, y: 1 });
    engine.submitPoint({ x: 11, y: 0 });
    engine.submitText('');
    expect(engine.isRunning()).toBe(false);
    const fillets = bus
      .getDocument()
      .entities.filter((e) => e.type === 'polyline' && e.metadata?.arc);
    expect(fillets.length).toBeGreaterThanOrEqual(2);
  });

  it('ESC cancels without committing', () => {
    const bus = new CommandBus(createEmptyDocument());
    const a = new CreateLineCommand({ x: 0, y: 5 }, { x: 0, y: 0 });
    const b = new CreateLineCommand({ x: 0, y: 0 }, { x: 5, y: 0 });
    bus.execute(a);
    bus.execute(b);
    const before = bus.getDocument().entities.length;
    const engine = new CadCommandEngine(
      createDefaultEngineRegistry(),
      bus,
      host(bus),
    );
    engine.start('FILLET');
    engine.submitText('radius');
    engine.submitText('1');
    engine.submitPoint({ x: 0, y: 2 });
    engine.onPointerMove({ x: 2, y: 0 });
    engine.handleEscape();
    expect(engine.isRunning()).toBe(false);
    expect(bus.getDocument().entities.length).toBe(before);
  });

  it('Polyline option fillets a rectangle', () => {
    const bus = new CommandBus(createEmptyDocument());
    bus.execute(
      new CreatePolylineCommand(
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 8 },
          { x: 0, y: 8 },
        ],
        undefined,
        true,
      ),
    );
    const engine = new CadCommandEngine(
      createDefaultEngineRegistry(),
      bus,
      host(bus),
    );
    engine.start('FILLET');
    engine.submitText('radius');
    engine.submitText('1');
    engine.submitText('polyline');
    const pl = bus.getDocument().entities.find((e) => e.type === 'polyline')!;
    engine.submitPoint({ x: 5, y: 0 });
    const after = getEntity(bus.getDocument(), pl.id);
    expect(after?.type).toBe('polyline');
    if (after?.type === 'polyline') {
      expect(after.geometry.closed).toBe(true);
      expect(after.geometry.vertices.length).toBeGreaterThan(4);
    }
  });
});
