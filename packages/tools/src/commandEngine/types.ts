import type { EntityId, LengthUnit, Vec2 } from '@ratecad/core';
import type { PreviewGeometry } from '@ratecad/viewport';
import type { ToolId } from '../session.js';

/** Expected input at a command prompt. */
export type CadInputType =
  | 'point'
  | 'distance'
  | 'length'
  | 'angle'
  | 'integer'
  | 'decimal'
  | 'string'
  | 'boolean'
  | 'option'
  | 'entity'
  | 'entities';

export interface CadCommandOption {
  id: string;
  label: string;
  aliases: string[];
}

export interface CadPromptDefinition {
  id: string;
  message: string;
  inputType: CadInputType;
  options?: CadCommandOption[];
  /** Default shown as <value>; Enter accepts when empty. */
  defaultValue?: string | number | null;
  optional?: boolean;
}

export type CadCommandPhase =
  | 'idle'
  | 'running'
  | 'awaiting-input'
  | 'complete'
  | 'cancelled';

export interface CadDynamicInput {
  distance?: number | null;
  angleDeg?: number | null;
  length?: number | null;
  width?: number | null;
  label?: string;
}

export interface CadCommandUiState {
  phase: CadCommandPhase;
  commandName: string | null;
  prompt: string;
  optionsText: string;
  defaultText: string;
  message: string | null;
  history: string[];
  suggestions: string[];
  suggestionIndex: number;
  dynamic: CadDynamicInput | null;
  preview: PreviewGeometry | null;
  previewEntities?: import('@ratecad/core').Entity[] | null;
  hideEntityIds?: EntityId[];
}

export interface CadPointContext {
  lastPoint: Vec2 | null;
  cursor: Vec2 | null;
  /** Active angle override in degrees, or null. */
  angleOverrideDeg: number | null;
  units: LengthUnit;
}

export type CadParsedPoint =
  | { ok: true; point: Vec2; consumedAngleOverride?: boolean }
  | { ok: false; error: string };

export type CadParsedDistance =
  | { ok: true; value: number }
  | { ok: false; error: string };

export type CadParsedAngle =
  | { ok: true; degrees: number }
  | { ok: false; error: string };

export type CadParsedOption =
  | { ok: true; optionId: string }
  | { ok: false; error: string };

/** Runtime context passed into command handlers. */
export interface CadCommandContext {
  units: LengthUnit;
  lastPoint: Vec2 | null;
  cursor: Vec2 | null;
  angleOverrideDeg: number | null;
  selectedIds: EntityId[];
}

export interface CadCommandStartResult {
  prompt: CadPromptDefinition;
  status?: string;
}

export type CadCommandInputResult =
  | {
      kind: 'continue';
      prompt: CadPromptDefinition;
      status?: string;
      preview?: PreviewGeometry | null;
      dynamic?: CadDynamicInput | null;
      lastPoint?: Vec2 | null;
      message?: string | null;
    }
  | {
      kind: 'complete';
      status?: string;
      message?: string | null;
    }
  | {
      kind: 'reject';
      message: string;
      prompt: CadPromptDefinition;
    }
  | {
      kind: 'cancel';
    };

/**
 * Full command definition for the engine.
 * Toolbar / aliases / command line all start the same definition.
 */
export interface CadEngineCommand {
  id: string;
  name: string;
  aliases: string[];
  description: string;
  tool: ToolId;
  /** When true, start activates the tool then releases the engine (legacy tool path). */
  handoffToTool?: boolean;
  /** Whether this command may run nested (read-only / transparent). */
  transparent?: boolean;
  start: (ctx: CadCommandContext) => CadCommandStartResult;
  /**
   * Handle typed text at the current prompt (coordinates, options, distances).
   * Mouse points are delivered via onPoint.
   */
  onText: (
    text: string,
    prompt: CadPromptDefinition,
    ctx: CadCommandContext,
    state: Record<string, unknown>,
  ) => CadCommandInputResult;
  onPoint: (
    point: Vec2,
    prompt: CadPromptDefinition,
    ctx: CadCommandContext,
    state: Record<string, unknown>,
  ) => CadCommandInputResult;
  onMove?: (
    point: Vec2,
    prompt: CadPromptDefinition,
    ctx: CadCommandContext,
    state: Record<string, unknown>,
  ) => {
    preview?: PreviewGeometry | null;
    previewEntities?: import('@ratecad/core').Entity[] | null;
    hideEntityIds?: EntityId[];
    dynamic?: CadDynamicInput | null;
    status?: string;
  };
  onCancel?: (state: Record<string, unknown>) => void;
}
