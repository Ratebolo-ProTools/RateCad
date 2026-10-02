/**
 * Undoable UNITS / DIMSTYLE document settings commands.
 */

import type {
  DimensionStyleDefinition,
  DrawingDocument,
  DrawingUnitsSettings,
} from '@ratecad/core';
import {
  applyDrawingUnits,
  cloneDimensionStyle,
  createEntityId,
  findDimensionStyle,
  getActiveDimensionStyle,
  legacyStyleFromDefinition,
  normalizeDrawingUnits,
} from '@ratecad/core';
import type { Command } from './bus.js';

/** Apply AutoCAD-style Drawing Units (display only — no geometry rewrite). */
export class SetDrawingUnitsSettingsCommand implements Command {
  readonly name = 'SetDrawingUnitsSettings';
  private readonly before: DrawingDocument['settings'];
  private readonly patch: Partial<DrawingUnitsSettings>;

  constructor(doc: DrawingDocument, patch: Partial<DrawingUnitsSettings>) {
    this.before = structuredClone(doc.settings);
    this.patch = patch;
  }

  execute(doc: DrawingDocument): DrawingDocument {
    const current = normalizeDrawingUnits(doc.settings.drawingUnits);
    const synced = applyDrawingUnits(
      {
        worldUnit: doc.settings.worldUnit,
        units: doc.settings.units,
        precision: doc.settings.precision,
        fractionDenominator: doc.settings.fractionDenominator,
        drawingUnits: current,
      },
      this.patch,
    );
    return {
      ...doc,
      settings: {
        ...doc.settings,
        drawingUnits: synced.drawingUnits,
        units: synced.units,
        precision: synced.precision,
        fractionDenominator: synced.fractionDenominator,
      },
      meta: { ...doc.meta, updatedAt: new Date().toISOString() },
    };
  }

  undo(doc: DrawingDocument): DrawingDocument {
    return {
      ...doc,
      settings: structuredClone(this.before),
      meta: { ...doc.meta, updatedAt: new Date().toISOString() },
    };
  }
}

function syncLegacyDimStyle(
  styles: DimensionStyleDefinition[],
  activeName: string,
) {
  const active = getActiveDimensionStyle(styles, activeName);
  return legacyStyleFromDefinition(active);
}

/** Set the active dimension style by name. */
export class SetActiveDimensionStyleCommand implements Command {
  readonly name = 'SetActiveDimensionStyle';
  private readonly beforeName: string;
  private readonly beforeLegacy: DrawingDocument['settings']['dimensionStyle'];
  private readonly afterName: string;

  constructor(doc: DrawingDocument, styleName: string) {
    this.beforeName = doc.settings.activeDimensionStyleName ?? 'Standard';
    this.beforeLegacy = structuredClone(doc.settings.dimensionStyle);
    this.afterName = styleName;
  }

  execute(doc: DrawingDocument): DrawingDocument {
    const styles = doc.settings.dimensionStyles ?? [];
    const found = findDimensionStyle(styles, this.afterName);
    if (!found) return doc;
    return {
      ...doc,
      settings: {
        ...doc.settings,
        activeDimensionStyleName: found.name,
        dimensionStyle: syncLegacyDimStyle(styles, found.name),
      },
      meta: { ...doc.meta, updatedAt: new Date().toISOString() },
    };
  }

  undo(doc: DrawingDocument): DrawingDocument {
    return {
      ...doc,
      settings: {
        ...doc.settings,
        activeDimensionStyleName: this.beforeName,
        dimensionStyle: structuredClone(this.beforeLegacy),
      },
      meta: { ...doc.meta, updatedAt: new Date().toISOString() },
    };
  }
}

/** Replace / update one named dimension style definition. */
export class UpdateDimensionStyleCommand implements Command {
  readonly name = 'UpdateDimensionStyle';
  private readonly beforeStyles: DimensionStyleDefinition[];
  private readonly beforeActive: string;
  private readonly beforeLegacy: DrawingDocument['settings']['dimensionStyle'];
  private readonly style: DimensionStyleDefinition;

  constructor(doc: DrawingDocument, style: DimensionStyleDefinition) {
    this.beforeStyles = structuredClone(doc.settings.dimensionStyles ?? []);
    this.beforeActive = doc.settings.activeDimensionStyleName ?? 'Standard';
    this.beforeLegacy = structuredClone(doc.settings.dimensionStyle);
    this.style = structuredClone(style);
  }

  execute(doc: DrawingDocument): DrawingDocument {
    const styles = structuredClone(doc.settings.dimensionStyles ?? []);
    const idx = styles.findIndex(
      (s) => s.id === this.style.id || s.name === this.style.name,
    );
    if (idx >= 0) styles[idx] = this.style;
    else styles.push(this.style);
    const active = doc.settings.activeDimensionStyleName ?? 'Standard';
    return {
      ...doc,
      settings: {
        ...doc.settings,
        dimensionStyles: styles,
        dimensionStyle: syncLegacyDimStyle(styles, active),
      },
      meta: { ...doc.meta, updatedAt: new Date().toISOString() },
    };
  }

  undo(doc: DrawingDocument): DrawingDocument {
    return {
      ...doc,
      settings: {
        ...doc.settings,
        dimensionStyles: structuredClone(this.beforeStyles),
        activeDimensionStyleName: this.beforeActive,
        dimensionStyle: structuredClone(this.beforeLegacy),
      },
      meta: { ...doc.meta, updatedAt: new Date().toISOString() },
    };
  }
}

/** Create a copy of a dimension style under a new name. */
export class CopyDimensionStyleCommand implements Command {
  readonly name = 'CopyDimensionStyle';
  private readonly beforeStyles: DimensionStyleDefinition[];
  private readonly sourceName: string;
  private readonly newName: string;
  private readonly newId: string;

  constructor(doc: DrawingDocument, sourceName: string, newName: string) {
    this.beforeStyles = structuredClone(doc.settings.dimensionStyles ?? []);
    this.sourceName = sourceName;
    this.newName = newName;
    this.newId = createEntityId('dimstyle');
  }

  execute(doc: DrawingDocument): DrawingDocument {
    const styles = structuredClone(doc.settings.dimensionStyles ?? []);
    const src = findDimensionStyle(styles, this.sourceName);
    if (!src) return doc;
    if (findDimensionStyle(styles, this.newName)) return doc;
    styles.push(cloneDimensionStyle(src, this.newId, this.newName));
    return {
      ...doc,
      settings: { ...doc.settings, dimensionStyles: styles },
      meta: { ...doc.meta, updatedAt: new Date().toISOString() },
    };
  }

  undo(doc: DrawingDocument): DrawingDocument {
    return {
      ...doc,
      settings: {
        ...doc.settings,
        dimensionStyles: structuredClone(this.beforeStyles),
      },
      meta: { ...doc.meta, updatedAt: new Date().toISOString() },
    };
  }
}

/** Rename a dimension style (not the active name uniqueness). */
export class RenameDimensionStyleCommand implements Command {
  readonly name = 'RenameDimensionStyle';
  private readonly beforeStyles: DimensionStyleDefinition[];
  private readonly beforeActive: string;
  private readonly fromName: string;
  private readonly toName: string;

  constructor(doc: DrawingDocument, fromName: string, toName: string) {
    this.beforeStyles = structuredClone(doc.settings.dimensionStyles ?? []);
    this.beforeActive = doc.settings.activeDimensionStyleName ?? 'Standard';
    this.fromName = fromName;
    this.toName = toName;
  }

  execute(doc: DrawingDocument): DrawingDocument {
    const styles = structuredClone(doc.settings.dimensionStyles ?? []);
    const style = findDimensionStyle(styles, this.fromName);
    if (!style) return doc;
    if (findDimensionStyle(styles, this.toName)) return doc;
    style.name = this.toName;
    const active =
      doc.settings.activeDimensionStyleName === this.fromName
        ? this.toName
        : doc.settings.activeDimensionStyleName;
    return {
      ...doc,
      settings: {
        ...doc.settings,
        dimensionStyles: styles,
        activeDimensionStyleName: active,
      },
      meta: { ...doc.meta, updatedAt: new Date().toISOString() },
    };
  }

  undo(doc: DrawingDocument): DrawingDocument {
    return {
      ...doc,
      settings: {
        ...doc.settings,
        dimensionStyles: structuredClone(this.beforeStyles),
        activeDimensionStyleName: this.beforeActive,
      },
      meta: { ...doc.meta, updatedAt: new Date().toISOString() },
    };
  }
}

/** Delete a named style — refuses to delete the active style. */
export class DeleteDimensionStyleCommand implements Command {
  readonly name = 'DeleteDimensionStyle';
  private readonly beforeStyles: DimensionStyleDefinition[];
  private readonly styleName: string;
  private readonly blocked: boolean;

  constructor(doc: DrawingDocument, styleName: string) {
    this.beforeStyles = structuredClone(doc.settings.dimensionStyles ?? []);
    this.styleName = styleName;
    this.blocked =
      (doc.settings.activeDimensionStyleName ?? 'Standard').toLowerCase() ===
      styleName.trim().toLowerCase();
  }

  execute(doc: DrawingDocument): DrawingDocument {
    if (this.blocked) return doc;
    const active = (doc.settings.activeDimensionStyleName ?? 'Standard').toLowerCase();
    if (this.styleName.trim().toLowerCase() === active) return doc;
    const styles = (doc.settings.dimensionStyles ?? []).filter(
      (s) => s.name.toLowerCase() !== this.styleName.trim().toLowerCase(),
    );
    if (styles.length === this.beforeStyles.length) return doc;
    return {
      ...doc,
      settings: { ...doc.settings, dimensionStyles: styles },
      meta: { ...doc.meta, updatedAt: new Date().toISOString() },
    };
  }

  undo(doc: DrawingDocument): DrawingDocument {
    return {
      ...doc,
      settings: {
        ...doc.settings,
        dimensionStyles: structuredClone(this.beforeStyles),
      },
      meta: { ...doc.meta, updatedAt: new Date().toISOString() },
    };
  }
}
