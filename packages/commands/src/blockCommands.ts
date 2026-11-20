import {
  blockNameError,
  createEntityId,
  findBlockByName,
  getCurrentLayer,
  isBlockContentType,
  type AppearanceProperties,
  type BlockContentEntity,
  type BlockDefinition,
  type BlockReferenceEntity,
  type DrawingDocument,
  type Entity,
  type EntityId,
  type LayerId,
  type Vec2,
  type WorkspaceMode,
} from '@ratecad/core';
import {
  appearanceForNewEntity,
  contentToLocal,
  isUsableBlockScale,
  validateEntityGeometry,
} from '@ratecad/geometry';
import type { Command } from './bus.js';

export interface CreateBlockPlan {
  beforeEntities: Entity[];
  afterEntities: Entity[];
  beforeDefinitions: BlockDefinition[];
  afterDefinitions: BlockDefinition[];
  beforeSelection: EntityId[];
  afterSelection: EntityId[];
  definition: BlockDefinition;
  reference: BlockReferenceEntity;
}

export interface InsertBlockInput {
  definitionId: string;
  position: Vec2;
  scaleX: number;
  scaleY: number;
  /** Radians. */
  rotation: number;
  workspaceMode: WorkspaceMode;
  layerId?: LayerId;
  properties?: AppearanceProperties;
  entityId?: EntityId;
}

function finitePoint(point: Vec2): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function touchMeta(doc: DrawingDocument): DrawingDocument['meta'] {
  return { ...doc.meta, updatedAt: new Date().toISOString() };
}

function cloneEntities(entities: readonly Entity[]): Entity[] {
  return entities.map((entity) => structuredClone(entity));
}

function cloneDefinitions(definitions: readonly BlockDefinition[]): BlockDefinition[] {
  return definitions.map((definition) => structuredClone(definition));
}

export function buildCreateBlock(
  doc: DrawingDocument,
  entityIds: readonly EntityId[],
  name: string,
  basePoint: Vec2,
  workspaceMode: WorkspaceMode,
): { ok: true; plan: CreateBlockPlan } | { ok: false; error: string } {
  if (workspaceMode !== 'MODEL_SPACE') {
    return { ok: false, error: 'Create Block works in model space only' };
  }
  const nameError = blockNameError(name);
  if (nameError) return { ok: false, error: nameError };
  if (findBlockByName(doc.blockDefinitions, name)) {
    return { ok: false, error: `A block named "${name.trim()}" already exists` };
  }
  if (!finitePoint(basePoint)) {
    return { ok: false, error: 'Base point must be a finite coordinate' };
  }
  if (entityIds.length === 0) {
    return { ok: false, error: 'Select one or more objects' };
  }
  const current = getCurrentLayer(doc);
  if (current.locked) {
    return { ok: false, error: 'Current layer is locked' };
  }

  const selected = new Set(entityIds);
  const sources: Entity[] = [];
  for (const id of entityIds) {
    const entity = doc.entities.find((item) => item.id === id);
    if (!entity) return { ok: false, error: 'A selected object is no longer in the drawing' };
    sources.push(entity);
  }
  if (sources.length !== selected.size) {
    return { ok: false, error: 'Select each object only once' };
  }

  for (const entity of sources) {
    if (!isBlockContentType(entity.type)) {
      const reason =
        entity.type === 'block'
          ? 'Nested blocks are not supported'
          : `Cannot create a block from ${entity.type}`;
      return { ok: false, error: reason };
    }
    const layer = doc.layers.find((item) => item.id === entity.layerId);
    if (entity.locked || layer?.locked) {
      return { ok: false, error: 'Locked objects cannot be converted to a block' };
    }
    if (!validateEntityGeometry(entity)) {
      return { ok: false, error: 'Selected geometry is invalid' };
    }
  }

  const contents = sources.map((entity) =>
    contentToLocal(entity as BlockContentEntity, basePoint),
  );
  for (const content of contents) {
    if (!validateEntityGeometry(content)) {
      return { ok: false, error: 'Selected geometry is invalid' };
    }
  }

  const definition: BlockDefinition = {
    id: createEntityId('bdef'),
    name: name.trim(),
    basePoint: { x: 0, y: 0 },
    entities: contents,
  };
  const reference: BlockReferenceEntity = {
    id: createEntityId('block'),
    type: 'block',
    layerId: current.id,
    visible: true,
    locked: false,
    geometry: {
      definitionId: definition.id,
      position: { ...basePoint },
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
    },
    properties: appearanceForNewEntity(doc),
  };
  if (!validateEntityGeometry(reference)) {
    return { ok: false, error: 'Block reference geometry is invalid' };
  }

  const beforeEntities = cloneEntities(doc.entities);
  const afterEntities = [
    ...doc.entities.filter((entity) => !selected.has(entity.id)).map((entity) => structuredClone(entity)),
    structuredClone(reference),
  ];
  const beforeDefinitions = cloneDefinitions(doc.blockDefinitions);
  const afterDefinitions = [...beforeDefinitions.map((item) => structuredClone(item)), structuredClone(definition)];

  return {
    ok: true,
    plan: {
      beforeEntities,
      afterEntities,
      beforeDefinitions,
      afterDefinitions,
      beforeSelection: [...doc.selection],
      afterSelection: [reference.id],
      definition,
      reference,
    },
  };
}

function applySnapshot(
  doc: DrawingDocument,
  entities: Entity[],
  definitions: BlockDefinition[],
  selection: EntityId[],
): DrawingDocument {
  return {
    ...doc,
    entities: cloneEntities(entities),
    blockDefinitions: cloneDefinitions(definitions),
    selection: [...selection],
    meta: touchMeta(doc),
  };
}

export class CreateBlockCommand implements Command {
  readonly name = 'CreateBlock';
  private plan: CreateBlockPlan | null = null;

  constructor(
    private readonly entityIds: readonly EntityId[],
    private readonly blockName: string,
    private readonly basePoint: Vec2,
    private readonly workspaceMode: WorkspaceMode,
  ) {}

  execute(doc: DrawingDocument): DrawingDocument {
    if (!this.plan) {
      const built = buildCreateBlock(
        doc,
        this.entityIds,
        this.blockName,
        this.basePoint,
        this.workspaceMode,
      );
      if (!built.ok) throw new Error(built.error);
      this.plan = built.plan;
    }
    return applySnapshot(
      doc,
      this.plan.afterEntities,
      this.plan.afterDefinitions,
      this.plan.afterSelection,
    );
  }

  undo(doc: DrawingDocument): DrawingDocument {
    if (!this.plan) return doc;
    return applySnapshot(
      doc,
      this.plan.beforeEntities,
      this.plan.beforeDefinitions,
      this.plan.beforeSelection,
    );
  }
}

export function buildInsertBlock(
  doc: DrawingDocument,
  input: InsertBlockInput,
): { ok: true; reference: BlockReferenceEntity } | { ok: false; error: string } {
  if (input.workspaceMode !== 'MODEL_SPACE') {
    return { ok: false, error: 'Insert Block works in model space only' };
  }
  const definition = doc.blockDefinitions.find((item) => item.id === input.definitionId);
  if (!definition) return { ok: false, error: 'Select a block definition' };
  if (!finitePoint(input.position)) {
    return { ok: false, error: 'Insertion point must be a finite coordinate' };
  }
  if (!isUsableBlockScale(input.scaleX)) {
    return { ok: false, error: 'X scale must be a finite non-zero number' };
  }
  if (!isUsableBlockScale(input.scaleY)) {
    return { ok: false, error: 'Y scale must be a finite non-zero number' };
  }
  if (!Number.isFinite(input.rotation)) {
    return { ok: false, error: 'Rotation must be a finite angle' };
  }
  const layer = input.layerId
    ? doc.layers.find((item) => item.id === input.layerId)
    : getCurrentLayer(doc);
  if (!layer) return { ok: false, error: 'Current layer is missing' };
  if (layer.locked) return { ok: false, error: 'Current layer is locked' };

  const reference: BlockReferenceEntity = {
    id: input.entityId ?? createEntityId('block'),
    type: 'block',
    layerId: layer.id,
    visible: true,
    locked: false,
    geometry: {
      definitionId: definition.id,
      position: { ...input.position },
      scaleX: input.scaleX,
      scaleY: input.scaleY,
      rotation: input.rotation,
    },
    properties: input.properties
      ? structuredClone(input.properties)
      : appearanceForNewEntity(doc),
  };
  if (!validateEntityGeometry(reference)) {
    return { ok: false, error: 'Block reference geometry is invalid' };
  }
  return { ok: true, reference };
}

export function previewBlockReference(
  doc: DrawingDocument,
  input: Omit<InsertBlockInput, 'entityId' | 'workspaceMode'> & {
    workspaceMode?: WorkspaceMode;
  },
): BlockReferenceEntity | null {
  const built = buildInsertBlock(doc, {
    ...input,
    workspaceMode: input.workspaceMode ?? 'MODEL_SPACE',
    entityId: 'block-preview',
  });
  return built.ok ? built.reference : null;
}

export class InsertBlockCommand implements Command {
  readonly name = 'InsertBlock';
  private reference: BlockReferenceEntity | null = null;
  private beforeSelection: EntityId[] = [];

  constructor(private readonly input: InsertBlockInput) {}

  execute(doc: DrawingDocument): DrawingDocument {
    if (!this.reference) {
      const built = buildInsertBlock(doc, this.input);
      if (!built.ok) throw new Error(built.error);
      this.reference = built.reference;
      this.beforeSelection = [...doc.selection];
    }
    if (!doc.blockDefinitions.some((item) => item.id === this.reference!.geometry.definitionId)) {
      throw new Error('Block definition is missing');
    }
    if (doc.entities.some((entity) => entity.id === this.reference!.id)) {
      return {
        ...doc,
        selection: [this.reference.id],
        meta: touchMeta(doc),
      };
    }
    return {
      ...doc,
      entities: [...doc.entities, structuredClone(this.reference)],
      selection: [this.reference.id],
      meta: touchMeta(doc),
    };
  }

  undo(doc: DrawingDocument): DrawingDocument {
    if (!this.reference) return doc;
    return {
      ...doc,
      entities: doc.entities.filter((entity) => entity.id !== this.reference!.id),
      selection: [...this.beforeSelection],
      meta: touchMeta(doc),
    };
  }
}
