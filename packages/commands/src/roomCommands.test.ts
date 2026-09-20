import { beforeEach, describe, expect, it } from 'vitest';
import { CommandBus } from '../src/bus.js';
import {
  CreateDoorCommand,
  CreateWallCommand,
  CreateWindowCommand,
} from '../src/constructionCommands.js';
import {
  CreateRoomCommand,
  DeleteRoomCommand,
  UpdateRoomCommand,
} from '../src/roomCommands.js';
import { MoveEntitiesCommand } from '../src/modifyCommands.js';
import { DeleteEntitiesCommand } from '../src/entityCommands.js';
import {
  createEmptyDocument,
  findInvalidRooms,
  getRoom,
  isEntityModifiable,
  resetIdCounter,
  updateLayer,
  type RoomEntity,
  type WallEntity,
} from '@ratecad/core';
import {
  findDoorsForRoom,
  findLoopAtPoint,
  findRooms,
  findRoomsContainingPoint,
  findWallsForRoom,
  findWindowsForRoom,
  findAffectedRoomsForWall,
} from '@ratecad/geometry';

function buildRectRoom(bus: CommandBus, w = 10, h = 12) {
  bus.execute(new CreateWallCommand({ x: 0, y: 0 }, { x: w, y: 0 }, 0.75, 8));
  bus.execute(new CreateWallCommand({ x: w, y: 0 }, { x: w, y: h }, 0.75, 8));
  bus.execute(new CreateWallCommand({ x: w, y: h }, { x: 0, y: h }, 0.75, 8));
  bus.execute(new CreateWallCommand({ x: 0, y: h }, { x: 0, y: 0 }, 0.75, 8));
  const walls = bus
    .getDocument()
    .entities.filter((e): e is WallEntity => e.type === 'wall');
  const loop = findLoopAtPoint(walls, { x: w / 2, y: h / 2 });
  if (!('wallIds' in loop)) throw new Error(loop.reason);
  bus.execute(
    new CreateRoomCommand(
      loop.wallIds,
      loop.wallDirs,
      loop.polygon,
      loop.area,
      'Bedroom 1',
      'bedroom',
    ),
  );
  return bus.getDocument().entities.find((e) => e.type === 'room') as RoomEntity;
}

describe('Milestone 7 rooms', () => {
  beforeEach(() => {
    resetIdCounter();
  });

  it('creates a room from a closed wall loop', () => {
    const bus = new CommandBus(createEmptyDocument());
    const room = buildRectRoom(bus, 10, 12);
    expect(room.properties.name).toBe('Bedroom 1');
    expect(room.geometry.area).toBeCloseTo(120, 5);
    expect(room.layerId).toBe('layer-rooms');
    expect(room.geometry.wallIds).toHaveLength(4);
  });

  it('rejects room creation when click is outside loops', () => {
    const bus = new CommandBus(createEmptyDocument());
    bus.execute(new CreateWallCommand({ x: 0, y: 0 }, { x: 10, y: 0 }, 0.75, 8));
    bus.execute(new CreateWallCommand({ x: 10, y: 0 }, { x: 10, y: 10 }, 0.75, 8));
    bus.execute(new CreateWallCommand({ x: 10, y: 10 }, { x: 0, y: 10 }, 0.75, 8));
    bus.execute(new CreateWallCommand({ x: 0, y: 10 }, { x: 0, y: 0 }, 0.75, 8));
    const walls = bus
      .getDocument()
      .entities.filter((e): e is WallEntity => e.type === 'wall');
    const miss = findLoopAtPoint(walls, { x: 100, y: 100 });
    expect('ok' in miss && miss.ok === false).toBe(true);
  });

  it('updates room name/type and supports undo', () => {
    const bus = new CommandBus(createEmptyDocument());
    const room = buildRectRoom(bus);
    bus.execute(new UpdateRoomCommand(room, { name: 'Kitchen', roomType: 'kitchen' }));
    const updated = getRoom(bus.getDocument(), room.id)!;
    expect(updated.properties.name).toBe('Kitchen');
    expect(updated.properties.roomType).toBe('kitchen');
    bus.undo();
    expect(getRoom(bus.getDocument(), room.id)!.properties.name).toBe('Bedroom 1');
  });

  it('semantic queries find walls/doors/windows for a room', () => {
    const bus = new CommandBus(createEmptyDocument());
    const room = buildRectRoom(bus, 20, 12);
    const walls = findWallsForRoom(bus.getDocument(), room.id);
    const host = walls[0]!;
    bus.execute(new CreateDoorCommand(host.id, 0.5, 3, 7));
    bus.execute(new CreateWindowCommand(walls[1]!.id, 0.5, 3, 4, 3));
    expect(findRooms(bus.getDocument())).toHaveLength(1);
    expect(findDoorsForRoom(bus.getDocument(), room.id)).toHaveLength(1);
    expect(findWindowsForRoom(bus.getDocument(), room.id)).toHaveLength(1);
    expect(findRoomsContainingPoint(bus.getDocument(), { x: 5, y: 5 })[0]?.id).toBe(
      room.id,
    );
    expect(findAffectedRoomsForWall(bus.getDocument(), host.id)[0]?.id).toBe(room.id);
  });

  it('recalculates room when a boundary wall moves', () => {
    const bus = new CommandBus(createEmptyDocument());
    const room = buildRectRoom(bus, 10, 10);
    const wall = findWallsForRoom(bus.getDocument(), room.id).find(
      (w) => Math.abs(w.geometry.start.x - w.geometry.end.x) < 1e-9,
    )!;
    // Move a vertical wall outward by 2
    bus.execute(
      new MoveEntitiesCommand([wall], { x: 2, y: 0 }, bus.getDocument().entities),
    );
    const refreshed = getRoom(bus.getDocument(), room.id);
    expect(refreshed).toBeDefined();
    // Area should change from 100
    expect(refreshed!.geometry.area).not.toBeCloseTo(100, 1);
    expect(refreshed!.geometry.area).toBeGreaterThan(0);
    bus.undo();
    expect(getRoom(bus.getDocument(), room.id)!.geometry.area).toBeCloseTo(100, 4);
  });

  it('deletes rooms when a boundary wall is deleted', () => {
    const bus = new CommandBus(createEmptyDocument());
    const room = buildRectRoom(bus);
    const wall = findWallsForRoom(bus.getDocument(), room.id)[0]!;
    bus.execute(new DeleteEntitiesCommand([wall.id]));
    expect(getRoom(bus.getDocument(), room.id)).toBeUndefined();
    expect(findInvalidRooms(bus.getDocument())).toHaveLength(0);
  });

  it('DeleteRoomCommand undo restores room', () => {
    const bus = new CommandBus(createEmptyDocument());
    const room = buildRectRoom(bus);
    bus.execute(new DeleteRoomCommand(room));
    expect(findRooms(bus.getDocument())).toHaveLength(0);
    bus.undo();
    expect(getRoom(bus.getDocument(), room.id)?.properties.name).toBe('Bedroom 1');
  });

  it('respects locked Rooms layer', () => {
    const bus = new CommandBus(createEmptyDocument());
    const room = buildRectRoom(bus);
    let doc = bus.getDocument();
    doc = updateLayer(doc, 'layer-rooms', { locked: true });
    bus.reset(doc);
    expect(isEntityModifiable(bus.getDocument(), room)).toBe(false);
  });
});
