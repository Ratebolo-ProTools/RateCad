import {
  addEntity,
  addLayer,
  createEntityId,
  createLayerId,
  DEFAULT_LAYER_ID,
  getCurrentLayer,
  removeEntities,
  removeLayer,
  replaceEntity,
  setCurrentLayer,
  updateLayer,
  type DimensionEntity,
  type DimensionKind,
  type DrawingDocument,
  type EntityId,
  type Layer,
  type LayerId,
  type LeaderEntity,
  type TextEntity,
  type Vec2,
} from '@ratecad/core';
import { offsetFromPlacement, validateEntityGeometry } from '@ratecad/geometry';
import type { Command } from './bus.js';
import { ReplaceEntityCommand } from './modifyCommands.js';

export class CreateDimensionCommand implements Command {
  readonly name = 'CreateDimension';
  private readonly entity: DimensionEntity;

  private readonly layerId?: LayerId;

  constructor(
    kind: DimensionKind,
    start: Vec2,
    end: Vec2,
    offset: number,
    layerId?: LayerId,
    entityId?: EntityId,
  ) {
    this.layerId = layerId;
    this.entity = {
      id: entityId ?? createEntityId('dim'),
      type: 'dimension',
      layerId: layerId ?? DEFAULT_LAYER_ID,
      visible: true,
      locked: false,
      geometry: {
        kind,
        start: { ...start },
        end: { ...end },
        offset,
      },
      properties: {},
    };
    if (!validateEntityGeometry(this.entity)) {
      throw new Error('Invalid dimension geometry');
    }
  }

  getEntityId(): EntityId {
    return this.entity.id;
  }

  execute(doc: DrawingDocument): DrawingDocument {
    const layerId = this.layerId ?? getCurrentLayer(doc).id;
    return addEntity(doc, { ...structuredClone(this.entity), layerId });
  }

  undo(doc: DrawingDocument): DrawingDocument {
    return removeEntities(doc, [this.entity.id]);
  }
}

export class UpdateDimensionOffsetCommand implements Command {
  readonly name = 'UpdateDimensionOffset';
  private readonly replace: ReplaceEntityCommand;

  constructor(before: DimensionEntity, place: Vec2) {
    const offset = offsetFromPlacement(
      before.geometry.start,
      before.geometry.end,
      before.geometry.kind,
      place,
    );
    const after: DimensionEntity = {
      ...before,
      geometry: { ...before.geometry, offset },
    };
    if (!validateEntityGeometry(after)) {
      throw new Error('Invalid dimension offset');
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

export class CreateTextCommand implements Command {
  readonly name = 'CreateText';
  private readonly entity: TextEntity;
  private readonly layerId?: LayerId;

  constructor(
    position: Vec2,
    content: string,
    height: number,
    rotation = 0,
    layerId?: LayerId,
    entityId?: EntityId,
  ) {
    const trimmed = content.trim();
    if (!trimmed) throw new Error('Text content required');
    this.layerId = layerId;
    this.entity = {
      id: entityId ?? createEntityId('text'),
      type: 'text',
      layerId: layerId ?? DEFAULT_LAYER_ID,
      visible: true,
      locked: false,
      geometry: {
        position: { ...position },
        content: trimmed,
        height,
        rotation,
      },
      properties: {},
    };
    if (!validateEntityGeometry(this.entity)) {
      throw new Error('Invalid text geometry');
    }
  }

  getEntityId(): EntityId {
    return this.entity.id;
  }

  execute(doc: DrawingDocument): DrawingDocument {
    const layerId = this.layerId ?? getCurrentLayer(doc).id;
    return addEntity(doc, { ...structuredClone(this.entity), layerId });
  }

  undo(doc: DrawingDocument): DrawingDocument {
    return removeEntities(doc, [this.entity.id]);
  }
}

export class UpdateTextCommand implements Command {
  readonly name = 'UpdateText';
  private readonly replace: ReplaceEntityCommand;

  constructor(
    before: TextEntity,
    patch: Partial<TextEntity['geometry']> & { content?: string },
  ) {
    const after: TextEntity = {
      ...before,
      geometry: {
        ...before.geometry,
        ...patch,
        content: patch.content?.trim() ?? before.geometry.content,
      },
    };
    if (!validateEntityGeometry(after)) {
      throw new Error('Invalid text update');
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

export class CreateLeaderCommand implements Command {
  readonly name = 'CreateLeader';
  private readonly entity: LeaderEntity;
  private readonly layerId?: LayerId;

  constructor(
    arrow: Vec2,
    vertices: Vec2[],
    content: string,
    textHeight: number,
    layerId?: LayerId,
    entityId?: EntityId,
  ) {
    if (vertices.length < 1) throw new Error('Leader needs a landing point');
    const trimmed = content.trim();
    if (!trimmed) throw new Error('Leader text required');
    this.layerId = layerId;
    this.entity = {
      id: entityId ?? createEntityId('leader'),
      type: 'leader',
      layerId: layerId ?? DEFAULT_LAYER_ID,
      visible: true,
      locked: false,
      geometry: {
        arrow: { ...arrow },
        vertices: vertices.map((v) => ({ ...v })),
        content: trimmed,
        textHeight,
      },
      properties: {},
    };
    if (!validateEntityGeometry(this.entity)) {
      throw new Error('Invalid leader geometry');
    }
  }

  getEntityId(): EntityId {
    return this.entity.id;
  }

  execute(doc: DrawingDocument): DrawingDocument {
    const layerId = this.layerId ?? getCurrentLayer(doc).id;
    return addEntity(doc, { ...structuredClone(this.entity), layerId });
  }

  undo(doc: DrawingDocument): DrawingDocument {
    return removeEntities(doc, [this.entity.id]);
  }
}

export class CreateLayerCommand implements Command {
  readonly name = 'CreateLayer';
  private readonly layer: Layer;

  constructor(name: string, color = '#c8ced6', id?: LayerId) {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Layer name required');
    this.layer = {
      id: id ?? createLayerId('layer'),
      name: trimmed,
      color,
      visible: true,
      locked: false,
    };
  }

  getLayerId(): LayerId {
    return this.layer.id;
  }

  execute(doc: DrawingDocument): DrawingDocument {
    return addLayer(doc, structuredClone(this.layer));
  }

  undo(doc: DrawingDocument): DrawingDocument {
    return {
      ...doc,
      layers: doc.layers.filter((l) => l.id !== this.layer.id),
      currentLayerId:
        doc.currentLayerId === this.layer.id
          ? DEFAULT_LAYER_ID
          : doc.currentLayerId,
    };
  }
}

export class UpdateLayerCommand implements Command {
  readonly name = 'UpdateLayer';
  private readonly layerId: LayerId;
  private readonly before: Partial<Omit<Layer, 'id'>>;
  private readonly after: Partial<Omit<Layer, 'id'>>;

  constructor(layerId: LayerId, before: Layer, patch: Partial<Omit<Layer, 'id'>>) {
    this.layerId = layerId;
    this.before = {
      name: before.name,
      color: before.color,
      visible: before.visible,
      locked: before.locked,
    };
    this.after = { ...this.before, ...patch };
  }

  execute(doc: DrawingDocument): DrawingDocument {
    return updateLayer(doc, this.layerId, this.after);
  }

  undo(doc: DrawingDocument): DrawingDocument {
    return updateLayer(doc, this.layerId, this.before);
  }
}

export class SetCurrentLayerCommand implements Command {
  readonly name = 'SetCurrentLayer';
  private readonly previous: LayerId;
  private readonly next: LayerId;

  constructor(previous: LayerId, next: LayerId) {
    this.previous = previous;
    this.next = next;
  }

  execute(doc: DrawingDocument): DrawingDocument {
    return setCurrentLayer(doc, this.next);
  }

  undo(doc: DrawingDocument): DrawingDocument {
    return setCurrentLayer(doc, this.previous);
  }
}

export class DeleteLayerCommand implements Command {
  readonly name = 'DeleteLayer';
  private before: DrawingDocument | null = null;

  constructor(
    private readonly layerId: LayerId,
    private readonly moveToLayerId: LayerId = DEFAULT_LAYER_ID,
  ) {}

  execute(doc: DrawingDocument): DrawingDocument {
    this.before = structuredClone(doc);
    return removeLayer(doc, this.layerId, this.moveToLayerId);
  }

  undo(doc: DrawingDocument): DrawingDocument {
    if (!this.before) return doc;
    return structuredClone(this.before);
  }
}

export class SetEntityLayerCommand implements Command {
  readonly name = 'SetEntityLayer';
  private readonly replace: ReplaceEntityCommand;

  constructor(entity: DrawingDocument['entities'][number], layerId: LayerId) {
    this.replace = new ReplaceEntityCommand(entity, { ...entity, layerId });
  }

  execute(doc: DrawingDocument): DrawingDocument {
    return this.replace.execute(doc);
  }

  undo(doc: DrawingDocument): DrawingDocument {
    return this.replace.undo(doc);
  }
}

// silence unused
void replaceEntity;
