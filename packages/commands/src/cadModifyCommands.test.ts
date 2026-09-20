import { describe, expect, it, beforeEach } from 'vitest';
import {
  createEmptyDocument,
  getEntity,
  resetIdCounter,
  setSelection,
} from '@ratecad/core';
import { degreesToRadians } from '@ratecad/geometry';
import {
  CommandBus,
  CreateLineCommand,
  CreatePolylineCommand,
  CreateRectangleCommand,
  CreateCircleCommand,
  ExtendEntityCommand,
  MirrorEntitiesCommand,
  OffsetEntityCommand,
  RotateEntitiesCommand,
  ScaleEntitiesCommand,
  TrimEntityCommand,
} from '../src/index.js';

describe('TrimEntityCommand', () => {
  beforeEach(() => resetIdCounter());

  it('trims line with undo/redo', () => {
    const bus = new CommandBus(createEmptyDocument());
    const a = new CreateLineCommand({ x: 0, y: 0 }, { x: 10, y: 0 });
    const b = new CreateLineCommand({ x: 5, y: -2 }, { x: 5, y: 2 });
    bus.execute(a);
    bus.execute(b);
    const target = getEntity(bus.getDocument(), a.getEntityId())!;
    const cutter = getEntity(bus.getDocument(), b.getEntityId())!;
    bus.execute(new TrimEntityCommand(target, cutter, { x: 8, y: 0 }));
    const after = getEntity(bus.getDocument(), a.getEntityId());
    expect(after?.type).toBe('line');
    if (after?.type === 'line') {
      expect(after.geometry.end.x).toBeCloseTo(5);
    }
    bus.undo();
    const undone = getEntity(bus.getDocument(), a.getEntityId());
    if (undone?.type === 'line') {
      expect(undone.geometry.end).toEqual({ x: 10, y: 0 });
    }
    bus.redo();
    const redone = getEntity(bus.getDocument(), a.getEntityId());
    if (redone?.type === 'line') {
      expect(redone.geometry.end.x).toBeCloseTo(5);
    }
  });

  it('throws on invalid trim', () => {
    const bus = new CommandBus(createEmptyDocument());
    const a = new CreateLineCommand({ x: 0, y: 0 }, { x: 2, y: 0 });
    const b = new CreateLineCommand({ x: 10, y: -1 }, { x: 10, y: 1 });
    bus.execute(a);
    bus.execute(b);
    expect(() =>
      new TrimEntityCommand(
        getEntity(bus.getDocument(), a.getEntityId())!,
        getEntity(bus.getDocument(), b.getEntityId())!,
        { x: 1, y: 0 },
      ),
    ).toThrow();
  });
});

describe('ExtendEntityCommand', () => {
  beforeEach(() => resetIdCounter());

  it('extends line with undo/redo', () => {
    const bus = new CommandBus(createEmptyDocument());
    const a = new CreateLineCommand({ x: 0, y: 0 }, { x: 3, y: 0 });
    const b = new CreateLineCommand({ x: 10, y: -2 }, { x: 10, y: 2 });
    bus.execute(a);
    bus.execute(b);
    bus.execute(
      new ExtendEntityCommand(
        getEntity(bus.getDocument(), a.getEntityId())!,
        getEntity(bus.getDocument(), b.getEntityId())!,
        { x: 3, y: 0 },
      ),
    );
    const after = getEntity(bus.getDocument(), a.getEntityId());
    if (after?.type === 'line') {
      expect(after.geometry.end.x).toBeCloseTo(10);
    }
    bus.undo();
    const undone = getEntity(bus.getDocument(), a.getEntityId());
    if (undone?.type === 'line') {
      expect(undone.geometry.end).toEqual({ x: 3, y: 0 });
    }
    bus.redo();
    const redone = getEntity(bus.getDocument(), a.getEntityId());
    if (redone?.type === 'line') {
      expect(redone.geometry.end.x).toBeCloseTo(10);
    }
  });
});

describe('OffsetEntityCommand', () => {
  beforeEach(() => resetIdCounter());

  it('offsets line with new id and leaves original', () => {
    const bus = new CommandBus(createEmptyDocument());
    const a = new CreateLineCommand({ x: 0, y: 0 }, { x: 10, y: 0 });
    bus.execute(a);
    const src = getEntity(bus.getDocument(), a.getEntityId())!;
    const cmd = new OffsetEntityCommand(src, 2, { x: 5, y: 1 });
    const newId = cmd.getCreatedId();
    bus.execute(cmd);
    expect(getEntity(bus.getDocument(), a.getEntityId())).toEqual(src);
    const created = getEntity(bus.getDocument(), newId);
    expect(created?.type).toBe('line');
    if (created?.type === 'line') {
      expect(created.geometry.start.y).toBeCloseTo(2);
    }
    bus.undo();
    expect(getEntity(bus.getDocument(), newId)).toBeUndefined();
    bus.redo();
    expect(getEntity(bus.getDocument(), newId)).toBeTruthy();
  });
});

describe('MirrorEntitiesCommand', () => {
  beforeEach(() => resetIdCounter());

  it('mirrors with new ids and undo/redo', () => {
    const bus = new CommandBus(createEmptyDocument());
    bus.execute(new CreateLineCommand({ x: 2, y: 0 }, { x: 4, y: 0 }));
    bus.execute(new CreateRectangleCommand({ x: 1, y: 1 }, { x: 2, y: 2 }));
    bus.execute(new CreateCircleCommand({ x: 3, y: 3 }, 1));
    bus.execute(
      new CreatePolylineCommand([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ]),
    );
    const originals = bus.getDocument().entities.map((e) => structuredClone(e));
    const cmd = new MirrorEntitiesCommand(
      originals,
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      true,
    );
    const ids = cmd.getCreatedIds();
    bus.execute(cmd);
    expect(bus.getDocument().entities).toHaveLength(originals.length * 2);
    for (const id of ids) {
      expect(originals.some((o) => o.id === id)).toBe(false);
    }
    for (const o of originals) {
      expect(getEntity(bus.getDocument(), o.id)).toEqual(o);
    }
    bus.undo();
    expect(bus.getDocument().entities).toHaveLength(originals.length);
    bus.redo();
    expect(bus.getDocument().entities).toHaveLength(originals.length * 2);
  });
});

describe('RotateEntitiesCommand', () => {
  beforeEach(() => resetIdCounter());

  it('rotates 90 degrees with undo/redo', () => {
    const bus = new CommandBus(createEmptyDocument());
    const a = new CreateLineCommand({ x: 1, y: 0 }, { x: 2, y: 0 });
    bus.execute(a);
    const before = getEntity(bus.getDocument(), a.getEntityId())!;
    bus.execute(
      new RotateEntitiesCommand([before], { x: 0, y: 0 }, degreesToRadians(90)),
    );
    const after = getEntity(bus.getDocument(), a.getEntityId());
    if (after?.type === 'line') {
      expect(after.geometry.start.y).toBeCloseTo(1);
      expect(after.geometry.end.y).toBeCloseTo(2);
    }
    bus.undo();
    expect(getEntity(bus.getDocument(), a.getEntityId())).toEqual(before);
    bus.redo();
    const redone = getEntity(bus.getDocument(), a.getEntityId());
    if (redone?.type === 'line') {
      expect(redone.geometry.end.y).toBeCloseTo(2);
    }
  });

  it('rotates multiple entities', () => {
    const bus = new CommandBus(createEmptyDocument());
    bus.execute(new CreateLineCommand({ x: 1, y: 0 }, { x: 2, y: 0 }));
    bus.execute(new CreateCircleCommand({ x: 3, y: 0 }, 1));
    const ents = [...bus.getDocument().entities];
    bus.execute(
      new RotateEntitiesCommand(ents, { x: 0, y: 0 }, degreesToRadians(90)),
    );
    expect(bus.getDocument().entities).toHaveLength(2);
  });
});

describe('ScaleEntitiesCommand', () => {
  beforeEach(() => resetIdCounter());

  it('scales 2x and 0.5x with undo/redo', () => {
    const bus = new CommandBus(createEmptyDocument());
    const a = new CreateLineCommand({ x: 2, y: 0 }, { x: 4, y: 0 });
    bus.execute(a);
    const before = getEntity(bus.getDocument(), a.getEntityId())!;
    bus.execute(new ScaleEntitiesCommand([before], { x: 0, y: 0 }, 2));
    let after = getEntity(bus.getDocument(), a.getEntityId());
    if (after?.type === 'line') {
      expect(after.geometry.end).toEqual({ x: 8, y: 0 });
    }
    bus.undo();
    bus.execute(
      new ScaleEntitiesCommand(
        [getEntity(bus.getDocument(), a.getEntityId())!],
        { x: 0, y: 0 },
        0.5,
      ),
    );
    after = getEntity(bus.getDocument(), a.getEntityId());
    if (after?.type === 'line') {
      expect(after.geometry.end).toEqual({ x: 2, y: 0 });
    }
  });

  it('rejects invalid scale', () => {
    const bus = new CommandBus(createEmptyDocument());
    bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 1, y: 0 }));
    const e = bus.getDocument().entities[0]!;
    expect(() => new ScaleEntitiesCommand([e], { x: 0, y: 0 }, 0)).toThrow();
    expect(() => new ScaleEntitiesCommand([e], { x: 0, y: 0 }, -2)).toThrow();
  });

  it('scales multiple entities', () => {
    const bus = new CommandBus(createEmptyDocument());
    bus.execute(new CreateLineCommand({ x: 1, y: 0 }, { x: 2, y: 0 }));
    bus.execute(new CreateRectangleCommand({ x: 0, y: 0 }, { x: 2, y: 2 }));
    bus.updateWithoutHistory((doc) =>
      setSelection(
        doc,
        doc.entities.map((e) => e.id),
      ),
    );
    bus.execute(
      new ScaleEntitiesCommand(bus.getDocument().entities, { x: 0, y: 0 }, 2),
    );
    expect(bus.getDocument().entities).toHaveLength(2);
  });
});
