import {
  DEFAULT_DIMENSION_STYLE,
  DEFAULT_LAYER_ID,
  SCHEMA_VERSION,
  createDefaultLayers,
  type DrawingDocument,
  type Entity,
  type Layer,
  type LayerId,
} from '@ratecad/core';

export const RATECAD_FILE_EXTENSION = '.ratecad';

export interface RatecadFile {
  format: 'ratecad';
  schemaVersion: number;
  document: Omit<DrawingDocument, 'selection'>;
}

export class RatecadParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RatecadParseError';
  }
}

const ENTITY_TYPES = new Set([
  'line',
  'rectangle',
  'circle',
  'polyline',
  'dimension',
  'text',
  'leader',
]);

function isVec2(value: unknown): value is { x: number; y: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { x?: unknown }).x === 'number' &&
    typeof (value as { y?: unknown }).y === 'number' &&
    Number.isFinite((value as { x: number }).x) &&
    Number.isFinite((value as { y: number }).y)
  );
}

function assertEntity(raw: unknown, index: number): Entity {
  if (!raw || typeof raw !== 'object') {
    throw new RatecadParseError(`Invalid entity at index ${index}`);
  }
  const e = raw as Record<string, unknown>;
  if (typeof e.id !== 'string' || !e.id) {
    throw new RatecadParseError(`Entity ${index} missing id`);
  }
  if (typeof e.type !== 'string' || !ENTITY_TYPES.has(e.type)) {
    throw new RatecadParseError(`Entity ${e.id}: unsupported type`);
  }
  if (typeof e.layerId !== 'string') {
    throw new RatecadParseError(`Entity ${e.id}: missing layerId`);
  }
  const geometry = e.geometry;
  if (!geometry || typeof geometry !== 'object') {
    throw new RatecadParseError(`Entity ${e.id}: missing geometry`);
  }
  const g = geometry as Record<string, unknown>;

  switch (e.type) {
    case 'line':
      if (!isVec2(g.start) || !isVec2(g.end)) {
        throw new RatecadParseError(`Entity ${e.id}: invalid line geometry`);
      }
      break;
    case 'rectangle':
      if (!isVec2(g.corner1) || !isVec2(g.corner2)) {
        throw new RatecadParseError(`Entity ${e.id}: invalid rectangle geometry`);
      }
      break;
    case 'circle':
      if (!isVec2(g.center) || typeof g.radius !== 'number' || !(g.radius >= 0)) {
        throw new RatecadParseError(`Entity ${e.id}: invalid circle geometry`);
      }
      break;
    case 'polyline': {
      if (!Array.isArray(g.vertices) || g.vertices.length < 2) {
        throw new RatecadParseError(`Entity ${e.id}: polyline needs ≥2 vertices`);
      }
      if (!g.vertices.every(isVec2)) {
        throw new RatecadParseError(`Entity ${e.id}: invalid polyline vertices`);
      }
      break;
    }
    case 'dimension': {
      if (
        typeof g.kind !== 'string' ||
        !['horizontal', 'vertical', 'aligned'].includes(g.kind) ||
        !isVec2(g.start) ||
        !isVec2(g.end) ||
        typeof g.offset !== 'number' ||
        !Number.isFinite(g.offset)
      ) {
        throw new RatecadParseError(`Entity ${e.id}: invalid dimension geometry`);
      }
      break;
    }
    case 'text': {
      if (
        !isVec2(g.position) ||
        typeof g.content !== 'string' ||
        typeof g.height !== 'number' ||
        !(g.height > 0) ||
        typeof g.rotation !== 'number'
      ) {
        throw new RatecadParseError(`Entity ${e.id}: invalid text geometry`);
      }
      break;
    }
    case 'leader': {
      if (
        !isVec2(g.arrow) ||
        !Array.isArray(g.vertices) ||
        g.vertices.length < 1 ||
        !g.vertices.every(isVec2) ||
        typeof g.content !== 'string' ||
        typeof g.textHeight !== 'number' ||
        !(g.textHeight > 0)
      ) {
        throw new RatecadParseError(`Entity ${e.id}: invalid leader geometry`);
      }
      break;
    }
  }

  return raw as Entity;
}

function assertLayer(raw: unknown, index: number): Layer {
  if (!raw || typeof raw !== 'object') {
    throw new RatecadParseError(`Invalid layer at index ${index}`);
  }
  const l = raw as Record<string, unknown>;
  if (typeof l.id !== 'string' || typeof l.name !== 'string') {
    throw new RatecadParseError(`Layer ${index} invalid`);
  }
  return {
    id: l.id as LayerId,
    name: l.name,
    color: typeof l.color === 'string' ? l.color : '#d4d4d4',
    visible: typeof l.visible === 'boolean' ? l.visible : true,
    locked: typeof l.locked === 'boolean' ? l.locked : false,
  };
}

function migrateDocument(
  fileSchema: number,
  d: Partial<DrawingDocument> & Record<string, unknown>,
  layers: Layer[],
  entities: Entity[],
): DrawingDocument {
  let nextLayers = layers;
  let currentLayerId =
    typeof d.currentLayerId === 'string'
      ? (d.currentLayerId as LayerId)
      : DEFAULT_LAYER_ID;

  // v1 → v2: ensure default annotation layers exist, add dimensionStyle + currentLayerId
  if (fileSchema < 2) {
    const defaults = createDefaultLayers();
    const byName = new Map(nextLayers.map((l) => [l.name.toLowerCase(), l]));
    for (const def of defaults) {
      if (!byName.has(def.name.toLowerCase()) && !nextLayers.some((l) => l.id === def.id)) {
        nextLayers = [...nextLayers, def];
      }
    }
    if (!nextLayers.some((l) => l.id === currentLayerId)) {
      currentLayerId = nextLayers[0]?.id ?? DEFAULT_LAYER_ID;
    }
  }

  const settingsRaw = (d.settings ?? {}) as Record<string, unknown>;
  const dimStyleRaw =
    settingsRaw.dimensionStyle && typeof settingsRaw.dimensionStyle === 'object'
      ? (settingsRaw.dimensionStyle as Record<string, unknown>)
      : {};

  return {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      name: (d.meta as DrawingDocument['meta']).name,
      createdAt:
        typeof (d.meta as DrawingDocument['meta']).createdAt === 'string'
          ? (d.meta as DrawingDocument['meta']).createdAt
          : new Date().toISOString(),
      updatedAt:
        typeof (d.meta as DrawingDocument['meta']).updatedAt === 'string'
          ? (d.meta as DrawingDocument['meta']).updatedAt
          : new Date().toISOString(),
      appVersion:
        typeof (d.meta as DrawingDocument['meta']).appVersion === 'string'
          ? (d.meta as DrawingDocument['meta']).appVersion
          : '0.0.0',
    },
    settings: {
      units: (settingsRaw.units as DrawingDocument['settings']['units']) ?? 'ft',
      precision:
        typeof settingsRaw.precision === 'number' ? settingsRaw.precision : 2,
      gridSize:
        typeof settingsRaw.gridSize === 'number' ? settingsRaw.gridSize : 1,
      snapToGrid:
        typeof settingsRaw.snapToGrid === 'boolean'
          ? settingsRaw.snapToGrid
          : true,
      dimensionStyle: {
        textHeight:
          typeof dimStyleRaw.textHeight === 'number'
            ? dimStyleRaw.textHeight
            : DEFAULT_DIMENSION_STYLE.textHeight,
        arrowSize:
          typeof dimStyleRaw.arrowSize === 'number'
            ? dimStyleRaw.arrowSize
            : DEFAULT_DIMENSION_STYLE.arrowSize,
        precision:
          typeof dimStyleRaw.precision === 'number'
            ? dimStyleRaw.precision
            : DEFAULT_DIMENSION_STYLE.precision,
        extensionGap:
          typeof dimStyleRaw.extensionGap === 'number'
            ? dimStyleRaw.extensionGap
            : DEFAULT_DIMENSION_STYLE.extensionGap,
        extensionBeyond:
          typeof dimStyleRaw.extensionBeyond === 'number'
            ? dimStyleRaw.extensionBeyond
            : DEFAULT_DIMENSION_STYLE.extensionBeyond,
      },
    },
    layers: nextLayers,
    currentLayerId,
    entities,
    selection: [],
  };
}

export function serializeDocument(doc: DrawingDocument): string {
  const file: RatecadFile = {
    format: 'ratecad',
    schemaVersion: doc.schemaVersion,
    document: {
      schemaVersion: doc.schemaVersion,
      meta: doc.meta,
      settings: doc.settings,
      layers: doc.layers,
      currentLayerId: doc.currentLayerId,
      entities: doc.entities,
    },
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

export function parseDocument(text: string): DrawingDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new RatecadParseError('File is not valid JSON');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new RatecadParseError('Invalid RateCAD file structure');
  }

  const file = parsed as Partial<RatecadFile>;
  if (file.format !== 'ratecad') {
    throw new RatecadParseError('Not a RateCAD file (missing format: ratecad)');
  }
  if (typeof file.schemaVersion !== 'number') {
    throw new RatecadParseError('Missing schemaVersion');
  }
  if (file.schemaVersion > SCHEMA_VERSION) {
    throw new RatecadParseError(
      `Unsupported schema version ${file.schemaVersion} (app supports ${SCHEMA_VERSION})`,
    );
  }
  if (!file.document || typeof file.document !== 'object') {
    throw new RatecadParseError('Missing document payload');
  }

  const d = file.document as Partial<DrawingDocument> & Record<string, unknown>;
  if (!d.meta || typeof d.meta !== 'object' || typeof d.meta.name !== 'string') {
    throw new RatecadParseError('Invalid document meta');
  }
  if (!d.settings || typeof d.settings !== 'object') {
    throw new RatecadParseError('Invalid document settings');
  }
  if (!Array.isArray(d.layers) || d.layers.length === 0) {
    throw new RatecadParseError('Document must contain at least one layer');
  }
  if (!Array.isArray(d.entities)) {
    throw new RatecadParseError('Document entities must be an array');
  }

  const layers = d.layers.map(assertLayer);
  const entities = d.entities.map(assertEntity);
  return migrateDocument(file.schemaVersion, d, layers, entities);
}

export function tryParseDocument(
  text: string,
): { ok: true; document: DrawingDocument } | { ok: false; error: string } {
  try {
    return { ok: true, document: parseDocument(text) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown parse error',
    };
  }
}
