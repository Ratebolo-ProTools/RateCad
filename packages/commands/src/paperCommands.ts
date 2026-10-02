import {
  PAPER_ANNOTATION_DEFAULTS,
  TEXT_LAYER_ID,
  DIMENSIONS_LAYER_ID,
  ANNOTATIONS_LAYER_ID,
  TITLE_BLOCK_LAYER_ID,
  addPaperSpaceEntity,
  buildTitleBlockEntities,
  buildViewportLabelEntity,
  createEntityId,
  defaultSheetInfo,
  defaultTitleBlock,
  removePaperSpaceEntities,
  replaceLayout,
  replacePaperSpaceEntity,
  replaceViewport,
  setLayoutPaperEntities,
  syncViewportLabelPositions,
  updateLayoutPageSettings,
  updateLayoutSheetMeta,
  withoutTitleBlockEntities,
  withoutViewportLabelEntities,
  type DimensionKind,
  type DrawingDocument,
  type Entity,
  type EntityId,
  type LayoutId,
  type LayoutViewport,
  type PageSettings,
  type SheetInfo,
  type TitleBlock,
  type Vec2,
  getActiveLayout,
  getLayout,
} from '@ratecad/core';
import type { Command } from './bus.js';

function stampPaper(entity: Entity): Entity {
  return {
    ...entity,
    metadata: { ...(entity.metadata ?? {}), paperSpace: true },
  };
}

export class CreatePaperTextCommand implements Command {
  readonly name = 'CreatePaperText';
  private readonly entity: Entity;

  constructor(
    private readonly layoutId: LayoutId,
    position: Vec2,
    content: string,
    height = PAPER_ANNOTATION_DEFAULTS.textHeight,
    rotation = 0,
    layerId: string = TEXT_LAYER_ID,
    alignment: 'left' | 'center' | 'right' = 'left',
  ) {
    this.entity = stampPaper({
      id: createEntityId('ps-text'),
      type: 'text',
      layerId,
      visible: true,
      locked: false,
      geometry: { position: { ...position }, content, height, rotation, alignment },
      properties: {},
    });
  }

  getEntityId(): EntityId {
    return this.entity.id;
  }

  execute(doc: DrawingDocument): DrawingDocument {
    return addPaperSpaceEntity(doc, this.layoutId, this.entity);
  }

  undo(doc: DrawingDocument): DrawingDocument {
    return removePaperSpaceEntities(doc, this.layoutId, [this.entity.id]);
  }
}

export class CreatePaperDimensionCommand implements Command {
  readonly name = 'CreatePaperDimension';
  private readonly entity: Entity;

  constructor(
    private readonly layoutId: LayoutId,
    kind: DimensionKind,
    start: Vec2,
    end: Vec2,
    offset: number,
    layerId: string = DIMENSIONS_LAYER_ID,
  ) {
    this.entity = stampPaper({
      id: createEntityId('ps-dim'),
      type: 'dimension',
      layerId,
      visible: true,
      locked: false,
      geometry: {
        kind,
        start: { ...start },
        end: { ...end },
        offset,
      },
      properties: {
        textHeight: PAPER_ANNOTATION_DEFAULTS.dimTextHeight,
        arrowSize: PAPER_ANNOTATION_DEFAULTS.arrowSize,
      },
    });
  }

  execute(doc: DrawingDocument): DrawingDocument {
    return addPaperSpaceEntity(doc, this.layoutId, this.entity);
  }

  undo(doc: DrawingDocument): DrawingDocument {
    return removePaperSpaceEntities(doc, this.layoutId, [this.entity.id]);
  }
}

export class CreatePaperLeaderCommand implements Command {
  readonly name = 'CreatePaperLeader';
  private readonly entity: Entity;

  constructor(
    private readonly layoutId: LayoutId,
    arrow: Vec2,
    vertices: Vec2[],
    content: string,
    textHeight = PAPER_ANNOTATION_DEFAULTS.leaderTextHeight,
    layerId: string = ANNOTATIONS_LAYER_ID,
  ) {
    this.entity = stampPaper({
      id: createEntityId('ps-leader'),
      type: 'leader',
      layerId,
      visible: true,
      locked: false,
      geometry: {
        arrow: { ...arrow },
        vertices: vertices.map((v) => ({ ...v })),
        content,
        textHeight,
      },
      properties: { arrowSize: PAPER_ANNOTATION_DEFAULTS.arrowSize },
    });
  }

  execute(doc: DrawingDocument): DrawingDocument {
    return addPaperSpaceEntity(doc, this.layoutId, this.entity);
  }

  undo(doc: DrawingDocument): DrawingDocument {
    return removePaperSpaceEntities(doc, this.layoutId, [this.entity.id]);
  }
}

export class CreatePaperLineCommand implements Command {
  readonly name = 'CreatePaperLine';
  private readonly entity: Entity;

  constructor(
    private readonly layoutId: LayoutId,
    start: Vec2,
    end: Vec2,
    layerId: string = TITLE_BLOCK_LAYER_ID,
  ) {
    this.entity = stampPaper({
      id: createEntityId('ps-line'),
      type: 'line',
      layerId,
      visible: true,
      locked: false,
      geometry: { start: { ...start }, end: { ...end } },
      properties: {},
    });
  }

  execute(doc: DrawingDocument): DrawingDocument {
    return addPaperSpaceEntity(doc, this.layoutId, this.entity);
  }

  undo(doc: DrawingDocument): DrawingDocument {
    return removePaperSpaceEntities(doc, this.layoutId, [this.entity.id]);
  }
}

export class DeletePaperEntitiesCommand implements Command {
  readonly name = 'DeletePaperEntities';
  private removed: Entity[] = [];

  constructor(
    private readonly layoutId: LayoutId,
    private readonly ids: EntityId[],
  ) {}

  execute(doc: DrawingDocument): DrawingDocument {
    const layout = getLayout(doc.layouts ?? [], this.layoutId);
    if (!layout) return doc;
    const idSet = new Set(this.ids);
    this.removed = layout.paperSpaceEntities.filter((e) => idSet.has(e.id));
    return removePaperSpaceEntities(doc, this.layoutId, this.ids);
  }

  undo(doc: DrawingDocument): DrawingDocument {
    let next = doc;
    for (const e of this.removed) {
      next = addPaperSpaceEntity(next, this.layoutId, e);
    }
    return next;
  }
}

export class ReplacePaperEntityCommand implements Command {
  readonly name = 'ReplacePaperEntity';

  constructor(
    private readonly layoutId: LayoutId,
    private readonly before: Entity,
    private readonly after: Entity,
  ) {
    if (before.id !== after.id) {
      throw new Error('ReplacePaperEntityCommand requires same entity id');
    }
  }

  execute(doc: DrawingDocument): DrawingDocument {
    return replacePaperSpaceEntity(doc, this.layoutId, structuredClone(this.after));
  }

  undo(doc: DrawingDocument): DrawingDocument {
    return replacePaperSpaceEntity(doc, this.layoutId, structuredClone(this.before));
  }
}

export class UpdateLayoutPageSettingsCommand implements Command {
  readonly name = 'UpdateLayoutPageSettings';
  private before: PageSettings | null = null;

  constructor(
    private readonly layoutId: LayoutId,
    private readonly after: PageSettings,
  ) {}

  execute(doc: DrawingDocument): DrawingDocument {
    const layout = getLayout(doc.layouts ?? [], this.layoutId);
    if (!layout) return doc;
    this.before = structuredClone(layout.pageSettings);
    return updateLayoutPageSettings(doc, this.layoutId, this.after);
  }

  undo(doc: DrawingDocument): DrawingDocument {
    if (!this.before) return doc;
    return updateLayoutPageSettings(doc, this.layoutId, this.before);
  }
}

export class ApplyTitleBlockCommand implements Command {
  readonly name = 'ApplyTitleBlock';
  private beforeEntities: Entity[] = [];
  private beforeBlock: TitleBlock | undefined;
  private beforeInfo: SheetInfo | undefined;

  constructor(
    private readonly layoutId: LayoutId,
    private readonly sheetInfo?: Partial<SheetInfo>,
    private readonly templateId = 'default-professional',
  ) {}

  execute(doc: DrawingDocument): DrawingDocument {
    const layout = getLayout(doc.layouts ?? [], this.layoutId);
    if (!layout) return doc;
    this.beforeEntities = structuredClone(layout.paperSpaceEntities);
    this.beforeBlock = layout.titleBlock
      ? structuredClone(layout.titleBlock)
      : undefined;
    this.beforeInfo = layout.sheetInfo
      ? structuredClone(layout.sheetInfo)
      : undefined;

    const info: SheetInfo = {
      ...defaultSheetInfo(),
      ...(layout.sheetInfo ?? {}),
      ...(this.sheetInfo ?? {}),
    };
    const block: TitleBlock = {
      ...(layout.titleBlock ?? defaultTitleBlock(layout.pageSettings)),
      enabled: true,
      templateId: this.templateId,
    };
    const kept = withoutTitleBlockEntities(layout.paperSpaceEntities);
    const generated = buildTitleBlockEntities(block, info, TITLE_BLOCK_LAYER_ID);
    let next = setLayoutPaperEntities(doc, this.layoutId, [...kept, ...generated]);
    next = updateLayoutSheetMeta(next, this.layoutId, {
      sheetInfo: info,
      titleBlock: block,
    });
    return next;
  }

  undo(doc: DrawingDocument): DrawingDocument {
    let next = setLayoutPaperEntities(
      doc,
      this.layoutId,
      structuredClone(this.beforeEntities),
    );
    const layout = getLayout(next.layouts ?? [], this.layoutId);
    if (!layout) return next;
    next = replaceLayout(next, {
      ...layout,
      sheetInfo: this.beforeInfo ? structuredClone(this.beforeInfo) : undefined,
      titleBlock: this.beforeBlock
        ? structuredClone(this.beforeBlock)
        : undefined,
    });
    return next;
  }
}

export class UpdateSheetInfoCommand implements Command {
  readonly name = 'UpdateSheetInfo';
  private before: SheetInfo | undefined;
  private beforeEntities: Entity[] = [];

  constructor(
    private readonly layoutId: LayoutId,
    private readonly after: SheetInfo,
  ) {}

  execute(doc: DrawingDocument): DrawingDocument {
    const layout = getLayout(doc.layouts ?? [], this.layoutId);
    if (!layout) return doc;
    this.before = layout.sheetInfo
      ? structuredClone(layout.sheetInfo)
      : undefined;
    this.beforeEntities = structuredClone(layout.paperSpaceEntities);
    let next = updateLayoutSheetMeta(doc, this.layoutId, {
      sheetInfo: this.after,
    });
    // Refresh title-block text if enabled
    const block = layout.titleBlock;
    if (block?.enabled) {
      const kept = withoutTitleBlockEntities(layout.paperSpaceEntities);
      const generated = buildTitleBlockEntities(block, this.after);
      next = setLayoutPaperEntities(next, this.layoutId, [...kept, ...generated]);
    }
    return next;
  }

  undo(doc: DrawingDocument): DrawingDocument {
    let next = setLayoutPaperEntities(
      doc,
      this.layoutId,
      structuredClone(this.beforeEntities),
    );
    if (this.before) {
      next = updateLayoutSheetMeta(next, this.layoutId, {
        sheetInfo: this.before,
      });
    }
    return next;
  }
}

export class SetViewportLabelCommand implements Command {
  readonly name = 'SetViewportLabel';
  private beforeVp: LayoutViewport | null = null;
  private beforeEntities: Entity[] = [];

  constructor(
    private readonly layoutId: LayoutId,
    private readonly viewportId: string,
    private readonly label: string,
    private readonly scaleLabel: string,
    private readonly showLabel: boolean,
  ) {}

  execute(doc: DrawingDocument): DrawingDocument {
    const layout = getLayout(doc.layouts ?? [], this.layoutId);
    if (!layout) return doc;
    const vp = layout.viewports.find((v) => v.id === this.viewportId);
    if (!vp) return doc;
    this.beforeVp = structuredClone(vp);
    this.beforeEntities = structuredClone(layout.paperSpaceEntities);
    const afterVp: LayoutViewport = {
      ...vp,
      label: this.label,
      scaleLabel: this.scaleLabel,
      showLabel: this.showLabel,
    };
    let next = replaceViewport(doc, this.layoutId, afterVp);
    let ents = withoutViewportLabelEntities(
      layout.paperSpaceEntities,
      this.viewportId,
    );
    const idx = layout.viewports.findIndex((v) => v.id === this.viewportId);
    if (this.showLabel) {
      const labelEnt = buildViewportLabelEntity(afterVp, idx >= 0 ? idx : 0);
      if (labelEnt) ents = [...ents, labelEnt];
    }
    ents = syncViewportLabelPositions(ents, [
      ...layout.viewports.filter((v) => v.id !== this.viewportId),
      afterVp,
    ]);
    next = setLayoutPaperEntities(next, this.layoutId, ents);
    return next;
  }

  undo(doc: DrawingDocument): DrawingDocument {
    if (!this.beforeVp) return doc;
    let next = replaceViewport(doc, this.layoutId, this.beforeVp);
    next = setLayoutPaperEntities(
      next,
      this.layoutId,
      structuredClone(this.beforeEntities),
    );
    return next;
  }
}

/** After moving a viewport, keep associated label entities in sync. */
export class SyncViewportLabelsCommand implements Command {
  readonly name = 'SyncViewportLabels';
  private before: Entity[] = [];

  constructor(private readonly layoutId: LayoutId) {}

  execute(doc: DrawingDocument): DrawingDocument {
    const layout = getLayout(doc.layouts ?? [], this.layoutId);
    if (!layout) return doc;
    this.before = structuredClone(layout.paperSpaceEntities);
    const next = syncViewportLabelPositions(
      layout.paperSpaceEntities,
      layout.viewports,
    );
    return setLayoutPaperEntities(doc, this.layoutId, next);
  }

  undo(doc: DrawingDocument): DrawingDocument {
    return setLayoutPaperEntities(
      doc,
      this.layoutId,
      structuredClone(this.before),
    );
  }
}

export function getActiveLayoutIdOrThrow(doc: DrawingDocument): LayoutId {
  const id = doc.activeLayoutId ?? getActiveLayout(doc)?.id;
  if (!id) throw new Error('No active layout');
  return id;
}
