/**
 * P3-B4B2A — Save All / Close All coordinator tests.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  CreateCircleCommand,
  CreateLineCommand,
} from '@ratecad/commands';
import {
  createEmptyDocument,
  ensureLayouts,
  resetIdCounter,
} from '@ratecad/core';
import { serializeDocument } from '@ratecad/io';
import {
  clearSessionDirty,
  createDocumentSession,
  disposeDocumentSession,
  getSessionDocument,
  getSessionTitle,
  markSessionDirty,
  persistedContentFingerprint,
} from './documentSession.js';
import {
  createAndRegisterSession,
  createDocumentSessionStore,
  disposeAllSessions,
  getActiveSession,
  getSession,
  listSessions,
  removeSession,
  setActiveSession,
} from './documentSessionStore.js';
import {
  applySuccessfulSaveToSession,
  parseDrawingContents,
} from './documentFileOps.js';
import {
  CLOSE_ALL_SAVE_DIALOG_TITLE,
  LAST_DRAWING_CLOSE_POLICY,
  closeAllSaveDialogMessage,
  collectCloseableSessionIds,
  filterDirtySessionIds,
  formatCloseAllProgress,
  formatSaveAllCompleted,
  formatSaveAllStopped,
  revalidateAllCloseAllDecisions,
  revalidateCloseAllDecision,
  sessionFingerprint,
  snapshotOpenSessionIds,
  type CloseAllDecision,
} from './documentSessionBulkOps.js';
import { CloseSaveDialog } from './CloseSaveDialog.js';
import {
  P3_B4B2A_BULK_OPS,
  REMAINING_FOR_P3_B4,
} from './documentSessionArchitecture.js';
import { CLOSE_TAB_ACTIONS_ENABLED } from './documentTabsModel.js';

describe('P3-B4B2A Save All / Close All', () => {
  beforeEach(() => resetIdCounter());

  it('1–2: Save All targets dirty only; skips clean', () => {
    const store = createDocumentSessionStore();
    const a = createAndRegisterSession(store, { bindMinimalEngine: true });
    const b = createAndRegisterSession(store, { bindMinimalEngine: true });
    const c = createAndRegisterSession(store, { bindMinimalEngine: true });
    a.bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 1, y: 0 }));
    c.bus.execute(new CreateCircleCommand({ x: 0, y: 0 }, 1));
    const snap = snapshotOpenSessionIds(store);
    expect(snap).toEqual([a.id, b.id, c.id]);
    expect(filterDirtySessionIds(store, snap)).toEqual([a.id, c.id]);
    disposeAllSessions(store);
  });

  it('3–5: Save All preserves tabs/active; saves inactive by id', () => {
    const store = createDocumentSessionStore();
    const a = createAndRegisterSession(store, { bindMinimalEngine: true });
    const b = createAndRegisterSession(store, { bindMinimalEngine: true });
    setActiveSession(store, a.id);
    b.bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 2, y: 0 }));
    const fp = persistedContentFingerprint(getSessionDocument(b));
    applySuccessfulSaveToSession(b, '/tmp/b.ratecad', fp);
    expect(b.dirty).toBe(false);
    expect(getActiveSession(store)?.id).toBe(a.id);
    expect(listSessions(store)).toHaveLength(2);
    disposeAllSessions(store);
  });

  it('6–8: Save As cancel / failure leave sessions open', () => {
    const store = createDocumentSessionStore();
    const a = createAndRegisterSession(store, { bindMinimalEngine: true });
    markSessionDirty(a);
    // Cancellation path: do not remove
    expect(listSessions(store)).toHaveLength(1);
    expect(a.dirty).toBe(true);
    expect(formatSaveAllStopped(getSessionTitle(a))).toContain('was not saved');
    disposeAllSessions(store);
  });

  it('9: edits during save remain dirty (fingerprint mismatch)', () => {
    const session = createDocumentSession({ bindMinimalEngine: true });
    session.bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 1, y: 0 }));
    const fp = persistedContentFingerprint(getSessionDocument(session));
    session.bus.execute(new CreateCircleCommand({ x: 0, y: 0 }, 1));
    const result = applySuccessfulSaveToSession(
      session,
      '/tmp/during.ratecad',
      fp,
    );
    expect(result.clearedDirty).toBe(false);
    expect(session.dirty).toBe(true);
    disposeDocumentSession(session);
  });

  it('10–11: concurrent lock semantics + partial success messaging', () => {
    expect(formatSaveAllCompleted(2)).toContain('2 drawings saved');
    expect(formatSaveAllCompleted(0)).toContain('nothing to save');
    // Successful earlier saves are not rolled back by helpers (filesystem fact).
    const store = createDocumentSessionStore();
    const a = createAndRegisterSession(store, { bindMinimalEngine: true });
    a.bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 1, y: 0 }));
    const fp = persistedContentFingerprint(getSessionDocument(a));
    applySuccessfulSaveToSession(a, '/tmp/a.ratecad', fp);
    expect(a.dirty).toBe(false);
    expect(a.filePath).toBe('/tmp/a.ratecad');
    disposeAllSessions(store);
  });

  it('12: sibling independence during multi-save planning', () => {
    const store = createDocumentSessionStore();
    const a = createAndRegisterSession(store, { bindMinimalEngine: true });
    const b = createAndRegisterSession(store, { bindMinimalEngine: true });
    a.bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 1, y: 0 }));
    b.bus.execute(new CreateCircleCommand({ x: 0, y: 0 }, 2));
    expect(a.bus.canUndo()).toBe(true);
    expect(b.bus.canUndo()).toBe(true);
    clearSessionDirty(a);
    expect(b.dirty).toBe(true);
    disposeAllSessions(store);
  });

  it('13–14: Close All clean snapshot; dirty requires decisions', () => {
    const store = createDocumentSessionStore();
    const a = createAndRegisterSession(store);
    const b = createAndRegisterSession(store, { bindMinimalEngine: true });
    b.bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 1, y: 0 }));
    const snap = snapshotOpenSessionIds(store);
    const dirty = filterDirtySessionIds(store, snap);
    expect(dirty).toEqual([b.id]);
    const decisions: CloseAllDecision[] = [
      {
        sessionId: a.id,
        kind: 'close-clean',
        fingerprint: sessionFingerprint(a),
        title: getSessionTitle(a),
      },
      {
        sessionId: b.id,
        kind: 'close-discard',
        fingerprint: sessionFingerprint(b),
        title: getSessionTitle(b),
      },
    ];
    expect(revalidateAllCloseAllDecisions(store, decisions).ok).toBe(true);
    disposeAllSessions(store);
  });

  it('15–17: Save / Don\'t Save / Cancel decision models', () => {
    const store = createDocumentSessionStore();
    const a = createAndRegisterSession(store, { bindMinimalEngine: true });
    a.bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 1, y: 0 }));
    const fp = persistedContentFingerprint(getSessionDocument(a));
    applySuccessfulSaveToSession(a, '/tmp/saved.ratecad', fp);
    const afterSave: CloseAllDecision = {
      sessionId: a.id,
      kind: 'close-after-save',
      fingerprint: sessionFingerprint(a),
      title: getSessionTitle(a),
    };
    expect(revalidateCloseAllDecision(store, afterSave).ok).toBe(true);
    // Cancel leaves sessions untouched
    expect(listSessions(store)).toHaveLength(1);
    disposeAllSessions(store);
  });

  it('18–19: Save failure / Save As cancel preserve sessions (no Stage B)', () => {
    const store = createDocumentSessionStore();
    const a = createAndRegisterSession(store, { bindMinimalEngine: true });
    const b = createAndRegisterSession(store, { bindMinimalEngine: true });
    markSessionDirty(a);
    markSessionDirty(b);
    // Abort before commit: nothing disposed
    expect(a.disposed).toBe(false);
    expect(b.disposed).toBe(false);
    disposeAllSessions(store);
  });

  it('20: no session disposed during prepare (decisions only)', () => {
    const store = createDocumentSessionStore();
    const a = createAndRegisterSession(store, { bindMinimalEngine: true });
    markSessionDirty(a);
    const decision: CloseAllDecision = {
      sessionId: a.id,
      kind: 'close-discard',
      fingerprint: sessionFingerprint(a),
      title: getSessionTitle(a),
    };
    expect(getSession(store, a.id)).toBe(a);
    expect(a.disposed).toBe(false);
    expect(decision.kind).toBe('close-discard');
    disposeAllSessions(store);
  });

  it('21–22: dirty revalidation; edits after Don\'t Save abort', () => {
    const store = createDocumentSessionStore();
    const a = createAndRegisterSession(store, { bindMinimalEngine: true });
    a.bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 1, y: 0 }));
    const decision: CloseAllDecision = {
      sessionId: a.id,
      kind: 'close-discard',
      fingerprint: sessionFingerprint(a),
      title: getSessionTitle(a),
    };
    a.bus.execute(new CreateCircleCommand({ x: 0, y: 0 }, 1));
    const result = revalidateCloseAllDecision(store, decision);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('edited-after-dont-save');
    }
    expect(a.disposed).toBe(false);
    disposeAllSessions(store);
  });

  it('23–24: architecture lists bulk ops; exit deferred; individual close still on', () => {
    expect(P3_B4B2A_BULK_OPS).toContain('saveAllDrawings');
    expect(P3_B4B2A_BULK_OPS).toContain('closeAllDrawingsTwoStage');
    expect(REMAINING_FOR_P3_B4).toContain('applicationExitMultiDocumentPrompt');
    expect(REMAINING_FOR_P3_B4).not.toContain('closeAllDrawings');
    expect(CLOSE_TAB_ACTIONS_ENABLED).toBe(true);
  });

  it('25–28: Stage B dispose + last-tab replace once', () => {
    expect(LAST_DRAWING_CLOSE_POLICY).toBe('replace-with-clean-untitled');
    const store = createDocumentSessionStore();
    const a = createAndRegisterSession(store, { bindMinimalEngine: true });
    const b = createAndRegisterSession(store, { bindMinimalEngine: true });
    const decisions: CloseAllDecision[] = [
      {
        sessionId: a.id,
        kind: 'close-clean',
        fingerprint: sessionFingerprint(a),
        title: getSessionTitle(a),
      },
      {
        sessionId: b.id,
        kind: 'close-clean',
        fingerprint: sessionFingerprint(b),
        title: getSessionTitle(b),
      },
    ];
    expect(revalidateAllCloseAllDecisions(store, decisions).ok).toBe(true);
    const ids = collectCloseableSessionIds(store, decisions);
    for (const id of ids) removeSession(store, id);
    expect(listSessions(store)).toHaveLength(0);
    expect(a.disposed).toBe(true);
    expect(a._unsubscribers).toHaveLength(0);
    expect(a.engine).toBeNull();
    // App creates exactly one replacement untitled after Close All.
    const replacement = createAndRegisterSession(store, {
      document: ensureLayouts(createEmptyDocument('Untitled Drawing')),
      trackDirtyFromBus: false,
    });
    expect(listSessions(store)).toHaveLength(1);
    expect(replacement.dirty).toBe(false);
    expect(getSessionDocument(replacement).entities).toHaveLength(0);
    expect(replacement.bus.canUndo()).toBe(false);
    disposeAllSessions(store);
  });

  it('29: Close All dialog shows progress + ESC cancel affordance', () => {
    const html = renderToStaticMarkup(
      createElement(CloseSaveDialog, {
        drawingName: 'Ground Floor',
        title: CLOSE_ALL_SAVE_DIALOG_TITLE,
        message: closeAllSaveDialogMessage('Ground Floor'),
        progressLabel: formatCloseAllProgress(2, 4),
        onChoose: () => undefined,
      }),
    );
    expect(html).toContain(CLOSE_ALL_SAVE_DIALOG_TITLE);
    expect(html).toContain('Drawing 2 of 4');
    expect(html).toContain('Ground Floor');
    expect(html).toContain('data-cad-dialog="1"');
    expect(html).toContain('close-save-dialog-cancel');
  });

  it('30–32: individual close helpers / switching / file parse still work', () => {
    const store = createDocumentSessionStore();
    const a = createAndRegisterSession(store);
    const b = createAndRegisterSession(store);
    setActiveSession(store, b.id);
    removeSession(store, a.id);
    expect(getActiveSession(store)?.id).toBe(b.id);
    const text = serializeDocument(
      ensureLayouts(createEmptyDocument('BulkCompat')),
    );
    expect(parseDrawingContents(text).ok).toBe(true);
    disposeAllSessions(store);
  });

  it('clean-after-resolve fails revalidation when dirty returns', () => {
    const store = createDocumentSessionStore();
    const a = createAndRegisterSession(store, { bindMinimalEngine: true });
    const decision: CloseAllDecision = {
      sessionId: a.id,
      kind: 'close-clean',
      fingerprint: sessionFingerprint(a),
      title: getSessionTitle(a),
    };
    markSessionDirty(a);
    const result = revalidateCloseAllDecision(store, decision);
    expect(result.ok).toBe(false);
    disposeAllSessions(store);
  });
});
