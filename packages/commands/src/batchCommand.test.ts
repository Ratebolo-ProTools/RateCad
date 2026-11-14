import { describe, expect, it } from 'vitest';
import { CommandBus, CreateLineCommand } from './index.js';
import { BatchCommand } from './batchCommand.js';
import { createEmptyDocument, type DrawingDocument } from '@ratecad/core';
import type { Command } from './bus.js';

class BoomCommand implements Command {
  readonly name = 'Boom';
  execute(_doc: DrawingDocument): DrawingDocument {
    throw new Error('child failed');
  }
  undo(doc: DrawingDocument): DrawingDocument {
    return doc;
  }
}

describe('BatchCommand', () => {
  it('commits several creates as one undo and one redo', () => {
    const bus = new CommandBus(createEmptyDocument('batch'));
    bus.execute(
      new BatchCommand([
        new CreateLineCommand({ x: 0, y: 0 }, { x: 1, y: 0 }),
        new CreateLineCommand({ x: 0, y: 1 }, { x: 1, y: 1 }),
      ]),
    );
    expect(bus.getUndoDepth()).toBe(1);
    expect(bus.getDocument().entities).toHaveLength(2);
    bus.undo();
    expect(bus.getDocument().entities).toHaveLength(0);
    expect(bus.canRedo()).toBe(true);
    bus.redo();
    expect(bus.getDocument().entities).toHaveLength(2);
  });

  it('rolls back when a child throws and leaves the bus unchanged', () => {
    const bus = new CommandBus(createEmptyDocument('rollback'));
    const before = bus.getDocument();
    expect(() =>
      bus.execute(
        new BatchCommand([
          new CreateLineCommand({ x: 0, y: 0 }, { x: 4, y: 0 }),
          new BoomCommand(),
        ]),
      ),
    ).toThrow(/child failed/);
    expect(bus.getDocument()).toBe(before);
    expect(bus.getDocument().entities).toHaveLength(0);
    expect(bus.canUndo()).toBe(false);
  });

  it('rejects an empty batch before any document change', () => {
    expect(() => new BatchCommand([])).toThrow(/at least one/);
  });
});
