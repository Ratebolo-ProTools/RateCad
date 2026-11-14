import type { DrawingDocument, Layer, LengthUnit, WorkspaceMode } from '@ratecad/core';
import {
  CreateCircleCommand,
  CreateLineCommand,
  CreatePolylineCommand,
  CreateRectangleCommand,
  type Command,
  BatchCommand,
} from '@ratecad/commands';
import { LENGTH_UNIT_LABELS, distance, formatWorldLength } from '@ratecad/geometry';
import type { CompiledEntitySummary, ParsedDrawPrompt } from './drawingIntent.js';

const MIN_SPAN = 1e-9;

export interface DrawCompileContext {
  document: DrawingDocument;
  workspaceMode: WorkspaceMode;
}

export interface CompiledDraw {
  summary: string;
  assumptions: string[];
  unitsLabel: string;
  displayUnit: LengthUnit;
  worldUnit: LengthUnit;
  entities: CompiledEntitySummary[];
  layerId: Layer['id'];
  command: BatchCommand;
}

export type CompileDrawResult =
  | { ok: true; compiled: CompiledDraw }
  | { ok: false; error: string };

/**
 * Validate a parsed intent against the live document and build commands.
 * Does not execute them.
 */
export function compileDrawIntent(
  parsed: ParsedDrawPrompt,
  context: DrawCompileContext,
): CompileDrawResult {
  if (context.workspaceMode !== 'MODEL_SPACE') {
    return {
      ok: false,
      error: 'AI drawing works in model space. Switch to the Model tab and try again.',
    };
  }

  const layer = resolveLayer(context.document, parsed.intent.layerName);
  if (!layer) {
    return {
      ok: false,
      error: `Layer "${parsed.intent.layerName}" does not exist. Create it first or omit the layer.`,
    };
  }
  if (layer.locked) {
    return {
      ok: false,
      error: `Layer "${layer.name}" is locked. Unlock it before drawing there.`,
    };
  }

  const geometryError = validateGeometry(parsed);
  if (geometryError) return { ok: false, error: geometryError };

  const worldUnit = context.document.settings.worldUnit ?? 'ft';
  const displayUnit = context.document.settings.units;
  const precision = context.document.settings.precision ?? 2;
  const formatOpts = { precision };
  const fmt = (value: number) =>
    formatWorldLength(value, worldUnit, displayUnit, formatOpts);
  const fmtPoint = (point: { x: number; y: number }) =>
    `(${fmt(point.x)}, ${fmt(point.y)})`;

  let detail = '';
  let command: Command;
  const intent = parsed.intent;
  switch (intent.kind) {
    case 'line':
      detail = `Line ${fmtPoint(intent.start)} to ${fmtPoint(intent.end)}`;
      command = new CreateLineCommand(
        intent.start,
        intent.end,
        undefined,
        layer.id,
      );
      break;
    case 'rectangle': {
      const corner2 = {
        x: intent.corner.x + intent.width,
        y: intent.corner.y + intent.height,
      };
      detail = `Rectangle ${fmt(intent.width)} by ${fmt(intent.height)} from ${fmtPoint(intent.corner)} to ${fmtPoint(corner2)}`;
      command = new CreateRectangleCommand(
        intent.corner,
        corner2,
        undefined,
        layer.id,
      );
      break;
    }
    case 'circle':
      detail = `Circle center ${fmtPoint(intent.center)}, radius ${fmt(intent.radius)}`;
      command = new CreateCircleCommand(
        intent.center,
        intent.radius,
        undefined,
        layer.id,
      );
      break;
    case 'polyline':
      detail = `${intent.closed ? 'Closed polyline' : 'Polyline'} through ${intent.vertices
        .map((vertex) => fmtPoint(vertex))
        .join(' → ')}`;
      command = new CreatePolylineCommand(
        intent.vertices,
        undefined,
        intent.closed,
        layer.id,
      );
      break;
  }

  const summary = `${detail} on layer ${layer.name}.`;
  return {
    ok: true,
    compiled: {
      summary,
      assumptions: parsed.assumptions,
      unitsLabel: `${LENGTH_UNIT_LABELS[displayUnit]} · stored in ${LENGTH_UNIT_LABELS[worldUnit]}`,
      displayUnit,
      worldUnit,
      layerId: layer.id,
      entities: [
        {
          kind: intent.kind,
          layerId: layer.id,
          layerName: layer.name,
          detail,
        },
      ],
      command: new BatchCommand([command]),
    },
  };
}

function resolveLayer(doc: DrawingDocument, layerName: string | null): Layer | null {
  if (!layerName) {
    return doc.layers.find((layer) => layer.id === doc.currentLayerId) ?? null;
  }
  const needle = layerName.toLowerCase();
  return doc.layers.find((layer) => layer.name.toLowerCase() === needle) ?? null;
}

function validateGeometry(parsed: ParsedDrawPrompt): string | null {
  const intent = parsed.intent;
  switch (intent.kind) {
    case 'line':
      if (!finitePoint(intent.start) || !finitePoint(intent.end)) {
        return 'Line coordinates must be finite numbers.';
      }
      if (distance(intent.start, intent.end) <= MIN_SPAN) {
        return 'Those line endpoints are the same, so the line has no length.';
      }
      return null;
    case 'rectangle':
      if (
        !finitePoint(intent.corner) ||
        !Number.isFinite(intent.width) ||
        !Number.isFinite(intent.height)
      ) {
        return 'Rectangle size and corner must be finite numbers.';
      }
      if (!(intent.width > MIN_SPAN) || !(intent.height > MIN_SPAN)) {
        return 'Rectangle width and height must be greater than zero.';
      }
      return null;
    case 'circle':
      if (!finitePoint(intent.center) || !Number.isFinite(intent.radius)) {
        return 'Circle center and radius must be finite numbers.';
      }
      if (!(intent.radius > MIN_SPAN)) {
        return 'Circle radius must be greater than zero.';
      }
      return null;
    case 'polyline': {
      if (intent.vertices.length < 2) {
        return 'A polyline needs at least two vertices.';
      }
      if (intent.closed && intent.vertices.length < 3) {
        return 'A closed polyline needs at least three vertices.';
      }
      for (const vertex of intent.vertices) {
        if (!finitePoint(vertex)) {
          return 'Polyline vertices must be finite numbers.';
        }
      }
      for (let i = 1; i < intent.vertices.length; i += 1) {
        if (distance(intent.vertices[i - 1]!, intent.vertices[i]!) <= MIN_SPAN) {
          return 'A polyline has two consecutive vertices in the same place.';
        }
      }
      if (
        intent.closed &&
        distance(
          intent.vertices[0]!,
          intent.vertices[intent.vertices.length - 1]!,
        ) <= MIN_SPAN
      ) {
        return 'The closing vertex repeats the start. Remove the duplicate or drop "close".';
      }
      return null;
    }
  }
}

function finitePoint(point: { x: number; y: number }): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}
