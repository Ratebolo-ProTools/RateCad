/**
 * DocumentSession — per-drawing runtime ownership (P3-B1 → P3-B3A).
 *
 * P3-B3A isolates document-specific mutable services inside each session:
 * CommandBus, SelectionManager, CadCommandEngine (when bound), cameras,
 * ViewHistory, tool session, layout/viewport UI fields, file/dirty state.
 *
 * P3-B3B enables App tab switching / new-tab create against this ownership.
 * App-shared prefs (ribbon tab, crosshair/pickbox, recents) stay outside.
 */

import {
  CommandBus,
  type CommandBusChangeKind,
} from '@ratecad/commands';
import {
  createEmptyDocument,
  ensureLayouts,
  type DrawingDocument,
  type EntityId,
  type Layout,
  type LayoutViewport,
  type ViewportId,
  type WorkspaceMode,
} from '@ratecad/core';
import {
  CadCommandEngine,
  SelectionManager,
  cancelTool,
  createDefaultEngineRegistry,
  createToolSession,
  type EngineHost,
  type ToolSession,
} from '@ratecad/tools';
import {
  createCamera,
  ViewHistory,
  type Camera,
} from '@ratecad/viewport';
import {
  APPLICATION_GLOBAL_STATE,
  DOCUMENT_SPECIFIC_STATE,
  REMAINING_FOR_P3_B3B_UI_SWITCH,
} from './documentSessionArchitecture.js';

export type DocumentSessionId = string;

export type DirtyListener = (dirty: boolean) => void;

/**
 * Document-specific runtime state for one open drawing.
 * Geometry / layers / settings / layouts live on `bus.getDocument()` —
 * this object does not duplicate DrawingDocument data.
 */
export type DocumentSession = {
  readonly id: DocumentSessionId;
  /** Owns DrawingDocument + undo/redo stacks. */
  readonly bus: CommandBus;
  /** OS path or web download identity; null for untitled. */
  filePath: string | null;
  dirty: boolean;
  /** When true, bus notifications must not mark dirty (load/save). */
  suppressDirty: boolean;
  toolSession: ToolSession;
  camera: Camera;
  modelCamera: Camera;
  readonly viewHistory: ViewHistory;
  workspaceMode: WorkspaceMode;
  activeViewportId: ViewportId | null;
  selectedViewportId: ViewportId | null;
  selectedPaperEntityIds: string[];
  /** Per-session selection + hover owner (bound to this bus). */
  selectionManager: SelectionManager;
  /** Per-session command engine; bound when App/host is available. */
  engine: CadCommandEngine | null;
  /** Hover highlight for this session only. */
  hoveredId: EntityId | null;
  /** Document-specific command-line buffer. */
  commandLineBuffer: string;
  disposed: boolean;
  /** Session-owned bus unsubscribers (dirty tracking, etc.). */
  readonly _unsubscribers: Array<() => void>;
  readonly _dirtyListeners: Set<DirtyListener>;
};

export type CreateDocumentSessionOptions = {
  /** Reuse an existing bus (App adapter). Otherwise a new untitled bus is created. */
  bus?: CommandBus;
  document?: DrawingDocument;
  filePath?: string | null;
  dirty?: boolean;
  toolSession?: ToolSession;
  camera?: Camera;
  modelCamera?: Camera;
  viewHistory?: ViewHistory;
  workspaceMode?: WorkspaceMode;
  activeViewportId?: ViewportId | null;
  selectedViewportId?: ViewportId | null;
  selectedPaperEntityIds?: string[];
  selectionManager?: SelectionManager;
  /** When false, caller attaches dirty tracking later. Default true. */
  trackDirtyFromBus?: boolean;
  /**
   * When true, bind a CadCommandEngine with a minimal host immediately
   * (tests / headless isolation). App supplies a richer host via bindSessionEngine.
   */
  bindMinimalEngine?: boolean;
};

/** @deprecated Prefer APPLICATION_GLOBAL_STATE — kept for P3-B1 tests. */
export const APPLICATION_SHARED_STATE_KEYS = [
  'activeRibbonTab',
  'applicationPreferences',
  'crosshairPreferences',
  'pickboxPreferences',
  'recentDrawings',
  'windowSettings',
] as const;

/** @deprecated Prefer DOCUMENT_SPECIFIC_STATE. */
export const DOCUMENT_SESSION_STATE_KEYS = [
  'drawingGeometry',
  'layers',
  'drawingSettings',
  'undoRedo',
  'selection',
  'activeTool',
  'commandSession',
  'camera',
  'layout',
  'activeViewport',
  'fileIdentity',
  'dirtyState',
  'viewHistory',
] as const;

/**
 * @deprecated P3-B3A owns engine/selection/hover; P3-B3B rebinds App mirrors.
 * Close workflows remain P3-B4.
 */
export const REMAINING_SHARED_BEFORE_MULTI_TAB = [
  ...REMAINING_FOR_P3_B3B_UI_SWITCH,
] as const;

export {
  APPLICATION_GLOBAL_STATE,
  DOCUMENT_SPECIFIC_STATE,
  REMAINING_FOR_P3_B3B_UI_SWITCH,
};

export function createSessionId(): DocumentSessionId {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

export function createUntitledBus(): CommandBus {
  return new CommandBus(ensureLayouts(createEmptyDocument('Untitled Drawing')));
}

export function getSessionDocument(session: DocumentSession): DrawingDocument {
  return session.bus.getDocument();
}

export function getSessionTitle(session: DocumentSession): string {
  return getSessionDocument(session).meta.name || 'Untitled Drawing';
}

export function getSessionDisplayName(session: DocumentSession): string {
  const title = getSessionTitle(session);
  return session.dirty ? `${title} *` : title;
}

export function getSessionActiveLayoutId(
  session: DocumentSession,
): string | null {
  return getSessionDocument(session).activeLayoutId ?? null;
}

export function subscribeDirty(
  session: DocumentSession,
  listener: DirtyListener,
): () => void {
  session._dirtyListeners.add(listener);
  return () => {
    session._dirtyListeners.delete(listener);
  };
}

function emitDirty(session: DocumentSession): void {
  for (const listener of session._dirtyListeners) {
    listener(session.dirty);
  }
}

export function markSessionDirty(session: DocumentSession): void {
  if (session.disposed) return;
  if (session.dirty) return;
  session.dirty = true;
  emitDirty(session);
}

export function clearSessionDirty(session: DocumentSession): void {
  if (session.disposed) return;
  if (!session.dirty) return;
  session.dirty = false;
  emitDirty(session);
}

export function setSessionFilePath(
  session: DocumentSession,
  filePath: string | null,
): void {
  if (session.disposed) return;
  session.filePath = filePath;
}

export function setSessionHoveredId(
  session: DocumentSession,
  id: EntityId | null,
): void {
  if (session.disposed) return;
  session.hoveredId = id;
  session.selectionManager.setHovered(id);
}

export function setSessionCommandLineBuffer(
  session: DocumentSession,
  value: string,
): void {
  if (session.disposed) return;
  session.commandLineBuffer = value;
}

/**
 * Run a bus/document mutation without flipping dirty
 * (load, successful save metadata, or caller-classified view-only ops).
 */
export function withDirtySuppressed(
  session: DocumentSession,
  fn: () => void,
): void {
  const prev = session.suppressDirty;
  session.suppressDirty = true;
  try {
    fn();
  } finally {
    session.suppressDirty = prev;
  }
}

/**
 * Record save outcome. Successful persistence clears dirty;
 * failed/canceled saves preserve dirty.
 */
export function recordSaveOutcome(
  session: DocumentSession,
  outcome: { ok: true; filePath?: string | null } | { ok: false },
): void {
  if (session.disposed) return;
  if (!outcome.ok) {
    return;
  }
  if (outcome.filePath !== undefined) {
    session.filePath = outcome.filePath;
  }
  clearSessionDirty(session);
}

/** Whether New/Open/Exit should prompt to discard unsaved changes. */
export function shouldPromptDiscard(session: DocumentSession): boolean {
  return !session.disposed && session.dirty;
}

/**
 * View-only camera / history updates. Must not mark the session dirty.
 */
export function setSessionCamera(
  session: DocumentSession,
  camera: Camera,
): void {
  if (session.disposed) return;
  session.camera = camera;
}

export function setSessionModelCamera(
  session: DocumentSession,
  camera: Camera,
): void {
  if (session.disposed) return;
  session.modelCamera = camera;
}

export function clearSessionViewHistory(session: DocumentSession): void {
  if (session.disposed) return;
  session.viewHistory.clear();
}

export function setSessionWorkspaceMode(
  session: DocumentSession,
  mode: WorkspaceMode,
): void {
  if (session.disposed) return;
  session.workspaceMode = mode;
}

/**
 * Strip selection + navigation camera fields so view/selection-only
 * updateWithoutHistory mutations do not look like document edits.
 */
export function persistedContentFingerprint(doc: DrawingDocument): string {
  const layouts = doc.layouts.map((layout: Layout) => ({
    id: layout.id,
    name: layout.name,
    pageSettings: layout.pageSettings,
    sheetInfo: layout.sheetInfo ?? null,
    titleBlock: layout.titleBlock ?? null,
    paperSpaceEntities: layout.paperSpaceEntities,
    viewports: layout.viewports.map((vp: LayoutViewport) => ({
      id: vp.id,
      x: vp.x,
      y: vp.y,
      width: vp.width,
      height: vp.height,
      locked: vp.locked,
      visible: vp.visible,
      label: vp.label ?? null,
      scaleLabel: vp.scaleLabel ?? null,
      showLabel: vp.showLabel ?? null,
      layerVisibilityOverrides: vp.layerVisibilityOverrides,
    })),
  }));

  return JSON.stringify({
    schemaVersion: doc.schemaVersion,
    meta: {
      name: doc.meta.name,
      createdAt: doc.meta.createdAt,
      appVersion: doc.meta.appVersion,
    },
    settings: doc.settings,
    layers: doc.layers,
    currentLayerId: doc.currentLayerId,
    entities: doc.entities,
    activeLayoutId: doc.activeLayoutId ?? null,
    layouts,
  });
}

export function shouldMarkDirtyForBusChange(
  kind: CommandBusChangeKind,
  previous: DrawingDocument,
  next: DrawingDocument,
): boolean {
  if (kind === 'execute' || kind === 'undo' || kind === 'redo') {
    return true;
  }
  if (kind === 'reset') {
    return false;
  }
  return (
    persistedContentFingerprint(previous) !==
    persistedContentFingerprint(next)
  );
}

export function attachBusDirtyTracking(session: DocumentSession): () => void {
  let previous = session.bus.getDocument();
  const unsubscribe = session.bus.subscribe((next) => {
    const kind = session.bus.getLastChangeKind();
    if (!session.disposed && !session.suppressDirty) {
      if (shouldMarkDirtyForBusChange(kind, previous, next)) {
        markSessionDirty(session);
      }
    }
    previous = next;
  });
  session._unsubscribers.push(unsubscribe);
  return unsubscribe;
}

/** Minimal EngineHost for headless / isolation tests. */
export function createMinimalEngineHost(
  session: DocumentSession,
): EngineHost {
  return {
    getUnits: () => session.bus.getDocument().settings.units,
    getWorldUnit: () => session.bus.getDocument().settings.worldUnit ?? 'ft',
    getSelectedIds: () => [...session.bus.getDocument().selection],
    getCursor: () => ({ x: 0, y: 0 }),
    activateTool: () => undefined,
    activateSelect: () => {
      session.toolSession = createToolSession('select');
    },
    clearSelection: () => {
      session.selectionManager.clear();
      session.hoveredId = null;
    },
    getWorkspaceMode: () => session.workspaceMode,
  };
}

/**
 * Bind (or replace) a CadCommandEngine owned by this session.
 * Uses the session's CommandBus — never a foreign bus.
 */
export function bindSessionEngine(
  session: DocumentSession,
  host: EngineHost,
  registry = createDefaultEngineRegistry(),
): CadCommandEngine {
  if (session.disposed) {
    throw new Error('Cannot bind engine on a disposed DocumentSession');
  }
  const engine = new CadCommandEngine(registry, session.bus, host);
  session.engine = engine;
  return engine;
}

export function createDocumentSession(
  options: CreateDocumentSessionOptions = {},
): DocumentSession {
  const bus =
    options.bus ??
    (options.document
      ? new CommandBus(ensureLayouts(options.document))
      : createUntitledBus());

  const selectionManager =
    options.selectionManager ?? new SelectionManager(bus);

  const session: DocumentSession = {
    id: createSessionId(),
    bus,
    filePath: options.filePath ?? null,
    dirty: options.dirty ?? false,
    suppressDirty: false,
    toolSession: options.toolSession ?? createToolSession('select'),
    camera: options.camera ?? createCamera(),
    modelCamera: options.modelCamera ?? createCamera(),
    viewHistory: options.viewHistory ?? new ViewHistory(32),
    workspaceMode: options.workspaceMode ?? 'MODEL_SPACE',
    activeViewportId: options.activeViewportId ?? null,
    selectedViewportId: options.selectedViewportId ?? null,
    selectedPaperEntityIds: options.selectedPaperEntityIds
      ? [...options.selectedPaperEntityIds]
      : [],
    selectionManager,
    engine: null,
    hoveredId: null,
    commandLineBuffer: '',
    disposed: false,
    _unsubscribers: [],
    _dirtyListeners: new Set(),
  };

  if (options.trackDirtyFromBus !== false) {
    attachBusDirtyTracking(session);
  }

  if (options.bindMinimalEngine) {
    bindSessionEngine(session, createMinimalEngineHost(session));
  }

  return session;
}

/**
 * Replace the drawing inside an existing session (single-document
 * New/Open path). Clears undo history via bus.reset, resets tool/view
 * session fields, and optionally clears dirty/path.
 */
export function replaceSessionDocument(
  session: DocumentSession,
  document: DrawingDocument,
  options: {
    filePath?: string | null;
    dirty?: boolean;
    clearViewHistory?: boolean;
  } = {},
): void {
  if (session.disposed) return;
  withDirtySuppressed(session, () => {
    session.bus.reset(ensureLayouts(document));
  });
  session.toolSession = createToolSession('select');
  session.camera = createCamera();
  session.modelCamera = createCamera();
  session.workspaceMode =
    document.activeLayoutId == null ? 'MODEL_SPACE' : 'PAPER_SPACE';
  session.activeViewportId = null;
  session.selectedViewportId = null;
  session.selectedPaperEntityIds = [];
  session.hoveredId = null;
  session.selectionManager.setHovered(null);
  session.commandLineBuffer = '';
  if (options.clearViewHistory !== false) {
    session.viewHistory.clear();
  }
  if (options.filePath !== undefined) {
    session.filePath = options.filePath;
  }
  if (options.dirty === false) {
    clearSessionDirty(session);
  } else if (options.dirty === true) {
    markSessionDirty(session);
  }
}

/**
 * Dispose session-owned resources. Does not dispose application-shared
 * prefs, recent drawings, or App shell services.
 */
export function disposeDocumentSession(session: DocumentSession): void {
  if (session.disposed) return;
  session.disposed = true;
  for (const unsub of session._unsubscribers.splice(0)) {
    try {
      unsub();
    } catch {
      // Ignore listener cleanup failures.
    }
  }
  session._dirtyListeners.clear();
  session.viewHistory.clear();
  session.toolSession = cancelTool(createToolSession('select'));
  session.selectedPaperEntityIds = [];
  session.activeViewportId = null;
  session.selectedViewportId = null;
  session.hoveredId = null;
  session.selectionManager.setHovered(null);
  session.commandLineBuffer = '';
  session.engine = null;
  session.filePath = null;
  session.dirty = false;
}
