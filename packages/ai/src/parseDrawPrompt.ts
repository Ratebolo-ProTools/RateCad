import type { LengthUnit, Vec2 } from '@ratecad/core';
import { parseLength } from '@ratecad/geometry';
import type { DrawingIntent, ParsedDrawPrompt } from './drawingIntent.js';

export type ParseDrawResult =
  | { ok: true; parsed: ParsedDrawPrompt }
  | { ok: false; error: string };

const SUPPORTED =
  'Try one entity: "Draw a line from 0,0 to 12 ft,0", "Draw a 12 ft by 10 ft rectangle at 0,0", "Draw a circle of radius 5 ft at 10 ft,10 ft", or "Draw a polyline through 0,0; 10 ft,0; 10 ft,8 ft; close".';

/**
 * Deterministic prompt parser. Reads the sentence and returns a DrawingIntent.
 * Does not read or write a document.
 */
export function parseDrawPrompt(
  prompt: string,
  worldUnit: LengthUnit,
  displayUnit: LengthUnit,
): ParseDrawResult {
  const text = normalizeDrawPrompt(prompt);
  if (!text) {
    return { ok: false, error: `Enter a drawing instruction. ${SUPPORTED}` };
  }
  const leading = text.replace(/^(?:please\s+)?/, '').match(/^([a-z]+)\b/)?.[1];
  if (leading && MODIFY_VERBS.has(leading)) {
    return {
      ok: false,
      error: `${leading.toUpperCase()} modifies an existing object. It does not draw a new one. No geometry was created.`,
    };
  }

  const layerSplit = splitLayerClause(text);
  if (!layerSplit.ok) return layerSplit;
  const body = layerSplit.body;
  const layerName = layerSplit.layerName;

  const drawn = body.match(
    /^(?:please\s+)?(?:draw|create|add)\s+(?:a\s+|an\s+)?(.+)$/,
  );
  const rest = drawn ? drawn[1]! : body;

  if (rest.startsWith('line')) {
    return finish(parseLine(rest, worldUnit, displayUnit), layerName);
  }
  if (rest.includes('rectangle')) {
    return finish(parseRectangle(rest, worldUnit, displayUnit), layerName);
  }
  if (rest.startsWith('circle')) {
    return finish(parseCircle(rest, worldUnit, displayUnit), layerName);
  }
  if (/^(?:closed\s+)?polyline\b/.test(rest)) {
    return finish(parsePolyline(rest, worldUnit, displayUnit), layerName);
  }

  return {
    ok: false,
    error: `That request is not supported yet. ${SUPPORTED}`,
  };
}

function finish(
  result: ParseDrawResult,
  layerName: string | null,
): ParseDrawResult {
  if (!result.ok) return result;
  return {
    ok: true,
    parsed: {
      assumptions: result.parsed.assumptions,
      intent: { ...result.parsed.intent, layerName },
    },
  };
}

const MODIFY_VERBS = new Set([
  'offset',
  'move',
  'copy',
  'trim',
  'extend',
  'fillet',
  'mirror',
  'rotate',
  'scale',
]);

export function normalizeDrawPrompt(prompt: string): string {
  return prompt
    .trim()
    .replace(/[.?!]+$/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ',')
    .replace(/\s*;\s*/g, ';')
    .toLowerCase();
}

function splitLayerClause(
  text: string,
): { ok: true; body: string; layerName: string | null } | { ok: false; error: string } {
  const match = text.match(/\s+on\s+layer\s+([a-z0-9_-]+)\s*$/);
  if (!match || match.index == null) {
    return { ok: true, body: text, layerName: null };
  }
  const layerName = match[1]!;
  if (!layerName) {
    return { ok: false, error: 'Name the layer after "on layer".' };
  }
  return { ok: true, body: text.slice(0, match.index).trim(), layerName };
}

function parseComponent(
  raw: string,
  worldUnit: LengthUnit,
  displayUnit: LengthUnit,
): number | null {
  const text = raw.trim();
  if (!text) return null;
  if (/^[+-]?(?:0+)(?:\.0+)?$/.test(text)) return 0;
  const parsed = parseLength(text, worldUnit, displayUnit);
  if (!parsed || !Number.isFinite(parsed.worldValue)) return null;
  return parsed.worldValue;
}

function parsePoint(
  raw: string,
  worldUnit: LengthUnit,
  displayUnit: LengthUnit,
): Vec2 | null {
  let text = raw.trim().replace(/^[()]+|[()]+$/g, '').trim();
  if (!text) return null;
  let xRaw: string;
  let yRaw: string;
  const comma = text.indexOf(',');
  if (comma >= 0) {
    xRaw = text.slice(0, comma);
    yRaw = text.slice(comma + 1);
  } else {
    const parts = text.split(/\s+/);
    if (parts.length !== 2) return null;
    xRaw = parts[0]!;
    yRaw = parts[1]!;
  }
  if (yRaw.includes(',')) return null;
  const x = parseComponent(xRaw, worldUnit, displayUnit);
  const y = parseComponent(yRaw, worldUnit, displayUnit);
  if (x == null || y == null) return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function parseLine(
  rest: string,
  worldUnit: LengthUnit,
  displayUnit: LengthUnit,
): ParseDrawResult {
  const match = rest.match(/^line\s+from\s+(.+?)\s+to\s+(.+)$/);
  if (!match) {
    return {
      ok: false,
      error:
        'A line needs both endpoints. Example: "Draw a line from 0,0 to 12 ft,0".',
    };
  }
  const start = parsePoint(match[1]!, worldUnit, displayUnit);
  const end = parsePoint(match[2]!, worldUnit, displayUnit);
  if (!start || !end) {
    return {
      ok: false,
      error:
        'Could not read the line endpoints. Use a point such as 0,0 or 12 ft,0.',
    };
  }
  return {
    ok: true,
    parsed: {
      assumptions: [],
      intent: { kind: 'line', start, end, layerName: null },
    },
  };
}

function parseRectangle(
  rest: string,
  worldUnit: LengthUnit,
  displayUnit: LengthUnit,
): ParseDrawResult {
  let body = rest;
  let at: string | null = null;
  const atMatch = body.match(/\s+at\s+(.+)$/);
  if (atMatch && atMatch.index != null) {
    at = atMatch[1]!;
    body = body.slice(0, atMatch.index).trim();
  }
  body = body
    .replace(/\brectangle\b/g, ' ')
    .replace(/\b(of|that is|sized)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const size = body.match(/^(.+?)\s+(?:by|x|×)\s+(.+)$/);
  if (!size) {
    return {
      ok: false,
      error:
        'A rectangle needs a width and a height. Example: "Draw a 12 ft by 10 ft rectangle at 0,0".',
    };
  }
  const width = parseComponent(size[1]!, worldUnit, displayUnit);
  const height = parseComponent(size[2]!, worldUnit, displayUnit);
  if (width == null || height == null) {
    return {
      ok: false,
      error:
        'Could not read the rectangle width and height. Include a length such as 12 ft.',
    };
  }
  const assumptions: string[] = [];
  let corner: Vec2 = { x: 0, y: 0 };
  let originAssumed = false;
  if (at) {
    const parsed = parsePoint(at, worldUnit, displayUnit);
    if (!parsed) {
      return {
        ok: false,
        error: 'Could not read the rectangle corner after "at".',
      };
    }
    corner = parsed;
  } else {
    originAssumed = true;
    assumptions.push('Origin was omitted; the rectangle corner is (0,0).');
  }
  return {
    ok: true,
    parsed: {
      assumptions,
      intent: {
        kind: 'rectangle',
        corner,
        width,
        height,
        originAssumed,
        layerName: null,
      },
    },
  };
}

function parseCircle(
  rest: string,
  worldUnit: LengthUnit,
  displayUnit: LengthUnit,
): ParseDrawResult {
  let body = rest.slice('circle'.length).trim();
  let at: string | null = null;
  const atMatch = body.match(
    /\s+(?:(?:centered|centred)\s+at|at)\s+(.+)$/,
  );
  if (atMatch && atMatch.index != null) {
    at = atMatch[1]!;
    body = body.slice(0, atMatch.index).trim();
  }
  body = body.replace(/^(?:of|with|a)\s+/, '').trim();
  const diameter = body.match(/^diameter(?:\s+of)?\s+(.+)$/);
  const radius = body.match(/^radius(?:\s+of)?\s+(.+)$/);
  if (!diameter && !radius) {
    return {
      ok: false,
      error:
        'A circle needs a radius or a diameter. Example: "Draw a circle of radius 5 ft at 10 ft,10 ft".',
    };
  }
  const measured = parseComponent(
    (diameter ?? radius)![1]!,
    worldUnit,
    displayUnit,
  );
  if (measured == null) {
    return {
      ok: false,
      error: 'Could not read the circle radius or diameter.',
    };
  }
  const assumptions: string[] = [];
  let circleRadius = measured;
  if (diameter) {
    circleRadius = measured / 2;
    assumptions.push('Diameter was converted to a radius.');
  }
  let center: Vec2 = { x: 0, y: 0 };
  let originAssumed = false;
  if (at) {
    const parsed = parsePoint(at, worldUnit, displayUnit);
    if (!parsed) {
      return {
        ok: false,
        error: 'Could not read the circle center.',
      };
    }
    center = parsed;
  } else {
    originAssumed = true;
    assumptions.push('Origin was omitted; the circle center is (0,0).');
  }
  return {
    ok: true,
    parsed: {
      assumptions,
      intent: {
        kind: 'circle',
        center,
        radius: circleRadius,
        originAssumed,
        layerName: null,
      },
    },
  };
}

function parsePolyline(
  rest: string,
  worldUnit: LengthUnit,
  displayUnit: LengthUnit,
): ParseDrawResult {
  const match = rest.match(/^(?:closed\s+)?polyline\s+through\s+(.+)$/);
  const closedWord = /^closed\s+polyline\b/.test(rest);
  if (!match) {
    return {
      ok: false,
      error:
        'A polyline needs its vertices. Example: "Draw a polyline through 0,0; 10 ft,0; 10 ft,8 ft; close".',
    };
  }
  let spec = match[1]!.trim();
  let closed = false;
  if (
    closedWord ||
    /(?:;|,|\s)\s*(?:and\s+)?close[d]?\s*$/.test(spec) ||
    /^(?:and\s+)?close[d]?$/.test(spec)
  ) {
    closed = true;
    spec = spec.replace(/(?:;|,|\s)\s*(?:and\s+)?close[d]?\s*$/, '').trim();
    spec = spec.replace(/^(?:and\s+)?close[d]?$/, '').trim();
  }
  const parts = spec
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length < 2) {
    return {
      ok: false,
      error: 'A polyline needs at least two vertices. Missing points were not invented.',
    };
  }
  if (closed && parts.length < 3) {
    return {
      ok: false,
      error: 'A closed polyline needs at least three vertices.',
    };
  }
  const vertices: Vec2[] = [];
  for (const part of parts) {
    const point = parsePoint(part, worldUnit, displayUnit);
    if (!point) {
      return {
        ok: false,
        error: `Could not read polyline vertex "${part}". Separate points with semicolons.`,
      };
    }
    vertices.push(point);
  }
  return {
    ok: true,
    parsed: {
      assumptions: [],
      intent: { kind: 'polyline', vertices, closed, layerName: null },
    },
  };
}
