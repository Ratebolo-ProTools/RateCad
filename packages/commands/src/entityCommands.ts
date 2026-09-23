import {
  addEntity,
  createEntityId,
  expandDeleteIds,
  getCurrentLayer,
  removeEntities,
  type CircleEntity,
  type DrawingDocument,
  type EntityId,
  type LayerId,
  type LineEntity,
  type PolylineEntity,
  type RectangleEntity,
  type Vec2,
} from '@ratecad/core';
import { appearanceForNewEntity } from '@ratecad/geometry';
import type { Command } from './bus.js';

export class CreateLineCommand implements Command {
  readonly name = 'CreateLine';
  private readonly entityId: EntityId;

  constructor(
    private readonly start: Vec2,
    private readonly end: Vec2,
    entityId?: EntityId,
    private readonly layerId?: LayerId,
  ) {
    this.entityId = entityId ?? createEntityId('line');
  }

  getEntityId(): EntityId {
    return this.entityId;
  }

  execute(doc: DrawingDocument): DrawingDocument {
    const entity: LineEntity = {
      id: this.entityId,
      type: 'line',
      layerId: this.layerId ?? getCurrentLayer(doc).id,
      visible: true,
      locked: false,
      geometry: {
        start: { ...this.start },
        end: { ...this.end },
      },
      properties: appearanceForNewEntity(doc),
    };
    return addEntity(doc, entity);
  }

  undo(doc: DrawingDocument): DrawingDocument {
    return removeEntities(doc, [this.entityId]);
  }
}

export class CreateRectangleCommand implements Command {
  readonly name = 'CreateRectangle';
  private readonly entityId: EntityId;

  constructor(
    private readonly corner1: Vec2,
    private readonly corner2: Vec2,
    entityId?: EntityId,
    private readonly layerId?: LayerId,
  ) {
    this.entityId = entityId ?? createEntityId('rect');
  }

  getEntityId(): EntityId {
    return this.entityId;
  }

  execute(doc: DrawingDocument): DrawingDocument {
    const entity: RectangleEntity = {
      id: this.entityId,
      type: 'rectangle',
      layerId: this.layerId ?? getCurrentLayer(doc).id,
      visible: true,
      locked: false,
      geometry: {
        corner1: { ...this.corner1 },
        corner2: { ...this.corner2 },
      },
      properties: appearanceForNewEntity(doc),
    };
    return addEntity(doc, entity);
  }

  undo(doc: DrawingDocument): DrawingDocument {
    return removeEntities(doc, [this.entityId]);
  }
}

export class CreateCircleCommand implements Command {
  readonly name = 'CreateCircle';
  private readonly entityId: EntityId;

  constructor(
    private readonly center: Vec2,
    private readonly radius: number,
    entityId?: EntityId,
    private readonly layerId?: LayerId,
  ) {
    this.entityId = entityId ?? createEntityId('circle');
  }

  getEntityId(): EntityId {
    return this.entityId;
  }

  execute(doc: DrawingDocument): DrawingDocument {
    const entity: CircleEntity = {
      id: this.entityId,
      type: 'circle',
      layerId: this.layerId ?? getCurrentLayer(doc).id,
      visible: true,
      locked: false,
      geometry: {
        center: { ...this.center },
        radius: this.radius,
      },
      properties: appearanceForNewEntity(doc),
    };
    return addEntity(doc, entity);
  }

  undo(doc: DrawingDocument): DrawingDocument {
    return removeEntities(doc, [this.entityId]);
  }
}

export class CreatePolylineCommand implements Command {
  readonly name = 'CreatePolyline';
  private readonly entityId: EntityId;
  private readonly vertices: Vec2[];

  constructor(
    vertices: Vec2[],
    entityId?: EntityId,
    private readonly closed = false,
    private readonly layerId?: LayerId,
  ) {
    if (vertices.length < 2) {
      throw new Error('Polyline requires at least 2 vertices');
    }
    this.vertices = vertices.map((v) => ({ ...v }));
    this.entityId = entityId ?? createEntityId('pline');
  }

  getEntityId(): EntityId {
    return this.entityId;
  }

  execute(doc: DrawingDocument): DrawingDocument {
    const entity: PolylineEntity = {
      id: this.entityId,
      type: 'polyline',
      layerId: this.layerId ?? getCurrentLayer(doc).id,
      visible: true,
      locked: false,
      geometry: {
        vertices: this.vertices.map((v) => ({ ...v })),
        closed: this.closed,
      },
      properties: appearanceForNewEntity(doc),
    };
    return addEntity(doc, entity);
  }

  undo(doc: DrawingDocument): DrawingDocument {
    return removeEntities(doc, [this.entityId]);
  }
}

export class DeleteEntitiesCommand implements Command {
  readonly name = 'DeleteEntities';
  private removed: DrawingDocument['entities'] = [];
  private previousSelection: EntityId[] = [];

  constructor(private readonly ids: EntityId[]) {}

  execute(doc: DrawingDocument): DrawingDocument {
    // Cascade: deleting a wall also removes hosted doors/windows
    const expanded = expandDeleteIds(doc, this.ids);
    const idSet = new Set(expanded);
    this.removed = doc.entities.filter((e) => idSet.has(e.id));
    this.previousSelection = [...doc.selection];
    return removeEntities(doc, expanded);
  }

  undo(doc: DrawingDocument): DrawingDocument {
    return {
      ...doc,
      entities: [...doc.entities, ...this.removed.map((e) => structuredClone(e))],
      selection: [...this.previousSelection],
      meta: {
        ...doc.meta,
        updatedAt: new Date().toISOString(),
      },
    };
  }
}
