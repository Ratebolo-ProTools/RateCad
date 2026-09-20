import {
  addEntity,
  createEntityId,
  getEntity,
  replaceEntity,
  type DrawingDocument,
  type Entity,
  type EntityId,
  type Vec2,
} from '@ratecad/core';
import {
  applyGripEdit,
  cloneEntityWithNewId,
  translateEntity,
  validateEntityGeometry,
  type GripEditTarget,
} from '@ratecad/geometry';
import type { Command } from './bus.js';

function assertValid(entity: Entity): Entity {
  if (!validateEntityGeometry(entity)) {
    throw new Error(`Invalid geometry for entity ${entity.id} (${entity.type})`);
  }
  return entity;
}

/** Generic replace — used by grip edits and other single-entity mutations. */
export class ReplaceEntityCommand implements Command {
  readonly name = 'ReplaceEntity';

  constructor(
    private readonly before: Entity,
    private readonly after: Entity,
  ) {
    if (before.id !== after.id) {
      throw new Error('ReplaceEntityCommand requires same entity id');
    }
    assertValid(after);
  }

  execute(doc: DrawingDocument): DrawingDocument {
    return replaceEntity(doc, structuredClone(this.after));
  }

  undo(doc: DrawingDocument): DrawingDocument {
    return replaceEntity(doc, structuredClone(this.before));
  }
}

export class MoveEntityGripCommand implements Command {
  readonly name = 'MoveEntityGrip';
  private readonly replace: ReplaceEntityCommand;

  constructor(
    before: Entity,
    target: GripEditTarget,
    point: Vec2,
  ) {
    const after = applyGripEdit(before, target, point);
    if (!after) {
      throw new Error('Grip edit produced invalid geometry');
    }
    this.replace = new ReplaceEntityCommand(before, after);
  }

  execute(doc: DrawingDocument): DrawingDocument {
    return this.replace.execute(doc);
  }

  undo(doc: DrawingDocument): DrawingDocument {
    return this.replace.undo(doc);
  }
}

export class MoveEntitiesCommand implements Command {
  readonly name = 'MoveEntities';
  private readonly before: Entity[] = [];
  private readonly after: Entity[] = [];

  constructor(
    entities: Entity[],
    private readonly delta: Vec2,
  ) {
    if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y)) {
      throw new Error('Invalid move delta');
    }
    for (const entity of entities) {
      const moved = translateEntity(entity, delta);
      if (!moved || !validateEntityGeometry(moved)) {
        throw new Error(`Cannot move entity ${entity.id}`);
      }
      this.before.push(structuredClone(entity));
      this.after.push(moved);
    }
  }

  execute(doc: DrawingDocument): DrawingDocument {
    let next = doc;
    for (const entity of this.after) {
      next = replaceEntity(next, structuredClone(entity));
    }
    return next;
  }

  undo(doc: DrawingDocument): DrawingDocument {
    let next = doc;
    for (const entity of this.before) {
      next = replaceEntity(next, structuredClone(entity));
    }
    return next;
  }
}

export class CopyEntitiesCommand implements Command {
  readonly name = 'CopyEntities';
  private readonly created: Entity[] = [];

  constructor(entities: Entity[], delta: Vec2) {
    if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y)) {
      throw new Error('Invalid copy delta');
    }
    for (const entity of entities) {
      const moved = translateEntity(entity, delta);
      if (!moved || !validateEntityGeometry(moved)) {
        throw new Error(`Cannot copy entity ${entity.id}`);
      }
      const prefix =
        entity.type === 'line'
          ? 'line'
          : entity.type === 'rectangle'
            ? 'rect'
            : entity.type === 'circle'
              ? 'circle'
              : 'pline';
      const copy = cloneEntityWithNewId(moved, createEntityId(prefix));
      this.created.push(copy);
    }
  }

  getCreatedIds(): EntityId[] {
    return this.created.map((e) => e.id);
  }

  execute(doc: DrawingDocument): DrawingDocument {
    let next = doc;
    for (const entity of this.created) {
      // Skip if already present (redo safety)
      if (getEntity(next, entity.id)) continue;
      next = addEntity(next, structuredClone(entity));
    }
    return next;
  }

  undo(doc: DrawingDocument): DrawingDocument {
    const ids = this.created.map((e) => e.id);
    return {
      ...doc,
      entities: doc.entities.filter((e) => !ids.includes(e.id)),
      selection: doc.selection.filter((id) => !ids.includes(id)),
      meta: {
        ...doc.meta,
        updatedAt: new Date().toISOString(),
      },
    };
  }
}
