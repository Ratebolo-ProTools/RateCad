import type { DrawingDocument } from '@ratecad/core';

/**
 * All document mutations go through Command.
 * Manual tools and future AI both emit commands on the same bus.
 */
export interface Command {
  readonly name: string;
  execute(doc: DrawingDocument): DrawingDocument;
  undo(doc: DrawingDocument): DrawingDocument;
}

export type CommandListener = (doc: DrawingDocument) => void;

/** Why the bus last notified listeners — used for dirty-state classification. */
export type CommandBusChangeKind =
  | 'execute'
  | 'undo'
  | 'redo'
  | 'reset'
  | 'updateWithoutHistory';

export class CommandBus {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private listeners = new Set<CommandListener>();
  private lastChangeKind: CommandBusChangeKind = 'reset';

  constructor(private document: DrawingDocument) {}

  getDocument(): DrawingDocument {
    return this.document;
  }

  /** Kind of the most recent bus mutation (for dirty tracking). */
  getLastChangeKind(): CommandBusChangeKind {
    return this.lastChangeKind;
  }

  subscribe(listener: CommandListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(kind: CommandBusChangeKind): void {
    this.lastChangeKind = kind;
    for (const listener of this.listeners) {
      listener(this.document);
    }
  }

  private setDocument(doc: DrawingDocument, kind: CommandBusChangeKind): void {
    this.document = doc;
    this.notify(kind);
  }

  /** Replace document without recording history (e.g. new/open). */
  reset(doc: DrawingDocument): void {
    this.document = doc;
    this.undoStack = [];
    this.redoStack = [];
    this.notify('reset');
  }

  /** Non-history UI updates such as selection changes. */
  updateWithoutHistory(mutator: (doc: DrawingDocument) => DrawingDocument): void {
    this.setDocument(mutator(this.document), 'updateWithoutHistory');
  }

  execute(command: Command): void {
    this.document = command.execute(this.document);
    this.undoStack.push(command);
    this.redoStack = [];
    this.notify('execute');
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Number of undoable commands (for detecting commits during a CAD session). */
  getUndoDepth(): number {
    return this.undoStack.length;
  }

  undo(): void {
    const command = this.undoStack.pop();
    if (!command) return;
    this.document = command.undo(this.document);
    this.redoStack.push(command);
    this.notify('undo');
  }

  redo(): void {
    const command = this.redoStack.pop();
    if (!command) return;
    this.document = command.execute(this.document);
    this.undoStack.push(command);
    this.notify('redo');
  }
}
