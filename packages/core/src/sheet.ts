/**
 * Professional sheet / title-block foundation for Paper Space.
 * Title-block fields are structured data; canvas entities are generated from them.
 */

import type { Entity, EntityId, LayerId, Vec2 } from './types.js';
import type { LayoutViewport, PageSettings, PaperSizeId } from './layout.js';
import { sheetSizeInPageUnits } from './layout.js';

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export const TITLE_BLOCK_LAYER_ID = 'layer-titleblock' as LayerId;
export const TEXT_LAYER_ID = 'layer-text' as LayerId;
export const DIMENSIONS_LAYER_ID = 'layer-dimensions' as LayerId;
export const ANNOTATIONS_LAYER_ID = 'layer-annotations' as LayerId;

/** Structured sheet information (editable; drives title block labels). */
export interface SheetInfo {
  project: string;
  drawingTitle: string;
  drawingNo: string;
  scale: string;
  date: string;
  drawnBy: string;
  checkedBy: string;
  revision: string;
}

export interface TitleBlock {
  /** Template id, e.g. 'a3-landscape-default'. */
  templateId: string;
  enabled: boolean;
  /** Bottom-left of title-block region in page units. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Per-layout Paper Space camera (independent of Model / viewport cameras).
 * zoom = 1 fits the sheet; offset pans in screen-ish paper units.
 */
export interface PaperCameraState {
  /** Pan offset in page units (positive X right, positive Y up). */
  offsetX: number;
  offsetY: number;
  /** Multiplier over fit-to-canvas zoom (1 = fitted). */
  zoom: number;
}

export function defaultSheetInfo(): SheetInfo {
  const today = new Date().toISOString().slice(0, 10);
  return {
    project: 'PROJECT',
    drawingTitle: 'DRAWING TITLE',
    drawingNo: 'A-101',
    scale: '1:50',
    date: today,
    drawnBy: '',
    checkedBy: '',
    revision: '0',
  };
}

export function defaultTitleBlock(page: PageSettings): TitleBlock {
  const sheet = sheetSizeInPageUnits(page);
  const margin = Math.max(page.margin, 0);
  const width = Math.min(180, sheet.width * 0.45);
  const height = Math.min(50, sheet.height * 0.28);
  return {
    templateId: 'default-professional',
    enabled: false,
    x: sheet.width - margin - width,
    y: margin,
    width,
    height,
  };
}

export function defaultPaperCamera(): PaperCameraState {
  return { offsetX: 0, offsetY: 0, zoom: 1 };
}

export const PAPER_ANNOTATION_DEFAULTS = {
  /** Default paper-space text height in page units (mm when units=mm). */
  textHeight: 3.5,
  dimTextHeight: 2.5,
  arrowSize: 2.5,
  leaderTextHeight: 2.5,
} as const;

export type TextAlignment = 'left' | 'center' | 'right';

/** Build title-block border + field labels as paper-space entities. */
export function buildTitleBlockEntities(
  block: TitleBlock,
  info: SheetInfo,
  layerId: LayerId = TITLE_BLOCK_LAYER_ID,
): Entity[] {
  if (!block.enabled) return [];
  const { x, y, width, height } = block;
  const entities: Entity[] = [];
  const line = (start: Vec2, end: Vec2): Entity => ({
    id: newId('ps-line'),
    type: 'line',
    layerId,
    visible: true,
    locked: false,
    metadata: { paperSpace: true, titleBlock: true },
    geometry: { start, end },
    properties: {},
  });
  const text = (
    position: Vec2,
    content: string,
    height: number,
    field?: string,
  ): Entity => ({
    id: newId('ps-text'),
    type: 'text',
    layerId,
    visible: true,
    locked: false,
    metadata: {
      paperSpace: true,
      titleBlock: true,
      ...(field ? { titleBlockField: field } : {}),
    },
    geometry: {
      position,
      content,
      height,
      rotation: 0,
      alignment: 'left' as TextAlignment,
    },
    properties: {},
  });

  // Outer border
  entities.push(line({ x, y }, { x: x + width, y }));
  entities.push(line({ x: x + width, y }, { x: x + width, y: y + height }));
  entities.push(line({ x: x + width, y: y + height }, { x, y: y + height }));
  entities.push(line({ x, y: y + height }, { x, y }));

  // Horizontal divisions (8 field rows-ish)
  const rows = 4;
  const rowH = height / rows;
  for (let i = 1; i < rows; i += 1) {
    const yy = y + rowH * i;
    entities.push(line({ x, y: yy }, { x: x + width, y: yy }));
  }
  // Vertical split for label / value
  const col = x + width * 0.32;
  entities.push(line({ x: col, y }, { x: col, y: y + height }));

  const fields: Array<{ key: keyof SheetInfo; label: string }> = [
    { key: 'project', label: 'PROJECT' },
    { key: 'drawingTitle', label: 'DRAWING TITLE' },
    { key: 'drawingNo', label: 'DRAWING NO.' },
    { key: 'scale', label: 'SCALE' },
    { key: 'date', label: 'DATE' },
    { key: 'drawnBy', label: 'DRAWN BY' },
    { key: 'checkedBy', label: 'CHECKED BY' },
    { key: 'revision', label: 'REVISION' },
  ];

  // Pack 2 fields per row band
  const bandH = height / 4;
  const labelH = Math.min(2.8, bandH * 0.35);
  const valueH = Math.min(3.2, bandH * 0.45);
  for (let i = 0; i < 4; i += 1) {
    const a = fields[i * 2]!;
    const b = fields[i * 2 + 1];
    const bandY = y + height - bandH * (i + 1);
    const midY = bandY + bandH * 0.55;
    entities.push(
      text({ x: x + 2, y: midY }, a.label, labelH, `${String(a.key)}Label`),
    );
    entities.push(
      text(
        { x: col + 2, y: midY },
        info[a.key] || '—',
        valueH,
        String(a.key),
      ),
    );
    if (b) {
      // Second field shares the same band on wide blocks — stack labels small
      const lowY = bandY + bandH * 0.22;
      entities.push(
        text({ x: x + 2, y: lowY }, b.label, labelH * 0.85, `${String(b.key)}Label`),
      );
      entities.push(
        text(
          { x: col + 2, y: lowY },
          info[b.key] || '—',
          valueH * 0.9,
          String(b.key),
        ),
      );
    }
  }

  return entities;
}

/** Default A3 landscape professional template — returns page + title block + sheet info. */
export function createA3LandscapeTemplate(): {
  pageSettings: PageSettings;
  titleBlock: TitleBlock;
  sheetInfo: SheetInfo;
  name: string;
} {
  const pageSettings: PageSettings = {
    paperSize: 'A3' as PaperSizeId,
    orientation: 'landscape',
    units: 'mm',
    margin: 10,
  };
  const titleBlock = defaultTitleBlock(pageSettings);
  titleBlock.enabled = true;
  titleBlock.templateId = 'a3-landscape-default';
  return {
    pageSettings,
    titleBlock,
    sheetInfo: defaultSheetInfo(),
    name: 'A3 Landscape Professional',
  };
}

/** Viewport label text entity associated with a viewport (Paper Space only). */
export function buildViewportLabelEntity(
  vp: LayoutViewport,
  index: number,
  layerId: LayerId = TEXT_LAYER_ID,
): Entity | null {
  if (!vp.showLabel) return null;
  const title = vp.label?.trim() || `Viewport ${index + 1}`;
  const scaleLabel = vp.scaleLabel?.trim() || '';
  const content = scaleLabel ? `${title}\n${scaleLabel}` : title;
  return {
    id: newId('ps-vplabel'),
    type: 'text',
    layerId,
    visible: true,
    locked: false,
    metadata: {
      paperSpace: true,
      viewportLabel: true,
      viewportId: vp.id,
    },
    geometry: {
      position: { x: vp.x, y: vp.y - 5 },
      content,
      height: 3,
      rotation: 0,
      alignment: 'left' as TextAlignment,
    },
    properties: {},
  };
}

/** Sync viewport-associated label entities after viewport move/resize. */
export function syncViewportLabelPositions(
  entities: Entity[],
  viewports: LayoutViewport[],
): Entity[] {
  const byVp = new Map(viewports.map((v) => [v.id, v]));
  return entities.map((e) => {
    const vpId = e.metadata?.viewportId;
    if (e.type !== 'text' || typeof vpId !== 'string') return e;
    if (!e.metadata?.viewportLabel) return e;
    const vp = byVp.get(vpId);
    if (!vp) return e;
    return {
      ...e,
      geometry: {
        ...e.geometry,
        position: { x: vp.x, y: vp.y - 5 },
      },
    };
  });
}

/** Strip previous title-block entities from a paper entity list. */
export function withoutTitleBlockEntities(entities: Entity[]): Entity[] {
  return entities.filter((e) => !e.metadata?.titleBlock);
}

/** Strip viewport-label entities for a given viewport (or all). */
export function withoutViewportLabelEntities(
  entities: Entity[],
  viewportId?: string,
): Entity[] {
  return entities.filter((e) => {
    if (!e.metadata?.viewportLabel) return true;
    if (!viewportId) return false;
    return e.metadata.viewportId !== viewportId;
  });
}

export function isPaperSpaceEntity(entity: Entity): boolean {
  return entity.metadata?.paperSpace === true;
}

/** Ensure unique entity ids across model + all paper spaces. */
export function assertNoEntityIdCollision(
  modelIds: Set<EntityId>,
  paperIds: Set<EntityId>,
): void {
  for (const id of paperIds) {
    if (modelIds.has(id)) {
      throw new Error(`Entity id collision between Model and Paper Space: ${id}`);
    }
  }
}
