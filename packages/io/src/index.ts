import {
  SCHEMA_VERSION,
  type DrawingDocument,
  type Entity,
  type Layer,
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

const ENTITY_TYPES = new Set(['line', 'rectangle', 'circle', 'polyline']);

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
  return raw as Layer;
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

  const d = file.document as Partial<DrawingDocument>;
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

  return {
    schemaVersion: d.schemaVersion ?? file.schemaVersion,
    meta: {
      name: d.meta.name,
      createdAt: typeof d.meta.createdAt === 'string' ? d.meta.createdAt : new Date().toISOString(),
      updatedAt: typeof d.meta.updatedAt === 'string' ? d.meta.updatedAt : new Date().toISOString(),
      appVersion: typeof d.meta.appVersion === 'string' ? d.meta.appVersion : '0.0.0',
    },
    settings: {
      units: (d.settings.units as DrawingDocument['settings']['units']) ?? 'ft',
      precision: typeof d.settings.precision === 'number' ? d.settings.precision : 2,
      gridSize: typeof d.settings.gridSize === 'number' ? d.settings.gridSize : 1,
      snapToGrid: typeof d.settings.snapToGrid === 'boolean' ? d.settings.snapToGrid : true,
    },
    layers,
    entities,
    selection: [],
  };
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
