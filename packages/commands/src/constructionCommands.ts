import {
  DOORS_LAYER_ID,
  WALLS_LAYER_ID,
  WINDOWS_LAYER_ID,
  addEntity,
  createEntityId,
  getCurrentLayer,
  getEntity,
  getHostedByWall,
  getWall,
  removeEntities,
  type DoorEntity,
  type DoorSwing,
  type DrawingDocument,
  type EntityId,
  type LayerId,
  type Vec2,
  type WallEntity,
  type WallJustification,
  type WindowEntity,
} from '@ratecad/core';
import {
  clampHostedPosition,
  validateDoorGeometry,
  validateWallGeometry,
  validateWindowGeometry,
  wallLength,
} from '@ratecad/geometry';
import type { Command } from './bus.js';
import { ReplaceEntityCommand } from './modifyCommands.js';

export class CreateWallCommand implements Command {
  readonly name = 'CreateWall';
  private readonly entity: WallEntity;
  private readonly layerId?: LayerId;

  constructor(
    start: Vec2,
    end: Vec2,
    thickness: number,
    height: number,
    justification: WallJustification = 'center',
    layerId?: LayerId,
    entityId?: EntityId,
    material = 'Generic',
  ) {
    this.layerId = layerId;
    this.entity = {
      id: entityId ?? createEntityId('wall'),
      type: 'wall',
      layerId: layerId ?? WALLS_LAYER_ID,
      visible: true,
      locked: false,
      geometry: {
        start: { ...start },
        end: { ...end },
        thickness,
        height,
        justification,
      },
      properties: { material, wallType: 'standard' },
    };
    if (!validateWallGeometry(this.entity)) {
      throw new Error('Invalid wall geometry');
    }
  }

  getEntityId(): EntityId {
    return this.entity.id;
  }

  execute(doc: DrawingDocument): DrawingDocument {
    const layerId =
      this.layerId ??
      (doc.layers.some((l) => l.id === WALLS_LAYER_ID)
        ? WALLS_LAYER_ID
        : getCurrentLayer(doc).id);
    return addEntity(doc, { ...structuredClone(this.entity), layerId });
  }

  undo(doc: DrawingDocument): DrawingDocument {
    return removeEntities(doc, [this.entity.id]);
  }
}

export class UpdateWallCommand implements Command {
  readonly name = 'UpdateWall';
  private readonly replace: ReplaceEntityCommand;

  constructor(
    before: WallEntity,
    patch: Partial<WallEntity['geometry']> & {
      material?: string;
      wallType?: string;
    },
  ) {
    const after: WallEntity = {
      ...before,
      geometry: { ...before.geometry, ...patch },
      properties: {
        ...before.properties,
        ...(patch.material !== undefined ? { material: patch.material } : {}),
        ...(patch.wallType !== undefined ? { wallType: patch.wallType } : {}),
      },
    };
    if (!validateWallGeometry(after)) {
      throw new Error('Invalid wall update');
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

/**
 * Delete wall and cascade-delete hosted doors/windows.
 * Safer than leaving orphans. Undo restores the wall and all hosted objects.
 */
export class DeleteWallCommand implements Command {
  readonly name = 'DeleteWall';
  private removed: DrawingDocument['entities'] = [];
  private previousSelection: EntityId[] = [];

  constructor(private readonly wallId: EntityId) {}

  execute(doc: DrawingDocument): DrawingDocument {
    const wall = getWall(doc, this.wallId);
    if (!wall) return doc;
    const hosted = getHostedByWall(doc, this.wallId);
    this.removed = [wall, ...hosted].map((e) => structuredClone(e));
    this.previousSelection = [...doc.selection];
    return removeEntities(doc, this.removed.map((e) => e.id));
  }

  undo(doc: DrawingDocument): DrawingDocument {
    let next = doc;
    for (const entity of this.removed) {
      if (!getEntity(next, entity.id)) {
        next = addEntity(next, structuredClone(entity));
      }
    }
    return {
      ...next,
      selection: [...this.previousSelection],
    };
  }
}

export class CreateDoorCommand implements Command {
  readonly name = 'CreateDoor';
  private readonly entity: DoorEntity;
  private readonly layerId?: LayerId;

  constructor(
    hostWallId: EntityId,
    position: number,
    width: number,
    height: number,
    swing: DoorSwing = 'left',
    swingAngle = Math.PI / 2,
    layerId?: LayerId,
    entityId?: EntityId,
  ) {
    this.layerId = layerId;
    this.entity = {
      id: entityId ?? createEntityId('door'),
      type: 'door',
      layerId: layerId ?? DOORS_LAYER_ID,
      visible: true,
      locked: false,
      geometry: {
        hostWallId,
        position,
        width,
        height,
        swing,
        swingAngle,
      },
      properties: { doorType: 'swing' },
    };
    if (!validateDoorGeometry(this.entity)) {
      throw new Error('Invalid door geometry');
    }
  }

  getEntityId(): EntityId {
    return this.entity.id;
  }

  execute(doc: DrawingDocument): DrawingDocument {
    const wall = getWall(doc, this.entity.geometry.hostWallId);
    if (!wall) throw new Error('Host wall not found');
    const len = wallLength(wall);
    if (this.entity.geometry.width >= len - 1e-6) {
      throw new Error('Door wider than host wall');
    }
    const position = clampHostedPosition(
      len,
      this.entity.geometry.width,
      this.entity.geometry.position,
    );
    const layerId =
      this.layerId ??
      (doc.layers.some((l) => l.id === DOORS_LAYER_ID)
        ? DOORS_LAYER_ID
        : getCurrentLayer(doc).id);
    return addEntity(doc, {
      ...structuredClone(this.entity),
      layerId,
      geometry: { ...this.entity.geometry, position },
    });
  }

  undo(doc: DrawingDocument): DrawingDocument {
    return removeEntities(doc, [this.entity.id]);
  }
}

export class UpdateDoorCommand implements Command {
  readonly name = 'UpdateDoor';
  private readonly replace: ReplaceEntityCommand;

  constructor(
    before: DoorEntity,
    patch: Partial<DoorEntity['geometry']> & { doorType?: string },
  ) {
    const after: DoorEntity = {
      ...before,
      geometry: { ...before.geometry, ...patch },
      properties: {
        ...before.properties,
        ...(patch.doorType !== undefined ? { doorType: patch.doorType } : {}),
      },
    };
    if (!validateDoorGeometry(after)) {
      throw new Error('Invalid door update');
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

export class CreateWindowCommand implements Command {
  readonly name = 'CreateWindow';
  private readonly entity: WindowEntity;
  private readonly layerId?: LayerId;

  constructor(
    hostWallId: EntityId,
    position: number,
    width: number,
    height: number,
    sillHeight: number,
    layerId?: LayerId,
    entityId?: EntityId,
  ) {
    this.layerId = layerId;
    this.entity = {
      id: entityId ?? createEntityId('window'),
      type: 'window',
      layerId: layerId ?? WINDOWS_LAYER_ID,
      visible: true,
      locked: false,
      geometry: {
        hostWallId,
        position,
        width,
        height,
        sillHeight,
      },
      properties: { windowType: 'fixed' },
    };
    if (!validateWindowGeometry(this.entity)) {
      throw new Error('Invalid window geometry');
    }
  }

  getEntityId(): EntityId {
    return this.entity.id;
  }

  execute(doc: DrawingDocument): DrawingDocument {
    const wall = getWall(doc, this.entity.geometry.hostWallId);
    if (!wall) throw new Error('Host wall not found');
    const len = wallLength(wall);
    if (this.entity.geometry.width >= len - 1e-6) {
      throw new Error('Window wider than host wall');
    }
    const position = clampHostedPosition(
      len,
      this.entity.geometry.width,
      this.entity.geometry.position,
    );
    const layerId =
      this.layerId ??
      (doc.layers.some((l) => l.id === WINDOWS_LAYER_ID)
        ? WINDOWS_LAYER_ID
        : getCurrentLayer(doc).id);
    return addEntity(doc, {
      ...structuredClone(this.entity),
      layerId,
      geometry: { ...this.entity.geometry, position },
    });
  }

  undo(doc: DrawingDocument): DrawingDocument {
    return removeEntities(doc, [this.entity.id]);
  }
}

export class UpdateWindowCommand implements Command {
  readonly name = 'UpdateWindow';
  private readonly replace: ReplaceEntityCommand;

  constructor(
    before: WindowEntity,
    patch: Partial<WindowEntity['geometry']> & { windowType?: string },
  ) {
    const after: WindowEntity = {
      ...before,
      geometry: { ...before.geometry, ...patch },
      properties: {
        ...before.properties,
        ...(patch.windowType !== undefined
          ? { windowType: patch.windowType }
          : {}),
      },
    };
    if (!validateWindowGeometry(after)) {
      throw new Error('Invalid window update');
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
