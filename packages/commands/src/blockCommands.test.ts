import { describe, expect, it } from 'vitest';
import { createEmptyDocument, setSelection, type Entity } from '@ratecad/core';
import {
  computeFillet,
  extendEntity,
  offsetEntity,
  trimEntity,
} from '@ratecad/geometry';
import { CommandBus } from './bus.js';
import { CreateBlockCommand, InsertBlockCommand } from './blockCommands.js';
import {
  CopyEntitiesCommand,
  MoveEntitiesCommand,
  MoveEntityGripCommand,
} from './modifyCommands.js';
import {
  ExtendEntityCommand,
  OffsetEntityCommand,
  RotateEntitiesCommand,
  ScaleEntitiesCommand,
  TrimEntityCommand,
} from './cadModifyCommands.js';
import { CreateLineCommand, DeleteEntitiesCommand } from './entityCommands.js';

function drawing(): CommandBus {
  const bus = new CommandBus(createEmptyDocument('Blocks'));
  bus.execute(new CreateLineCommand({ x: 10, y: 5 }, { x: 12, y: 5 }, 'line-a'));
  bus.execute(new CreateLineCommand({ x: 10, y: 5 }, { x: 10, y: 8 }, 'line-b'));
  bus.updateWithoutHistory((doc) => setSelection(doc, ['line-a', 'line-b']));
  return bus;
}

function createMark(bus: CommandBus, name = 'Mark', base = { x: 10, y: 5 }) {
  bus.execute(new CreateBlockCommand(['line-a', 'line-b'], name, base, 'MODEL_SPACE'));
}

describe('CreateBlockCommand', () => {
  it('converts selected lines into one definition and one reference, then undoes and redoes', () => {
    const bus = drawing();
    const originals = structuredClone(bus.getDocument().entities);
    createMark(bus);
    const doc = bus.getDocument();
    expect(bus.getUndoDepth()).toBe(3);
    expect(doc.blockDefinitions).toHaveLength(1);
    expect(doc.entities).toHaveLength(1);
    const reference = doc.entities[0]!;
    expect(reference.type).toBe('block');
    if (reference.type !== 'block') return;
    const definition = doc.blockDefinitions[0]!;
    expect(definition.name).toBe('Mark');
    expect(definition.entities.map((entity) => entity.id)).toEqual(['line-a', 'line-b']);
    const local = definition.entities[0]!;
    expect(local.type).toBe('line');
    if (local.type !== 'line') return;
    expect(local.geometry).toEqual({
      start: { x: 0, y: 0 },
      end: { x: 2, y: 0 },
    });
    expect(reference.geometry).toMatchObject({
      definitionId: definition.id,
      position: { x: 10, y: 5 },
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
    });
    expect(doc.selection).toEqual([reference.id]);

    bus.undo();
    expect(bus.getDocument().blockDefinitions).toEqual([]);
    expect(bus.getDocument().entities).toEqual(originals);
    expect(bus.getDocument().selection).toEqual(['line-a', 'line-b']);

    bus.redo();
    const redone = bus.getDocument();
    expect(redone.entities).toHaveLength(1);
    expect(redone.entities[0]!.id).toBe(reference.id);
    expect(redone.blockDefinitions[0]!.id).toBe(definition.id);
    expect(redone.blockDefinitions[0]!.entities.map((entity) => entity.id)).toEqual([
      'line-a',
      'line-b',
    ]);
  });

  it('rejects a duplicate name without changing the drawing', () => {
    const bus = drawing();
    createMark(bus, 'Door');
    bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 1, y: 0 }, 'line-c'));
    bus.updateWithoutHistory((doc) => setSelection(doc, ['line-c']));
    const before = structuredClone(bus.getDocument());
    expect(() =>
      bus.execute(new CreateBlockCommand(['line-c'], 'door', { x: 0, y: 0 }, 'MODEL_SPACE')),
    ).toThrow(/already exists/i);
    expect(bus.getDocument().entities).toEqual(before.entities);
    expect(bus.getDocument().blockDefinitions).toEqual(before.blockDefinitions);
    expect(bus.getUndoDepth()).toBe(before.entities.length === 2 ? 4 : bus.getUndoDepth());
  });

  it('rejects invalid geometry, locked layers, paper space, and nested blocks', () => {
    const bus = drawing();
    bus.updateWithoutHistory((doc) =>
      setSelection(
        {
          ...doc,
          entities: [
            ...doc.entities,
            {
              id: 'bad-line',
              type: 'line',
              layerId: doc.currentLayerId,
              visible: true,
              locked: false,
              geometry: { start: { x: 0, y: 0 }, end: { x: 0, y: 0 } },
              properties: {},
            },
          ],
        },
        ['bad-line'],
      ),
    );
    const before = structuredClone(bus.getDocument());
    expect(() =>
      bus.execute(
        new CreateBlockCommand(['bad-line'], 'Bad', { x: 0, y: 0 }, 'MODEL_SPACE'),
      ),
    ).toThrow(/invalid/i);
    expect(bus.getDocument()).toEqual(before);

    bus.updateWithoutHistory((doc) => ({
      ...doc,
      layers: doc.layers.map((layer) =>
        layer.id === doc.currentLayerId ? { ...layer, locked: true } : layer,
      ),
      selection: ['line-a'],
    }));
    expect(() =>
      bus.execute(
        new CreateBlockCommand(['line-a'], 'Locked', { x: 0, y: 0 }, 'MODEL_SPACE'),
      ),
    ).toThrow(/locked/i);

    const paper = drawing();
    expect(() =>
      paper.execute(
        new CreateBlockCommand(['line-a', 'line-b'], 'Paper', { x: 0, y: 0 }, 'PAPER_SPACE'),
      ),
    ).toThrow(/model space/i);
    expect(paper.getDocument().blockDefinitions).toEqual([]);

    createMark(paper);
    const referenceId = paper.getDocument().entities[0]!.id;
    expect(() =>
      paper.execute(
        new CreateBlockCommand([referenceId], 'Nested', { x: 0, y: 0 }, 'MODEL_SPACE'),
      ),
    ).toThrow(/nested/i);
    expect(paper.getDocument().blockDefinitions).toHaveLength(1);
  });
});

describe('InsertBlockCommand', () => {
  it('shares one definition across several references and transforms', () => {
    const bus = drawing();
    createMark(bus);
    const definition = bus.getDocument().blockDefinitions[0]!;
    const definitionGeometry = structuredClone(definition.entities);
    const points = [
      { x: 1, y: 2 },
      { x: -4, y: 3 },
      { x: 0, y: -8 },
      { x: 6, y: -1 },
    ];
    const scales = [
      { scaleX: 2, scaleY: 2 },
      { scaleX: -1, scaleY: 1 },
      { scaleX: 0.5, scaleY: 2 },
      { scaleX: 1, scaleY: -2 },
    ];
    points.forEach((position, index) => {
      bus.execute(
        new InsertBlockCommand({
          definitionId: definition.id,
          position,
          scaleX: scales[index]!.scaleX,
          scaleY: scales[index]!.scaleY,
          rotation: index === 0 ? Math.PI / 2 : 0,
          workspaceMode: 'MODEL_SPACE',
        }),
      );
    });
    const doc = bus.getDocument();
    const references = doc.entities.filter((entity) => entity.type === 'block');
    expect(references).toHaveLength(5);
    expect(doc.blockDefinitions).toHaveLength(1);
    expect(doc.blockDefinitions[0]!.entities).toEqual(definitionGeometry);
    const ids = new Set(references.map((entity) => entity.id));
    expect(ids.size).toBe(5);
    for (const entity of references) {
      if (entity.type !== 'block') continue;
      expect(entity.geometry.definitionId).toBe(definition.id);
    }
    expect(references[1]!.type === 'block' && references[1].geometry.position).toEqual(points[0]);
    expect(references[2]!.type === 'block' && references[2].geometry.scaleX).toBe(-1);

    for (const input of [
      { scaleX: 0, scaleY: 1 },
      { scaleX: Number.NaN, scaleY: 1 },
      { scaleX: Number.POSITIVE_INFINITY, scaleY: 1 },
    ]) {
      expect(() =>
        bus.execute(
          new InsertBlockCommand({
            definitionId: definition.id,
            position: { x: 0, y: 0 },
            scaleX: input.scaleX,
            scaleY: input.scaleY,
            rotation: 0,
            workspaceMode: 'MODEL_SPACE',
          }),
        ),
      ).toThrow(/scale/i);
    }
    expect(bus.getDocument().blockDefinitions[0]!.entities).toEqual(definitionGeometry);
    expect(bus.getDocument().entities.filter((entity) => entity.type === 'block')).toHaveLength(5);
  });
});

describe('block reference modify commands', () => {
  function blockOnly(): { bus: CommandBus; reference: Entity } {
    const bus = drawing();
    createMark(bus);
    const reference = bus.getDocument().entities[0]!;
    return { bus, reference };
  }

  it('moves, copies, rotates, scales, and deletes the reference only', () => {
    const { bus, reference } = blockOnly();
    if (reference.type !== 'block') throw new Error('expected block');
    const definitionBefore = structuredClone(bus.getDocument().blockDefinitions);

    bus.execute(new MoveEntitiesCommand([reference], { x: 3, y: -2 }, bus.getDocument().entities));
    const moved = bus.getDocument().entities[0]!;
    expect(moved.type === 'block' && moved.geometry.position).toEqual({ x: 13, y: 3 });
    expect(bus.getDocument().blockDefinitions).toEqual(definitionBefore);

    bus.execute(new CopyEntitiesCommand([moved], { x: 1, y: 0 }, bus.getDocument().entities));
    const copies = bus.getDocument().entities.filter((entity) => entity.type === 'block');
    expect(copies).toHaveLength(2);
    expect(copies[0]!.id).not.toBe(copies[1]!.id);
    if (copies[0]!.type !== 'block' || copies[1]!.type !== 'block') return;
    expect(copies[0].geometry.definitionId).toBe(copies[1].geometry.definitionId);
    expect(bus.getDocument().blockDefinitions).toHaveLength(1);

    bus.execute(new RotateEntitiesCommand([copies[0]], copies[0].geometry.position, Math.PI / 2));
    const rotated = bus.getDocument().entities.find((entity) => entity.id === copies[0]!.id);
    expect(rotated?.type === 'block' && rotated.geometry.rotation).toBeCloseTo(Math.PI / 2);
    expect(rotated?.type === 'block' && rotated.geometry.position).toEqual(copies[0].geometry.position);
    expect(bus.getDocument().blockDefinitions[0]!.entities[0]).toEqual(
      definitionBefore[0]!.entities[0],
    );

    bus.execute(new ScaleEntitiesCommand([rotated!], (rotated as Extract<Entity, { type: 'block' }>).geometry.position, 2));
    const scaled = bus.getDocument().entities.find((entity) => entity.id === rotated!.id);
    expect(scaled?.type === 'block' && scaled.geometry.scaleX).toBe(2);
    expect(scaled?.type === 'block' && scaled.geometry.scaleY).toBe(2);

    bus.execute(new DeleteEntitiesCommand([copies[0]!.id, copies[1]!.id]));
    expect(bus.getDocument().entities.filter((entity) => entity.type === 'block')).toHaveLength(0);
    expect(bus.getDocument().blockDefinitions).toHaveLength(1);
    expect(bus.getDocument().blockDefinitions[0]!.name).toBe('Mark');
  });

  it('moves the insertion grip without changing the definition', () => {
    const { bus, reference } = blockOnly();
    const before = structuredClone(bus.getDocument().blockDefinitions);
    bus.execute(
      new MoveEntityGripCommand(reference, { kind: 'block-insertion' }, { x: 4, y: -6 }),
    );
    const next = bus.getDocument().entities[0]!;
    expect(next.type === 'block' && next.geometry.position).toEqual({ x: 4, y: -6 });
    expect(bus.getDocument().blockDefinitions).toEqual(before);
  });

  it('rejects trim, extend, fillet, and offset without touching the definition', () => {
    const { bus, reference } = blockOnly();
    const line = {
      id: 'cutter',
      type: 'line' as const,
      layerId: bus.getDocument().currentLayerId,
      visible: true,
      locked: false,
      geometry: { start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
      properties: {},
    };
    const before = structuredClone(bus.getDocument().blockDefinitions);
    expect(() => new TrimEntityCommand(reference, line, { x: 10, y: 5 })).toThrow(/trim/i);
    expect(() => new ExtendEntityCommand(reference, line, { x: 10, y: 5 })).toThrow(/extend/i);
    expect(() => new OffsetEntityCommand(reference, 1, { x: 0, y: 1 })).toThrow(/offset/i);
    const trimmed = trimEntity(reference, line, { x: 10, y: 5 });
    const extended = extendEntity(reference, line, { x: 10, y: 5 });
    const offset = offsetEntity(reference, 1, { x: 0, y: 1 }, 'off');
    const filleted = computeFillet(
      { entity: reference, worldPoint: { x: 10, y: 5 } },
      { entity: line, worldPoint: { x: 0, y: 0 } },
      { radius: 0, trim: true },
      'fillet-1',
    );
    expect(trimmed.ok).toBe(false);
    expect(extended.ok).toBe(false);
    expect(offset.ok).toBe(false);
    expect(filleted.ok).toBe(false);
    expect(bus.getDocument().blockDefinitions).toEqual(before);
    expect(bus.getDocument().entities).toHaveLength(1);
  });
});
