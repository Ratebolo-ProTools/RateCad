import { beforeEach, describe, expect, it } from 'vitest';
import { CommandBus, CreateLineCommand, CreateRectangleCommand } from '@ratecad/commands';
import {
  createEmptyDocument,
  getEntity,
  resetIdCounter,
  type Entity,
} from '@ratecad/core';
import type { SnapResult } from '@ratecad/geometry';
import { createCamera } from '@ratecad/viewport';
import { handleOffsetPointerDown } from './cadModifyTools.js';
import { createToolSession, type PointerInput } from './session.js';

const snap: SnapResult = {
  point: { x: 0, y: 0 },
  snapped: false,
  kind: null,
  label: null,
  candidate: null,
};

function pointer(world: { x: number; y: number }): PointerInput {
  return {
    world,
    camera: createCamera({ zoom: 1 }),
    detail: 1,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
  };
}

function sizeOf(entity: Entity | undefined): { width: number; height: number } {
  if (entity?.type !== 'rectangle') return { width: NaN, height: NaN };
  return {
    width: Math.abs(entity.geometry.corner2.x - entity.geometry.corner1.x),
    height: Math.abs(entity.geometry.corner2.y - entity.geometry.corner1.y),
  };
}

describe('rectangle offset tool', () => {
  beforeEach(() => resetIdCounter());

  it('offsets inward and outward by a typed distance and stays active', () => {
    const bus = new CommandBus(createEmptyDocument());
    const created = new CreateRectangleCommand({ x: 0, y: 0 }, { x: 5000, y: 4000 });
    bus.execute(created);
    const sourceId = created.getEntityId();
    let session = {
      ...createToolSession('offset'),
      refEntityId: sourceId,
      numericValue: 230,
    };
    session = handleOffsetPointerDown(
      session,
      bus,
      pointer({ x: 2500, y: 2000 }),
      { x: 2500, y: 2000 },
      snap,
    );
    expect(session.activeTool).toBe('offset');
    expect(session.refEntityId).toBeNull();
    expect(session.numericValue).toBe(230);
    const inward = bus.getDocument().entities.find((entity) => entity.id !== sourceId);
    expect(sizeOf(inward)).toEqual({ width: 4540, height: 3540 });
    expect(sizeOf(getEntity(bus.getDocument(), sourceId))).toEqual({
      width: 5000,
      height: 4000,
    });

    session = {
      ...session,
      refEntityId: sourceId,
    };
    session = handleOffsetPointerDown(
      session,
      bus,
      pointer({ x: -100, y: 2000 }),
      { x: -100, y: 2000 },
      snap,
    );
    const outward = bus
      .getDocument()
      .entities.find(
        (entity) =>
          entity.id !== sourceId &&
          entity.type === 'rectangle' &&
          Math.abs(entity.geometry.corner2.x - entity.geometry.corner1.x) > 5000,
      );
    expect(sizeOf(outward)).toEqual({ width: 5460, height: 4460 });
    expect(session.activeTool).toBe('offset');
  });

  it('uses the perpendicular distance when the distance is not typed', () => {
    const bus = new CommandBus(createEmptyDocument());
    const created = new CreateRectangleCommand({ x: 0, y: 0 }, { x: 5000, y: 4000 });
    bus.execute(created);
    const sourceId = created.getEntityId();
    const session = handleOffsetPointerDown(
      { ...createToolSession('offset'), refEntityId: sourceId },
      bus,
      pointer({ x: 230, y: 2000 }),
      { x: 0, y: 0 },
      snap,
    );
    const createdOffset = bus
      .getDocument()
      .entities.find((entity) => entity.id !== sourceId);
    expect(sizeOf(createdOffset)).toEqual({ width: 4540, height: 3540 });
    expect(session.statusMessage).toMatch(/Offset created/);
  });

  it('keeps a line offset parallel and undoable', () => {
    const bus = new CommandBus(createEmptyDocument());
    const created = new CreateLineCommand({ x: 0, y: 0 }, { x: 10, y: 0 });
    bus.execute(created);
    const sourceId = created.getEntityId();
    handleOffsetPointerDown(
      {
        ...createToolSession('offset'),
        refEntityId: sourceId,
        numericValue: 150,
      },
      bus,
      pointer({ x: 5, y: 1 }),
      { x: 5, y: 1 },
      snap,
    );
    const copy = bus.getDocument().entities.find((entity) => entity.id !== sourceId);
    expect(copy?.type).toBe('line');
    if (copy?.type === 'line') {
      expect(copy.geometry.start).toEqual({ x: 0, y: 150 });
      expect(copy.geometry.end).toEqual({ x: 10, y: 150 });
    }
    bus.undo();
    expect(bus.getDocument().entities).toHaveLength(1);
    expect(getEntity(bus.getDocument(), sourceId)?.type).toBe('line');
  });
});
