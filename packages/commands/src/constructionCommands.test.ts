import { beforeEach, describe, expect, it } from 'vitest';
import { CommandBus } from '../src/bus.js';
import {
  CreateDoorCommand,
  CreateWallCommand,
  CreateWindowCommand,
  DeleteWallCommand,
  UpdateDoorCommand,
  UpdateWallCommand,
  UpdateWindowCommand,
} from '../src/constructionCommands.js';
import {
  CopyEntitiesCommand,
  MoveEntitiesCommand,
} from '../src/modifyCommands.js';
import {
  MirrorEntitiesCommand,
  RotateEntitiesCommand,
  ScaleEntitiesCommand,
} from '../src/cadModifyCommands.js';
import { DeleteEntitiesCommand } from '../src/entityCommands.js';
import {
  createEmptyDocument,
  findOrphanHosted,
  getHostedByWall,
  getWall,
  resetIdCounter,
  type DoorEntity,
  type WallEntity,
  type WindowEntity,
} from '@ratecad/core';
import {
  doorLayout,
  pointAlongWall,
  rotateEntity,
  wallLength,
  wallOutlineSegments,
} from '@ratecad/geometry';

describe('Milestone 6 construction objects', () => {
  beforeEach(() => {
    resetIdCounter();
  });

  it('creates walls with thickness and derived length', () => {
    const bus = new CommandBus(createEmptyDocument());
    bus.execute(
      new CreateWallCommand({ x: 0, y: 0 }, { x: 12, y: 0 }, 0.75, 8),
    );
    const wall = bus.getDocument().entities[0] as WallEntity;
    expect(wall.type).toBe('wall');
    expect(wallLength(wall)).toBe(12);
    expect(wall.geometry.thickness).toBe(0.75);
    expect(wall.layerId).toBe('layer-walls');
    const segs = wallOutlineSegments(wall, []);
    expect(segs.length).toBeGreaterThan(0);
  });

  it('updates wall properties and supports undo', () => {
    const bus = new CommandBus(createEmptyDocument());
    bus.execute(
      new CreateWallCommand({ x: 0, y: 0 }, { x: 10, y: 0 }, 0.75, 8),
    );
    const wall = bus.getDocument().entities[0] as WallEntity;
    bus.execute(new UpdateWallCommand(wall, { thickness: 1, material: 'CMU' }));
    const updated = bus.getDocument().entities[0] as WallEntity;
    expect(updated.geometry.thickness).toBe(1);
    expect(updated.properties.material).toBe('CMU');
    bus.undo();
    expect((bus.getDocument().entities[0] as WallEntity).geometry.thickness).toBe(
      0.75,
    );
  });

  it('moves / copies / rotates / mirrors walls', () => {
    const bus = new CommandBus(createEmptyDocument());
    bus.execute(
      new CreateWallCommand({ x: 0, y: 0 }, { x: 10, y: 0 }, 0.75, 8),
    );
    const wall = bus.getDocument().entities[0] as WallEntity;
    bus.execute(new MoveEntitiesCommand([wall], { x: 2, y: 3 }));
    const moved = bus.getDocument().entities[0] as WallEntity;
    expect(moved.geometry.start).toEqual({ x: 2, y: 3 });
    expect(moved.geometry.end).toEqual({ x: 12, y: 3 });

    bus.execute(
      new CopyEntitiesCommand([moved], { x: 0, y: 5 }, bus.getDocument().entities),
    );
    expect(bus.getDocument().entities.filter((e) => e.type === 'wall')).toHaveLength(
      2,
    );
    const copy = bus.getDocument().entities.find((e) => e.id !== moved.id)!;
    expect(copy.id).not.toBe(moved.id);

    bus.execute(
      new RotateEntitiesCommand([moved], { x: 2, y: 3 }, Math.PI / 2),
    );
    const rotated = getWall(bus.getDocument(), moved.id)!;
    expect(rotated.geometry.end.x).toBeCloseTo(2, 6);
    expect(rotated.geometry.end.y).toBeCloseTo(13, 6);

    bus.execute(
      new MirrorEntitiesCommand([rotated], { x: 0, y: 0 }, { x: 0, y: 1 }),
    );
    expect(bus.getDocument().entities.filter((e) => e.type === 'wall').length).toBe(
      3,
    );
  });

  it('rejects scale for walls', () => {
    const bus = new CommandBus(createEmptyDocument());
    bus.execute(
      new CreateWallCommand({ x: 0, y: 0 }, { x: 5, y: 0 }, 0.75, 8),
    );
    const wall = bus.getDocument().entities[0] as WallEntity;
    expect(() =>
      bus.execute(new ScaleEntitiesCommand([wall], { x: 0, y: 0 }, 2)),
    ).toThrow(/Scale is disabled/);
  });

  it('creates hosted doors that follow wall moves and rotations', () => {
    const bus = new CommandBus(createEmptyDocument());
    bus.execute(
      new CreateWallCommand({ x: 0, y: 0 }, { x: 20, y: 0 }, 0.75, 8),
    );
    const wall = bus.getDocument().entities[0] as WallEntity;
    bus.execute(new CreateDoorCommand(wall.id, 0.5, 3, 7));
    const door = bus.getDocument().entities.find((e) => e.type === 'door') as DoorEntity;
    expect(door.geometry.hostWallId).toBe(wall.id);
    expect(door.layerId).toBe('layer-doors');

    const before = doorLayout(door, wall)!;
    bus.execute(
      new MoveEntitiesCommand([wall], { x: 0, y: 4 }, bus.getDocument().entities),
    );
    const wall2 = getWall(bus.getDocument(), wall.id)!;
    const door2 = bus.getDocument().entities.find(
      (e) => e.type === 'door',
    ) as DoorEntity;
    // Parametric position unchanged — world center moved with wall
    expect(door2.geometry.position).toBe(door.geometry.position);
    const after = doorLayout(door2, wall2)!;
    expect(after.center.y).toBeCloseTo(before.center.y + 4, 6);

    bus.execute(
      new RotateEntitiesCommand([wall2], wall2.geometry.start, Math.PI / 2),
    );
    const wall3 = getWall(bus.getDocument(), wall.id)!;
    const door3 = bus.getDocument().entities.find(
      (e) => e.type === 'door',
    ) as DoorEntity;
    const layout3 = doorLayout(door3, wall3)!;
    expect(layout3.center.x).toBeCloseTo(wall3.geometry.start.x, 5);
  });

  it('creates hosted windows that follow walls', () => {
    const bus = new CommandBus(createEmptyDocument());
    bus.execute(
      new CreateWallCommand({ x: 0, y: 0 }, { x: 16, y: 0 }, 0.75, 8),
    );
    const wall = bus.getDocument().entities[0] as WallEntity;
    bus.execute(new CreateWindowCommand(wall.id, 0.25, 3, 4, 3));
    const win = bus.getDocument().entities.find(
      (e) => e.type === 'window',
    ) as WindowEntity;
    expect(win.geometry.hostWallId).toBe(wall.id);

    bus.execute(
      new MoveEntitiesCommand([wall], { x: 5, y: 0 }, bus.getDocument().entities),
    );
    const wall2 = getWall(bus.getDocument(), wall.id)!;
    const win2 = bus.getDocument().entities.find(
      (e) => e.type === 'window',
    ) as WindowEntity;
    expect(pointAlongWall(wall2, win2.geometry.position).x).toBeCloseTo(
      5 + 16 * 0.25,
      6,
    );
  });

  it('cascade-deletes hosted objects with wall and leaves no orphans', () => {
    const bus = new CommandBus(createEmptyDocument());
    bus.execute(
      new CreateWallCommand({ x: 0, y: 0 }, { x: 12, y: 0 }, 0.75, 8),
    );
    const wall = bus.getDocument().entities[0] as WallEntity;
    bus.execute(new CreateDoorCommand(wall.id, 0.4, 3, 7));
    bus.execute(new CreateWindowCommand(wall.id, 0.7, 3, 4, 3));
    expect(getHostedByWall(bus.getDocument(), wall.id)).toHaveLength(2);

    bus.execute(new DeleteWallCommand(wall.id));
    expect(bus.getDocument().entities).toHaveLength(0);
    expect(findOrphanHosted(bus.getDocument())).toHaveLength(0);

    bus.undo();
    expect(bus.getDocument().entities).toHaveLength(3);
    expect(findOrphanHosted(bus.getDocument())).toHaveLength(0);
  });

  it('DeleteEntitiesCommand cascades wall hosts', () => {
    const bus = new CommandBus(createEmptyDocument());
    bus.execute(
      new CreateWallCommand({ x: 0, y: 0 }, { x: 10, y: 0 }, 0.75, 8),
    );
    const wall = bus.getDocument().entities[0] as WallEntity;
    bus.execute(new CreateDoorCommand(wall.id, 0.5, 3, 7));
    bus.execute(new DeleteEntitiesCommand([wall.id]));
    expect(bus.getDocument().entities).toHaveLength(0);
  });

  it('updates door/window width via commands', () => {
    const bus = new CommandBus(createEmptyDocument());
    bus.execute(
      new CreateWallCommand({ x: 0, y: 0 }, { x: 20, y: 0 }, 0.75, 8),
    );
    const wall = bus.getDocument().entities[0] as WallEntity;
    bus.execute(new CreateDoorCommand(wall.id, 0.5, 3, 7));
    bus.execute(new CreateWindowCommand(wall.id, 0.2, 3, 4, 3));
    const door = bus.getDocument().entities.find((e) => e.type === 'door') as DoorEntity;
    const win = bus.getDocument().entities.find(
      (e) => e.type === 'window',
    ) as WindowEntity;
    bus.execute(new UpdateDoorCommand(door, { width: 3.5 }));
    bus.execute(new UpdateWindowCommand(win, { width: 4, height: 5 }));
    expect(
      (bus.getDocument().entities.find((e) => e.type === 'door') as DoorEntity)
        .geometry.width,
    ).toBe(3.5);
    expect(
      (
        bus.getDocument().entities.find((e) => e.type === 'window') as WindowEntity
      ).geometry.height,
    ).toBe(5);
  });

  it('rejects door without host wall', () => {
    const bus = new CommandBus(createEmptyDocument());
    expect(() =>
      bus.execute(new CreateDoorCommand('missing-wall', 0.5, 3, 7)),
    ).toThrow();
  });
});

// silence unused
void rotateEntity;
