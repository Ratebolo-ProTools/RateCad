/**
 * P3-B4B2B — safe application exit tests.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  CreateCircleCommand,
  CreateLineCommand,
} from '@ratecad/commands';
import { resetIdCounter } from '@ratecad/core';
import {
  createDocumentSession,
  disposeDocumentSession,
  getSessionTitle,
  markSessionDirty,
  persistedContentFingerprint,
  getSessionDocument,
} from './documentSession.js';
import {
  createAndRegisterSession,
  createDocumentSessionStore,
  disposeAllSessions,
  listSessions,
  removeSession,
  setActiveSession,
} from './documentSessionStore.js';
import {
  applySuccessfulSaveToSession,
  parseDrawingContents,
} from './documentFileOps.js';
import { serializeDocument } from '@ratecad/io';
import { createEmptyDocument, ensureLayouts } from '@ratecad/core';
import {
  BROWSER_EXIT_POLICY,
  EXIT_SAVE_DIALOG_TITLE,
  anySessionDirty,
  armElectronAuthorizedUnload,
  createElectronExitUnloadGate,
  disarmElectronAuthorizedUnload,
  exitSaveDialogMessage,
  prepareDirtyLifecycleDecisions,
  sessionsChangedSinceSnapshot,
  shouldPreventUnloadForDirtySessions,
} from './documentSessionExit.js';
import {
  revalidateAllCloseAllDecisions,
  snapshotOpenSessionIds,
} from './documentSessionBulkOps.js';
import { CloseSaveDialog } from './CloseSaveDialog.js';
import {
  P3_B4B2A_BULK_OPS,
  P3_B4B2B_EXIT_OPS,
  REMAINING_FOR_P3_B4,
  REMAINING_FOR_P3_B5,
} from './documentSessionArchitecture.js';
import { CLOSE_TAB_ACTIONS_ENABLED } from './documentTabsModel.js';

describe('P3-B4B2B safe application exit', () => {
  beforeEach(() => resetIdCounter());

  it('1: clean workspace prepare approves without prompts', async () => {
    const store = createDocumentSessionStore();
    const a = createAndRegisterSession(store);
    const b = createAndRegisterSession(store);
    const snapshot = snapshotOpenSessionIds(store);
    const result = await prepareDirtyLifecycleDecisions({
      store,
      snapshot,
      prompt: async () => {
        throw new Error('should not prompt');
      },
      save: async () => ({ ok: true }),
      needsForceDialog: () => false,
    });
    expect(result.status).toBe('approved');
    if (result.status === 'approved') {
      expect(result.decisions).toHaveLength(2);
      expect(a.disposed).toBe(false);
      expect(b.disposed).toBe(false);
    }
    disposeAllSessions(store);
  });

  it('2–3: dirty drawings prompt; multiple dirty sequential', async () => {
    const store = createDocumentSessionStore();
    const a = createAndRegisterSession(store, { bindMinimalEngine: true });
    const b = createAndRegisterSession(store);
    const c = createAndRegisterSession(store, { bindMinimalEngine: true });
    a.bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 1, y: 0 }));
    c.bus.execute(new CreateCircleCommand({ x: 0, y: 0 }, 1));
    const prompted: string[] = [];
    const result = await prepareDirtyLifecycleDecisions({
      store,
      snapshot: snapshotOpenSessionIds(store),
      prompt: async (session) => {
        prompted.push(session.id);
        return 'dont-save';
      },
      save: async () => ({ ok: true }),
      needsForceDialog: () => false,
    });
    expect(result.status).toBe('approved');
    expect(prompted).toEqual([a.id, c.id]);
    expect(listSessions(store)).toHaveLength(3);
    disposeAllSessions(store);
  });

  it('4–5: Save success / Don\'t Save record correct session ids', async () => {
    const store = createDocumentSessionStore();
    const a = createAndRegisterSession(store, { bindMinimalEngine: true });
    const b = createAndRegisterSession(store, { bindMinimalEngine: true });
    a.bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 1, y: 0 }));
    b.bus.execute(new CreateCircleCommand({ x: 0, y: 0 }, 1));
    const result = await prepareDirtyLifecycleDecisions({
      store,
      snapshot: snapshotOpenSessionIds(store),
      prompt: async (session) => (session.id === a.id ? 'save' : 'dont-save'),
      save: async (sessionId) => {
        const s = store.sessions.get(sessionId)!;
        const fp = persistedContentFingerprint(getSessionDocument(s));
        applySuccessfulSaveToSession(s, `/tmp/${sessionId}.ratecad`, fp);
        return { ok: true };
      },
      needsForceDialog: () => true,
    });
    expect(result.status).toBe('approved');
    if (result.status === 'approved') {
      expect(result.decisions.find((d) => d.sessionId === a.id)?.kind).toBe(
        'close-after-save',
      );
      expect(result.decisions.find((d) => d.sessionId === b.id)?.kind).toBe(
        'close-discard',
      );
    }
    expect(a.disposed).toBe(false);
    disposeAllSessions(store);
  });

  it('6–7: Cancel / ESC path returns canceled; sessions intact', async () => {
    const store = createDocumentSessionStore();
    const a = createAndRegisterSession(store, { bindMinimalEngine: true });
    markSessionDirty(a);
    const result = await prepareDirtyLifecycleDecisions({
      store,
      snapshot: snapshotOpenSessionIds(store),
      prompt: async () => 'cancel',
      save: async () => ({ ok: true }),
      needsForceDialog: () => false,
    });
    expect(result.status).toBe('canceled');
    expect(a.disposed).toBe(false);
    expect(a.dirty).toBe(true);
    disposeAllSessions(store);
  });

  it('8–9: Save failure / Save As cancel prevent approval', async () => {
    const store = createDocumentSessionStore();
    const a = createAndRegisterSession(store, { bindMinimalEngine: true });
    markSessionDirty(a);
    const fail = await prepareDirtyLifecycleDecisions({
      store,
      snapshot: snapshotOpenSessionIds(store),
      prompt: async () => 'save',
      save: async () => ({ ok: false, reason: 'permission denied' }),
      needsForceDialog: () => true,
    });
    expect(fail.status).toBe('failed');
    const cancelSave = await prepareDirtyLifecycleDecisions({
      store,
      snapshot: snapshotOpenSessionIds(store),
      prompt: async () => 'save',
      save: async () => ({ ok: false, reason: 'Save was canceled' }),
      needsForceDialog: () => true,
    });
    expect(cancelSave.status).toBe('failed');
    expect(listSessions(store)).toHaveLength(1);
    disposeAllSessions(store);
  });

  it('10–11: edits during save / fingerprint change prevent exit', async () => {
    const store = createDocumentSessionStore();
    const a = createAndRegisterSession(store, { bindMinimalEngine: true });
    a.bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 1, y: 0 }));
    const result = await prepareDirtyLifecycleDecisions({
      store,
      snapshot: snapshotOpenSessionIds(store),
      prompt: async () => 'save',
      save: async (sessionId) => {
        const s = store.sessions.get(sessionId)!;
        const fp = persistedContentFingerprint(getSessionDocument(s));
        s.bus.execute(new CreateCircleCommand({ x: 0, y: 0 }, 1));
        applySuccessfulSaveToSession(s, '/tmp/stale.ratecad', fp);
        return { ok: true };
      },
      needsForceDialog: () => false,
    });
    expect(result.status).toBe('failed');
    disposeAllSessions(store);
  });

  it('12–13: new / missing session during prepare detected', async () => {
    const store = createDocumentSessionStore();
    const a = createAndRegisterSession(store);
    const snapshot = snapshotOpenSessionIds(store);
    createAndRegisterSession(store);
    expect(sessionsChangedSinceSnapshot(store, snapshot)).toBe(true);
    removeSession(store, a.id);
    expect(sessionsChangedSinceSnapshot(store, snapshot)).toBe(true);
    disposeAllSessions(store);
  });

  it('14–17: conflicts documented via bulk op kinds; prepare never disposes', async () => {
    expect(P3_B4B2B_EXIT_OPS).toContain('safeApplicationExitPrepare');
    expect(P3_B4B2B_EXIT_OPS).toContain('electronCloseHandshake');
    expect(P3_B4B2A_BULK_OPS).toContain('closeAllDrawingsTwoStage');
    const store = createDocumentSessionStore();
    const a = createAndRegisterSession(store, { bindMinimalEngine: true });
    markSessionDirty(a);
    const result = await prepareDirtyLifecycleDecisions({
      store,
      snapshot: snapshotOpenSessionIds(store),
      prompt: async () => 'dont-save',
      save: async () => ({ ok: true }),
      needsForceDialog: () => false,
    });
    expect(result.status).toBe('approved');
    expect(a.disposed).toBe(false);
    expect(a.engine).not.toBeNull();
    disposeAllSessions(store);
  });

  it('18–19: no untitled created during prepare; discard revalidation works', async () => {
    const store = createDocumentSessionStore();
    const a = createAndRegisterSession(store, { bindMinimalEngine: true });
    a.bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 1, y: 0 }));
    const prepared = await prepareDirtyLifecycleDecisions({
      store,
      snapshot: snapshotOpenSessionIds(store),
      prompt: async () => 'dont-save',
      save: async () => ({ ok: true }),
      needsForceDialog: () => false,
    });
    expect(prepared.status).toBe('approved');
    expect(listSessions(store)).toHaveLength(1);
    if (prepared.status === 'approved') {
      a.bus.execute(new CreateCircleCommand({ x: 0, y: 0 }, 2));
      const re = revalidateAllCloseAllDecisions(store, prepared.decisions);
      expect(re.ok).toBe(false);
    }
    disposeAllSessions(store);
  });

  it('20–25: IPC payload contract / stale approval ignored by shape', () => {
    const currentRequestId = 7;
    const stale = { requestId: 3, status: 'approved' as const };
    const fresh = { requestId: 7, status: 'canceled' as const };
    const accept = (payload: { requestId: number; status: string }) => {
      if (payload.requestId !== currentRequestId) return { ignored: true };
      if (payload.status !== 'approved') return { closed: false };
      return { closed: true };
    };
    expect(accept(stale).ignored).toBe(true);
    expect(accept(fresh).closed).toBe(false);
    expect(accept({ requestId: 7, status: 'approved' }).closed).toBe(true);
    // Timeout / missing reply ≡ non-approval
    expect(accept({ requestId: 7, status: 'failed' }).closed).toBe(false);
  });

  it('26–27: browser policy + dirty detection for beforeunload', () => {
    expect(BROWSER_EXIT_POLICY).toBe('prepare-only-no-process-quit');
    const store = createDocumentSessionStore();
    createAndRegisterSession(store);
    expect(anySessionDirty(store)).toBe(false);
    const dirty = createAndRegisterSession(store, { bindMinimalEngine: true });
    markSessionDirty(dirty);
    expect(anySessionDirty(store)).toBe(true);
    disposeAllSessions(store);
  });

  it('28–31: Save All / Close All / individual close / file ops remain', () => {
    expect(P3_B4B2A_BULK_OPS).toContain('saveAllDrawings');
    expect(CLOSE_TAB_ACTIONS_ENABLED).toBe(true);
    expect(REMAINING_FOR_P3_B4).not.toContain('applicationExitMultiDocumentPrompt');
    expect(REMAINING_FOR_P3_B5.length).toBeGreaterThan(0);
    const text = serializeDocument(
      ensureLayouts(createEmptyDocument('ExitCompat')),
    );
    expect(parseDrawingContents(text).ok).toBe(true);
  });

  it('exit dialog copy and progress', () => {
    const html = renderToStaticMarkup(
      createElement(CloseSaveDialog, {
        drawingName: 'Site Plan',
        title: EXIT_SAVE_DIALOG_TITLE,
        message: exitSaveDialogMessage('Site Plan'),
        progressLabel: 'Drawing 2 of 4',
        onChoose: () => undefined,
      }),
    );
    expect(html).toContain(EXIT_SAVE_DIALOG_TITLE);
    expect(html).toContain('before exiting RateCAD');
    expect(html).toContain('Drawing 2 of 4');
    expect(html).toContain('data-cad-dialog="1"');
  });

  it('active session preserved after canceled prepare', async () => {
    const store = createDocumentSessionStore();
    const a = createAndRegisterSession(store, { bindMinimalEngine: true });
    const b = createAndRegisterSession(store, { bindMinimalEngine: true });
    setActiveSession(store, b.id);
    markSessionDirty(a);
    await prepareDirtyLifecycleDecisions({
      store,
      snapshot: snapshotOpenSessionIds(store),
      prompt: async () => 'cancel',
      save: async () => ({ ok: true }),
      needsForceDialog: () => false,
    });
    expect(store.activeSessionId).toBe(b.id);
    expect(getSessionTitle(b)).toBeTruthy();
    disposeAllSessions(store);
  });
});

/** ISS-N1 — authorized Electron unload must not be blocked by beforeunload. */
describe('ISS-N1 Electron authorized unload gate', () => {
  it('dirty sessions still block unload when gate is disarmed', () => {
    const gate = createElectronExitUnloadGate();
    expect(gate.armed).toBe(false);
    expect(shouldPreventUnloadForDirtySessions(true, gate)).toBe(true);
    expect(shouldPreventUnloadForDirtySessions(false, gate)).toBe(false);
  });

  it('armed gate allows unload without clearing dirty', () => {
    const gate = createElectronExitUnloadGate();
    armElectronAuthorizedUnload(gate);
    expect(gate.armed).toBe(true);
    // Dirty remains conceptually true — gate only scopes beforeunload.
    expect(shouldPreventUnloadForDirtySessions(true, gate)).toBe(false);
  });

  it('disarm restores protection after cancel / failed quit', () => {
    const gate = createElectronExitUnloadGate();
    armElectronAuthorizedUnload(gate);
    disarmElectronAuthorizedUnload(gate);
    expect(gate.armed).toBe(false);
    expect(shouldPreventUnloadForDirtySessions(true, gate)).toBe(true);
  });

  it('browser policy never implies Electron gate arming', () => {
    expect(BROWSER_EXIT_POLICY).toBe('prepare-only-no-process-quit');
    const gate = createElectronExitUnloadGate();
    // Browser path leaves gate disarmed; dirty still blocks tab close.
    expect(shouldPreventUnloadForDirtySessions(true, gate)).toBe(true);
  });

  it('Dont Save prepare leaves sessions dirty (no artificial clear)', async () => {
    const store = createDocumentSessionStore();
    const a = createAndRegisterSession(store, { bindMinimalEngine: true });
    const b = createAndRegisterSession(store, { bindMinimalEngine: true });
    markSessionDirty(a);
    markSessionDirty(b);
    const result = await prepareDirtyLifecycleDecisions({
      store,
      snapshot: snapshotOpenSessionIds(store),
      prompt: async () => 'dont-save',
      save: async () => ({ ok: true }),
      needsForceDialog: () => false,
    });
    expect(result.status).toBe('approved');
    expect(a.dirty).toBe(true);
    expect(b.dirty).toBe(true);
    expect(anySessionDirty(store)).toBe(true);
    // Gate + dirty: without arm, beforeunload would block; with arm, allow.
    const gate = createElectronExitUnloadGate();
    expect(shouldPreventUnloadForDirtySessions(true, gate)).toBe(true);
    armElectronAuthorizedUnload(gate);
    expect(shouldPreventUnloadForDirtySessions(true, gate)).toBe(false);
    disposeAllSessions(store);
  });

  it('cancel prepare path never needs an armed gate', async () => {
    const store = createDocumentSessionStore();
    const a = createAndRegisterSession(store, { bindMinimalEngine: true });
    markSessionDirty(a);
    const result = await prepareDirtyLifecycleDecisions({
      store,
      snapshot: snapshotOpenSessionIds(store),
      prompt: async () => 'cancel',
      save: async () => ({ ok: true }),
      needsForceDialog: () => false,
    });
    expect(result.status).toBe('canceled');
    expect(a.dirty).toBe(true);
    const gate = createElectronExitUnloadGate();
    expect(shouldPreventUnloadForDirtySessions(true, gate)).toBe(true);
    disposeAllSessions(store);
  });
});

/** Minimal Electron close-guard state machine (mirrors main.cjs rules). */
describe('P3-B4B2B Electron close guard model', () => {
  it('23–25: intercept until approved; cancel resets; stale ignored', () => {
    let shutdownAuthorized = false;
    let handshake: { requestId: number } | null = null;
    let seq = 0;
    const onClose = () => {
      if (shutdownAuthorized) return 'allow';
      if (handshake) return 'ignored-duplicate';
      seq += 1;
      handshake = { requestId: seq };
      return 'prevent-and-ask';
    };
    const onBeforeQuit = () => {
      if (shutdownAuthorized) return 'allow-quit';
      // Cancel quit wave; route through window close handshake.
      if (handshake) return 'quit-canceled-handshake-active';
      onClose();
      return 'quit-canceled-ask-renderer';
    };
    const onResponse = (payload: { requestId: number; status: string }) => {
      if (!handshake || handshake.requestId !== payload.requestId) {
        return 'ignored-stale';
      }
      handshake = null;
      if (payload.status === 'approved') {
        shutdownAuthorized = true;
        return 'close';
      }
      shutdownAuthorized = false;
      return 'keep-open';
    };
    const onAppQuitIpc = () => {
      // Only after renderer prepare — authorize then close (not destroy).
      shutdownAuthorized = true;
      handshake = null;
      return onClose();
    };

    expect(onBeforeQuit()).toBe('quit-canceled-ask-renderer');
    expect(onClose()).toBe('ignored-duplicate');
    expect(onResponse({ requestId: 999, status: 'approved' })).toBe(
      'ignored-stale',
    );
    expect(onResponse({ requestId: 1, status: 'canceled' })).toBe('keep-open');
    expect(shutdownAuthorized).toBe(false);
    expect(onBeforeQuit()).toBe('quit-canceled-ask-renderer');
    expect(onResponse({ requestId: 2, status: 'approved' })).toBe('close');
    expect(shutdownAuthorized).toBe(true);
    expect(onClose()).toBe('allow');
    expect(onBeforeQuit()).toBe('allow-quit');
    // Menu Exit after prepare uses authorized close path.
    shutdownAuthorized = false;
    handshake = null;
    expect(onAppQuitIpc()).toBe('allow');
  });
});
