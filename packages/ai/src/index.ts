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
