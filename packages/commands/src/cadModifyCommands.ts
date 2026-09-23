import {
  addEntity,
  createEntityId,
  getEntity,
  removeEntities,
  replaceEntity,
  type DrawingDocument,
  type Entity,
  type EntityId,
  type RoomEntity,
  type Vec2,
  type WallEntity,
} from '@ratecad/core';
import {
  extendEntityMulti,
  mirrorEntity,
  offsetEntity,
  rotateEntity,
  scaleEntity,
  trimEntityMulti,
  validateEntityGeometry,
  validateFilletResult,
  type FilletComputeResult,
} from '@ratecad/geometry';
import type { Command } from './bus.js';
import {
  ReplaceEntityCommand,
  applyRoomRefresh,
  planRoomRefresh,
  restoreRooms,
} from './modifyCommands.js';

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
    case 'room':
      return 'room';
  }
}

/**
 * Trim: replace target with one or more resulting entities.
 * Supports multiple cutting edges via TrimExtendEngine.
 * Stores before/after for exact undo/redo (IDs fixed at construction).
 */
export class TrimEntityCommand implements Command {
  readonly name = 'TrimEntity';
  private readonly before: Entity;
  private readonly after: Entity[];
  private readonly removedId: EntityId;
  private readonly addedIds: EntityId[] = [];
  private roomBefore: RoomEntity[] = [];
  private roomAfter: RoomEntity[] = [];
  private brokenRoomIds: EntityId[] = [];
  private roomsPlanned = false;

  constructor(
    target: Entity,
    cutterOrCutters: Entity | Entity[],
    pickPoint: Vec2,
    options?: { edgeMode?: 'extend' | 'no-extend'; projectMode?: 'none' | 'ucs' | 'view' },
  ) {
    const cutters = Array.isArray(cutterOrCutters)
      ? cutterOrCutters
      : [cutterOrCutters];
    const result = trimEntityMulti(target, cutters, pickPoint, {
      edgeMode: options?.edgeMode ?? 'no-extend',
      projectMode: options?.projectMode ?? 'none',
      allowSelfAsCutter: true,
    });
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

  private ensureRooms(doc: DrawingDocument): void {
    if (this.roomsPlanned) return;
    this.roomsPlanned = true;
    if (this.before.type !== 'wall') return;
    const afterWall = this.after.find((e): e is WallEntity => e.type === 'wall');
    if (!afterWall) return;
    const entitiesAfter = doc.entities.map((e) =>
      e.id === this.before.id ? afterWall : e,
    );
    const plan = planRoomRefresh(doc.entities, entitiesAfter, [this.before.id]);
    this.roomBefore = plan.roomsBefore;
    this.roomAfter = plan.roomsAfter;
    this.brokenRoomIds = plan.brokenIds;
  }

  execute(doc: DrawingDocument): DrawingDocument {
    this.ensureRooms(doc);
    let next = replaceEntity(doc, structuredClone(this.after[0]!));
    for (let i = 1; i < this.after.length; i += 1) {
      next = addEntity(next, structuredClone(this.after[i]!));
    }
    if (this.roomBefore.length || this.roomAfter.length || this.brokenRoomIds.length) {
      next = applyRoomRefresh(next, this.roomAfter, this.brokenRoomIds);
    }
    return next;
  }

  undo(doc: DrawingDocument): DrawingDocument {
    let next = doc;
    if (this.roomBefore.length || this.brokenRoomIds.length) {
      next = restoreRooms(next, this.roomBefore, this.brokenRoomIds);
    }
    next = removeEntities(next, this.addedIds);
    next = replaceEntity(next, structuredClone(this.before));
    return next;
  }
}

export class ExtendEntityCommand implements Command {
  readonly name = 'ExtendEntity';
  private readonly replace: ReplaceEntityCommand;

  constructor(
    target: Entity,
    boundaryOrBoundaries: Entity | Entity[],
    pickPoint: Vec2,
    options?: { edgeMode?: 'extend' | 'no-extend' },
  ) {
    const boundaries = Array.isArray(boundaryOrBoundaries)
      ? boundaryOrBoundaries
      : [boundaryOrBoundaries];
    const result = extendEntityMulti(target, boundaries, pickPoint, {
      edgeMode: options?.edgeMode ?? 'extend',
    });
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
    const selectedIds = new Set(entities.map((e) => e.id));
    const wallIdMap = new Map<EntityId, EntityId>();

    for (const entity of entities) {
      if (entity.type === 'door' || entity.type === 'window') continue;
      if (entity.type === 'room') {
        throw new Error(
          'Cannot mirror rooms directly — mirror boundary walls and recreate the room',
        );
      }
      const id = createEntityId(prefixFor(entity.type));
      const mirrored = mirrorEntity(entity, axisA, axisB, id);
      if (!mirrored) {
        throw new Error(`Cannot mirror entity ${entity.id}`);
      }
      if (entity.type === 'wall') {
        wallIdMap.set(entity.id, id);
      }
      this.created.push(mirrored);
    }

    for (const entity of entities) {
      if (entity.type !== 'door' && entity.type !== 'window') continue;
      if (!selectedIds.has(entity.geometry.hostWallId)) {
        throw new Error(
          `Cannot mirror ${entity.type} without its host wall — select the wall too`,
        );
      }
      const newHost = wallIdMap.get(entity.geometry.hostWallId);
      if (!newHost) {
        throw new Error(`Cannot mirror ${entity.type}: host wall failed`);
      }
      const id = createEntityId(prefixFor(entity.type));
      // Flip swing for doors when mirrored
      const copy: Entity =
        entity.type === 'door'
          ? {
              ...structuredClone(entity),
              id,
              geometry: {
                ...entity.geometry,
                hostWallId: newHost,
                swing:
                  entity.geometry.swing === 'left'
                    ? ('right' as const)
                    : ('left' as const),
              },
            }
          : {
              ...structuredClone(entity),
              id,
              geometry: { ...entity.geometry, hostWallId: newHost },
            };
      if (!validateEntityGeometry(copy)) {
        throw new Error(`Cannot mirror ${entity.type}`);
      }
      this.created.push(copy);
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
  private roomsBefore: RoomEntity[] = [];
  private roomsAfter: RoomEntity[] = [];
  private brokenRoomIds: EntityId[] = [];

  constructor(
    entities: Entity[],
    origin: Vec2,
    radians: number,
    contextEntities: Entity[] = entities,
  ) {
    if (!Number.isFinite(radians)) {
      throw new Error('Invalid rotation angle');
    }
    const selectedIds = new Set(entities.map((e) => e.id));
    for (const entity of entities) {
      if (entity.type === 'door' || entity.type === 'window') {
        if (selectedIds.has(entity.geometry.hostWallId)) {
          // Host wall rotation keeps parametric attachment — no door record change
          continue;
        }
        throw new Error(
          `Cannot rotate ${entity.type} without its host wall — select the wall too`,
        );
      }
      if (entity.type === 'room') {
        // Rooms recalculate from walls; skip standalone room rotate if walls also selected
        if (entity.geometry.wallIds.some((id) => selectedIds.has(id))) {
          continue;
        }
        throw new Error(
          'Cannot rotate room without its boundary walls — select the walls too',
        );
      }
      const rotated = rotateEntity(entity, origin, radians);
      if (!rotated) {
        throw new Error(`Cannot rotate entity ${entity.id}`);
      }
      this.before.push(structuredClone(entity));
      this.after.push(rotated);
    }

    const wallIds = this.after
      .filter((e): e is WallEntity => e.type === 'wall')
      .map((w) => w.id);
    if (wallIds.length > 0) {
      const afterById = new Map(this.after.map((e) => [e.id, e]));
      const entitiesAfter = contextEntities.map((e) => afterById.get(e.id) ?? e);
      const plan = planRoomRefresh(contextEntities, entitiesAfter, wallIds);
      this.roomsBefore = plan.roomsBefore;
      this.roomsAfter = plan.roomsAfter;
      this.brokenRoomIds = plan.brokenIds;
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
    return applyRoomRefresh(next, this.roomsAfter, this.brokenRoomIds);
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
    return restoreRooms(next, this.roomsBefore, this.brokenRoomIds);
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
      if (
        entity.type === 'wall' ||
        entity.type === 'door' ||
        entity.type === 'window' ||
        entity.type === 'room'
      ) {
        throw new Error(
          `Scale is disabled for ${entity.type} — construction sizes must be edited explicitly`,
        );
      }
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

/**
 * Fillet: one transactional undo unit for replacements + created arc.
 * Built from a pre-validated FilletComputeResult (FilletEngine).
 */
export class FilletEntitiesCommand implements Command {
  readonly name = 'FilletEntities';
  private readonly beforeById = new Map<EntityId, Entity>();
  private readonly replacements: Entity[];
  private readonly created: Entity[];
  private readonly createdIds: EntityId[] = [];

  constructor(result: FilletComputeResult, documentEntities: Entity[]) {
    if (!result.ok) throw new Error(result.reason);
    if (!validateFilletResult(result)) {
      throw new Error('Fillet produced invalid geometry');
    }
    const byId = new Map(documentEntities.map((e) => [e.id, e]));
    this.replacements = result.replacements.map((e) => {
      const prev = byId.get(e.id);
      if (prev) this.beforeById.set(e.id, structuredClone(prev));
      const kept = structuredClone(e);
      if (!validateEntityGeometry(kept)) {
        throw new Error('Fillet replacement invalid');
      }
      return kept;
    });
    this.created = result.created.map((e) => {
      const id = e.id.includes('#fillet') || e.id.startsWith('fillet')
        ? e.id
        : createEntityId('fillet');
      this.createdIds.push(id);
      const created = { ...structuredClone(e), id };
      if (!validateEntityGeometry(created)) {
        throw new Error('Fillet arc invalid');
      }
      return created;
    });
  }

  getCreatedIds(): EntityId[] {
    return [...this.createdIds];
  }

  execute(doc: DrawingDocument): DrawingDocument {
    let next = doc;
    for (const entity of this.replacements) {
      if (getEntity(next, entity.id)) {
        next = replaceEntity(next, structuredClone(entity));
      } else {
        next = addEntity(next, structuredClone(entity));
      }
    }
    for (const entity of this.created) {
      if (!getEntity(next, entity.id)) {
        next = addEntity(next, structuredClone(entity));
      }
    }
    return next;
  }

  undo(doc: DrawingDocument): DrawingDocument {
    let next = removeEntities(doc, this.createdIds);
    for (const [id, before] of this.beforeById) {
      if (getEntity(next, id)) {
        next = replaceEntity(next, structuredClone(before));
      } else {
        next = addEntity(next, structuredClone(before));
      }
    }
    return next;
  }
}

