import type { CommandBus } from '@ratecad/commands';
import type { Entity, EntityId, LengthUnit, Vec2 } from '@ratecad/core';
import type { PreviewGeometry } from '@ratecad/viewport';
import { CadCommandHistory } from './history.js';
import {
  formatDefaultHint,
  formatOptionsHint,
  isAngleOverrideResult,
  isDistanceResult,
  isPointResult,
  parsePointInput,
  pointFromDirectDistance,
} from './parsers.js';
import { CadEngineRegistry } from './registry.js';
import { setEngineRectangleConstraints } from './commands/rectangle.js';
import type {
  CadCommandContext,
  CadCommandUiState,
  CadDynamicInput,
  CadEngineCommand,
  CadPromptDefinition,
} from './types.js';

export interface EngineHost {
  getUnits(): LengthUnit;
  getSelectedIds(): EntityId[];
  getCursor(): Vec2 | null;
  /** Activate matching toolbar tool for UI consistency. */
  activateTool(tool: string): void;
  /** Set select tool after cancel/complete. */
  activateSelect(): void;
}

type Running = {
  command: CadEngineCommand;
  prompt: CadPromptDefinition;
  state: Record<string, unknown>;
  lastPoint: Vec2 | null;
  angleOverrideDeg: number | null;
  preview: PreviewGeometry | null;
  previewEntities: Entity[] | null;
  hideEntityIds: EntityId[];
  dynamic: CadDynamicInput | null;
  status: string;
  message: string | null;
};

/**
 * Central CAD command engine — one execution path for aliases, command line, and toolbar.
 */
export class CadCommandEngine {
  readonly registry: CadEngineRegistry;
  readonly history: CadCommandHistory;
  private running: Running | null = null;
  private lastCompletedName: string | null = null;
  private buffer = '';
  private suggestions: string[] = [];
  private suggestionIndex = -1;
  private message: string | null = null;

  constructor(
    registry: CadEngineRegistry,
    private readonly bus: CommandBus,
    private readonly host: EngineHost,
  ) {
    this.registry = registry;
    this.history = new CadCommandHistory();
  }

  isRunning(): boolean {
    return !!this.running;
  }

  /** True while MOVE/COPY (etc.) wait for object selection via canvas. */
  isAwaitingSelection(): boolean {
    return this.running?.prompt.inputType === 'entities';
  }

  getRunningCommand(): CadEngineCommand | null {
    return this.running?.command ?? null;
  }

  getLastPoint(): Vec2 | null {
    return this.running?.lastPoint ?? null;
  }

  /** Active typed angle override, if any. */
  getAngleOverrideDeg(): number | null {
    return this.running?.angleOverrideDeg ?? null;
  }

  setRectangleDims(length: number | null, width: number | null): void {
    if (this.running?.command.id !== 'rectangle') return;
    setEngineRectangleConstraints(this.running.state, length, width);
  }

  getStatusMessage(): string | null {
    return this.running?.status ?? this.message;
  }

  getBuffer(): string {
    return this.buffer;
  }

  setBuffer(value: string): void {
    this.buffer = value;
    this.suggestions = this.registry.suggest(value);
    this.suggestionIndex = this.suggestions.length ? 0 : -1;
    if (!this.running) this.message = null;
  }

  getUiState(): CadCommandUiState {
    if (!this.running) {
      return {
        phase: 'idle',
        commandName: null,
        prompt: 'Command:',
        optionsText: '',
        defaultText: '',
        message: this.message,
        history: this.history.list(),
        suggestions: this.suggestions,
        suggestionIndex: this.suggestionIndex,
        dynamic: null,
        preview: null,
        previewEntities: null,
        hideEntityIds: [],
      };
    }
    const r = this.running;
    return {
      phase: 'awaiting-input',
      commandName: r.command.name,
      prompt: r.prompt.message,
      optionsText: formatOptionsHint(r.prompt.options),
      defaultText: formatDefaultHint(r.prompt.defaultValue),
      message: r.message ?? this.message,
      history: this.history.list(),
      suggestions: [],
      suggestionIndex: -1,
      dynamic: r.dynamic,
      preview: r.preview,
      previewEntities: r.previewEntities,
      hideEntityIds: r.hideEntityIds,
    };
  }

  /** Start by alias/name or tool id. */
  start(rawOrId: string): { ok: true } | { ok: false; message: string } {
    const resolved = this.registry.resolve(rawOrId);
    const byTool =
      !resolved.ok && this.registry.getByTool(rawOrId.toLowerCase());
    const command = resolved.ok
      ? resolved.command
      : byTool
        ? byTool
        : null;
    if (!command) {
      if (!resolved.ok && resolved.reason === 'empty') {
        return { ok: false, message: '' };
      }
      const input = !resolved.ok ? resolved.input : rawOrId;
      this.message = `Unknown command: ${input}`;
      return { ok: false, message: this.message };
    }
    return this.startCommand(command);
  }

  startCommand(command: CadEngineCommand): { ok: true } {
    this.cancel(false);
    this.host.activateTool(command.tool);
    this.history.push(command.name);
    this.lastCompletedName = command.name;
    this.buffer = '';
    this.suggestions = [];
    this.suggestionIndex = -1;
    this.message = null;
    const ctx = this.ctx(null);
    const started = command.start(ctx);
    this.running = {
      command,
      prompt: started.prompt,
      state: { bus: this.bus },
      lastPoint: null,
      angleOverrideDeg: null,
      preview: null,
      previewEntities: null,
      hideEntityIds: [],
      dynamic: null,
      status: started.status ?? `${command.name}: ${started.prompt.message}`,
      message: null,
    };
    if (command.handoffToTool) {
      // Leave tool active; canvas handlers own interaction.
      this.running = null;
    }
    return { ok: true };
  }

  /** Tab cycles autocomplete suggestions into the buffer. */
  cycleSuggestion(): void {
    if (this.running) return;
    if (!this.suggestions.length) {
      this.suggestions = this.registry.suggest(this.buffer);
    }
    if (!this.suggestions.length) return;
    this.suggestionIndex =
      (this.suggestionIndex + 1) % this.suggestions.length;
    this.buffer = this.suggestions[this.suggestionIndex]!;
  }

  historyUp(): void {
    if (this.running) return;
    const v = this.history.up();
    if (v != null) {
      this.buffer = v;
      this.suggestions = this.registry.suggest(this.buffer);
    }
  }

  historyDown(): void {
    if (this.running) return;
    const v = this.history.down();
    if (v != null) {
      this.buffer = v;
      this.suggestions = this.registry.suggest(this.buffer);
    }
  }

  /**
   * Confirm typed buffer with Enter or Space.
   * Idle: start command (or repeat last on empty Enter).
   * Running: submit text / default to current prompt.
   */
  confirm(source: 'enter' | 'space' = 'enter'): void {
    if (!this.running) {
      const raw = this.buffer.trim();
      if (!raw) {
        if (source === 'enter' && this.lastCompletedName) {
          this.start(this.lastCompletedName);
        }
        return;
      }
      this.start(raw);
      return;
    }
    const text = this.buffer.trim();
    this.buffer = '';
    this.submitText(text);
  }

  cancel(activateSelect = true): void {
    if (this.running?.command.onCancel) {
      this.running.command.onCancel(this.running.state);
    }
    this.running = null;
    this.buffer = '';
    this.suggestions = [];
    this.suggestionIndex = -1;
    if (activateSelect) this.host.activateSelect();
  }

  /** Pointer / snap-resolved world point while a command waits for a point/distance. */
  submitPoint(point: Vec2): void {
    if (!this.running) return;
    if (this.running.prompt.inputType === 'entities') return;
    const inputType = this.running.prompt.inputType;
    // Allow click-to-pick for point and distance prompts (e.g. CIRCLE radius).
    if (inputType !== 'point' && inputType !== 'distance') return;
    const r = this.running;
    const ctx = this.ctx(r.lastPoint);
    const result = r.command.onPoint(point, r.prompt, ctx, r.state);
    this.applyResult(result, point);
  }

  submitText(text: string): void {
    if (!this.running) return;
    const r = this.running;
    const prompt = r.prompt;

    // Empty Enter → default value via command onText, or let command finish
    if (!text) {
      if (prompt.defaultValue != null && prompt.defaultValue !== '') {
        const result = r.command.onText(
          String(prompt.defaultValue),
          prompt,
          this.ctx(r.lastPoint),
          r.state,
        );
        this.applyResult(result);
        return;
      }
      const result = r.command.onText('', prompt, this.ctx(r.lastPoint), r.state);
      this.applyResult(result);
      return;
    }

    if (prompt.inputType === 'entities') {
      const result = r.command.onText(text, prompt, this.ctx(r.lastPoint), r.state);
      this.applyResult(result);
      return;
    }

    if (prompt.inputType === 'distance' || prompt.inputType === 'length') {
      const result = r.command.onText(text, prompt, this.ctx(r.lastPoint), r.state);
      this.applyResult(result);
      return;
    }

    if (prompt.inputType === 'point') {
      const parsed = parsePointInput(text, {
        lastPoint: r.lastPoint,
        cursor: this.host.getCursor(),
        angleOverrideDeg: r.angleOverrideDeg,
        units: this.host.getUnits(),
      });
      if (isAngleOverrideResult(parsed)) {
        r.angleOverrideDeg = parsed.angleOverrideDeg;
        r.message = `Angle override: ${parsed.angleOverrideDeg}°`;
        r.status = `${r.command.name}: ${prompt.message} (angle ${parsed.angleOverrideDeg}°)`;
        return;
      }
      if (isDistanceResult(parsed) && parsed.ok) {
        if (!r.lastPoint) {
          r.message = 'No base point for direct distance';
          return;
        }
        const pt = pointFromDirectDistance(
          r.lastPoint,
          this.host.getCursor(),
          parsed.value,
          r.angleOverrideDeg,
        );
        if (!pt) {
          r.message = 'Cannot resolve direct distance (need cursor direction)';
          return;
        }
        this.submitPoint(pt);
        return;
      }
      if (isPointResult(parsed)) {
        this.submitPoint(parsed.point);
        return;
      }
      // Option keywords on point prompts (e.g. Length/Width/Undo)
      if (prompt.options?.length) {
        const result = r.command.onText(text, prompt, this.ctx(r.lastPoint), r.state);
        this.applyResult(result);
        return;
      }
      r.message =
        'error' in parsed && parsed.ok === false
          ? parsed.error
          : 'Invalid point input';
      return;
    }

    const result = r.command.onText(text, prompt, this.ctx(r.lastPoint), r.state);
    this.applyResult(result);
  }

  onPointerMove(point: Vec2): void {
    const onMove = this.running?.command.onMove;
    if (!this.running || !onMove) return;
    const r = this.running;
    if (r.prompt.inputType !== 'point' && r.prompt.inputType !== 'distance') {
      return;
    }
    const update = onMove(
      point,
      r.prompt,
      this.ctx(r.lastPoint),
      r.state,
    );
    if (update.preview !== undefined) r.preview = update.preview;
    if (update.previewEntities !== undefined) {
      r.previewEntities = update.previewEntities;
    }
    if (update.hideEntityIds !== undefined) {
      r.hideEntityIds = update.hideEntityIds;
    }
    if (update.dynamic !== undefined) r.dynamic = update.dynamic;
    if (update.status) r.status = update.status;
  }

  private applyResult(
    result: ReturnType<CadEngineCommand['onPoint']>,
    lastPoint?: Vec2,
  ): void {
    if (!this.running) return;
    const r = this.running;
    if (result.kind === 'cancel') {
      this.cancel(true);
      return;
    }
    if (result.kind === 'reject') {
      r.message = result.message;
      r.prompt = result.prompt;
      return;
    }
    if (result.kind === 'complete') {
      this.message = result.message ?? null;
      this.running = null;
      this.buffer = '';
      this.host.activateSelect();
      return;
    }
    // continue
    r.prompt = result.prompt;
    r.message = result.message ?? null;
    if (result.status) r.status = result.status;
    if (result.preview !== undefined) r.preview = result.preview;
    else r.preview = null;
    if (result.dynamic !== undefined) r.dynamic = result.dynamic;
    else r.dynamic = null;
    r.previewEntities = null;
    r.hideEntityIds = [];
    if (result.lastPoint !== undefined) r.lastPoint = result.lastPoint;
    else if (lastPoint) r.lastPoint = lastPoint;
    r.angleOverrideDeg = null;
  }

  private ctx(lastPoint: Vec2 | null): CadCommandContext {
    return {
      units: this.host.getUnits(),
      lastPoint,
      cursor: this.host.getCursor(),
      angleOverrideDeg: this.running?.angleOverrideDeg ?? null,
      selectedIds: this.host.getSelectedIds(),
    };
  }
}
