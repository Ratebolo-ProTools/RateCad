import type { CommandBus } from '@ratecad/commands';
import type { DrawingDocument, WorkspaceMode } from '@ratecad/core';
import { compileDrawIntent, type CompiledDraw, type DrawCompileContext } from './compileDrawIntent.js';
import type { ParsedDrawPrompt } from './drawingIntent.js';
import {
  classifyCadPrompt,
  previewModifyPrompt,
  type PreparedModify,
} from './modifyPreview.js';
import { parseDrawPrompt } from './parseDrawPrompt.js';

export interface PreparedDraw extends CompiledDraw {
  kind: 'draw';
  canApply: true;
  prompt: string;
  parsed: ParsedDrawPrompt;
}

export type PreparedPrompt = PreparedDraw | PreparedModify;

export type DrawPreviewResult =
  | { ok: true; prepared: PreparedPrompt }
  | { ok: false; error: string };

export type ApplyDrawResult = { ok: true } | { ok: false; error: string };

/**
 * Parse and validate a prompt. The document is only read.
 */
export function previewDrawPrompt(
  prompt: string,
  context: DrawCompileContext,
): DrawPreviewResult {
  const classified = classifyCadPrompt(prompt);
  if (classified.kind === 'unsupported') {
    return {
      ok: false,
      error: `${classified.verb.toUpperCase()} is not available from the AI Engineer yet. No geometry was created.`,
    };
  }
  if (classified.kind === 'modify') {
    return previewModifyPrompt(prompt, context.document);
  }
  const worldUnit = context.document.settings.worldUnit ?? 'ft';
  const displayUnit = context.document.settings.units;
  const parsed = parseDrawPrompt(prompt, worldUnit, displayUnit);
  if (!parsed.ok) return parsed;
  const compiled = compileDrawIntent(parsed.parsed, context);
  if (!compiled.ok) return compiled;
  return {
    ok: true,
    prepared: {
      ...compiled.compiled,
      kind: 'draw',
      canApply: true,
      prompt: prompt.trim(),
      parsed: parsed.parsed,
    },
  };
}

/**
 * Re-check layer and model space, then commit the prepared batch.
 * A thrown command leaves the bus document unchanged.
 */
export function applyPreparedDraw(
  bus: CommandBus,
  prepared: PreparedPrompt,
  workspaceMode: WorkspaceMode,
): ApplyDrawResult {
  if (prepared.kind !== 'draw') {
    return {
      ok: false,
      error:
        'This preview only identifies an object and an operation. It does not change the drawing.',
    };
  }
  if (workspaceMode !== 'MODEL_SPACE') {
    return {
      ok: false,
      error: 'AI drawing works in model space. Switch to the Model tab and try again.',
    };
  }
  const doc: DrawingDocument = bus.getDocument();
  const layer = doc.layers.find((item) => item.id === prepared.layerId);
  if (!layer) {
    return {
      ok: false,
      error: 'The preview layer no longer exists. Generate the preview again.',
    };
  }
  if (layer.locked) {
    return {
      ok: false,
      error: `Layer "${layer.name}" is locked. Unlock it before applying.`,
    };
  }
  try {
    bus.execute(prepared.command);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : 'The drawing could not be applied.',
    };
  }
}
