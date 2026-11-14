import type { DrawingDocument } from '@ratecad/core';
import type { Command } from './bus.js';

/**
 * One undo entry for several existing commands.
 * execute is atomic: a child failure rolls the local document back and throws,
 * so CommandBus keeps the caller's document unchanged.
 */
export class BatchCommand implements Command {
  readonly name = 'Batch';
  private readonly commands: readonly Command[];

  constructor(commands: readonly Command[]) {
    if (commands.length === 0) {
      throw new Error('BatchCommand requires at least one command');
    }
    this.commands = [...commands];
  }

  get length(): number {
    return this.commands.length;
  }

  execute(doc: DrawingDocument): DrawingDocument {
    let next = doc;
    const applied: Command[] = [];
    try {
      for (const command of this.commands) {
        next = command.execute(next);
        applied.push(command);
      }
      return next;
    } catch (error) {
      try {
        for (let i = applied.length - 1; i >= 0; i -= 1) {
          next = applied[i]!.undo(next);
        }
      } catch {
        // CommandBus discards this return value when execute throws.
      }
      throw error instanceof Error ? error : new Error('Batch command failed');
    }
  }

  undo(doc: DrawingDocument): DrawingDocument {
    let next = doc;
    for (let i = this.commands.length - 1; i >= 0; i -= 1) {
      next = this.commands[i]!.undo(next);
    }
    return next;
  }
}
