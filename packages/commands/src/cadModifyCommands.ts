import {
  addEntity,
  createEntityId,
  getEntity,
  removeEntities,
  replaceEntity,
  type DrawingDocument,
  type Entity,
  type EntityId,
  type Vec2,
} from '@ratecad/core';
import {
  extendEntity,
  mirrorEntity,
  offsetEntity,
  rotateEntity,
  scaleEntity,
  trimEntity,
  validateEntityGeometry,
} from '@ratecad/geometry';
import type { Command } from './bus.js';
import { ReplaceEntityCommand } from './modifyCommands.js';

function prefixFor(type: Entity['type']): string {
  switch (type) {
    case 'line':
      return 'line';
    case 'rectangle':
      return 'rect';
    case 'circle':
      return 'circle';
    case 'polyline':
      return 'pline';
  }
}

/**
 * Trim: replace target with one or more resulting entities.
 * Stores before/after for exact undo/redo (IDs fixed at construction).
 */
export class TrimEntityCommand implements Command {
  readonly name = 'TrimEntity';
  private readonly before: Entity;
  private readonly after: Entity[];
  private readonly removedId: EntityId;
  private readonly addedIds: EntityId[] = [];

  constructor(target: Entity, cutter: Entity, pickPoint: Vec2) {
    const result = trimEntity(target, cutter, pickPoint);
    if (!result.ok) {
      throw new Error(result.reason);
    }
    this.before = structuredClone(target);
    this.removedId = target.id;
    this.after = result.entities.map((e, index) => {
      if (index === 0) {
        const kept = { ...structuredClone(e), id: target.id };
        if (!validateEntityGeometry(kept)) {
          throw new Error('Trim produced invalid geometry');
        }
        return kept;
      }
      const id = createEntityId(prefixFor(e.type));
      this.addedIds.push(id);
      const created = { ...structuredClone(e), id };
      if (!validateEntityGeometry(created)) {
        throw new Error('Trim produced invalid geometry');
      }
      return created;
    });
  }

  execute(doc: DrawingDocument): DrawingDocument {
    let next = replaceEntity(doc, structuredClone(this.after[0]!));
    for (let i = 1; i < this.after.length; i += 1) {
      next = addEntity(next, structuredClone(this.after[i]!));
    }
    return next;
  }

  undo(doc: DrawingDocument): DrawingDocument {
    let next = removeEntities(doc, this.addedIds);
    next = replaceEntity(next, structuredClone(this.before));
    return next;
  }
}

export class ExtendEntityCommand implements Command {
  readonly name = 'ExtendEntity';
  private readonly replace: ReplaceEntityCommand;

  constructor(target: Entity, boundary: Entity, pickPoint: Vec2) {
    const result = extendEntity(target, boundary, pickPoint);
    if (!result.ok || result.entities.length !== 1) {
      throw new Error(result.ok ? 'Extend produced unexpected geometry' : result.reason);
    }
    this.replace = new ReplaceEntityCommand(target, result.entities[0]!);
  }

  execute(doc: DrawingDocument): DrawingDocument {
    return this.replace.execute(doc);
  }

  undo(doc: DrawingDocument): DrawingDocument {
    return this.replace.undo(doc);
  }
}

export class OffsetEntityCommand implements Command {
  readonly name = 'OffsetEntity';
  private readonly created: Entity;

  constructor(
    source: Entity,
    distanceValue: number,
    sidePoint: Vec2,
    entityId?: EntityId,
  ) {
    const id = entityId ?? createEntityId(prefixFor(source.type));
    const result = offsetEntity(source, distanceValue, sidePoint, id);
    if (!result.ok || result.entities.length !== 1) {
      throw new Error(result.ok ? 'Offset failed' : result.reason);
    }
    this.created = structuredClone(result.entities[0]!);
  }

  getCreatedId(): EntityId {
    return this.created.id;
  }

  execute(doc: DrawingDocument): DrawingDocument {
    if (getEntity(doc, this.created.id)) return doc;
    return addEntity(doc, structuredClone(this.created));
  }

  undo(doc: DrawingDocument): DrawingDocument {
    return removeEntities(doc, [this.created.id]);
  }
}

export class MirrorEntitiesCommand implements Command {
  readonly name = 'MirrorEntities';
  private readonly created: Entity[] = [];

  constructor(
    entities: Entity[],
    axisA: Vec2,
    axisB: Vec2,
    _keepOriginal = true,
  ) {
    void _keepOriginal;
    for (const entity of entities) {
      const id = createEntityId(prefixFor(entity.type));
      const mirrored = mirrorEntity(entity, axisA, axisB, id);
      if (!mirrored) {
        throw new Error(`Cannot mirror entity ${entity.id}`);
      }
      this.created.push(mirrored);
    }
  }

  getCreatedIds(): EntityId[] {
    return this.created.map((e) => e.id);
  }

  execute(doc: DrawingDocument): DrawingDocument {
    let next = doc;
    for (const entity of this.created) {
      if (getEntity(next, entity.id)) continue;
      next = addEntity(next, structuredClone(entity));
    }
    return next;
  }

  undo(doc: DrawingDocument): DrawingDocument {
    return removeEntities(
      doc,
      this.created.map((e) => e.id),
    );
  }
}

export class RotateEntitiesCommand implements Command {
  readonly name = 'RotateEntities';
  private readonly before: Entity[] = [];
  private readonly after: Entity[] = [];

  constructor(entities: Entity[], origin: Vec2, radians: number) {
    if (!Number.isFinite(radians)) {
      throw new Error('Invalid rotation angle');
    }
    for (const entity of entities) {
      const rotated = rotateEntity(entity, origin, radians);
      if (!rotated) {
        throw new Error(`Cannot rotate entity ${entity.id}`);
      }
      this.before.push(structuredClone(entity));
      this.after.push(rotated);
    }
  }

  execute(doc: DrawingDocument): DrawingDocument {
    let next = doc;
    for (const entity of this.after) {
      // Type may change rectangle→polyline; replace by id
      const existing = getEntity(next, entity.id);
      if (!existing) {
        next = addEntity(next, structuredClone(entity));
      } else if (existing.type !== entity.type) {
        next = removeEntities(next, [entity.id]);
        next = addEntity(next, structuredClone(entity));
      } else {
        next = replaceEntity(next, structuredClone(entity));
      }
    }
    return next;
  }

  undo(doc: DrawingDocument): DrawingDocument {
    let next = doc;
    for (const entity of this.after) {
      const current = getEntity(next, entity.id);
      if (current && current.type !== this.before.find((b) => b.id === entity.id)?.type) {
        next = removeEntities(next, [entity.id]);
      }
    }
    for (const entity of this.before) {
      if (getEntity(next, entity.id)) {
        next = replaceEntity(next, structuredClone(entity));
      } else {
        next = addEntity(next, structuredClone(entity));
      }
    }
    return next;
  }
}

export class ScaleEntitiesCommand implements Command {
  readonly name = 'ScaleEntities';
  private readonly before: Entity[] = [];
  private readonly after: Entity[] = [];

  constructor(entities: Entity[], origin: Vec2, factor: number) {
    if (!Number.isFinite(factor) || !(factor > 0)) {
      throw new Error('Scale factor must be a positive finite number');
    }
    for (const entity of entities) {
      const scaled = scaleEntity(entity, origin, factor);
      if (!scaled) {
        throw new Error(`Cannot scale entity ${entity.id}`);
      }
      this.before.push(structuredClone(entity));
      this.after.push(scaled);
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
