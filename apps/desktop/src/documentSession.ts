/**
 * P3-B1 — DocumentSession foundation.
 *
 * Packages per-drawing runtime state for future multi-document support
 * without changing DrawingDocument serialization or introducing a second
 * command engine. App-shared preferences (ribbon tab, drafting prefs,
 * recent drawings, window settings) stay outside this module.
 *
 * B1 scope: model + store + single-session App adapter.
 * Multi-tab UI, engine-per-session isolation, and full App ownership
 * migration are deferred to P3-B2 / P3-B3.
 */

import {
  CommandBus,
  type CommandBusChangeKind,
} from '@ratecad/commands';
import {
  createEmptyDocument,
  ensureLayouts,
  type DrawingDocument,
  type Layout,
  type LayoutViewport,
  type ViewportId,
  type WorkspaceMode,
} from '@ratecad/core';
import { createToolSession, type ToolSession } from '@ratecad/tools';
import {
  createCamera,
  ViewHistory,
  type Camera,
} from '@ratecad/viewport';

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
  /**
   * Optional App-attached controllers. B1 keeps CadCommandEngine /
   * SelectionManager constructed once in App and may point these slots
   * at the shared instances — do not create a second command engine here.
   */
  engine: unknown | null;
  selectionManager: unknown | null;
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
  /** When false, caller attaches dirty tracking later. Default true. */
  trackDirtyFromBus?: boolean;
};

/** Application-shared state — must not be stored on DocumentSession. */
export const APPLICATION_SHARED_STATE_KEYS = [
  'activeRibbonTab',
  'applicationPreferences',
  'crosshairPreferences',
  'pickboxPreferences',
  'recentDrawings',
  'windowSettings',
] as const;

/** Document-specific state owned or referenced by DocumentSession. */
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
 * Still shared on the single App shell — must be isolated per session
 * before P3-B2 multi-tab UI can safely become functional (P3-B3 work):
 * CadCommandEngine instance, SelectionManager, hover highlight, command-line
 * buffer, polar engine, canvas renderer bindings, and live React mirrors of
 * bus/camera/workspace that still close over App refs.
 */
export const REMAINING_SHARED_BEFORE_MULTI_TAB = [
  'CadCommandEngine',
  'SelectionManager',
  'hoveredId',
  'commandLineBuffer',
  'polarTrackingEngine',
  'canvasRendererBindings',
  'appBusRefMirrors',
] as const;

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
    // Keep dirty as-is (including true).
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

/**
 * Strip selection + navigation camera fields so view/selection-only
 * updateWithoutHistory mutations do not look like document edits.
 * Structural layout/viewport fields (bounds, lock, labels, paper entities)
 * remain in the fingerprint.
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
      // Intentionally omit modelCenterX/Y, scale, rotation — camera navigation.
    })),
    // Intentionally omit paperCamera — paper-space pan/zoom.
  }));

  return JSON.stringify({
    schemaVersion: doc.schemaVersion,
    // Omit meta.updatedAt — touchDocument() stamps it on many
    // updateWithoutHistory paths (including camera navigation).
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
    // Intentionally omit selection + workspaceMode (session UI).
  });
}

/**
 * Decide whether a bus notification should flip dirty.
 * - execute / undo / redo → always (history-backed document edits)
 * - reset → never here (New/Open use suppress + explicit clear)
 * - updateWithoutHistory → only when persisted content changes
 *   (not selection-only or camera-navigation-only)
 */
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
  // updateWithoutHistory
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

export function createDocumentSession(
  options: CreateDocumentSessionOptions = {},
): DocumentSession {
  const bus =
    options.bus ??
    (options.document
      ? new CommandBus(ensureLayouts(options.document))
      : createUntitledBus());

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
    engine: null,
    selectionManager: null,
    disposed: false,
    _unsubscribers: [],
    _dirtyListeners: new Set(),
  };

  if (options.trackDirtyFromBus !== false) {
    attachBusDirtyTracking(session);
  }

  return session;
}

/**
 * Replace the drawing inside an existing session (B1 single-document
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
 * prefs, recent drawings, or a CadCommandEngine that App still owns —
 * only clears session slots and unsubscribes session listeners.
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
  session.toolSession = createToolSession('select');
  session.selectedPaperEntityIds = [];
  session.activeViewportId = null;
  session.selectedViewportId = null;
  session.engine = null;
  session.selectionManager = null;
  session.filePath = null;
  session.dirty = false;
}
