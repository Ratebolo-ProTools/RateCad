/**
 * P3-B3B — safe multi-document session transitions.
 *
 * Pure helpers for untitled naming, deactivation cleanup, and
 * App mirror persistence. Does not own CAD engines or DrawingDocument.
 */

import {
  cancelTool,
  createToolSession,
  type ToolSession,
} from '@ratecad/tools';
import type { Camera } from '@ratecad/viewport';
import type { ViewportId, WorkspaceMode } from '@ratecad/core';
import {
  getSessionTitle,
  type DocumentSession,
  type DocumentSessionId,
} from './documentSession.js';
import {
  listSessions,
  setActiveSession,
  type DocumentSessionStore,
} from './documentSessionStore.js';

export const UNTITLED_DRAWING_BASE = 'Untitled Drawing';

/** App-owned mirrors that must be flushed into the session before switch. */
export type ActiveSessionMirrorSnapshot = {
  camera: Camera;
  modelCamera: Camera;
  toolSession: ToolSession;
  workspaceMode: WorkspaceMode;
  activeViewportId: ViewportId | null;
  selectedViewportId: ViewportId | null;
  selectedPaperEntityIds: string[];
  commandLineBuffer: string;
  hoveredId: string | null;
  dirty: boolean;
  filePath: string | null;
};

/**
 * Allocate a unique untitled title among open sessions.
 * Sequence: "Untitled Drawing", "Untitled Drawing 2", "Untitled Drawing 3", …
 */
export function allocateUntitledDrawingName(
  existingTitles: readonly string[],
): string {
  const used = new Set(
    existingTitles.map((t) => t.trim()).filter((t) => t.length > 0),
  );
  if (!used.has(UNTITLED_DRAWING_BASE)) return UNTITLED_DRAWING_BASE;
  let n = 2;
  while (used.has(`${UNTITLED_DRAWING_BASE} ${n}`)) {
    n += 1;
  }
  return `${UNTITLED_DRAWING_BASE} ${n}`;
}

export function allocateUntitledDrawingNameFromStore(
  store: DocumentSessionStore,
): string {
  return allocateUntitledDrawingName(
    listSessions(store).map((s) => getSessionTitle(s)),
  );
}

/**
 * Cancel incomplete command / tool / drag state on a session before leaving it.
 * Preserves committed geometry and undo/redo history.
 */
export function prepareSessionDeactivation(session: DocumentSession): {
  cancelledCommand: boolean;
  toolReset: boolean;
} {
  let cancelledCommand = false;
  if (session.engine?.isRunning()) {
    session.engine.cancel(false);
    cancelledCommand = true;
  }
  session.engine?.setBuffer('');
  session.commandLineBuffer = '';
  session.toolSession = cancelTool(createToolSession('select'));
  session.hoveredId = null;
  session.selectionManager.setHovered(null);
  return { cancelledCommand, toolReset: true };
}

/** Persist App React/ref mirrors into the session object (pre-switch). */
export function persistActiveSessionMirrors(
  session: DocumentSession,
  mirrors: ActiveSessionMirrorSnapshot,
): void {
  if (session.disposed) return;
  session.camera = { ...mirrors.camera };
  session.modelCamera = { ...mirrors.modelCamera };
  session.toolSession = mirrors.toolSession;
  session.workspaceMode = mirrors.workspaceMode;
  session.activeViewportId = mirrors.activeViewportId;
  session.selectedViewportId = mirrors.selectedViewportId;
  session.selectedPaperEntityIds = [...mirrors.selectedPaperEntityIds];
  session.commandLineBuffer = mirrors.commandLineBuffer;
  session.hoveredId = mirrors.hoveredId;
  session.dirty = mirrors.dirty;
  session.filePath = mirrors.filePath;
}

/**
 * Store-level activation. Returns the newly active session.
 * Does not touch engines — App rebinds after this.
 */
export function activateSessionInStore(
  store: DocumentSessionStore,
  sessionId: DocumentSessionId,
): DocumentSession {
  return setActiveSession(store, sessionId);
}

/** Snapshot of tab dirty flags for independent verification. */
export function sessionDirtyMap(
  store: DocumentSessionStore,
): Record<DocumentSessionId, boolean> {
  const out: Record<DocumentSessionId, boolean> = {};
  for (const s of listSessions(store)) {
    out[s.id] = s.dirty;
  }
  return out;
}

/** Whether keyboard / pointer input should target this session. */
export function isSessionInputTarget(
  activeSessionId: DocumentSessionId | null,
  sessionId: DocumentSessionId,
): boolean {
  return activeSessionId != null && activeSessionId === sessionId;
}
