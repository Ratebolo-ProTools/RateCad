import { beforeEach, describe, expect, it } from 'vitest';
import { CommandBus } from '../src/bus.js';
import {
  CreateDimensionCommand,
  CreateLayerCommand,
  CreateLeaderCommand,
  CreateTextCommand,
  DeleteLayerCommand,
  SetCurrentLayerCommand,
  UpdateDimensionOffsetCommand,
  UpdateLayerCommand,
  UpdateTextCommand,
} from '../src/annotationCommands.js';
import { CreateLineCommand, DeleteEntitiesCommand } from '../src/entityCommands.js';
import { MoveEntitiesCommand } from '../src/modifyCommands.js';
import {
  createEmptyDocument,
  isEntityModifiable,
  isEntitySelectable,
  resetIdCounter,
  type DimensionEntity,
  type TextEntity,
} from '@ratecad/core';
import { formatLengthInUnits, measuredLength } from '@ratecad/geometry';

describe('Milestone 5 annotations & layers', () => {
  beforeEach(() => {
    resetIdCounter();
  });

  it('creates horizontal / vertical / aligned dimensions with geometry-driven values', () => {
    const bus = new CommandBus(createEmptyDocument());
    bus.execute(
      new CreateDimensionCommand('horizontal', { x: 0, y: 0 }, { x: 12, y: 3 }, 1),
    );
    bus.execute(
      new CreateDimensionCommand('vertical', { x: 0, y: 0 }, { x: 4, y: 5 }, 1),
    );
    bus.execute(
      new CreateDimensionCommand('aligned', { x: 0, y: 0 }, { x: 3, y: 4 }, 1),
    );
    const dims = bus
      .getDocument()
      .entities.filter((e): e is DimensionEntity => e.type === 'dimension');
    expect(dims).toHaveLength(3);
    expect(measuredLength(dims[0]!.geometry.start, dims[0]!.geometry.end, 'horizontal')).toBe(
      12,
    );
    expect(measuredLength(dims[1]!.geometry.start, dims[1]!.geometry.end, 'vertical')).toBe(
      5,
    );
    expect(
      measuredLength(dims[2]!.geometry.start, dims[2]!.geometry.end, 'aligned'),
    ).toBeCloseTo(5, 10);
    const label = formatLengthInUnits(12, bus.getDocument().settings.units, 0);
    expect(label).toBe("12'-0\"");
  });

  it('rejects invalid dimensions and supports undo/redo', () => {
    const bus = new CommandBus(createEmptyDocument());
    expect(() =>
      bus.execute(
        new CreateDimensionCommand('aligned', { x: 1, y: 1 }, { x: 1, y: 1 }, 0),
      ),
    ).toThrow();
    bus.execute(
      new CreateDimensionCommand('aligned', { x: 0, y: 0 }, { x: 10, y: 0 }, 2),
    );
    expect(bus.getDocument().entities).toHaveLength(1);
    bus.undo();
    expect(bus.getDocument().entities).toHaveLength(0);
    bus.redo();
    expect(bus.getDocument().entities).toHaveLength(1);
  });

  it('updates dimension offset via command', () => {
    const bus = new CommandBus(createEmptyDocument());
    bus.execute(
      new CreateDimensionCommand('horizontal', { x: 0, y: 0 }, { x: 10, y: 0 }, 1),
    );
    const dim = bus.getDocument().entities[0] as DimensionEntity;
    bus.execute(new UpdateDimensionOffsetCommand(dim, { x: 5, y: 3 }));
    const updated = bus.getDocument().entities[0] as DimensionEntity;
    expect(updated.geometry.offset).toBeCloseTo(3, 6);
    bus.undo();
    expect((bus.getDocument().entities[0] as DimensionEntity).geometry.offset).toBe(1);
  });

  it('creates / edits / moves text with undo', () => {
    const bus = new CommandBus(createEmptyDocument());
    bus.execute(new CreateTextCommand({ x: 1, y: 2 }, 'Room A', 0.5));
    let text = bus.getDocument().entities[0] as TextEntity;
    expect(text.geometry.content).toBe('Room A');
    bus.execute(new UpdateTextCommand(text, { content: 'Room B', height: 0.75 }));
    text = bus.getDocument().entities[0] as TextEntity;
    expect(text.geometry.content).toBe('Room B');
    expect(text.geometry.height).toBe(0.75);
    bus.execute(new MoveEntitiesCommand([text], { x: 3, y: 0 }));
    text = bus.getDocument().entities[0] as TextEntity;
    expect(text.geometry.position).toEqual({ x: 4, y: 2 });
    bus.undo();
    bus.undo();
    expect((bus.getDocument().entities[0] as TextEntity).geometry.content).toBe(
      'Room A',
    );
  });

  it('creates leaders with geometry and text preserved', () => {
    const bus = new CommandBus(createEmptyDocument());
    bus.execute(
      new CreateLeaderCommand(
        { x: 0, y: 0 },
        [{ x: 2, y: 1 }],
        '9 inch wall',
        0.35,
      ),
    );
    const leader = bus.getDocument().entities[0]!;
    expect(leader.type).toBe('leader');
    if (leader.type === 'leader') {
      expect(leader.geometry.content).toBe('9 inch wall');
      expect(leader.geometry.arrow).toEqual({ x: 0, y: 0 });
      expect(leader.geometry.vertices).toEqual([{ x: 2, y: 1 }]);
    }
    bus.undo();
    expect(bus.getDocument().entities).toHaveLength(0);
    bus.redo();
    expect(bus.getDocument().entities).toHaveLength(1);
  });

  it('manages layers: create, rename, current, visibility, lock', () => {
    const bus = new CommandBus(createEmptyDocument());
    const create = new CreateLayerCommand('Structural', '#ffaa00');
    bus.execute(create);
    const layerId = create.getLayerId();
    const layer = bus.getDocument().layers.find((l) => l.id === layerId)!;
    bus.execute(new UpdateLayerCommand(layerId, layer, { name: 'Struct' }));
    expect(bus.getDocument().layers.find((l) => l.id === layerId)!.name).toBe(
      'Struct',
    );
    bus.execute(
      new SetCurrentLayerCommand(bus.getDocument().currentLayerId, layerId),
    );
    expect(bus.getDocument().currentLayerId).toBe(layerId);
    bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 5, y: 0 }));
    const line = bus.getDocument().entities[0]!;
    expect(line.layerId).toBe(layerId);

    const renamed = bus.getDocument().layers.find((l) => l.id === layerId)!;
    bus.execute(new UpdateLayerCommand(layerId, renamed, { visible: false }));
    expect(isEntitySelectable(bus.getDocument(), line)).toBe(false);
    expect(isEntityModifiable(bus.getDocument(), line)).toBe(false);

    bus.execute(
      new UpdateLayerCommand(layerId, bus.getDocument().layers.find((l) => l.id === layerId)!, {
        visible: true,
        locked: true,
      }),
    );
    // Locked but visible: selectable, not modifiable
    expect(isEntitySelectable(bus.getDocument(), line)).toBe(true);
    expect(isEntityModifiable(bus.getDocument(), line)).toBe(false);
  });

  it('assigns new entities to current layer and blocks delete of layer 0', () => {
    const bus = new CommandBus(createEmptyDocument());
    const walls = bus.getDocument().layers.find((l) => l.name === 'Walls')!;
    bus.execute(
      new SetCurrentLayerCommand(bus.getDocument().currentLayerId, walls.id),
    );
    bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 1, y: 0 }));
    expect(bus.getDocument().entities[0]!.layerId).toBe(walls.id);
    expect(() => bus.execute(new DeleteLayerCommand('layer-0'))).toThrow();
  });

  it('moves entities off a layer when deleting it', () => {
    const bus = new CommandBus(createEmptyDocument());
    const create = new CreateLayerCommand('Temp');
    bus.execute(create);
    const id = create.getLayerId();
    bus.execute(new SetCurrentLayerCommand(bus.getDocument().currentLayerId, id));
    bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 2, y: 0 }));
    bus.execute(new DeleteLayerCommand(id, 'layer-0'));
    expect(bus.getDocument().layers.find((l) => l.id === id)).toBeUndefined();
    expect(bus.getDocument().entities[0]!.layerId).toBe('layer-0');
  });

  it('delete respects locked layers at the tool/document level', () => {
    const bus = new CommandBus(createEmptyDocument());
    bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 3, y: 0 }));
    const line = bus.getDocument().entities[0]!;
    const layer = bus.getDocument().layers.find((l) => l.id === line.layerId)!;
    bus.execute(new UpdateLayerCommand(layer.id, layer, { locked: true }));
    expect(isEntityModifiable(bus.getDocument(), line)).toBe(false);
    // Command itself still deletes if called directly — UI filters first
    bus.execute(new DeleteEntitiesCommand([line.id]));
    expect(bus.getDocument().entities).toHaveLength(0);
  });
});
