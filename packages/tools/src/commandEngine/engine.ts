import type { CommandBus } from '@ratecad/commands';
import type { Entity, EntityId, LengthUnit, Vec2 } from '@ratecad/core';
import type { PreviewGeometry } from '@ratecad/viewport';
import { CadCommandHistory } from './history.js';
import {
  classifyIdleCommandInput,
  classifyActiveCommandInput,
} from './inputClassifier.js';
import {
  formatDefaultHint,
  formatOptionsHint,
  isAngleOverrideResult,
  isDistanceResult,
  isPointResult,
  matchOption,
  parsePointInput,
  pointFromDirectDistance,
} from './parsers.js';
import { CadEngineRegistry } from './registry.js';
import { setEngineRectangleConstraints } from './commands/rectangle.js';
import { CommandUsageTracker } from './usage.js';
import type {
  CadCommandContext,
  CadCommandUiState,
  CadDynamicInput,
  CadEngineCommand,
  CadPromptDefinition,
  CommandSuggestion,
} from './types.js';

export interface EngineHost {
  getUnits(): LengthUnit;
  getWorldUnit(): LengthUnit;
  getSelectedIds(): EntityId[];
  getCursor(): Vec2 | null;
  /** Activate matching toolbar tool for UI consistency. */
  activateTool(tool: string): void;
  /** Set select tool after cancel/complete. */
  activateSelect(): void;
  /** Optional: route natural-language idle input to AI adapter. */
  onNaturalLanguage?: (text: string) => void;
  /** Optional: clear document selection (ESC when idle). */
  clearSelection?: () => void;
  /** Workspace mode for LAYOUT / MSPACE / PSPACE. */
  getWorkspaceMode?: () => import('@ratecad/core').WorkspaceMode;
  /** Enter VIEWPORT_MODEL_SPACE through the active/selected viewport. */
  enterMspace?: () => { ok: boolean; message: string };
  /** Return to PAPER_SPACE from VIEWPORT_MODEL_SPACE. */
  enterPspace?: () => { ok: boolean; message: string };
  /** Sync App tabs after LAYOUT CREATE/SET/RENAME. */
  onLayoutChanged?: (layoutId: string | null, message: string) => void;
  /** Open Drawing Units dialog (UNITS command). */
  openUnitsDialog?: () => void;
  /** Open Dimension Style Manager (DIMSTYLE command). */
  openDimStyleDialog?: () => void;
  /** ZOOM Extents — fit visible geometry (Phase P1). */
  zoomExtents?: () => { ok: boolean; message: string };
  /** ZOOM Window — frame two corners (Phase P1). */
  zoomWindow?: (
    a: import('@ratecad/core').Vec2,
    b: import('@ratecad/core').Vec2,
  ) => { ok: boolean; message: string };
  /** ZOOM Previous — restore last view snapshot (Phase P1). */
  zoomPrevious?: () => { ok: boolean; message: string };
  /** Activate pan tool (PAN command / nav bar). */
  beginPanTool?: () => void;
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

export type EscAction =
  | { kind: 'cancel-command' }
  | { kind: 'clear-buffer' }
  | { kind: 'clear-selection' }
  | { kind: 'idle' };

/**
 * Central CAD command engine — one execution path for aliases, command line, and toolbar.
 * Extended for ranked suggestions, usage ranking, ESC state machine, and NL classification.
 */
export class CadCommandEngine {
  readonly registry: CadEngineRegistry;
  readonly history: CadCommandHistory;
  readonly usage: CommandUsageTracker;
  private running: Running | null = null;
  /** Last successfully completed command name (SPACE/Enter repeat). */
  private lastCompletedName: string | null = null;
  /** Handoff tool command waiting for commit or ESC → Selection Mode. */
  private handoffName: string | null = null;
  /** Undo depth when the current engine/handoff session started. */
  private undoDepthAtStart = 0;
  private buffer = '';
  private suggestionRows: CommandSuggestion[] = [];
  private suggestionIndex = -1;
  private message: string | null = null;
  private naturalLanguagePending = false;

  constructor(
    registry: CadEngineRegistry,
    private readonly bus: CommandBus,
    private readonly host: EngineHost,
    usage?: CommandUsageTracker,
  ) {
    this.registry = registry;
    this.history = new CadCommandHistory();
    this.usage = usage ?? new CommandUsageTracker();
  }

  isRunning(): boolean {
    return !!this.running;
  }

  /** Name of the last successfully completed command, if any. */
  getLastCompletedName(): string | null {
    return this.lastCompletedName;
  }

  /** True while a handoff tool (MIRROR, etc.) owns the canvas after start(). */
  hasPendingHandoff(): boolean {
    return this.handoffName != null;
  }

  /**
   * After a handoff tool commits geometry, store it as last completed and clear handoff.
   * @returns true when a commit was recorded (caller should enter Selection Mode).
   */
  finalizeHandoffIfCommitted(): boolean {
    if (!this.handoffName) return false;
    if (this.sessionCommittedWork()) {
      this.lastCompletedName = this.handoffName;
      this.handoffName = null;
      return true;
    }
    return false;
  }

  /**
   * Mark a successful handoff completion that did not mutate document history
   * (e.g. AREA measurement). Stores last completed for SPACE repeat.
   */
  completeHandoff(): boolean {
    if (!this.handoffName) return false;
    this.lastCompletedName = this.handoffName;
    this.handoffName = null;
    return true;
  }

  /** Clear handoff tracking without treating it as a successful completion. */
  clearHandoff(): void {
    this.handoffName = null;
  }

  /** True while MOVE/COPY (etc.) wait for object selection via canvas. */
  isAwaitingSelection(): boolean {
    return this.running?.prompt.inputType === 'entities';
  }

  getRunningCommand(): CadEngineCommand | null {
    return this.running?.command ?? null;
  }

  getActivePrompt(): CadPromptDefinition | null {
    return this.running?.prompt ?? null;
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
    this.refreshSuggestions();
    if (!this.running) this.message = null;
  }

  private refreshSuggestions(): void {
    if (this.running) {
      this.suggestionRows = [];
      this.suggestionIndex = -1;
      this.naturalLanguagePending = false;
      return;
    }
    const classified = classifyIdleCommandInput(this.buffer);
    if (classified.kind === 'natural-language') {
      this.suggestionRows = [];
      this.suggestionIndex = -1;
      this.naturalLanguagePending = true;
      return;
    }
    this.naturalLanguagePending = false;
    this.suggestionRows = this.registry.suggestRanked(this.buffer, {
      usage: this.usage,
      allowTypo: true,
    });
    this.suggestionIndex = this.suggestionRows.length ? 0 : -1;
  }

  getUiState(): CadCommandUiState {
    const suggestionStrings = this.suggestionRows.map((r) =>
      r.alias ? `${r.alias} (${r.name})` : r.name,
    );
    if (!this.running) {
      return {
        phase: this.buffer.trim() ? 'command-input' : 'idle',
        commandName: null,
        prompt: 'Command:',
        optionsText: '',
        defaultText: '',
        message: this.message,
        history: this.history.list(),
        suggestions: suggestionStrings,
        suggestionIndex: this.suggestionIndex,
        suggestionRows: this.suggestionRows,
        dynamic: null,
        preview: null,
        previewEntities: null,
        hideEntityIds: [],
        naturalLanguagePending: this.naturalLanguagePending,
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
      suggestionRows: [],
      dynamic: r.dynamic,
      preview: r.preview,
      previewEntities: r.previewEntities,
      hideEntityIds: r.hideEntityIds,
      naturalLanguagePending: false,
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
      // Typo: offer did-you-mean without executing
      const ranked = this.registry.suggestRanked(rawOrId, {
        usage: this.usage,
        allowTypo: true,
        limit: 3,
      });
      if (ranked.length && ranked[0]!.matchKind === 'typo') {
        this.message = `Did you mean: ${ranked[0]!.name}?`;
        this.suggestionRows = ranked;
        this.suggestionIndex = 0;
        return { ok: false, message: this.message };
      }
      const input = !resolved.ok ? resolved.input : rawOrId;
      this.message = `Unknown command: ${input}`;
      return { ok: false, message: this.message };
    }
    return this.startCommand(command);
  }

  startCommand(command: CadEngineCommand): { ok: true } {
    this.cancel(false);
    this.handoffName = null;
    this.undoDepthAtStart = this.bus.getUndoDepth();
    this.host.activateTool(command.tool);
    this.history.push(command.name);
    this.usage.record(command.id);
    this.buffer = '';
    this.suggestionRows = [];
    this.suggestionIndex = -1;
    this.message = null;
    this.naturalLanguagePending = false;
    const ctx = this.ctx(null);
    const started = command.start(ctx);
    this.running = {
      command,
      prompt: started.prompt,
      state: { bus: this.bus, ...(started.state ?? {}) },
      lastPoint: null,
      angleOverrideDeg: null,
      preview: null,
      previewEntities: null,
      hideEntityIds: [],
      dynamic: null,
      status: started.status ?? `${command.name}: ${started.prompt.message}`,
      message: null,
    };
    if (command.bootstrap) {
      const boot = command.bootstrap(this.bus, this.host);
      if (boot.state) Object.assign(this.running.state, boot.state);
      if (boot.prompt) this.running.prompt = boot.prompt;
      if (boot.status) this.running.status = boot.status;
      if (boot.complete) {
        this.message = boot.status ?? this.running.status;
        // Successful immediate completion (e.g. MSPACE/PSPACE).
        this.lastCompletedName = command.name;
        this.running = null;
        this.host.activateSelect();
        return { ok: true };
      }
    }
    if (command.handoffToTool) {
      // Leave tool active; canvas handlers own interaction.
      this.handoffName = command.name;
      this.running = null;
    }
    return { ok: true };
  }

  /** Tab / arrow: move highlight without replacing buffer unless cycling fills. */
  moveSuggestion(delta: number): void {
    if (this.running || !this.suggestionRows.length) return;
    const n = this.suggestionRows.length;
    this.suggestionIndex = (this.suggestionIndex + delta + n * 10) % n;
  }

  /** Tab cycles autocomplete: apply highlighted suggestion name into buffer. */
  cycleSuggestion(): void {
    if (this.running) return;
    if (!this.suggestionRows.length) {
      this.refreshSuggestions();
    }
    if (!this.suggestionRows.length) return;
    this.suggestionIndex =
      (this.suggestionIndex + 1) % this.suggestionRows.length;
    const row = this.suggestionRows[this.suggestionIndex]!;
    this.buffer = row.name;
  }

  selectSuggestion(index: number): void {
    if (index < 0 || index >= this.suggestionRows.length) return;
    this.suggestionIndex = index;
    this.buffer = this.suggestionRows[index]!.name;
  }

  historyUp(): void {
    if (this.running) return;
    const v = this.history.up();
    if (v != null) {
      this.buffer = v;
      this.refreshSuggestions();
    }
  }

  historyDown(): void {
    if (this.running) return;
    const v = this.history.down();
    if (v != null) {
      this.buffer = v;
      this.refreshSuggestions();
    }
  }

  /**
   * Confirm typed buffer with Enter or Space.
   * Idle: start exact alias/name, or highlighted suggestion if ambiguous prefix.
   * Never auto-picks a random ambiguous match without highlight.
   */
  confirm(source: 'enter' | 'space' = 'enter'): void {
    if (!this.running) {
      const raw = this.buffer.trim();
      if (!raw) {
        // Enter or Space with empty buffer repeats last completed command.
        if (
          (source === 'enter' || source === 'space') &&
          this.lastCompletedName
        ) {
          this.start(this.lastCompletedName);
        }
        return;
      }

      const classified = classifyIdleCommandInput(raw);
      if (classified.kind === 'natural-language') {
        this.host.onNaturalLanguage?.(classified.text);
        this.message = 'AI: natural-language request queued';
        this.buffer = '';
        this.refreshSuggestions();
        return;
      }

      // Exact resolve first (M → MOVE, MI → MIRROR)
      const exact = this.registry.resolve(raw);
      if (exact.ok) {
        this.startCommand(exact.command);
        return;
      }

      // Ambiguous / partial: use highlighted suggestion only
      if (this.suggestionRows.length && this.suggestionIndex >= 0) {
        const row = this.suggestionRows[this.suggestionIndex]!;
        const cmd = this.registry.get(row.commandId);
        if (cmd) {
          this.startCommand(cmd);
          return;
        }
      }

      this.start(raw);
      return;
    }

    // Active command: options take priority over global search
    const text = this.buffer.trim();
    this.buffer = '';
    const prompt = this.running.prompt;
    if (text && prompt.options?.length) {
      const classified = classifyActiveCommandInput(text, true);
      if (classified.kind === 'option-candidate') {
        const matched = matchOption(text, prompt.options);
        if (matched.ok) {
          this.submitText(matched.optionId);
          return;
        }
      }
    }
    this.submitText(text);
  }

  /**
   * ESC state machine:
   * 1) cancel running command
   * 2) clear command buffer / suggestions
   * 3) clear selection (via host)
   */
  handleEscape(): EscAction {
    if (this.running) {
      this.cancel(true);
      return { kind: 'cancel-command' };
    }
    if (this.handoffName) {
      // ESC ends handoff tool session; keep lastCompleted only if geometry was committed.
      this.finalizeHandoffIfCommitted();
      this.handoffName = null;
      this.buffer = '';
      this.suggestionRows = [];
      this.suggestionIndex = -1;
      this.message = null;
      this.naturalLanguagePending = false;
      this.host.activateSelect();
      return { kind: 'cancel-command' };
    }
    if (this.buffer.trim().length > 0 || this.suggestionRows.length > 0) {
      this.buffer = '';
      this.suggestionRows = [];
      this.suggestionIndex = -1;
      this.message = null;
      this.naturalLanguagePending = false;
      return { kind: 'clear-buffer' };
    }
    if (this.host.getSelectedIds().length > 0) {
      this.host.clearSelection?.();
      this.host.activateSelect();
      return { kind: 'clear-selection' };
    }
    this.host.activateSelect();
    return { kind: 'idle' };
  }

  cancel(activateSelect = true): void {
    if (this.running) {
      // Preserve last completed when ESC ends a session that already committed geometry
      // (e.g. LINE drew segments then ESC). Do not store abandoned/no-op cancels.
      if (this.sessionCommittedWork()) {
        this.lastCompletedName = this.running.command.name;
      }
      if (this.running.command.onCancel) {
        this.running.command.onCancel(this.running.state);
      }
    } else if (this.handoffName) {
      this.finalizeHandoffIfCommitted();
    }
    this.running = null;
    this.handoffName = null;
    this.buffer = '';
    this.suggestionRows = [];
    this.suggestionIndex = -1;
    this.naturalLanguagePending = false;
    if (activateSelect) this.host.activateSelect();
  }

  /** Pointer / snap-resolved world point while a command waits for a point/distance. */
  submitPoint(point: Vec2, modifiers?: { shiftKey?: boolean }): void {
    if (!this.running) return;
    if (this.running.prompt.inputType === 'entities') return;
    const inputType = this.running.prompt.inputType;
    // Allow click-to-pick for point and distance prompts (e.g. CIRCLE radius).
    if (inputType !== 'point' && inputType !== 'distance') return;
    const r = this.running;
    if (modifiers?.shiftKey) {
      r.state.shiftKey = true;
    } else {
      delete r.state.shiftKey;
    }
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
        worldUnit: this.host.getWorldUnit(),
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
      // Successful completion — store for SPACE/Enter repeat.
      this.lastCompletedName = r.command.name;
      this.running = null;
      this.handoffName = null;
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
      worldUnit: this.host.getWorldUnit(),
      lastPoint,
      cursor: this.host.getCursor(),
      angleOverrideDeg: this.running?.angleOverrideDeg ?? null,
      selectedIds: this.host.getSelectedIds(),
    };
  }

  private sessionCommittedWork(): boolean {
    return this.bus.getUndoDepth() > this.undoDepthAtStart;
  }
}
