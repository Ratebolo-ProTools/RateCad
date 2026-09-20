import { describe, expect, it, beforeEach } from 'vitest';
import {
  createEmptyDocument,
  getEntity,
  resetIdCounter,
} from '@ratecad/core';
import {
  CommandBus,
  CreateCircleCommand,
  CreateLineCommand,
  CreatePolylineCommand,
  CreateRectangleCommand,
  DeleteEntitiesCommand,
} from '../src/index.js';

describe('CommandBus', () => {
  beforeEach(() => {
    resetIdCounter();
  });

  it('executes CreateLineCommand and supports undo/redo', () => {
    const bus = new CommandBus(createEmptyDocument());
    const cmd = new CreateLineCommand({ x: 0, y: 0 }, { x: 10, y: 0 });
    bus.execute(cmd);

    expect(bus.getDocument().entities).toHaveLength(1);
    expect(getEntity(bus.getDocument(), cmd.getEntityId())?.type).toBe('line');

    bus.undo();
    expect(bus.getDocument().entities).toHaveLength(0);

    bus.redo();
    expect(bus.getDocument().entities).toHaveLength(1);
  });

  it('creates rectangle and circle entities', () => {
    const bus = new CommandBus(createEmptyDocument());
    bus.execute(new CreateRectangleCommand({ x: 0, y: 0 }, { x: 4, y: 3 }));
    bus.execute(new CreateCircleCommand({ x: 2, y: 2 }, 1.5));

    const types = bus.getDocument().entities.map((e) => e.type);
    expect(types).toEqual(['rectangle', 'circle']);
  });

  it('creates polyline with ordered vertices and supports undo/redo', () => {
    const bus = new CommandBus(createEmptyDocument());
    const verts = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 4 },
    ];
    const cmd = new CreatePolylineCommand(verts);
    bus.execute(cmd);

    const entity = getEntity(bus.getDocument(), cmd.getEntityId());
    expect(entity?.type).toBe('polyline');
    if (entity?.type === 'polyline') {
      expect(entity.geometry.vertices).toHaveLength(3);
      expect(entity.geometry.vertices[1]).toEqual({ x: 5, y: 0 });
      expect(entity.geometry.closed).toBe(false);
    }

    bus.undo();
    expect(bus.getDocument().entities).toHaveLength(0);
    bus.redo();
    expect(bus.getDocument().entities).toHaveLength(1);
    expect(bus.getDocument().entities[0]?.type).toBe('polyline');
  });

  it('rejects polyline with fewer than 2 vertices', () => {
    expect(() => new CreatePolylineCommand([{ x: 0, y: 0 }])).toThrow();
  });

  it('deletes entities and restores them on undo', () => {
    const bus = new CommandBus(createEmptyDocument());
    const line = new CreateLineCommand({ x: 0, y: 0 }, { x: 5, y: 5 });
    bus.execute(line);
    const id = line.getEntityId();

    bus.execute(new DeleteEntitiesCommand([id]));
    expect(bus.getDocument().entities).toHaveLength(0);

    bus.undo();
    expect(bus.getDocument().entities).toHaveLength(1);
    expect(getEntity(bus.getDocument(), id)?.type).toBe('line');
  });

  it('clears redo stack after a new command', () => {
    const bus = new CommandBus(createEmptyDocument());
    bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 1, y: 0 }));
    bus.undo();
    expect(bus.canRedo()).toBe(true);

    bus.execute(new CreateCircleCommand({ x: 0, y: 0 }, 2));
    expect(bus.canRedo()).toBe(false);
    expect(bus.getDocument().entities).toHaveLength(1);
    expect(bus.getDocument().entities[0]?.type).toBe('circle');
  });
});
