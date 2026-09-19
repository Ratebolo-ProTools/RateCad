import {
  addEntity,
  createEntityId,
  DEFAULT_LAYER_ID,
  removeEntities,
  type CircleEntity,
  type DrawingDocument,
  type EntityId,
  type LineEntity,
  type RectangleEntity,
  type Vec2,
} from '@ratecad/core';
import type { Command } from './bus.js';

export class CreateLineCommand implements Command {
  readonly name = 'CreateLine';
  private readonly entityId: EntityId;

  constructor(
    private readonly start: Vec2,
    private readonly end: Vec2,
    entityId?: EntityId,
    private readonly layerId = DEFAULT_LAYER_ID,
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
      layerId: this.layerId,
      visible: true,
      locked: false,
      geometry: {
        start: { ...this.start },
        end: { ...this.end },
      },
      properties: {},
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
    private readonly layerId = DEFAULT_LAYER_ID,
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
      layerId: this.layerId,
      visible: true,
      locked: false,
      geometry: {
        corner1: { ...this.corner1 },
        corner2: { ...this.corner2 },
      },
      properties: {},
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
    private readonly layerId = DEFAULT_LAYER_ID,
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
      layerId: this.layerId,
      visible: true,
      locked: false,
      geometry: {
        center: { ...this.center },
        radius: this.radius,
      },
      properties: {},
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
    const idSet = new Set(this.ids);
    this.removed = doc.entities.filter((e) => idSet.has(e.id));
    this.previousSelection = [...doc.selection];
    return removeEntities(doc, this.ids);
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
