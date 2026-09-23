import type {
  DrawingDocument,
  DrawingSettings,
  Entity,
  LengthUnit,
  Vec2,
} from '@ratecad/core';
import { convertLength } from '@ratecad/geometry';
import type { Command } from './bus.js';

/** Undoable display-unit / precision change — does not alter geometry. */
export class SetDrawingUnitsCommand implements Command {
  readonly name = 'SetDrawingUnits';
  private readonly before: Pick<
    DrawingSettings,
    'units' | 'precision' | 'fractionDenominator' | 'gridSize'
  >;
  private readonly after: Partial<
    Pick<
      DrawingSettings,
      'units' | 'precision' | 'fractionDenominator' | 'gridSize'
    >
  >;

  constructor(
    previous: DrawingDocument,
    patch: Partial<
      Pick<
        DrawingSettings,
        'units' | 'precision' | 'fractionDenominator' | 'gridSize'
      >
    >,
  ) {
    this.before = {
      units: previous.settings.units,
      precision: previous.settings.precision,
      fractionDenominator: previous.settings.fractionDenominator ?? 16,
      gridSize: previous.settings.gridSize,
    };
    this.after = patch;
  }

  execute(doc: DrawingDocument): DrawingDocument {
    return {
      ...doc,
      settings: {
        ...doc.settings,
        ...this.after,
      },
      meta: { ...doc.meta, updatedAt: new Date().toISOString() },
    };
  }

  undo(doc: DrawingDocument): DrawingDocument {
    return {
      ...doc,
      settings: {
        ...doc.settings,
        ...this.before,
      },
      meta: { ...doc.meta, updatedAt: new Date().toISOString() },
    };
  }
}

function scaleVec(p: Vec2, factor: number): Vec2 {
  return { x: p.x * factor, y: p.y * factor };
}

/** Scale all linear geometry from one world unit to another (import conversion). */
export function scaleEntityToWorldUnit(
  entity: Entity,
  factor: number,
): Entity {
  if (!(factor > 0) || Math.abs(factor - 1) < 1e-15) return entity;
  switch (entity.type) {
    case 'line':
      return {
        ...entity,
        geometry: {
          start: scaleVec(entity.geometry.start, factor),
          end: scaleVec(entity.geometry.end, factor),
        },
      };
    case 'rectangle':
      return {
        ...entity,
        geometry: {
          corner1: scaleVec(entity.geometry.corner1, factor),
          corner2: scaleVec(entity.geometry.corner2, factor),
        },
      };
    case 'circle':
      return {
        ...entity,
        geometry: {
          center: scaleVec(entity.geometry.center, factor),
          radius: entity.geometry.radius * factor,
        },
      };
    case 'polyline':
      return {
        ...entity,
        geometry: {
          ...entity.geometry,
          vertices: entity.geometry.vertices.map((v) => scaleVec(v, factor)),
        },
      };
    case 'dimension':
      return {
        ...entity,
        geometry: {
          ...entity.geometry,
          start: scaleVec(entity.geometry.start, factor),
          end: scaleVec(entity.geometry.end, factor),
          offset: entity.geometry.offset * factor,
          textOffset:
            entity.geometry.textOffset != null
              ? entity.geometry.textOffset * factor
              : undefined,
          vertex: entity.geometry.vertex
            ? scaleVec(entity.geometry.vertex, factor)
            : undefined,
        },
      };
    case 'text':
      return {
        ...entity,
        geometry: {
          ...entity.geometry,
          position: scaleVec(entity.geometry.position, factor),
          height: entity.geometry.height * factor,
        },
      };
    case 'leader':
      return {
        ...entity,
        geometry: {
          ...entity.geometry,
          vertices: entity.geometry.vertices.map((v) => scaleVec(v, factor)),
          textHeight: entity.geometry.textHeight * factor,
        },
      };
    case 'wall':
      return {
        ...entity,
        geometry: {
          ...entity.geometry,
          start: scaleVec(entity.geometry.start, factor),
          end: scaleVec(entity.geometry.end, factor),
          thickness: entity.geometry.thickness * factor,
          height: entity.geometry.height * factor,
        },
      };
    case 'door':
      return {
        ...entity,
        geometry: {
          ...entity.geometry,
          width: entity.geometry.width * factor,
          height: entity.geometry.height * factor,
        },
      };
    case 'window':
      return {
        ...entity,
        geometry: {
          ...entity.geometry,
          width: entity.geometry.width * factor,
          height: entity.geometry.height * factor,
          sillHeight: entity.geometry.sillHeight * factor,
        },
      };
    case 'room':
      return {
        ...entity,
        geometry: {
          ...entity.geometry,
          polygon: entity.geometry.polygon.map((v) => scaleVec(v, factor)),
          labelPosition: scaleVec(entity.geometry.labelPosition, factor),
          area: entity.geometry.area * factor * factor,
        },
      };
    default:
      return entity;
  }
}

/**
 * Convert imported / mis-unit geometry by changing worldUnit and scaling.
 * This is NOT a display-unit change.
 */
export class ConvertDrawingWorldUnitCommand implements Command {
  readonly name = 'ConvertDrawingWorldUnit';
  private readonly fromUnit: LengthUnit;
  private readonly toUnit: LengthUnit;
  private readonly factor: number;
  private readonly beforeEntities: Entity[];
  private readonly beforeSettings: DrawingDocument['settings'];

  constructor(doc: DrawingDocument, toUnit: LengthUnit) {
    const from: LengthUnit =
      doc.settings.worldUnit === 'ft-in' ? 'ft' : doc.settings.worldUnit;
    const to: LengthUnit = toUnit === 'ft-in' ? 'ft' : toUnit;
    this.fromUnit = from;
    this.toUnit = to;
    this.factor = convertLength(1, from, to);
    this.beforeEntities = structuredClone(doc.entities);
    this.beforeSettings = structuredClone(doc.settings);
  }

  execute(doc: DrawingDocument): DrawingDocument {
    const factor = this.factor;
    const entities = doc.entities.map((e) =>
      scaleEntityToWorldUnit(e, factor),
    );
    const s = doc.settings;
    return {
      ...doc,
      entities,
      settings: {
        ...s,
        worldUnit: this.toUnit,
        gridSize: s.gridSize * factor,
        dimensionStyle: {
          ...s.dimensionStyle,
          textHeight: s.dimensionStyle.textHeight * factor,
          arrowSize: s.dimensionStyle.arrowSize * factor,
          extensionGap: s.dimensionStyle.extensionGap * factor,
          extensionBeyond: s.dimensionStyle.extensionBeyond * factor,
        },
        constructionDefaults: {
          wallThickness: s.constructionDefaults.wallThickness * factor,
          wallHeight: s.constructionDefaults.wallHeight * factor,
          doorWidth: s.constructionDefaults.doorWidth * factor,
          doorHeight: s.constructionDefaults.doorHeight * factor,
          windowWidth: s.constructionDefaults.windowWidth * factor,
          windowHeight: s.constructionDefaults.windowHeight * factor,
          windowSill: s.constructionDefaults.windowSill * factor,
        },
      },
      meta: { ...doc.meta, updatedAt: new Date().toISOString() },
    };
  }

  undo(doc: DrawingDocument): DrawingDocument {
    return {
      ...doc,
      entities: structuredClone(this.beforeEntities),
      settings: structuredClone(this.beforeSettings),
      meta: { ...doc.meta, updatedAt: new Date().toISOString() },
    };
  }
}
