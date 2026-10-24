import type {
  DoorEntity,
  DrawingDocument,
  DrawingMeta,
  DrawingSettings,
  Entity,
  EntityId,
  Layer,
  LayerId,
  RoomEntity,
  WallEntity,
  WindowEntity,
} from './types.js';
import {
  APP_VERSION,
  DEFAULT_CONSTRUCTION,
  DEFAULT_DIMENSION_STYLE,
  DEFAULT_LAYER_ID,
  DOORS_LAYER_ID,
  ROOMS_LAYER_ID,
  SCHEMA_VERSION,
  WALLS_LAYER_ID,
  WINDOWS_LAYER_ID,
} from './types.js';
import { DEFAULT_CURRENT_APPEARANCE } from './appearance.js';
import { DEFAULT_ANNOTATION_SCALE } from './annotationScale.js';
import {
  DEFAULT_DRAWING_UNITS,
  drawingUnitsFromLegacy,
  legacyDisplayFromDrawingUnits,
} from './drawingUnits.js';
import {
  DEFAULT_ACTIVE_DIMSTYLE_NAME,
  DEFAULT_DIMENSION_STYLES,
  getActiveDimensionStyle,
  legacyStyleFromDefinition,
} from './dimensionStyles.js';
import {
  createDefaultLayout,
  createLayout,
  getLayout,
  type Layout,
  type LayoutId,
  type LayoutViewport,
  type PageSettings,
  type ViewportId,
} from './layout.js';

function withLayerDefaults(
  partial: Pick<Layer, 'id' | 'name' | 'color'> &
    Partial<Omit<Layer, 'id' | 'name' | 'color'>>,
): Layer {
  return {
    linetype: 'Continuous',
    lineweight: 0.25,
    transparency: 0,
    visible: true,
    locked: false,
    ...partial,
  };
}

let idCounter = 0;

export function createEntityId(prefix = 'ent'): EntityId {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

export function createLayerId(prefix = 'layer'): LayerId {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}` as LayerId;
}

export function resetIdCounter(): void {
  idCounter = 0;
}

export function createDefaultLayers(): Layer[] {
  return [
    withLayerDefaults({
      id: DEFAULT_LAYER_ID,
      name: '0',
      color: '#d4d4d4',
      lineweight: 0.25,
    }),
    withLayerDefaults({
      id: WALLS_LAYER_ID,
      name: 'Walls',
      color: '#e8e8e8',
      lineweight: 0.5,
    }),
    withLayerDefaults({
      id: DOORS_LAYER_ID,
      name: 'Doors',
      color: '#8ec8ff',
      lineweight: 0.35,
    }),
    withLayerDefaults({
      id: WINDOWS_LAYER_ID,
      name: 'Windows',
      color: '#7ad4c8',
      lineweight: 0.35,
    }),
    withLayerDefaults({
      id: ROOMS_LAYER_ID,
      name: 'Rooms',
      color: '#c9a86c',
      lineweight: 0.25,
    }),
    withLayerDefaults({
      id: 'layer-dimensions' as LayerId,
      name: 'Dimensions',
      color: '#f0c674',
      lineweight: 0.18,
    }),
    withLayerDefaults({
      id: 'layer-text' as LayerId,
      name: 'Text',
      color: '#c8ced6',
      lineweight: 0.18,
    }),
    withLayerDefaults({
      id: 'layer-construction' as LayerId,
      name: 'Construction',
      color: '#6a737d',
      linetype: 'Dashed',
      lineweight: 0.13,
    }),
    withLayerDefaults({
      id: 'layer-annotations' as LayerId,
      name: 'Annotations',
      color: '#d2a8ff',
      lineweight: 0.18,
    }),
    withLayerDefaults({
      id: 'layer-titleblock' as LayerId,
      name: 'TitleBlock',
      color: '#9aa4b2',
      lineweight: 0.25,
    }),
  ];
}

/** @deprecated use createDefaultLayers — kept for callers expecting a single layer */
export function createDefaultLayer(): Layer {
  return createDefaultLayers()[0]!;
}

export function createEmptyDocument(
  name = 'Untitled Drawing',
  settings?: Partial<DrawingSettings>,
): DrawingDocument {
  const now = new Date().toISOString();
  const meta: DrawingMeta = {
    name,
    createdAt: now,
    updatedAt: now,
    appVersion: APP_VERSION,
  };

  const layers = createDefaultLayers();

  const worldUnit = settings?.worldUnit ?? 'ft';
  const drawingUnits = {
    ...DEFAULT_DRAWING_UNITS,
    ...(settings?.drawingUnits ??
      drawingUnitsFromLegacy({
        units: settings?.units ?? 'ft-in',
        precision: settings?.precision ?? 2,
        fractionDenominator: settings?.fractionDenominator ?? 16,
        worldUnit,
      })),
  };
  const legacyDisplay = legacyDisplayFromDrawingUnits(drawingUnits, worldUnit);
  const dimensionStyles =
    settings?.dimensionStyles?.length
      ? settings.dimensionStyles
      : DEFAULT_DIMENSION_STYLES.map((s) => structuredClone(s));
  const activeDimensionStyleName =
    settings?.activeDimensionStyleName ?? DEFAULT_ACTIVE_DIMSTYLE_NAME;
  const activeDim = getActiveDimensionStyle(
    dimensionStyles,
    activeDimensionStyleName,
  );

  return {
    schemaVersion: SCHEMA_VERSION,
    meta,
    settings: {
      worldUnit,
      drawingUnits,
      units: settings?.units ?? legacyDisplay.units,
      precision: settings?.precision ?? legacyDisplay.precision,
      fractionDenominator:
        settings?.fractionDenominator ?? legacyDisplay.fractionDenominator,
      gridSize: settings?.gridSize ?? 1,
      showGrid: settings?.showGrid ?? true,
      snapToGrid: settings?.snapToGrid ?? true,
      trimMode: settings?.trimMode ?? 'quick',
      edgeMode: settings?.edgeMode ?? 'no-extend',
      projectMode: settings?.projectMode ?? 'none',
      trimEraseUntrimmable: settings?.trimEraseUntrimmable ?? false,
      filletRadius: settings?.filletRadius ?? 0,
      filletTrim: settings?.filletTrim ?? true,
      linetypeScale: settings?.linetypeScale ?? 1,
      showLineweights: settings?.showLineweights ?? true,
      currentAppearance: {
        ...DEFAULT_CURRENT_APPEARANCE,
        ...(settings?.currentAppearance ?? {}),
      },
      dimensionStyles,
      activeDimensionStyleName,
      dimensionStyle: {
        ...DEFAULT_DIMENSION_STYLE,
        ...legacyStyleFromDefinition(activeDim),
        ...(settings?.dimensionStyle ?? {}),
      },
      constructionDefaults: {
        ...DEFAULT_CONSTRUCTION,
        ...(settings?.constructionDefaults ?? {}),
      },
      annotationScale: {
        ...DEFAULT_ANNOTATION_SCALE,
        ...(settings?.annotationScale ?? {}),
      },
    },
    layers,
    currentLayerId: DEFAULT_LAYER_ID,
    entities: [],
    layouts: [createDefaultLayout('Layout1')],
    activeLayoutId: null,
    workspaceMode: 'MODEL_SPACE',
    selection: [],
  };
}

export function ensureLayouts(doc: DrawingDocument): DrawingDocument {
  if (doc.layouts?.length) return doc;
  return touchDocument({
    ...doc,
    layouts: [createDefaultLayout('Layout1')],
    activeLayoutId: doc.activeLayoutId ?? null,
  });
}

export function setActiveLayout(
  doc: DrawingDocument,
  layoutId: LayoutId | null,
): DrawingDocument {
  if (layoutId != null && !getLayout(doc.layouts, layoutId)) {
    return doc;
  }
  return touchDocument({
    ...doc,
    activeLayoutId: layoutId,
    workspaceMode: layoutId == null ? 'MODEL_SPACE' : 'PAPER_SPACE',
  });
}

export function addLayout(
  doc: DrawingDocument,
  name?: string,
): { document: DrawingDocument; layout: Layout } {
  const layout = createLayout(doc.layouts ?? [], name);
  const document = touchDocument({
    ...doc,
    layouts: [...(doc.layouts ?? []), layout],
    activeLayoutId: layout.id,
    workspaceMode: 'PAPER_SPACE',
  });
  return { document, layout };
}

/** Rename a layout (unique name required, case-insensitive). */
export function renameLayout(
  doc: DrawingDocument,
  layoutId: LayoutId,
  name: string,
): DrawingDocument {
  const trimmed = name.trim();
  if (!trimmed) return doc;
  const layout = getLayout(doc.layouts ?? [], layoutId);
  if (!layout) return doc;
  const clash = (doc.layouts ?? []).some(
    (l) =>
      l.id !== layoutId && l.name.toLowerCase() === trimmed.toLowerCase(),
  );
  if (clash) {
    throw new Error(`Layout name already exists: ${trimmed}`);
  }
  return replaceLayout(doc, { ...layout, name: trimmed });
}

export function getActiveLayout(doc: DrawingDocument): Layout | undefined {
  return getLayout(doc.layouts ?? [], doc.activeLayoutId);
}

/** Replace one viewport inside a layout (immutable). */
export function replaceViewport(
  doc: DrawingDocument,
  layoutId: LayoutId,
  viewport: LayoutViewport,
): DrawingDocument {
  const layouts = doc.layouts ?? [];
  const li = layouts.findIndex((l) => l.id === layoutId);
  if (li < 0) return doc;
  const layout = layouts[li]!;
  const vi = layout.viewports.findIndex((v) => v.id === viewport.id);
  if (vi < 0) return doc;
  const viewports = layout.viewports.slice();
  viewports[vi] = structuredClone(viewport);
  const nextLayouts = layouts.slice();
  nextLayouts[li] = { ...layout, viewports };
  return touchDocument({ ...doc, layouts: nextLayouts });
}

/** Append a viewport to a layout. */
export function addViewport(
  doc: DrawingDocument,
  layoutId: LayoutId,
  viewport: LayoutViewport,
): DrawingDocument {
  const layouts = doc.layouts ?? [];
  const li = layouts.findIndex((l) => l.id === layoutId);
  if (li < 0) return doc;
  const layout = layouts[li]!;
  if (layout.viewports.some((v) => v.id === viewport.id)) {
    throw new Error(`Duplicate viewport id: ${viewport.id}`);
  }
  const nextLayouts = layouts.slice();
  nextLayouts[li] = {
    ...layout,
    viewports: [...layout.viewports, structuredClone(viewport)],
  };
  return touchDocument({ ...doc, layouts: nextLayouts });
}

/** Remove a viewport from a layout. */
export function removeViewport(
  doc: DrawingDocument,
  layoutId: LayoutId,
  viewportId: ViewportId,
): DrawingDocument {
  const layouts = doc.layouts ?? [];
  const li = layouts.findIndex((l) => l.id === layoutId);
  if (li < 0) return doc;
  const layout = layouts[li]!;
  const viewports = layout.viewports.filter((v) => v.id !== viewportId);
  if (viewports.length === layout.viewports.length) return doc;
  const nextLayouts = layouts.slice();
  nextLayouts[li] = { ...layout, viewports };
  return touchDocument({ ...doc, layouts: nextLayouts });
}

/** Replace an entire layout (immutable). */
export function replaceLayout(
  doc: DrawingDocument,
  layout: Layout,
): DrawingDocument {
  const layouts = doc.layouts ?? [];
  const li = layouts.findIndex((l) => l.id === layout.id);
  if (li < 0) return doc;
  const nextLayouts = layouts.slice();
  nextLayouts[li] = structuredClone(layout);
  return touchDocument({ ...doc, layouts: nextLayouts });
}

export function updateLayoutPageSettings(
  doc: DrawingDocument,
  layoutId: LayoutId,
  pageSettings: PageSettings,
): DrawingDocument {
  const layout = getLayout(doc.layouts ?? [], layoutId);
  if (!layout) return doc;
  return replaceLayout(doc, { ...layout, pageSettings: structuredClone(pageSettings) });
}

export function addPaperSpaceEntity(
  doc: DrawingDocument,
  layoutId: LayoutId,
  entity: Entity,
): DrawingDocument {
  const layout = getLayout(doc.layouts ?? [], layoutId);
  if (!layout) return doc;
  if (doc.entities.some((e) => e.id === entity.id)) {
    throw new Error(`Paper entity id collides with Model Space: ${entity.id}`);
  }
  if (layout.paperSpaceEntities.some((e) => e.id === entity.id)) {
    throw new Error(`Duplicate paper entity id: ${entity.id}`);
  }
  const stamped: Entity = {
    ...structuredClone(entity),
    metadata: { ...(entity.metadata ?? {}), paperSpace: true },
  };
  return replaceLayout(doc, {
    ...layout,
    paperSpaceEntities: [...layout.paperSpaceEntities, stamped],
  });
}

export function replacePaperSpaceEntity(
  doc: DrawingDocument,
  layoutId: LayoutId,
  entity: Entity,
): DrawingDocument {
  const layout = getLayout(doc.layouts ?? [], layoutId);
  if (!layout) return doc;
  const idx = layout.paperSpaceEntities.findIndex((e) => e.id === entity.id);
  if (idx < 0) return doc;
  const next = layout.paperSpaceEntities.slice();
  next[idx] = {
    ...structuredClone(entity),
    metadata: { ...(entity.metadata ?? {}), paperSpace: true },
  };
  return replaceLayout(doc, { ...layout, paperSpaceEntities: next });
}

export function removePaperSpaceEntities(
  doc: DrawingDocument,
  layoutId: LayoutId,
  ids: EntityId[],
): DrawingDocument {
  const layout = getLayout(doc.layouts ?? [], layoutId);
  if (!layout) return doc;
  const remove = new Set(ids);
  return replaceLayout(doc, {
    ...layout,
    paperSpaceEntities: layout.paperSpaceEntities.filter((e) => !remove.has(e.id)),
  });
}

export function setLayoutPaperEntities(
  doc: DrawingDocument,
  layoutId: LayoutId,
  entities: Entity[],
): DrawingDocument {
  const layout = getLayout(doc.layouts ?? [], layoutId);
  if (!layout) return doc;
  return replaceLayout(doc, {
    ...layout,
    paperSpaceEntities: structuredClone(entities),
  });
}

export function getPaperSpaceEntity(
  doc: DrawingDocument,
  layoutId: LayoutId,
  id: EntityId,
): Entity | undefined {
  return getLayout(doc.layouts ?? [], layoutId)?.paperSpaceEntities.find(
    (e) => e.id === id,
  );
}

export function updateLayoutSheetMeta(
  doc: DrawingDocument,
  layoutId: LayoutId,
  patch: {
    sheetInfo?: import('./sheet.js').SheetInfo;
    titleBlock?: import('./sheet.js').TitleBlock;
    paperCamera?: import('./sheet.js').PaperCameraState;
  },
): DrawingDocument {
  const layout = getLayout(doc.layouts ?? [], layoutId);
  if (!layout) return doc;
  return replaceLayout(doc, {
    ...layout,
    ...(patch.sheetInfo ? { sheetInfo: structuredClone(patch.sheetInfo) } : {}),
    ...(patch.titleBlock
      ? { titleBlock: structuredClone(patch.titleBlock) }
      : {}),
    ...(patch.paperCamera
      ? { paperCamera: structuredClone(patch.paperCamera) }
      : {}),
  });
}


export function cloneDocument(doc: DrawingDocument): DrawingDocument {
  return structuredClone(doc);
}

export function touchDocument(doc: DrawingDocument): DrawingDocument {
  return {
    ...doc,
    meta: {
      ...doc.meta,
      updatedAt: new Date().toISOString(),
    },
  };
}

export function getEntity(
  doc: DrawingDocument,
  id: EntityId,
): Entity | undefined {
  return doc.entities.find((e) => e.id === id);
}

export function getLayer(
  doc: DrawingDocument,
  id: LayerId,
): Layer | undefined {
  return doc.layers.find((l) => l.id === id);
}

export function getCurrentLayer(doc: DrawingDocument): Layer {
  return getLayer(doc, doc.currentLayerId) ?? doc.layers[0]!;
}

export function getSelectedEntities(doc: DrawingDocument): Entity[] {
  const selected = new Set(doc.selection);
  return doc.entities.filter((e) => selected.has(e.id));
}

export function setSelection(
  doc: DrawingDocument,
  ids: EntityId[],
): DrawingDocument {
  return {
    ...doc,
    selection: [...ids],
  };
}

export function toggleSelectionId(
  doc: DrawingDocument,
  id: EntityId,
): DrawingDocument {
  const set = new Set(doc.selection);
  if (set.has(id)) {
    set.delete(id);
  } else {
    set.add(id);
  }
  return setSelection(doc, [...set]);
}

export function clearSelection(doc: DrawingDocument): DrawingDocument {
  return setSelection(doc, []);
}

export function addEntity(
  doc: DrawingDocument,
  entity: Entity,
): DrawingDocument {
  return touchDocument({
    ...doc,
    entities: [...doc.entities, entity],
  });
}

export function removeEntities(
  doc: DrawingDocument,
  ids: EntityId[],
): DrawingDocument {
  const remove = new Set(ids);
  return touchDocument({
    ...doc,
    entities: doc.entities.filter((e) => !remove.has(e.id)),
    selection: doc.selection.filter((id) => !remove.has(id)),
  });
}

export function replaceEntity(
  doc: DrawingDocument,
  entity: Entity,
): DrawingDocument {
  const index = doc.entities.findIndex((e) => e.id === entity.id);
  if (index < 0) {
    return doc;
  }
  const entities = [...doc.entities];
  entities[index] = entity;
  return touchDocument({ ...doc, entities });
}

export function setCurrentLayer(
  doc: DrawingDocument,
  layerId: LayerId,
): DrawingDocument {
  if (!getLayer(doc, layerId)) return doc;
  return touchDocument({ ...doc, currentLayerId: layerId });
}

export function addLayer(doc: DrawingDocument, layer: Layer): DrawingDocument {
  if (doc.layers.some((l) => l.id === layer.id)) return doc;
  return touchDocument({
    ...doc,
    layers: [...doc.layers, layer],
  });
}

export function updateLayer(
  doc: DrawingDocument,
  layerId: LayerId,
  patch: Partial<Omit<Layer, 'id'>>,
): DrawingDocument {
  const layers = doc.layers.map((l) =>
    l.id === layerId ? { ...l, ...patch, id: l.id } : l,
  );
  return touchDocument({ ...doc, layers });
}

export function removeLayer(
  doc: DrawingDocument,
  layerId: LayerId,
  moveToLayerId?: LayerId,
): DrawingDocument {
  if (layerId === DEFAULT_LAYER_ID) {
    throw new Error('Cannot delete the default layer "0"');
  }
  const hasModel = doc.entities.some((e) => e.layerId === layerId);
  const hasPaper = (doc.layouts ?? []).some((l) =>
    l.paperSpaceEntities.some((e) => e.layerId === layerId),
  );
  if (hasModel || hasPaper) {
    if (!moveToLayerId || !getLayer(doc, moveToLayerId)) {
      throw new Error('Move entities to another layer before deleting');
    }
  }
  const target = moveToLayerId ?? DEFAULT_LAYER_ID;
  const entities = doc.entities.map((e) =>
    e.layerId === layerId ? { ...e, layerId: target } : e,
  );
  const layouts = (doc.layouts ?? []).map((layout) => ({
    ...layout,
    paperSpaceEntities: layout.paperSpaceEntities.map((e) =>
      e.layerId === layerId ? { ...e, layerId: target } : e,
    ),
  }));
  const layers = doc.layers.filter((l) => l.id !== layerId);
  const currentLayerId =
    doc.currentLayerId === layerId ? target : doc.currentLayerId;
  return touchDocument({
    ...doc,
    layers,
    entities,
    layouts,
    currentLayerId,
  });
}

export function isEntityModifiable(doc: DrawingDocument, entity: Entity): boolean {
  if (entity.locked) return false;
  const layer = getLayer(doc, entity.layerId);
  if (!layer) return true;
  if (!layer.visible) return false;
  if (layer.locked) return false;
  return true;
}

export function isEntitySelectable(doc: DrawingDocument, entity: Entity): boolean {
  if (!entity.visible) return false;
  const layer = getLayer(doc, entity.layerId);
  if (layer && !layer.visible) return false;
  return true;
}

export function getWall(doc: DrawingDocument, id: EntityId): WallEntity | undefined {
  const e = getEntity(doc, id);
  return e?.type === 'wall' ? e : undefined;
}

export function getRoom(doc: DrawingDocument, id: EntityId): RoomEntity | undefined {
  const e = getEntity(doc, id);
  return e?.type === 'room' ? e : undefined;
}

/** Doors and windows hosted by a given wall. */
export function getHostedByWall(
  doc: DrawingDocument,
  wallId: EntityId,
): Array<DoorEntity | WindowEntity> {
  return doc.entities.filter(
    (e): e is DoorEntity | WindowEntity =>
      (e.type === 'door' || e.type === 'window') &&
      e.geometry.hostWallId === wallId,
  );
}

export function getHostedDoorIds(doc: DrawingDocument, wallId: EntityId): EntityId[] {
  return getHostedByWall(doc, wallId)
    .filter((e) => e.type === 'door')
    .map((e) => e.id);
}

export function getHostedWindowIds(
  doc: DrawingDocument,
  wallId: EntityId,
): EntityId[] {
  return getHostedByWall(doc, wallId)
    .filter((e) => e.type === 'window')
    .map((e) => e.id);
}

/** Rooms that reference any of the given wall IDs in their boundary. */
export function findRoomsUsingWalls(
  doc: DrawingDocument,
  wallIds: EntityId[],
): RoomEntity[] {
  const set = new Set(wallIds);
  return doc.entities.filter(
    (e): e is RoomEntity =>
      e.type === 'room' && e.geometry.wallIds.some((id) => set.has(id)),
  );
}

/** Wall deletion must cascade hosted doors/windows — collect full set. */
export function expandDeleteIds(
  doc: DrawingDocument,
  ids: EntityId[],
): EntityId[] {
  const out = new Set(ids);
  for (const id of ids) {
    const ent = getEntity(doc, id);
    if (ent?.type === 'wall') {
      for (const hosted of getHostedByWall(doc, id)) {
        out.add(hosted.id);
      }
      // Rooms that lose a boundary wall become invalid — delete them too
      for (const room of findRoomsUsingWalls(doc, [id])) {
        out.add(room.id);
      }
    }
  }
  return [...out];
}

export function findOrphanHosted(
  doc: DrawingDocument,
): Array<DoorEntity | WindowEntity> {
  return doc.entities.filter((e): e is DoorEntity | WindowEntity => {
    if (e.type !== 'door' && e.type !== 'window') return false;
    return !getWall(doc, e.geometry.hostWallId);
  });
}

/** Rooms whose wallIds reference missing walls. */
export function findInvalidRooms(doc: DrawingDocument): RoomEntity[] {
  return doc.entities.filter((e): e is RoomEntity => {
    if (e.type !== 'room') return false;
    if (e.geometry.wallIds.length < 3) return true;
    if (e.geometry.wallIds.length !== e.geometry.wallDirs.length) return true;
    return e.geometry.wallIds.some((id) => !getWall(doc, id));
  });
}
