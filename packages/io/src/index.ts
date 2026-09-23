import {
  DEFAULT_CONSTRUCTION,
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
  'wall',
  'door',
  'window',
  'room',
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
    case 'wall': {
      if (
        !isVec2(g.start) ||
        !isVec2(g.end) ||
        typeof g.thickness !== 'number' ||
        !(g.thickness > 0) ||
        typeof g.height !== 'number' ||
        !(g.height > 0) ||
        (g.justification !== undefined &&
          !['center', 'left', 'right'].includes(g.justification as string))
      ) {
        throw new RatecadParseError(`Entity ${e.id}: invalid wall geometry`);
      }
      break;
    }
    case 'door': {
      if (
        typeof g.hostWallId !== 'string' ||
        typeof g.position !== 'number' ||
        typeof g.width !== 'number' ||
        !(g.width > 0) ||
        typeof g.height !== 'number' ||
        !(g.height > 0) ||
        (g.swing !== undefined && !['left', 'right'].includes(g.swing as string)) ||
        (g.swingAngle !== undefined && typeof g.swingAngle !== 'number')
      ) {
        throw new RatecadParseError(`Entity ${e.id}: invalid door geometry`);
      }
      break;
    }
    case 'window': {
      if (
        typeof g.hostWallId !== 'string' ||
        typeof g.position !== 'number' ||
        typeof g.width !== 'number' ||
        !(g.width > 0) ||
        typeof g.height !== 'number' ||
        !(g.height > 0) ||
        typeof g.sillHeight !== 'number' ||
        g.sillHeight < 0
      ) {
        throw new RatecadParseError(`Entity ${e.id}: invalid window geometry`);
      }
      break;
    }
    case 'room': {
      const props = (e.properties ?? {}) as Record<string, unknown>;
      if (
        !Array.isArray(g.wallIds) ||
        g.wallIds.length < 3 ||
        !g.wallIds.every((id) => typeof id === 'string') ||
        !Array.isArray(g.wallDirs) ||
        g.wallDirs.length !== g.wallIds.length ||
        !g.wallDirs.every((d) => d === 'forward' || d === 'reverse') ||
        !Array.isArray(g.polygon) ||
        g.polygon.length < 3 ||
        !g.polygon.every(isVec2) ||
        !isVec2(g.labelPosition) ||
        typeof g.area !== 'number' ||
        !(g.area > 0) ||
        typeof props.name !== 'string' ||
        !props.name.trim()
      ) {
        throw new RatecadParseError(`Entity ${e.id}: invalid room geometry`);
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

  // v2 → v3: construction defaults; ensure Walls/Doors/Windows layers
  if (fileSchema < 3) {
    const defaults = createDefaultLayers();
    for (const def of defaults) {
      if (!nextLayers.some((l) => l.id === def.id || l.name === def.name)) {
        nextLayers = [...nextLayers, def];
      }
    }
  }

  // v3 → v4: Rooms layer
  if (fileSchema < 4) {
    const defaults = createDefaultLayers();
    for (const def of defaults) {
      if (!nextLayers.some((l) => l.id === def.id || l.name === def.name)) {
        nextLayers = [...nextLayers, def];
      }
    }
  }

  // v4 → v5: worldUnit + fractionDenominator; legacy 'ft' display → 'ft-in'
  // (geometry stays in previous world units — no scaling on migration)

  // Validate host relationships — drop orphaned doors/windows with warning via filter
  const wallIds = new Set(
    entities.filter((e) => e.type === 'wall').map((e) => e.id),
  );
  let nextEntities = entities.filter((e) => {
    if (e.type === 'door' || e.type === 'window') {
      return wallIds.has(e.geometry.hostWallId);
    }
    return true;
  });
  // Drop rooms whose boundary walls are missing
  nextEntities = nextEntities.filter((e) => {
    if (e.type !== 'room') return true;
    return (
      e.geometry.wallIds.length >= 3 &&
      e.geometry.wallIds.every((id) => wallIds.has(id))
    );
  });

  const settingsRaw = (d.settings ?? {}) as Record<string, unknown>;
  const dimStyleRaw =
    settingsRaw.dimensionStyle && typeof settingsRaw.dimensionStyle === 'object'
      ? (settingsRaw.dimensionStyle as Record<string, unknown>)
      : {};
  const constructionRaw =
    settingsRaw.constructionDefaults &&
    typeof settingsRaw.constructionDefaults === 'object'
      ? (settingsRaw.constructionDefaults as Record<string, unknown>)
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
      worldUnit: (() => {
        const raw = settingsRaw.worldUnit;
        if (
          raw === 'ft' ||
          raw === 'in' ||
          raw === 'm' ||
          raw === 'cm' ||
          raw === 'mm'
        ) {
          return raw;
        }
        // Legacy: coordinates were stored in settings.units (ft meant foot world)
        const legacy = settingsRaw.units;
        if (legacy === 'ft' || legacy === 'ft-in') return 'ft';
        if (
          legacy === 'in' ||
          legacy === 'm' ||
          legacy === 'cm' ||
          legacy === 'mm'
        ) {
          return legacy;
        }
        return 'ft';
      })(),
      units: (() => {
        const raw = settingsRaw.units;
        if (
          raw === 'ft-in' ||
          raw === 'ft' ||
          raw === 'in' ||
          raw === 'm' ||
          raw === 'cm' ||
          raw === 'mm'
        ) {
          // Pre-v5 files used 'ft' for architectural feet-inches display
          if (fileSchema < 5 && raw === 'ft' && settingsRaw.worldUnit == null) {
            return 'ft-in';
          }
          return raw;
        }
        return 'ft-in';
      })(),
      precision:
        typeof settingsRaw.precision === 'number' ? settingsRaw.precision : 2,
      fractionDenominator:
        typeof settingsRaw.fractionDenominator === 'number' &&
        [1, 2, 4, 8, 16, 32].includes(settingsRaw.fractionDenominator)
          ? settingsRaw.fractionDenominator
          : 16,
      gridSize:
        typeof settingsRaw.gridSize === 'number' ? settingsRaw.gridSize : 1,
      snapToGrid:
        typeof settingsRaw.snapToGrid === 'boolean'
          ? settingsRaw.snapToGrid
          : true,
      trimMode:
        settingsRaw.trimMode === 'standard' || settingsRaw.trimMode === 'quick'
          ? settingsRaw.trimMode
          : 'quick',
      edgeMode:
        settingsRaw.edgeMode === 'extend' || settingsRaw.edgeMode === 'no-extend'
          ? settingsRaw.edgeMode
          : 'no-extend',
      projectMode:
        settingsRaw.projectMode === 'ucs' ||
        settingsRaw.projectMode === 'view' ||
        settingsRaw.projectMode === 'none'
          ? settingsRaw.projectMode
          : 'none',
      trimEraseUntrimmable:
        typeof settingsRaw.trimEraseUntrimmable === 'boolean'
          ? settingsRaw.trimEraseUntrimmable
          : false,
      filletRadius:
        typeof settingsRaw.filletRadius === 'number' &&
        Number.isFinite(settingsRaw.filletRadius) &&
        settingsRaw.filletRadius >= 0
          ? settingsRaw.filletRadius
          : 0,
      filletTrim:
        typeof settingsRaw.filletTrim === 'boolean'
          ? settingsRaw.filletTrim
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
      constructionDefaults: {
        wallThickness:
          typeof constructionRaw.wallThickness === 'number'
            ? constructionRaw.wallThickness
            : DEFAULT_CONSTRUCTION.wallThickness,
        wallHeight:
          typeof constructionRaw.wallHeight === 'number'
            ? constructionRaw.wallHeight
            : DEFAULT_CONSTRUCTION.wallHeight,
        doorWidth:
          typeof constructionRaw.doorWidth === 'number'
            ? constructionRaw.doorWidth
            : DEFAULT_CONSTRUCTION.doorWidth,
        doorHeight:
          typeof constructionRaw.doorHeight === 'number'
            ? constructionRaw.doorHeight
            : DEFAULT_CONSTRUCTION.doorHeight,
        windowWidth:
          typeof constructionRaw.windowWidth === 'number'
            ? constructionRaw.windowWidth
            : DEFAULT_CONSTRUCTION.windowWidth,
        windowHeight:
          typeof constructionRaw.windowHeight === 'number'
            ? constructionRaw.windowHeight
            : DEFAULT_CONSTRUCTION.windowHeight,
        windowSill:
          typeof constructionRaw.windowSill === 'number'
            ? constructionRaw.windowSill
            : DEFAULT_CONSTRUCTION.windowSill,
      },
    },
    layers: nextLayers,
    currentLayerId,
    entities: nextEntities,
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
