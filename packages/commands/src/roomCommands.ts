import {
  ROOMS_LAYER_ID,
  addEntity,
  createEntityId,
  getCurrentLayer,
  removeEntities,
  type DrawingDocument,
  type EntityId,
  type LayerId,
  type RoomEntity,
  type Vec2,
  type WallDir,
} from '@ratecad/core';
import {
  polygonCentroid,
  validateRoomGeometry,
} from '@ratecad/geometry';
import type { Command } from './bus.js';
import { ReplaceEntityCommand } from './modifyCommands.js';

export class CreateRoomCommand implements Command {
  readonly name = 'CreateRoom';
  private readonly entity: RoomEntity;
  private readonly layerId?: LayerId;

  constructor(
    wallIds: EntityId[],
    wallDirs: WallDir[],
    polygon: Vec2[],
    area: number,
    name: string,
    roomType = 'general',
    labelPosition?: Vec2,
    layerId?: LayerId,
    entityId?: EntityId,
  ) {
    this.layerId = layerId;
    const label = labelPosition ?? polygonCentroid(polygon);
    this.entity = {
      id: entityId ?? createEntityId('room'),
      type: 'room',
      layerId: layerId ?? ROOMS_LAYER_ID,
      visible: true,
      locked: false,
      geometry: {
        wallIds: [...wallIds],
        wallDirs: [...wallDirs],
        polygon: polygon.map((p) => ({ ...p })),
        labelPosition: { ...label },
        area,
      },
      properties: {
        name: name.trim() || 'Room',
        roomType,
      },
    };
    if (!validateRoomGeometry(this.entity)) {
      throw new Error('Invalid room geometry');
    }
  }

  getEntityId(): EntityId {
    return this.entity.id;
  }

  execute(doc: DrawingDocument): DrawingDocument {
    const layerId =
      this.layerId ??
      (doc.layers.some((l) => l.id === ROOMS_LAYER_ID)
        ? ROOMS_LAYER_ID
        : getCurrentLayer(doc).id);
    return addEntity(doc, { ...structuredClone(this.entity), layerId });
  }

  undo(doc: DrawingDocument): DrawingDocument {
    return removeEntities(doc, [this.entity.id]);
  }
}

export class UpdateRoomCommand implements Command {
  readonly name = 'UpdateRoom';
  private readonly replace: ReplaceEntityCommand;

  constructor(
    before: RoomEntity,
    patch: {
      name?: string;
      roomType?: string;
      labelPosition?: Vec2;
      wallIds?: EntityId[];
      wallDirs?: WallDir[];
      polygon?: Vec2[];
      area?: number;
    },
  ) {
    const after: RoomEntity = {
      ...before,
      geometry: {
        ...before.geometry,
        ...(patch.labelPosition
          ? { labelPosition: { ...patch.labelPosition } }
          : {}),
        ...(patch.wallIds ? { wallIds: [...patch.wallIds] } : {}),
        ...(patch.wallDirs ? { wallDirs: [...patch.wallDirs] } : {}),
        ...(patch.polygon
          ? { polygon: patch.polygon.map((p) => ({ ...p })) }
          : {}),
        ...(patch.area !== undefined ? { area: patch.area } : {}),
      },
      properties: {
        ...before.properties,
        ...(patch.name !== undefined ? { name: patch.name.trim() || before.properties.name } : {}),
        ...(patch.roomType !== undefined ? { roomType: patch.roomType } : {}),
      },
    };
    if (!validateRoomGeometry(after)) {
      throw new Error('Invalid room update');
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

export class DeleteRoomCommand implements Command {
  readonly name = 'DeleteRoom';
  private readonly entity: RoomEntity;

  constructor(entity: RoomEntity) {
    this.entity = structuredClone(entity);
  }

  execute(doc: DrawingDocument): DrawingDocument {
    return removeEntities(doc, [this.entity.id]);
  }

  undo(doc: DrawingDocument): DrawingDocument {
    return addEntity(doc, structuredClone(this.entity));
  }
}

/**
 * After wall edits, replace affected rooms with recalculated geometry.
 * Broken rooms (open loop) are removed — undo restores prior room state.
 */
export class RefreshRoomsCommand implements Command {
  readonly name = 'RefreshRooms';

  constructor(
    private readonly before: RoomEntity[],
    private readonly after: RoomEntity[],
    private readonly removedIds: EntityId[],
  ) {}

  execute(doc: DrawingDocument): DrawingDocument {
    let next = doc;
    for (const room of this.after) {
      next = next.entities.some((e) => e.id === room.id)
        ? {
            ...next,
            entities: next.entities.map((e) =>
              e.id === room.id ? structuredClone(room) : e,
            ),
          }
        : addEntity(next, structuredClone(room));
    }
    if (this.removedIds.length > 0) {
      next = removeEntities(next, this.removedIds);
    }
    return next;
  }

  undo(doc: DrawingDocument): DrawingDocument {
    let next = doc;
    // Restore removed
    for (const room of this.before) {
      if (this.removedIds.includes(room.id)) {
        next = addEntity(next, structuredClone(room));
      }
    }
    // Restore previous versions of updated
    for (const room of this.before) {
      if (!this.removedIds.includes(room.id)) {
        next = {
          ...next,
          entities: next.entities.map((e) =>
            e.id === room.id ? structuredClone(room) : e,
          ),
        };
      }
    }
    // Remove rooms that were only in after (shouldn't happen)
    return next;
  }
}
