import type { DrawingDocument, Entity, LengthUnit } from '@ratecad/core';
import {
  LENGTH_UNIT_LABELS,
  formatWorldLength,
  parseLength,
} from '@ratecad/geometry';
import { describeEntity, type EntityDescription } from './entitySummary.js';
import { normalizeDrawPrompt } from './parseDrawPrompt.js';

export const MODIFY_OPERATIONS = [
  'offset',
  'move',
  'copy',
  'trim',
  'extend',
  'fillet',
  'mirror',
  'rotate',
  'scale',
] as const;

export type ModifyOperation = (typeof MODIFY_OPERATIONS)[number];

const UNSUPPORTED_VERBS = new Set([
  'stretch',
  'erase',
  'delete',
  'chamfer',
  'explode',
  'join',
  'break',
  'lengthen',
  'array',
]);

const DRAW_TYPES = ['line', 'circle', 'rectangle', 'polyline'] as const;
type DrawType = (typeof DRAW_TYPES)[number];

export type PromptClass =
  | { kind: 'draw' }
  | { kind: 'modify'; operation: ModifyOperation }
  | { kind: 'unsupported'; verb: string };

export function classifyCadPrompt(prompt: string): PromptClass {
  const text = normalizeDrawPrompt(prompt).replace(/^(?:please\s+)?/, '');
  if (/^(?:draw|create|add)\b/.test(text)) return { kind: 'draw' };
  const verb = text.match(/^([a-z]+)\b/)?.[1];
  if (!verb) return { kind: 'draw' };
  if ((MODIFY_OPERATIONS as readonly string[]).includes(verb)) {
    return { kind: 'modify', operation: verb as ModifyOperation };
  }
  if (UNSUPPORTED_VERBS.has(verb)) return { kind: 'unsupported', verb };
  return { kind: 'draw' };
}

export interface PreparedModify {
  kind: 'modify';
  canApply: false;
  prompt: string;
  operation: ModifyOperation;
  summary: string;
  assumptions: string[];
  unitsLabel: string;
  executionNote: string;
  entities: EntityDescription[];
}

export type ModifyPreviewResult =
  | { ok: true; prepared: PreparedModify }
  | { ok: false; error: string };

const NOT_CREATED = 'No geometry was created.';

export function previewModifyPrompt(
  prompt: string,
  document: DrawingDocument,
): ModifyPreviewResult {
  const classified = classifyCadPrompt(prompt);
  if (classified.kind === 'unsupported') {
    return {
      ok: false,
      error: `${classified.verb.toUpperCase()} is not available from the AI Engineer yet. ${NOT_CREATED}`,
    };
  }
  if (classified.kind !== 'modify') {
    return { ok: false, error: `That request is not a modification. ${NOT_CREATED}` };
  }
  const operation = classified.operation;
  const normalized = normalizeDrawPrompt(prompt);
  const reference = readReference(prompt, normalized);
  if (!reference.ok) return reference;
  const resolved = resolveReference(reference.reference, document, operation);
  if (!resolved.ok) return resolved;
  const operand = readOperand(operation, prompt, document);
  if (!operand.ok) return operand;
  const names = resolved.entities
    .map((entity) => `${entity.type} ${entity.id} on layer ${entity.layerName}`)
    .join('; ');
  const summary = `${operation.toUpperCase()} — ${names}. Requested: ${operand.detail}. Not applied.`;
  const worldUnit = document.settings.worldUnit ?? 'ft';
  const displayUnit = document.settings.units;
  return {
    ok: true,
    prepared: {
      kind: 'modify',
      canApply: false,
      prompt: prompt.trim(),
      operation,
      summary,
      assumptions: [],
      unitsLabel: `${LENGTH_UNIT_LABELS[displayUnit]} · stored in ${LENGTH_UNIT_LABELS[worldUnit]}`,
      executionNote:
        'Preview only. This phase identifies the object and the operation. The drawing was not changed.',
      entities: resolved.entities,
    },
  };
}

type Reference =
  | { mode: 'id'; id: string }
  | { mode: 'selected'; type: DrawType | 'any'; count: 1 | 2 }
  | { mode: 'last'; type: DrawType | 'any' };

function readReference(
  original: string,
  normalized: string,
): { ok: true; reference: Reference } | { ok: false; error: string } {
  const id =
    original.match(/\bentity\s+id\s+([A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)\b/i)?.[1] ??
    original.match(/\bid\s+([A-Za-z0-9]+-[A-Za-z0-9-]+)\b/i)?.[1];
  const mentionsSelected = /\bselected\b/.test(normalized);
  const mentionsLast = /\blast(?:\s+created)?\b/.test(normalized);
  const signals = [Boolean(id), mentionsSelected, mentionsLast].filter(Boolean);
  if (signals.length > 1) {
    return {
      ok: false,
      error: `The prompt names more than one object. Use the selection, the last created entity, or one entity id. ${NOT_CREATED}`,
    };
  }
  if (id) return { ok: true, reference: { mode: 'id', id } };

  const two = normalized.match(
    /\btwo selected (lines|circles|rectangles|polylines)\b/,
  );
  if (two) {
    return {
      ok: true,
      reference: { mode: 'selected', type: singular(two[1]!), count: 2 },
    };
  }
  const selected = normalized.match(
    /\bthe selected (line|circle|rectangle|polyline|object|entity)\b/,
  );
  if (selected) {
    return {
      ok: true,
      reference: {
        mode: 'selected',
        type: referenceType(selected[1]!),
        count: 1,
      },
    };
  }
  const last = normalized.match(
    /\bthe last(?:\s+created)? (line|circle|rectangle|polyline|entity|object)\b/,
  );
  if (last) {
    return {
      ok: true,
      reference: { mode: 'last', type: referenceType(last[1]!) },
    };
  }
  return {
    ok: false,
    error: `Name the object as the selected line, circle, rectangle, or polyline, the last created entity, or an entity id. ${NOT_CREATED}`,
  };
}

function referenceType(word: string): DrawType | 'any' {
  if (
    word === 'line' ||
    word === 'circle' ||
    word === 'rectangle' ||
    word === 'polyline'
  ) {
    return word;
  }
  return 'any';
}

function singular(word: string): DrawType {
  if (word === 'lines') return 'line';
  if (word === 'circles') return 'circle';
  if (word === 'rectangles') return 'rectangle';
  return 'polyline';
}

function resolveReference(
  reference: Reference,
  document: DrawingDocument,
  operation: ModifyOperation,
): { ok: true; entities: EntityDescription[] } | { ok: false; error: string } {
  if (reference.mode === 'id') {
    const matches = document.entities.filter(
      (entity) => entity.id.toLowerCase() === reference.id.toLowerCase(),
    );
    if (matches.length === 0) {
      return {
        ok: false,
        error: `No object has id "${reference.id}". ${NOT_CREATED}`,
      };
    }
    if (matches.length > 1) {
      return {
        ok: false,
        error: `More than one object matches id "${reference.id}". Select the intended object. ${NOT_CREATED}`,
      };
    }
    return { ok: true, entities: [describeEntity(matches[0]!, document)] };
  }
  if (reference.mode === 'last') {
    const pool = document.entities.filter((entity) =>
      reference.type === 'any' ? true : entity.type === reference.type,
    );
    const entity = pool[pool.length - 1];
    if (!entity) {
      const which = reference.type === 'any' ? 'object' : reference.type;
      return {
        ok: false,
        error: `This drawing has no ${which} yet. ${NOT_CREATED}`,
      };
    }
    return { ok: true, entities: [describeEntity(entity, document)] };
  }
  const selected = document.entities.filter((entity) =>
    document.selection.includes(entity.id),
  );
  const matched =
    reference.type === 'any'
      ? selected
      : selected.filter((entity) => entity.type === reference.type);
  return acceptCount(matched, reference.type, reference.count, operation, document);
}

function acceptCount(
  matched: Entity[],
  type: DrawType | 'any',
  count: 1 | 2,
  operation: ModifyOperation,
  document: DrawingDocument,
): { ok: true; entities: EntityDescription[] } | { ok: false; error: string } {
  const label = type === 'any' ? 'object' : type;
  if (matched.length === 0) {
    return {
      ok: false,
      error: `No ${label} is selected. Select ${count === 2 ? `two ${label}s` : `a ${label}`} on the canvas, then preview again. ${NOT_CREATED}`,
    };
  }
  if (matched.length !== count) {
    const noun = matched.length === 1 ? label : `${label}s`;
    const verb = matched.length === 1 ? 'is' : 'are';
    return {
      ok: false,
      error: `${matched.length} ${noun} ${verb} selected. Select ${count === 1 ? `the one ${label}` : `exactly two ${label}s`} to ${operation}. ${NOT_CREATED}`,
    };
  }
  return {
    ok: true,
    entities: matched.map((entity) => describeEntity(entity, document)),
  };
}

function readOperand(
  operation: ModifyOperation,
  prompt: string,
  document: DrawingDocument,
): { ok: true; detail: string } | { ok: false; error: string } {
  const worldUnit = document.settings.worldUnit ?? 'ft';
  const displayUnit = document.settings.units;
  const normalized = normalizeDrawPrompt(prompt);
  const length = readLength(prompt, worldUnit, displayUnit);
  const formatted =
    length == null
      ? null
      : formatWorldLength(length, worldUnit, displayUnit, { precision: 4 });
  if (operation === 'move' || operation === 'copy') {
    const direction = normalized.match(/\b(right|left|up|down)\b/)?.[1];
    if (!formatted || !direction) {
      return {
        ok: false,
        error: `${operation.toUpperCase()} needs a distance and a direction (right, left, up, or down). ${NOT_CREATED}`,
      };
    }
    return { ok: true, detail: `${formatted} ${direction}` };
  }
  if (operation === 'offset') {
    const side = normalized.match(/\b(inward|outward|inside|outside)\b/)?.[1];
    if (!formatted) {
      return {
        ok: false,
        error: `OFFSET needs a distance. ${NOT_CREATED}`,
      };
    }
    if (!side) {
      return {
        ok: false,
        error: `OFFSET needs a side, such as inward or outward. ${NOT_CREATED}`,
      };
    }
    return { ok: true, detail: `${side} by ${formatted}` };
  }
  if (operation === 'fillet') {
    if (!formatted) {
      return {
        ok: false,
        error: `FILLET needs a radius. ${NOT_CREATED}`,
      };
    }
    return { ok: true, detail: `radius ${formatted}` };
  }
  if (operation === 'rotate') {
    const angle = normalized.match(/(-?\d+(?:\.\d+)?)\s*(?:deg|degrees|°)/);
    if (!angle) {
      return {
        ok: false,
        error: `ROTATE needs an angle in degrees. ${NOT_CREATED}`,
      };
    }
    return { ok: true, detail: `${angle[1]} degrees` };
  }
  if (operation === 'scale') {
    const factor = normalized.match(/\b(?:by|factor(?:\s+of)?)\s+(\d+(?:\.\d+)?)\b/);
    if (!factor) {
      return {
        ok: false,
        error: `SCALE needs a factor, such as "by 2". ${NOT_CREATED}`,
      };
    }
    return { ok: true, detail: `factor ${factor[1]}` };
  }
  const boundary = prompt.match(
    /\bboundary\s+entity(?:\s+id)?\s+([A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)\b/i,
  )?.[1];
  if (!boundary) {
    return {
      ok: false,
      error: `${operation.toUpperCase()} needs one boundary named by entity id. ${NOT_CREATED}`,
    };
  }
  const found = document.entities.filter(
    (entity) => entity.id.toLowerCase() === boundary.toLowerCase(),
  );
  if (found.length !== 1) {
    return {
      ok: false,
      error: `The boundary id "${boundary}" does not identify one object. ${NOT_CREATED}`,
    };
  }
  return { ok: true, detail: `boundary ${found[0]!.id}` };
}

function readLength(
  prompt: string,
  worldUnit: LengthUnit,
  displayUnit: LengthUnit,
): number | null {
  const match = prompt.match(
    /(\d+(?:\.\d+)?)\s*(millimeters?|millimetres?|mm|centimeters?|centimetres?|cm|meters?|metres?|m|inches|inch|in|feet|foot|ft)\b/i,
  );
  if (!match) return null;
  const parsed = parseLength(match[0], worldUnit, displayUnit);
  return parsed ? parsed.worldValue : null;
}
