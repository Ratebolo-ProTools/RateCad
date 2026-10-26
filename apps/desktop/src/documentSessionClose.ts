/**
 * P3-B4B1 — safe individual drawing-tab close helpers.
 *
 * Pure store/session logic for fallback selection, dirty prompts,
 * and last-tab compatibility policy. App owns dialogs and I/O.
 */

import {
  getSessionTitle,
  shouldPromptDiscard,
  type DocumentSession,
  type DocumentSessionId,
} from './documentSession.js';
import {
  listSessions,
  type DocumentSessionStore,
} from './documentSessionStore.js';

export type CloseSaveChoice = 'save' | 'dont-save' | 'cancel';

/**
 * Last-drawing policy (P3-B4B1):
 * App cannot safely run with zero DocumentSessions (bus/engine/UI mirrors).
 * After the final tab closes, App creates one clean untitled replacement.
 * Never silently discard a dirty last drawing — prompt first.
 */
export const LAST_DRAWING_CLOSE_POLICY =
  'replace-with-clean-untitled' as const;

export const CLOSE_SAVE_DIALOG_TITLE = 'Save changes to drawing?';

export function closeSaveDialogMessage(drawingName: string): string {
  const name = drawingName.trim() || 'Untitled Drawing';
  return `Do you want to save changes to "${name}" before closing?`;
}

export function shouldPromptSaveBeforeClose(
  session: DocumentSession,
): boolean {
  return shouldPromptDiscard(session);
}

/**
 * Choose the session that becomes active after closing `closingId`
 * when that session is currently active.
 *
 * Order:
 * 1. preferredPreviousId if still open and not the closing session
 * 2. Neighbor to the left, then right, in tab order
 * 3. Any remaining session
 * 4. null → caller applies last-drawing policy
 */
export function chooseFallbackSessionId(
  store: DocumentSessionStore,
  closingId: DocumentSessionId,
  preferredPreviousId: DocumentSessionId | null = null,
): DocumentSessionId | null {
  const ordered = listSessions(store);
  const remaining = ordered.filter(
    (s) => s.id !== closingId && !s.disposed,
  );
  if (remaining.length === 0) return null;

  if (
    preferredPreviousId &&
    preferredPreviousId !== closingId &&
    remaining.some((s) => s.id === preferredPreviousId)
  ) {
    return preferredPreviousId;
  }

  const idx = ordered.findIndex((s) => s.id === closingId);
  if (idx >= 0) {
    for (let i = idx - 1; i >= 0; i -= 1) {
      const candidate = ordered[i]!;
      if (candidate.id !== closingId && !candidate.disposed) {
        return candidate.id;
      }
    }
    for (let i = idx + 1; i < ordered.length; i += 1) {
      const candidate = ordered[i]!;
      if (candidate.id !== closingId && !candidate.disposed) {
        return candidate.id;
      }
    }
  }

  return remaining[0]!.id;
}

export function getCloseDialogTitle(session: DocumentSession): string {
  return getSessionTitle(session);
}

/** True when closing this session leaves the store empty. */
export function isLastOpenSession(
  store: DocumentSessionStore,
  sessionId: DocumentSessionId,
): boolean {
  return listSessions(store).filter((s) => s.id !== sessionId && !s.disposed)
    .length === 0;
}
