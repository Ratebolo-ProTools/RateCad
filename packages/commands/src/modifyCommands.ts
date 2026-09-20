import {
  addEntity,
  createEntityId,
  expandDeleteIds,
  getEntity,
  removeEntities,
  replaceEntity,
  type DoorEntity,
  type DrawingDocument,
  type Entity,
  type EntityId,
  type Vec2,
  type WallEntity,
  type WindowEntity,
} from '@ratecad/core';
import {
  applyGripEdit,
  clampHostedPosition,
  cloneEntityWithNewId,
  doorLayout,
  projectOntoWall,
  translateEntity,
  translatePoint,
  validateEntityGeometry,
  wallLength,
  windowLayout,
  type GripEditTarget,
} from '@ratecad/geometry';
import type { Command } from './bus.js';

function assertValid(entity: Entity): Entity {
  if (!validateEntityGeometry(entity)) {
    throw new Error(`Invalid geometry for entity ${entity.id} (${entity.type})`);
  }
  return entity;
}

function entityPrefix(type: Entity['type']): string {
  switch (type) {
    case 'line':
      return 'line';
    case 'rectangle':
      return 'rect';
    case 'circle':
      return 'circle';
    case 'polyline':
      return 'pline';
    case 'dimension':
      return 'dim';
    case 'text':
      return 'text';
    case 'leader':
      return 'leader';
    case 'wall':
      return 'wall';
    case 'door':
      return 'door';
    case 'window':
      return 'window';
  }
}

function withHostedPosition(
  entity: DoorEntity | WindowEntity,
  position: number,
): DoorEntity | WindowEntity {
  if (entity.type === 'door') {
    return {
      ...entity,
      geometry: { ...entity.geometry, position },
    };
  }
  return {
    ...entity,
    geometry: { ...entity.geometry, position },
  };
}

function moveHostedAlongWall(
  entity: DoorEntity | WindowEntity,
  wall: WallEntity,
  delta: Vec2,
): DoorEntity | WindowEntity | null {
  const layout =
    entity.type === 'door' ? doorLayout(entity, wall) : windowLayout(entity, wall);
  if (!layout) return null;
  const moved = translatePoint(layout.center, delta);
  const proj = projectOntoWall(wall, moved);
  if (!proj) return null;
  const position = clampHostedPosition(
    wallLength(wall),
    entity.geometry.width,
    proj.t,
  );
  const next = withHostedPosition(entity, position);
  return validateEntityGeometry(next) ? next : null;
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
    hostWall?: WallEntity,
  ) {
    let after: Entity | null = null;
    if (
      (before.type === 'door' || before.type === 'window') &&
      (target.kind === 'door-position' || target.kind === 'window-position') &&
      hostWall
    ) {
      const proj = projectOntoWall(hostWall, point);
      if (proj) {
        const position = clampHostedPosition(
          wallLength(hostWall),
          before.geometry.width,
          proj.t,
        );
        after = withHostedPosition(before, position);
      }
    } else {
      after = applyGripEdit(before, target, point);
    }
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

  /**
   * @param entities Entities to move
   * @param delta World translation
   * @param contextEntities Document entities used to resolve host walls for doors/windows
   */
  constructor(
    entities: Entity[],
    private readonly delta: Vec2,
    contextEntities: Entity[] = entities,
  ) {
    if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y)) {
      throw new Error('Invalid move delta');
    }
    const selectedIds = new Set(entities.map((e) => e.id));
    const walls = new Map(
      contextEntities
        .filter((e): e is WallEntity => e.type === 'wall')
        .map((w) => [w.id, w]),
    );

    for (const entity of entities) {
      if (entity.type === 'door' || entity.type === 'window') {
        // Host wall also moving → parametric attachment is enough
        if (selectedIds.has(entity.geometry.hostWallId)) {
          continue;
        }
        const wall = walls.get(entity.geometry.hostWallId);
        if (!wall) {
          throw new Error(`Cannot move ${entity.type}: missing host wall`);
        }
        const moved = moveHostedAlongWall(entity, wall, delta);
        if (!moved) throw new Error(`Cannot move ${entity.type} along wall`);
        this.before.push(structuredClone(entity));
        this.after.push(moved);
        continue;
      }

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

  constructor(
    entities: Entity[],
    delta: Vec2,
    contextEntities: Entity[] = entities,
  ) {
    if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y)) {
      throw new Error('Invalid copy delta');
    }
    const selectedIds = new Set(entities.map((e) => e.id));
    const walls = new Map(
      contextEntities
        .filter((e): e is WallEntity => e.type === 'wall')
        .map((w) => [w.id, w]),
    );
    const wallIdMap = new Map<EntityId, EntityId>();

    // First pass: copy walls (and non-hosted)
    for (const entity of entities) {
      if (entity.type === 'door' || entity.type === 'window') continue;

      const moved = translateEntity(entity, delta);
      if (!moved || !validateEntityGeometry(moved)) {
        throw new Error(`Cannot copy entity ${entity.id}`);
      }
      const newId = createEntityId(entityPrefix(entity.type));
      if (entity.type === 'wall') {
        wallIdMap.set(entity.id, newId);
      }
      this.created.push(cloneEntityWithNewId(moved, newId));
    }

    // Second pass: hosted objects
    for (const entity of entities) {
      if (entity.type !== 'door' && entity.type !== 'window') continue;

      const hostMoved = selectedIds.has(entity.geometry.hostWallId);
      const newHostId = wallIdMap.get(entity.geometry.hostWallId);

      if (hostMoved && newHostId) {
        // Copy onto the new mirrored/copied wall, keep parametric position
        const remapped =
          entity.type === 'door'
            ? ({
                ...entity,
                geometry: { ...entity.geometry, hostWallId: newHostId },
              } satisfies DoorEntity)
            : ({
                ...entity,
                geometry: { ...entity.geometry, hostWallId: newHostId },
              } satisfies WindowEntity);
        const copy = cloneEntityWithNewId(
          remapped,
          createEntityId(entityPrefix(entity.type)),
        );
        if (!validateEntityGeometry(copy)) {
          throw new Error(`Cannot copy ${entity.type}`);
        }
        this.created.push(copy);
        continue;
      }

      // Copy onto same host wall at offset position
      const wall = walls.get(entity.geometry.hostWallId);
      if (!wall) {
        throw new Error(`Cannot copy ${entity.type}: missing host wall`);
      }
      const moved = moveHostedAlongWall(entity, wall, delta);
      if (!moved) throw new Error(`Cannot copy ${entity.type} along wall`);
      this.created.push(
        cloneEntityWithNewId(moved, createEntityId(entityPrefix(entity.type))),
      );
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
