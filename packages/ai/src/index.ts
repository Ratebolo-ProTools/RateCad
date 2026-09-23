import type { LengthUnit } from '@ratecad/core';
import {
  areaFromEntity,
  defaultBoundaryTolerance,
  findBoundaryAtPoint,
  formatWorldArea,
  formatWorldLength,
  parseLength,
  resolveUnitAlias,
  type ParsedLength,
} from '@ratecad/geometry';
import type { Command } from '@ratecad/commands';
import type { DrawingDocument } from '@ratecad/core';

/**
 * Architectural boundary for future AI commands.
 *
 * Target flow (NOT implemented as LLM yet):
 *   User Prompt → AI → Validated DrawingCommand[] → CommandBus → DrawingDocument → Viewport
 *
 * AI must NEVER manipulate the renderer or dimension text directly.
 * Geometry commands + the unit engine own measurements.
 */

export interface AiDrawingContext {
  document: DrawingDocument;
  selectedEntityIds: string[];
  units: DrawingDocument['settings']['units'];
  worldUnit: DrawingDocument['settings']['worldUnit'];
}

export interface AiCommandProposal {
  /** Natural-language summary for the user */
  summary: string;
  /** Commands that would be executed on the shared CommandBus */
  commands: Command[];
}

export interface AiProvider {
  proposeCommands(
    prompt: string,
    context: AiDrawingContext,
  ): Promise<AiCommandProposal>;
}

export class AiNotImplementedError extends Error {
  constructor() {
    super(
      'AI LLM command engine is not implemented yet. Unit-aware parsing helpers are available.',
    );
    this.name = 'AiNotImplementedError';
  }
}

/** Placeholder provider — keeps the package boundary ready for later milestones. */
export class StubAiProvider implements AiProvider {
  async proposeCommands(): Promise<AiCommandProposal> {
    throw new AiNotImplementedError();
  }
}

/** Extract a length mention from natural language into world units. */
export function parseAiLength(
  text: string,
  worldUnit: LengthUnit,
  displayUnit: LengthUnit,
): ParsedLength | null {
  // Prefer explicit patterns like "10 feet", "3.5 m", "3'-4\""
  const patterns = [
    /(\d+(?:\.\d+)?)\s*(millimeters?|millimetres?|mm)\b/i,
    /(\d+(?:\.\d+)?)\s*(centimeters?|centimetres?|cm)\b/i,
    /(\d+(?:\.\d+)?)\s*(meters?|metres?|m)\b/i,
    /(\d+(?:\.\d+)?)\s*(inches|inch|in)\b/i,
    /(\d+(?:\.\d+)?)\s*(feet|foot|ft)\b/i,
    /(\d+)\s*'\s*-?\s*(\d+(?:\.\d+)?)\s*"?/,
    /(\d+(?:\.\d+)?)\s*["']/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;
    const snippet = m[0]!;
    const parsed = parseLength(snippet, worldUnit, displayUnit);
    if (parsed) return parsed;
  }
  return null;
}

/** Detect a request to change display units (not geometry scale). */
export function parseAiDisplayUnitChange(text: string): LengthUnit | null {
  const lower = text.toLowerCase();
  if (/feet\s*(?:&|and)?\s*inches|ft-in|architectural/.test(lower)) return 'ft-in';
  const m = lower.match(
    /(?:units?|dimensions?|display)\s+(?:to|in|as)\s+(mm|cm|m|meters?|metres?|in|inches|ft|feet|foot)/,
  );
  if (m) return resolveUnitAlias(m[1]!) ?? null;
  if (/change.*(?:to|into)\s+meters?/.test(lower)) return 'm';
  if (/change.*(?:to|into)\s+millimeters?/.test(lower)) return 'mm';
  if (/change.*(?:to|into)\s+centimeters?/.test(lower)) return 'cm';
  if (/show.*feet\s*&?\s*inches/.test(lower)) return 'ft-in';
  return null;
}

/** Detect geometry-scale conversion request (import-style). */
export function parseAiWorldUnitConversion(text: string): LengthUnit | null {
  const lower = text.toLowerCase();
  const m = lower.match(
    /convert\s+(?:the\s+)?(?:drawing(?:\s+dimensions?)?|geometry|dimensions?)\s+to\s+(millimeters?|millimetres?|mm|centimeters?|centimetres?|cm|meters?|metres?|m|inches|inch|in|feet|foot|ft)/,
  );
  if (!m) return null;
  const u = resolveUnitAlias(m[1]!);
  return u === 'ft-in' ? 'ft' : u;
}

/** Detect a natural-language CAD request (vs alias/command token). */
export function isNaturalLanguageCadRequest(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (t.split(/\s+/).length >= 3) return true;
  return /make\s|change\s|calculate\s|show\s|convert\s|please\s|this\s+wall|draw\s+a\s/i.test(
    t,
  );
}

/**
 * Area-related AI intents — always resolved via the deterministic Area Engine.
 * The LLM must never invent numeric areas.
 */
export type AiAreaIntent =
  | { kind: 'selection' }
  | { kind: 'all-rooms' }
  | { kind: 'pick-inside' }
  | { kind: 'net-floor' }
  | { kind: 'show-unit'; unit: LengthUnit }
  | { kind: 'none' };

export function parseAiAreaIntent(text: string): AiAreaIntent {
  const lower = text.toLowerCase();
  if (
    /show\s+(?:the\s+)?area\s+in\s+square\s+meters|area\s+in\s+m²|in\s+square\s+metres/.test(
      lower,
    )
  ) {
    return { kind: 'show-unit', unit: 'm' };
  }
  if (
    /show\s+(?:the\s+)?area\s+in\s+square\s+feet|area\s+in\s+ft²|in\s+sq\.?\s*ft/.test(
      lower,
    )
  ) {
    return { kind: 'show-unit', unit: 'ft' };
  }
  if (
    /all\s+rooms|every\s+room|total\s+floor\s+area|calculate\s+area\s+of\s+all\s+rooms/.test(
      lower,
    )
  ) {
    return { kind: 'all-rooms' };
  }
  if (
    /net\s+area|excluding\s+columns?|subtract\s+(?:the\s+)?(?:staircase|opening|column)/.test(
      lower,
    )
  ) {
    return { kind: 'net-floor' };
  }
  if (
    /pick\s+inside|click\s+inside|this\s+room|enclosed\s+region|boundary/.test(
      lower,
    )
  ) {
    return { kind: 'pick-inside' };
  }
  if (
    /calculate\s+(?:the\s+)?area|measure\s+(?:the\s+)?area|area\s+of\s+this|add\s+these\s+.*areas/.test(
      lower,
    )
  ) {
    return { kind: 'selection' };
  }
  return { kind: 'none' };
}

export interface AiAreaQueryResult {
  summary: string;
  /** World-unit net area when a single region was measured. */
  area?: number;
  perimeter?: number;
  /** Formatted for the requested / current display unit. */
  areaText?: string;
  perimeterText?: string;
  rooms?: Array<{ name: string; area: number; areaText: string }>;
  totalArea?: number;
  totalAreaText?: string;
  warnings: string[];
}

/**
 * Execute an area intent against the document using the shared Area Engine.
 * Never invents geometry numbers — all values come from areaFromEntity / reports.
 */
export function executeAiAreaQuery(
  intent: AiAreaIntent,
  context: AiDrawingContext,
  options: { displayUnit?: LengthUnit; pickPoint?: { x: number; y: number } } = {},
): AiAreaQueryResult {
  const doc = context.document;
  const world = context.worldUnit ?? 'ft';
  const display = options.displayUnit ?? context.units;
  const precision = doc.settings.precision ?? 2;
  const warnings: string[] = [];

  if (intent.kind === 'none') {
    return { summary: 'No area intent detected', warnings };
  }

  if (intent.kind === 'show-unit') {
    // Re-run selection formatting in the requested unit
    const nested = executeAiAreaQuery(
      { kind: 'selection' },
      context,
      { displayUnit: intent.unit, pickPoint: options.pickPoint },
    );
    return {
      ...nested,
      summary: nested.areaText
        ? `Area shown in ${intent.unit}: ${nested.areaText}`
        : nested.summary,
    };
  }

  if (intent.kind === 'all-rooms') {
    const rooms: AiAreaQueryResult['rooms'] = [];
    let total = 0;
    for (const e of doc.entities) {
      if (e.type !== 'room' || !e.visible) continue;
      const r = areaFromEntity(e);
      if (!r.ok) {
        warnings.push(r.reason);
        continue;
      }
      rooms.push({
        name: e.properties.name || 'Room',
        area: r.area,
        areaText: formatWorldArea(r.area, world, display, precision),
      });
      total += r.area;
    }
    return {
      summary: `Room area report · ${rooms.length} room(s)`,
      rooms,
      totalArea: total,
      totalAreaText: formatWorldArea(total, world, display, precision),
      warnings,
    };
  }

  if (intent.kind === 'pick-inside') {
    if (!options.pickPoint) {
      return {
        summary: 'Pick-inside requires a point — activate AREA · Pick Inside',
        warnings: ['Missing pick point'],
      };
    }
    const r = findBoundaryAtPoint(doc, options.pickPoint, {
      tolerance: defaultBoundaryTolerance(doc),
    });
    if (!r.ok) {
      return { summary: r.reason, warnings: [r.reason] };
    }
    return {
      summary: 'Boundary area from pick-inside',
      area: r.area,
      perimeter: r.perimeter,
      areaText: formatWorldArea(r.area, world, display, precision),
      perimeterText: formatWorldLength(r.perimeter, world, display, {
        precision,
      }),
      warnings: r.warnings,
    };
  }

  if (intent.kind === 'net-floor' || intent.kind === 'selection') {
    const ids = context.selectedEntityIds;
    if (!ids.length) {
      // Fall back to all rooms for net-floor
      if (intent.kind === 'net-floor') {
        return executeAiAreaQuery({ kind: 'all-rooms' }, context, options);
      }
      return {
        summary: 'Select a closed object, then ask to calculate its area',
        warnings: ['Nothing selected'],
      };
    }
    let total = 0;
    let peri = 0;
    const parts: string[] = [];
    for (const id of ids) {
      const e = doc.entities.find((x) => x.id === id);
      if (!e) continue;
      const r = areaFromEntity(e);
      if (!r.ok) {
        warnings.push(`${id}: ${r.reason}`);
        continue;
      }
      total += r.area;
      peri += r.perimeter;
      parts.push(formatWorldArea(r.area, world, display, precision));
    }
    if (!parts.length) {
      return {
        summary: 'No closed area objects in selection',
        warnings,
      };
    }
    return {
      summary:
        intent.kind === 'net-floor'
          ? `Net area from selection (${parts.length} region(s))`
          : `Area of selection (${parts.length} object(s))`,
      area: total,
      perimeter: peri,
      areaText: formatWorldArea(total, world, display, precision),
      perimeterText: formatWorldLength(peri, world, display, { precision }),
      warnings,
    };
  }

  return { summary: 'Unhandled area intent', warnings };
}

// ---------------------------------------------------------------------------
// TRIM AI intents — always resolved via TrimExtendEngine (never LLM coords)
// ---------------------------------------------------------------------------

export type AiTrimIntent =
  | {
      kind: 'trim';
      mode?: 'quick' | 'standard';
      edgeMode?: 'extend' | 'no-extend';
      projectMode?: 'none' | 'ucs' | 'view';
      needsCuttingEdge: boolean;
      needsTargets: boolean;
      summary: string;
    }
  | { kind: 'none' };

/**
 * Parse natural-language TRIM requests into a deterministic intent.
 * The LLM must never invent intersection coordinates — invoke TrimExtendEngine.
 */
export function parseAiTrimIntent(text: string): AiTrimIntent {
  const lower = text.toLowerCase().trim();
  if (!/\btrim\b|\btrimming\b|\bcut\s+(?:this|the|these)\b/.test(lower)) {
    return { kind: 'none' };
  }

  const mode: 'quick' | 'standard' | undefined = /\bstandard\b/.test(lower)
    ? 'standard'
    : /\bquick\b/.test(lower)
      ? 'quick'
      : undefined;

  const edgeMode: 'extend' | 'no-extend' | undefined = /\bno\s*extend\b/.test(
    lower,
  )
    ? 'no-extend'
    : /\bedge\s+extend\b|\bextend(?:ed)?\s+edge\b/.test(lower)
      ? 'extend'
      : undefined;

  const hasBoundary =
    /cutting\s+edge|boundary|against\s+(?:the\s+)?(?:wall|line|circle)|to\s+(?:the\s+)?(?:wall|line|circle|this)/.test(
      lower,
    );
  const hasTargets =
    /this\s+line|these\s+lines|the\s+wall|intersecting|everything\s+inside|selected/.test(
      lower,
    );

  // If user asks to trim but does not name a boundary safely → require pick
  const needsCuttingEdge = !hasBoundary;
  const needsTargets = !hasTargets;

  return {
    kind: 'trim',
    mode,
    edgeMode,
    projectMode: 'none',
    needsCuttingEdge,
    needsTargets,
    summary: needsCuttingEdge
      ? 'I need a cutting edge. Select the boundary to trim against.'
      : needsTargets
        ? 'Select the object(s) to trim.'
        : 'Ready to run TRIM via TrimExtendEngine.',
  };
}

export interface AiTrimProposal {
  summary: string;
  /** When true, UI must ask the user to pick a cutting edge — do not guess. */
  requireCuttingEdgePick: boolean;
  requireTargetPick: boolean;
  commandAlias: 'TRIM';
  mode?: 'quick' | 'standard';
  edgeMode?: 'extend' | 'no-extend';
  projectMode?: 'none' | 'ucs' | 'view';
}

/** Build a safe TRIM proposal from NL — never includes raw coordinates. */
export function proposeAiTrimCommand(text: string): AiTrimProposal | null {
  const intent = parseAiTrimIntent(text);
  if (intent.kind === 'none') return null;
  return {
    summary: intent.summary,
    requireCuttingEdgePick: intent.needsCuttingEdge,
    requireTargetPick: intent.needsTargets,
    commandAlias: 'TRIM',
    mode: intent.mode,
    edgeMode: intent.edgeMode,
    projectMode: intent.projectMode,
  };
}

// ---------------------------------------------------------------------------
// FILLET AI intents — always resolved via FilletEngine (never LLM coords)
// ---------------------------------------------------------------------------

export type AiFilletIntent =
  | {
      kind: 'fillet';
      radiusWorld?: number;
      radiusText?: string;
      trim?: boolean;
      polylineAll?: boolean;
      sharpCorner?: boolean;
      needsObjectPick: boolean;
      summary: string;
    }
  | { kind: 'none' };

export function parseAiFilletIntent(
  text: string,
  worldUnit: LengthUnit = 'ft',
  displayUnit: LengthUnit = 'ft-in',
): AiFilletIntent {
  const lower = text.toLowerCase().trim();
  if (
    !/\bfillet\b|\bround(?:ing)?\b|\bradius\b.*\bcorner\b|\bcorner\b.*\bradius\b|\bsharp\s+corner\b/.test(
      lower,
    )
  ) {
    return { kind: 'none' };
  }

  const sharp =
    /sharp\s+corner|remove\s+(?:the\s+)?fillet|radius\s*(?:=|of)?\s*0\b/.test(
      lower,
    );
  const polylineAll =
    /all\s+corners|every\s+corner|fillet\s+(?:the\s+)?(?:entire\s+)?polyline|fillet\s+(?:this\s+)?rectangle/.test(
      lower,
    );
  const trimOff = /without\s+trimm|no\s+trim|trim\s+off/.test(lower);

  const radiusParsed = parseAiLength(text, worldUnit, displayUnit);
  const needsObjectPick =
    !/\bselected\b|\ball\s+corners/.test(lower) &&
    !/\bthese\s+(?:two\s+)?(?:walls?|lines?|objects?)\b/.test(lower);

  if (sharp) {
    return {
      kind: 'fillet',
      radiusWorld: 0,
      sharpCorner: true,
      trim: true,
      needsObjectPick: true,
      summary: 'Radius 0 — select the corner objects for a sharp intersection',
    };
  }

  return {
    kind: 'fillet',
    radiusWorld: radiusParsed?.worldValue,
    radiusText: radiusParsed ? text : undefined,
    trim: trimOff ? false : true,
    polylineAll,
    needsObjectPick: polylineAll ? false : needsObjectPick,
    summary: needsObjectPick
      ? 'Select the two objects (or corner) to fillet'
      : polylineAll
        ? 'Ready to fillet all corners via FilletEngine Polyline option'
        : 'Ready to run FILLET via FilletEngine',
  };
}

export interface AiFilletProposal {
  summary: string;
  commandAlias: 'FILLET';
  requireObjectPick: boolean;
  radiusWorld?: number;
  trim?: boolean;
  polylineAll?: boolean;
}

export function proposeAiFilletCommand(
  text: string,
  worldUnit: LengthUnit = 'ft',
  displayUnit: LengthUnit = 'ft-in',
): AiFilletProposal | null {
  const intent = parseAiFilletIntent(text, worldUnit, displayUnit);
  if (intent.kind === 'none') return null;
  return {
    summary: intent.summary,
    commandAlias: 'FILLET',
    requireObjectPick: intent.needsObjectPick,
    radiusWorld: intent.radiusWorld,
    trim: intent.trim,
    polylineAll: intent.polylineAll,
  };
}



export type AiPropertyTarget = 'selection' | 'current';

export type AiPropertyIntent =
  | { kind: 'none' }
  | {
      kind: 'chprop' | 'setbylayer' | 'matchprop' | 'properties';
      target: AiPropertyTarget;
      changes?: {
        color?: string;
        layer?: string;
        linetype?: string;
        lineweightMm?: number;
        transparency?: number;
        byLayer?: boolean;
      };
      summary: string;
      needsObjectPick: boolean;
    };

/**
 * Translate natural language into structured property-command intent.
 * Does NOT mutate documents — PropertyEngine / CHPROP execute the change.
 */
export function parseAiPropertyIntent(text: string): AiPropertyIntent {
  const t = text.trim();
  const lower = t.toLowerCase();
  if (!t) return { kind: 'none' };

  const isCurrent =
    /\b(current|new|default)\b/.test(lower) &&
    /\b(color|layer|linetype|lineweight|line weight|properties)\b/.test(lower);

  const target: AiPropertyTarget = isCurrent ? 'current' : 'selection';

  if (
    /\b(match\s+prop|match\s+properties|copy\s+(the\s+)?properties)\b/.test(
      lower,
    )
  ) {
    return {
      kind: 'matchprop',
      target: 'selection',
      summary: 'MATCHPROP — copy appearance between objects',
      needsObjectPick: true,
    };
  }

  if (
    /\b(set\s*by\s*layer|bylayer|by\s+layer)\b/.test(lower) &&
    /\b(set|make|change|reset|convert)\b/.test(lower)
  ) {
    return {
      kind: 'setbylayer',
      target,
      changes: { byLayer: true },
      summary:
        target === 'current'
          ? 'Set current appearance to ByLayer'
          : 'SETBYLAYER — reset overrides to ByLayer',
      needsObjectPick: target === 'selection',
    };
  }

  if (
    /\b(properties|props|inspector)\b/.test(lower) &&
    /\b(open|show|view)\b/.test(lower)
  ) {
    return {
      kind: 'properties',
      target,
      summary: 'Open PROPERTIES palette',
      needsObjectPick: false,
    };
  }

  const colorMatch = lower.match(
    /\b(red|yellow|green|cyan|blue|magenta|white|black)\b|#([0-9a-f]{3,6})\b/i,
  );
  const layerMatch = t.match(/\b(?:layer|on(?:\s+the)?)\s+([A-Za-z0-9_-]+)\b/i);
  const ltMatch = lower.match(
    /\b(continuous|dashed|dotted|dashdot|center|hidden)\b/,
  );
  const lwMatch = lower.match(
    /(\d+(?:\.\d+)?)\s*mm\b|\b(?:line\s*weight|lineweight)\s*(?:to\s*)?(\d+(?:\.\d+)?)/,
  );

  const isPropChange =
    /\b(make|change|set|put)\b/.test(lower) &&
    (colorMatch ||
      layerMatch ||
      ltMatch ||
      lwMatch ||
      /\b(color|linetype|line\s*type|transparency)\b/.test(lower));

  if (!isPropChange) return { kind: 'none' };

  const changes: {
    color?: string;
    layer?: string;
    linetype?: string;
    lineweightMm?: number;
    transparency?: number;
    byLayer?: boolean;
  } = {};
  if (colorMatch) {
    changes.color = colorMatch[0]!.startsWith('#')
      ? colorMatch[0]!
      : colorMatch[1] ?? colorMatch[0]!;
  }
  if (layerMatch) changes.layer = layerMatch[1];
  if (ltMatch) {
    const raw = ltMatch[1]!;
    changes.linetype = raw.charAt(0).toUpperCase() + raw.slice(1);
  }
  if (lwMatch) {
    changes.lineweightMm = Number(lwMatch[1] ?? lwMatch[2]);
  }

  return {
    kind: 'chprop',
    target,
    changes,
    summary:
      target === 'current'
        ? 'Update CurrentProperties for new objects'
        : 'CHPROP — change selected object appearance via PropertyEngine',
    needsObjectPick: target === 'selection' && !/\bselected\b/.test(lower),
  };
}

export function proposeAiPropertyCommand(text: string): {
  summary: string;
  commandAlias: 'CHPROP' | 'SETBYLAYER' | 'MATCHPROP' | 'PROPERTIES';
  target: AiPropertyTarget;
  changes?: {
    color?: string;
    layer?: string;
    linetype?: string;
    lineweightMm?: number;
    transparency?: number;
    byLayer?: boolean;
  };
  requireObjectPick: boolean;
} | null {
  const intent = parseAiPropertyIntent(text);
  if (intent.kind === 'none') return null;
  const alias =
    intent.kind === 'chprop'
      ? 'CHPROP'
      : intent.kind === 'setbylayer'
        ? 'SETBYLAYER'
        : intent.kind === 'matchprop'
          ? 'MATCHPROP'
          : 'PROPERTIES';
  return {
    summary: intent.summary,
    commandAlias: alias,
    target: intent.target,
    changes: intent.changes,
    requireObjectPick: intent.needsObjectPick,
  };
}
