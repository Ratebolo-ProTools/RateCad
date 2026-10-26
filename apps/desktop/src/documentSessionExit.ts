/**
 * P3-B4B2B — safe application-exit helpers.
 *
 * Reuses Close All Stage A decision/fingerprint types without performing
 * Close All Stage B (dispose + untitled replacement). Exit authorization
 * never creates a replacement drawing and never disposes during prepare.
 */

import {
  getSessionTitle,
  shouldPromptDiscard,
  type DocumentSession,
  type DocumentSessionId,
} from './documentSession.js';
import {
  getSession,
  type DocumentSessionStore,
} from './documentSessionStore.js';
import {
  sessionFingerprint,
  snapshotOpenSessionIds,
  type CloseAllDecision,
} from './documentSessionBulkOps.js';

export type ExitStatus = 'approved' | 'canceled' | 'failed';

export type ExitPrepareResult =
  | { status: 'approved'; decisions: CloseAllDecision[]; snapshot: DocumentSessionId[] }
  | { status: 'canceled'; reason: string }
  | { status: 'failed'; reason: string };

export const EXIT_SAVE_DIALOG_TITLE = 'Save changes before exiting?';

export function exitSaveDialogMessage(drawingName: string): string {
  const name = drawingName.trim() || 'Untitled Drawing';
  return `Do you want to save changes to "${name}" before exiting RateCAD?`;
}

/**
 * Browser preview cannot terminate the RateCAD process.
 * Menu Exit runs prepare (Save/Don't Save/Cancel) then leaves the
 * workspace open with a status message — no fake process quit.
 */
export const BROWSER_EXIT_POLICY = 'prepare-only-no-process-quit' as const;

export const ELECTRON_EXIT_CHANNELS = {
  prepareExitEvent: 'app:prepare-exit',
  exitResponseInvoke: 'app:exit-response',
  quitInvoke: 'app:quit',
} as const;

export type ExitIpcRequest = { requestId: number };
export type ExitIpcResponse = {
  requestId: number;
  status: ExitStatus;
  reason?: string;
};

export function shouldPromptSaveBeforeExit(
  session: DocumentSession,
): boolean {
  return shouldPromptDiscard(session);
}

/** True when open session set differs from the exit snapshot. */
export function sessionsChangedSinceSnapshot(
  store: DocumentSessionStore,
  snapshot: readonly DocumentSessionId[],
): boolean {
  const now = snapshotOpenSessionIds(store);
  if (now.length !== snapshot.length) return true;
  for (let i = 0; i < snapshot.length; i += 1) {
    if (now[i] !== snapshot[i]) return true;
  }
  // Also fail if any snapshot id is missing/disposed.
  for (const id of snapshot) {
    const session = getSession(store, id);
    if (!session || session.disposed) return true;
  }
  return false;
}

export type LifecycleSaveOutcome =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Shared Stage A prepare used by Close All and Exit.
 * Never disposes sessions. Never creates replacement drawings.
 */
export async function prepareDirtyLifecycleDecisions(options: {
  store: DocumentSessionStore;
  snapshot: readonly DocumentSessionId[];
  prompt: (
    session: DocumentSession,
    index1Based: number,
    total: number,
  ) => Promise<'save' | 'dont-save' | 'cancel'>;
  save: (
    sessionId: DocumentSessionId,
    forceDialog: boolean,
  ) => Promise<LifecycleSaveOutcome>;
  needsForceDialog: (session: DocumentSession) => boolean;
}): Promise<ExitPrepareResult> {
  const { store, snapshot } = options;
  const decisions: CloseAllDecision[] = [];

  for (let i = 0; i < snapshot.length; i += 1) {
    const sessionId = snapshot[i]!;
    const session = getSession(store, sessionId);
    if (!session || session.disposed) {
      return {
        status: 'failed',
        reason: 'A drawing was closed during exit preparation',
      };
    }

    if (!shouldPromptSaveBeforeExit(session)) {
      decisions.push({
        sessionId,
        kind: 'close-clean',
        fingerprint: sessionFingerprint(session),
        title: getSessionTitle(session),
      });
      continue;
    }

    const title = getSessionTitle(session);
    const choice = await options.prompt(session, i + 1, snapshot.length);
    if (choice === 'cancel') {
      return { status: 'canceled', reason: 'User canceled' };
    }

    if (choice === 'save') {
      const outcome = await options.save(
        sessionId,
        options.needsForceDialog(session),
      );
      if (!outcome.ok) {
        return {
          status: 'failed',
          reason: outcome.reason || `${title} was not saved`,
        };
      }
      const after = getSession(store, sessionId);
      if (!after || after.disposed || after.dirty) {
        return {
          status: 'failed',
          reason: `Latest changes to ${title} are not saved`,
        };
      }
      decisions.push({
        sessionId,
        kind: 'close-after-save',
        fingerprint: sessionFingerprint(after),
        title: getSessionTitle(after),
      });
      continue;
    }

    // Don't Save — record only; caller must not dispose during exit prepare.
    const live = getSession(store, sessionId);
    if (!live || live.disposed) {
      return {
        status: 'failed',
        reason: 'A drawing was closed during exit preparation',
      };
    }
    decisions.push({
      sessionId,
      kind: 'close-discard',
      fingerprint: sessionFingerprint(live),
      title: getSessionTitle(live),
    });
  }

  return { status: 'approved', decisions, snapshot: [...snapshot] };
}

export function anySessionDirty(store: DocumentSessionStore): boolean {
  return snapshotOpenSessionIds(store).some((id) => {
    const s = getSession(store, id);
    return !!s && !s.disposed && s.dirty;
  });
}
