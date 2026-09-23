import type { LengthUnit } from '@ratecad/core';
import {
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
