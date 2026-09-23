import {
  getEntity,
  replaceEntity,
  type CurrentAppearance,
  type DrawingDocument,
  type Entity,
  type EntityId,
} from '@ratecad/core';
import {
  applyAppearancePatch,
  applyGeometryPropertyEdit,
  canEditEntityProperties,
  matchPropPatch,
  setByLayerPatch,
  type AppearancePatch,
} from '@ratecad/geometry';
import type { Command } from './bus.js';

/**
 * Apply the same appearance patch to one or more entities (one undo step).
 */
export class ChangeEntitiesAppearanceCommand implements Command {
  readonly name = 'ChangeEntitiesAppearance';
  private readonly before = new Map<EntityId, Entity>();

  constructor(
    private readonly entityIds: EntityId[],
    private readonly patch: AppearancePatch,
  ) {}

  execute(doc: DrawingDocument): DrawingDocument {
    this.before.clear();
    let next = doc;
    for (const id of this.entityIds) {
      const ent = getEntity(next, id);
      if (!ent) continue;
      if (!canEditEntityProperties(ent, next)) continue;
      this.before.set(id, structuredClone(ent));
      const updated = applyAppearancePatch(ent, this.patch);
      next = replaceEntity(next, updated);
    }
    return next;
  }

  undo(doc: DrawingDocument): DrawingDocument {
    let next = doc;
    for (const [id, ent] of this.before) {
      void id;
      next = replaceEntity(next, structuredClone(ent));
    }
    return next;
  }
}

export class SetByLayerCommand implements Command {
  readonly name = 'SetByLayer';
  private readonly inner: ChangeEntitiesAppearanceCommand;

  constructor(
    entityIds: EntityId[],
    keys: Array<'color' | 'linetype' | 'lineweight' | 'transparency'> = [
      'color',
      'linetype',
      'lineweight',
      'transparency',
    ],
  ) {
    this.inner = new ChangeEntitiesAppearanceCommand(
      entityIds,
      setByLayerPatch(keys),
    );
  }

  execute(doc: DrawingDocument): DrawingDocument {
    return this.inner.execute(doc);
  }

  undo(doc: DrawingDocument): DrawingDocument {
    return this.inner.undo(doc);
  }
}

export class MatchPropertiesCommand implements Command {
  readonly name = 'MatchProperties';
  private before = new Map<EntityId, Entity>();

  constructor(
    private readonly sourceId: EntityId,
    private readonly destIds: EntityId[],
    private readonly keys?: Array<
      | 'layer'
      | 'color'
      | 'linetype'
      | 'linetypeScale'
      | 'lineweight'
      | 'transparency'
    >,
    private readonly sourceSnapshot?: Entity,
  ) {}

  execute(doc: DrawingDocument): DrawingDocument {
    this.before.clear();
    const source = this.sourceSnapshot ?? getEntity(doc, this.sourceId);
    if (!source) return doc;
    const patch = matchPropPatch(source, this.keys);
    let next = doc;
    for (const id of this.destIds) {
      const ent = getEntity(next, id);
      if (!ent || ent.id === source.id) continue;
      if (!canEditEntityProperties(ent, next)) continue;
      this.before.set(id, structuredClone(ent));
      next = replaceEntity(next, applyAppearancePatch(ent, patch));
    }
    return next;
  }

  undo(doc: DrawingDocument): DrawingDocument {
    let next = doc;
    for (const ent of this.before.values()) {
      next = replaceEntity(next, structuredClone(ent));
    }
    return next;
  }
}

export class UpdateEntityGeometryPropertyCommand implements Command {
  readonly name = 'UpdateEntityGeometryProperty';
  private before: Entity | null = null;

  constructor(
    private readonly entityId: EntityId,
    private readonly key: string,
    private readonly value: number | boolean,
  ) {}

  execute(doc: DrawingDocument): DrawingDocument {
    const ent = getEntity(doc, this.entityId);
    if (!ent) return doc;
    if (!canEditEntityProperties(ent, doc)) return doc;
    const updated = applyGeometryPropertyEdit(ent, this.key, this.value);
    if (!updated) return doc;
    this.before = structuredClone(ent);
    return replaceEntity(doc, updated);
  }

  undo(doc: DrawingDocument): DrawingDocument {
    if (!this.before) return doc;
    return replaceEntity(doc, structuredClone(this.before));
  }
}

/** Update drawing currentAppearance (defaults for new objects). */
export class SetCurrentAppearanceCommand implements Command {
  readonly name = 'SetCurrentAppearance';
  private before: CurrentAppearance | null = null;

  constructor(private readonly patch: Partial<CurrentAppearance>) {}

  execute(doc: DrawingDocument): DrawingDocument {
    this.before = structuredClone(doc.settings.currentAppearance);
    return {
      ...doc,
      settings: {
        ...doc.settings,
        currentAppearance: {
          ...doc.settings.currentAppearance,
          ...this.patch,
        },
      },
      meta: { ...doc.meta, updatedAt: new Date().toISOString() },
    };
  }

  undo(doc: DrawingDocument): DrawingDocument {
    if (!this.before) return doc;
    return {
      ...doc,
      settings: {
        ...doc.settings,
        currentAppearance: structuredClone(this.before),
      },
      meta: { ...doc.meta, updatedAt: new Date().toISOString() },
    };
  }
}

export class SetShowLineweightsCommand implements Command {
  readonly name = 'SetShowLineweights';
  private before: boolean | null = null;

  constructor(private readonly value: boolean) {}

  execute(doc: DrawingDocument): DrawingDocument {
    this.before = doc.settings.showLineweights;
    return {
      ...doc,
      settings: { ...doc.settings, showLineweights: this.value },
      meta: { ...doc.meta, updatedAt: new Date().toISOString() },
    };
  }

  undo(doc: DrawingDocument): DrawingDocument {
    if (this.before == null) return doc;
    return {
      ...doc,
      settings: { ...doc.settings, showLineweights: this.before },
      meta: { ...doc.meta, updatedAt: new Date().toISOString() },
    };
  }
}
