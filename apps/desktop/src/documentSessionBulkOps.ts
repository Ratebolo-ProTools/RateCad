/**
 * P3-B4B2A — Save All / Close All pure coordinators.
 *
 * App owns I/O, dialogs, and disposal. This module plans targets,
 * snapshots session IDs, and revalidates Close All decisions.
 */

import {
  getSessionDocument,
  getSessionTitle,
  persistedContentFingerprint,
  type DocumentSession,
  type DocumentSessionId,
} from './documentSession.js';
import {
  getSession,
  listSessions,
  type DocumentSessionStore,
} from './documentSessionStore.js';
import { LAST_DRAWING_CLOSE_POLICY } from './documentSessionClose.js';

export { LAST_DRAWING_CLOSE_POLICY };

export type BulkOpKind = 'save-all' | 'close-all';

/** Stable ordered snapshot of open session IDs (tab order). */
export function snapshotOpenSessionIds(
  store: DocumentSessionStore,
): DocumentSessionId[] {
  return listSessions(store)
    .filter((s) => !s.disposed)
    .map((s) => s.id);
}

export function filterDirtySessionIds(
  store: DocumentSessionStore,
  sessionIds: readonly DocumentSessionId[],
): DocumentSessionId[] {
  const dirty: DocumentSessionId[] = [];
  for (const id of sessionIds) {
    const session = getSession(store, id);
    if (session && !session.disposed && session.dirty) {
      dirty.push(id);
    }
  }
  return dirty;
}

export function sessionFingerprint(session: DocumentSession): string {
  return persistedContentFingerprint(getSessionDocument(session));
}

/**
 * Close All Stage A decision — no disposal yet.
 * Fingerprints detect edits between prepare and commit.
 */
export type CloseAllDecision =
  | {
      sessionId: DocumentSessionId;
      kind: 'close-clean';
      fingerprint: string;
      title: string;
    }
  | {
      sessionId: DocumentSessionId;
      kind: 'close-after-save';
      fingerprint: string;
      title: string;
    }
  | {
      sessionId: DocumentSessionId;
      kind: 'close-discard';
      fingerprint: string;
      title: string;
    };

export type CloseAllRevalidateResult =
  | { ok: true; missing?: boolean }
  | { ok: false; reason: string; sessionId: DocumentSessionId; title?: string };

export function revalidateCloseAllDecision(
  store: DocumentSessionStore,
  decision: CloseAllDecision,
): CloseAllRevalidateResult {
  const session = getSession(store, decision.sessionId);
  if (!session || session.disposed) {
    return { ok: true, missing: true };
  }
  const fp = sessionFingerprint(session);
  const title = getSessionTitle(session);

  if (decision.kind === 'close-clean' || decision.kind === 'close-after-save') {
    if (session.dirty) {
      return {
        ok: false,
        reason: 'dirty-after-resolve',
        sessionId: decision.sessionId,
        title,
      };
    }
    if (fp !== decision.fingerprint) {
      return {
        ok: false,
        reason: 'changed-after-resolve',
        sessionId: decision.sessionId,
        title,
      };
    }
    return { ok: true };
  }

  // Don't Save: fingerprint must still match decision-time content.
  // Newer edits after Don't Save must not be silently discarded.
  if (fp !== decision.fingerprint) {
    return {
      ok: false,
      reason: 'edited-after-dont-save',
      sessionId: decision.sessionId,
      title,
    };
  }
  return { ok: true };
}

export function revalidateAllCloseAllDecisions(
  store: DocumentSessionStore,
  decisions: readonly CloseAllDecision[],
): CloseAllRevalidateResult {
  for (const decision of decisions) {
    const result = revalidateCloseAllDecision(store, decision);
    if (!result.ok) return result;
  }
  return { ok: true };
}

export function formatSaveAllProgress(
  index1Based: number,
  total: number,
  title: string,
): string {
  return `Saving drawing ${index1Based} of ${total}… ${title}`;
}

export function formatSaveAllCompleted(savedCount: number): string {
  if (savedCount === 0) return 'Save All completed — nothing to save';
  return `Save All completed — ${savedCount} drawing${savedCount === 1 ? '' : 's'} saved`;
}

export function formatSaveAllStopped(title: string): string {
  return `Save All stopped: ${title} was not saved`;
}

export function formatCloseAllProgress(
  index1Based: number,
  total: number,
): string {
  return `Drawing ${index1Based} of ${total}`;
}

export const CLOSE_ALL_SAVE_DIALOG_TITLE = 'Save changes before closing?';

export function closeAllSaveDialogMessage(drawingName: string): string {
  const name = drawingName.trim() || 'Untitled Drawing';
  return `Do you want to save changes to "${name}"?`;
}

/** Sessions still present for Stage B commit (skip already-removed). */
export function collectCloseableSessionIds(
  store: DocumentSessionStore,
  decisions: readonly CloseAllDecision[],
): DocumentSessionId[] {
  const ids: DocumentSessionId[] = [];
  for (const d of decisions) {
    const s = getSession(store, d.sessionId);
    if (s && !s.disposed) ids.push(d.sessionId);
  }
  return ids;
}
