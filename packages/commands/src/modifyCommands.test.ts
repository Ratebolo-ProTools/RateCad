import { describe, expect, it, beforeEach } from 'vitest';
import {
  createEmptyDocument,
  getEntity,
  resetIdCounter,
  setSelection,
  type Entity,
} from '@ratecad/core';
import { applyGripEdit, translateEntity, vecDelta } from '@ratecad/geometry';
import { selectByRectangle } from '@ratecad/viewport';
import {
  CommandBus,
  CopyEntitiesCommand,
  CreateCircleCommand,
  CreateLineCommand,
  CreatePolylineCommand,
  CreateRectangleCommand,
  DeleteEntitiesCommand,
  MoveEntitiesCommand,
  MoveEntityGripCommand,
} from '../src/index.js';

function seedBus() {
  const bus = new CommandBus(createEmptyDocument());
  bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 10, y: 0 }));
  bus.execute(new CreateRectangleCommand({ x: 0, y: 0 }, { x: 4, y: 3 }));
  bus.execute(new CreateCircleCommand({ x: 5, y: 5 }, 2));
  bus.execute(
    new CreatePolylineCommand([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
    ]),
  );
  return bus;
}

describe('grip edits', () => {
  beforeEach(() => resetIdCounter());

  it('moves line endpoint with undo/redo', () => {
    const bus = new CommandBus(createEmptyDocument());
    const create = new CreateLineCommand({ x: 0, y: 0 }, { x: 10, y: 0 });
    bus.execute(create);
    const before = getEntity(bus.getDocument(), create.getEntityId())!;
    bus.execute(
      new MoveEntityGripCommand(before, { kind: 'line-end' }, { x: 12, y: 2 }),
    );
    const after = getEntity(bus.getDocument(), create.getEntityId());
    expect(after?.type).toBe('line');
    if (after?.type === 'line') {
      expect(after.geometry.end).toEqual({ x: 12, y: 2 });
      expect(after.geometry.start).toEqual({ x: 0, y: 0 });
    }
    bus.undo();
    const undone = getEntity(bus.getDocument(), create.getEntityId());
    if (undone?.type === 'line') {
      expect(undone.geometry.end).toEqual({ x: 10, y: 0 });
    }
    bus.redo();
    const redone = getEntity(bus.getDocument(), create.getEntityId());
    if (redone?.type === 'line') {
      expect(redone.geometry.end).toEqual({ x: 12, y: 2 });
    }
  });

  it('moves polyline vertex', () => {
    const bus = new CommandBus(createEmptyDocument());
    const create = new CreatePolylineCommand([
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 5 },
    ]);
    bus.execute(create);
    const before = getEntity(bus.getDocument(), create.getEntityId())!;
    bus.execute(
      new MoveEntityGripCommand(
        before,
        { kind: 'polyline-vertex', index: 1 },
        { x: 7, y: 1 },
      ),
    );
    const after = getEntity(bus.getDocument(), create.getEntityId());
    if (after?.type === 'polyline') {
      expect(after.geometry.vertices[1]).toEqual({ x: 7, y: 1 });
    }
  });

  it('moves rectangle corner', () => {
    const bus = new CommandBus(createEmptyDocument());
    const create = new CreateRectangleCommand({ x: 0, y: 0 }, { x: 4, y: 3 });
    bus.execute(create);
    const before = getEntity(bus.getDocument(), create.getEntityId())!;
    bus.execute(
      new MoveEntityGripCommand(
        before,
        { kind: 'rect-corner', index: 2 },
        { x: 6, y: 5 },
      ),
    );
    const after = getEntity(bus.getDocument(), create.getEntityId());
    if (after?.type === 'rectangle') {
      expect(after.geometry.corner2).toEqual({ x: 6, y: 5 });
    }
  });

  it('moves circle center and radius', () => {
    const bus = new CommandBus(createEmptyDocument());
    const create = new CreateCircleCommand({ x: 0, y: 0 }, 2);
    bus.execute(create);
    let entity = getEntity(bus.getDocument(), create.getEntityId())!;
    bus.execute(
      new MoveEntityGripCommand(entity, { kind: 'circle-center' }, { x: 3, y: 4 }),
    );
    entity = getEntity(bus.getDocument(), create.getEntityId())!;
    if (entity.type === 'circle') {
      expect(entity.geometry.center).toEqual({ x: 3, y: 4 });
      expect(entity.geometry.radius).toBe(2);
    }
    bus.execute(
      new MoveEntityGripCommand(entity, { kind: 'circle-radius' }, { x: 7, y: 4 }),
    );
    const after = getEntity(bus.getDocument(), create.getEntityId());
    if (after?.type === 'circle') {
      expect(after.geometry.radius).toBe(4);
    }
  });

  it('rejects zero-length line grip edit', () => {
    const line: Entity = {
      id: 'l1',
      type: 'line',
      layerId: 'layer-0',
      visible: true,
      locked: false,
      geometry: { start: { x: 0, y: 0 }, end: { x: 5, y: 0 } },
      properties: {},
    };
    expect(applyGripEdit(line, { kind: 'line-end' }, { x: 0, y: 0 })).toBeNull();
  });
});

describe('MoveEntitiesCommand', () => {
  beforeEach(() => resetIdCounter());

  it('moves all entity types and supports undo/redo', () => {
    const bus = seedBus();
    const entities = [...bus.getDocument().entities];
    const delta = { x: 2, y: -1 };
    bus.execute(new MoveEntitiesCommand(entities, delta));

    for (let i = 0; i < entities.length; i += 1) {
      const moved = getEntity(bus.getDocument(), entities[i]!.id)!;
      const expected = translateEntity(entities[i]!, delta)!;
      expect(moved).toEqual(expected);
    }

    bus.undo();
    for (const original of entities) {
      expect(getEntity(bus.getDocument(), original.id)).toEqual(original);
    }
    bus.redo();
    for (const original of entities) {
      expect(getEntity(bus.getDocument(), original.id)).toEqual(
        translateEntity(original, delta),
      );
    }
  });
});

describe('CopyEntitiesCommand', () => {
  beforeEach(() => resetIdCounter());

  it('copies with new ids and leaves originals unchanged', () => {
    const bus = seedBus();
    const originals = bus.getDocument().entities.map((e) => structuredClone(e));
    const cmd = new CopyEntitiesCommand(originals, { x: 10, y: 0 });
    const newIds = cmd.getCreatedIds();
    bus.execute(cmd);

    expect(bus.getDocument().entities).toHaveLength(originals.length * 2);
    for (const id of newIds) {
      expect(originals.some((o) => o.id === id)).toBe(false);
      expect(getEntity(bus.getDocument(), id)).toBeTruthy();
    }
    for (const original of originals) {
      expect(getEntity(bus.getDocument(), original.id)).toEqual(original);
    }

    bus.undo();
    expect(bus.getDocument().entities).toHaveLength(originals.length);
    for (const id of newIds) {
      expect(getEntity(bus.getDocument(), id)).toBeUndefined();
    }
    bus.redo();
    expect(bus.getDocument().entities).toHaveLength(originals.length * 2);
  });
});

describe('multi-selection and window selection', () => {
  beforeEach(() => resetIdCounter());

  it('deletes and moves multiple selected entities', () => {
    const bus = seedBus();
    const ids = bus.getDocument().entities.slice(0, 2).map((e) => e.id);
    bus.updateWithoutHistory((doc) => setSelection(doc, ids));
    expect(bus.getDocument().selection).toEqual(ids);

    const selected = ids.map((id) => getEntity(bus.getDocument(), id)!);
    bus.execute(new MoveEntitiesCommand(selected, { x: 1, y: 1 }));
    bus.execute(new DeleteEntitiesCommand(ids));
    expect(bus.getDocument().entities).toHaveLength(2);
    bus.undo();
    expect(bus.getDocument().entities).toHaveLength(4);
  });

  it('window-selects fully inside entities only', () => {
    const bus = new CommandBus(createEmptyDocument());
    bus.execute(new CreateLineCommand({ x: 1, y: 1 }, { x: 2, y: 1 }));
    bus.execute(new CreateLineCommand({ x: 20, y: 20 }, { x: 25, y: 20 }));
    const inside = selectByRectangle(
      bus.getDocument(),
      { x: 0, y: 0 },
      { x: 5, y: 5 },
      'window',
    );
    expect(inside).toHaveLength(1);
  });

  it('crossing-selects intersecting entities', () => {
    const bus = new CommandBus(createEmptyDocument());
    bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 10, y: 0 }));
    const ids = selectByRectangle(
      bus.getDocument(),
      { x: 4, y: -1 },
      { x: 6, y: 1 },
      'crossing',
    );
    expect(ids).toHaveLength(1);
  });
});

describe('snap vector helper', () => {
  it('computes move delta', () => {
    expect(vecDelta({ x: 1, y: 2 }, { x: 4, y: 6 })).toEqual({ x: 3, y: 4 });
  });
});

describe('cancel semantics via commands', () => {
  beforeEach(() => resetIdCounter());

  it('uncommitted move preview is not in document', () => {
    const bus = seedBus();
    const originals = bus.getDocument().entities.map((e) => structuredClone(e));
    // Simulating cancel: never execute MoveEntitiesCommand
    expect(bus.getDocument().entities).toEqual(originals);
  });

  it('uncommitted copy does not add entities', () => {
    const bus = seedBus();
    const count = bus.getDocument().entities.length;
    // Constructing the command does not mutate until execute
    const cmd = new CopyEntitiesCommand(bus.getDocument().entities, {
      x: 5,
      y: 5,
    });
    expect(bus.getDocument().entities).toHaveLength(count);
    expect(cmd.getCreatedIds()).toHaveLength(count);
  });
});
