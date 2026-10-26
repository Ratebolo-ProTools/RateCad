/**
 * P3-B3A — two-session isolation tests against real CommandBus /
 * SelectionManager / CadCommandEngine / cameras.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import {
  CreateLineCommand,
  SetDrawingUnitsCommand,
} from '@ratecad/commands';
import {
  ensureLayouts,
  resetIdCounter,
  setActiveLayout,
} from '@ratecad/core';
import { createCamera } from '@ratecad/viewport';
import {
  bindSessionEngine,
  clearSessionDirty,
  createDocumentSession,
  createMinimalEngineHost,
  disposeDocumentSession,
  getSessionActiveLayoutId,
  getSessionDocument,
  markSessionDirty,
  recordSaveOutcome,
  setSessionCamera,
  setSessionHoveredId,
  setSessionWorkspaceMode,
  withDirtySuppressed,
} from './documentSession.js';
import {
  createAndRegisterSession,
  createDocumentSessionStore,
  disposeAllSessions,
  listSessions,
  removeSession,
} from './documentSessionStore.js';
import {
  DOCUMENT_SPECIFIC_STATE,
  REMAINING_FOR_P3_B3B_UI_SWITCH,
  REMAINING_FOR_P3_B4,
} from './documentSessionArchitecture.js';
import {
  CLOSE_TAB_ACTIONS_ENABLED,
  MULTI_DOCUMENT_ACTIONS_ENABLED,
} from './documentTabsModel.js';

function createIsolatedPair() {
  const a = createDocumentSession({ bindMinimalEngine: true });
  const b = createDocumentSession({ bindMinimalEngine: true });
  return { a, b };
}

describe('P3-B3A two-session isolation', () => {
  beforeEach(() => resetIdCounter());

  it('TEST A: geometry in Session A does not appear in Session B', () => {
    const { a, b } = createIsolatedPair();
    a.bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 10, y: 0 }));
    expect(getSessionDocument(a).entities).toHaveLength(1);
    expect(getSessionDocument(b).entities).toHaveLength(0);
    expect(getSessionDocument(a)).not.toBe(getSessionDocument(b));
    disposeDocumentSession(a);
    disposeDocumentSession(b);
  });

  it('TEST B: undo in Session A does not affect Session B history', () => {
    const { a, b } = createIsolatedPair();
    a.bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 4, y: 0 }));
    b.bus.execute(new CreateLineCommand({ x: 1, y: 1 }, { x: 2, y: 2 }));
    expect(a.bus.canUndo()).toBe(true);
    expect(b.bus.canUndo()).toBe(true);
    a.bus.undo();
    expect(getSessionDocument(a).entities).toHaveLength(0);
    expect(getSessionDocument(b).entities).toHaveLength(1);
    expect(b.bus.canUndo()).toBe(true);
    disposeDocumentSession(a);
    disposeDocumentSession(b);
  });

  it('TEST C: selection in Session A leaves Session B empty', () => {
    const { a, b } = createIsolatedPair();
    a.bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 3, y: 0 }));
    b.bus.execute(new CreateLineCommand({ x: 5, y: 0 }, { x: 8, y: 0 }));
    const idA = getSessionDocument(a).entities[0]!.id;
    a.selectionManager.select(idA);
    expect(a.selectionManager.selectedIds()).toEqual([idA]);
    expect(b.selectionManager.selectedIds()).toEqual([]);
    expect(getSessionDocument(b).selection).toEqual([]);
    disposeDocumentSession(a);
    disposeDocumentSession(b);
  });

  it('TEST D: camera change in Session A leaves Session B camera unchanged', () => {
    const { a, b } = createIsolatedPair();
    const bCam = { ...b.camera };
    setSessionCamera(a, createCamera({ zoom: 120, centerX: 9, centerY: -2 }));
    expect(a.camera.zoom).toBe(120);
    expect(b.camera).toEqual(bCam);
    a.viewHistory.push({ kind: 'model', camera: a.camera });
    expect(a.viewHistory.size).toBe(1);
    expect(b.viewHistory.size).toBe(0);
    disposeDocumentSession(a);
    disposeDocumentSession(b);
  });

  it('TEST E: active layout change in Session A leaves Session B unchanged', () => {
    const { a, b } = createIsolatedPair();
    const layoutId = ensureLayouts(getSessionDocument(a)).layouts[0]!.id;
    withDirtySuppressed(a, () => {
      a.bus.updateWithoutHistory((d) => setActiveLayout(d, layoutId));
    });
    setSessionWorkspaceMode(a, 'PAPER_SPACE');
    expect(getSessionActiveLayoutId(a)).toBe(layoutId);
    expect(a.workspaceMode).toBe('PAPER_SPACE');
    expect(getSessionActiveLayoutId(b)).toBeNull();
    expect(b.workspaceMode).toBe('MODEL_SPACE');
    disposeDocumentSession(a);
    disposeDocumentSession(b);
  });

  it('TEST F: starting a command in Session A leaves Session B idle', () => {
    const { a, b } = createIsolatedPair();
    expect(a.engine).not.toBeNull();
    expect(b.engine).not.toBeNull();
    const result = a.engine!.start('line');
    expect(result.ok).toBe(true);
    expect(a.engine!.isRunning()).toBe(true);
    expect(b.engine!.isRunning()).toBe(false);
    expect(b.engine!.getLastCompletedName()).toBeNull();
    disposeDocumentSession(a);
    disposeDocumentSession(b);
  });

  it('TEST G: only the owning session becomes dirty', () => {
    const { a, b } = createIsolatedPair();
    a.bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 1, y: 0 }));
    expect(a.dirty).toBe(true);
    expect(b.dirty).toBe(false);
    b.bus.execute(
      new SetDrawingUnitsCommand(b.bus.getDocument(), {
        units: 'm',
        precision: 2,
      }),
    );
    expect(b.dirty).toBe(true);
    expect(a.dirty).toBe(true);
    disposeDocumentSession(a);
    disposeDocumentSession(b);
  });

  it('TEST H: disposing Session A leaves Session B functional', () => {
    const store = createDocumentSessionStore();
    const a = createAndRegisterSession(store, { bindMinimalEngine: true });
    const b = createAndRegisterSession(store, { bindMinimalEngine: true });
    a.bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 2, y: 0 }));
    expect(removeSession(store, a.id)).toBe(true);
    expect(a.disposed).toBe(true);
    expect(b.disposed).toBe(false);
    b.bus.execute(new CreateLineCommand({ x: 3, y: 0 }, { x: 4, y: 0 }));
    expect(getSessionDocument(b).entities).toHaveLength(1);
    expect(b.engine?.isRunning()).toBe(false);
    b.engine?.start('circle');
    expect(b.engine?.isRunning()).toBe(true);
    disposeAllSessions(store);
  });

  it('TEST I: saving Session A does not clear Session B dirty', () => {
    const { a, b } = createIsolatedPair();
    a.bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 1, y: 0 }));
    b.bus.execute(new CreateLineCommand({ x: 2, y: 0 }, { x: 3, y: 0 }));
    expect(a.dirty).toBe(true);
    expect(b.dirty).toBe(true);
    recordSaveOutcome(a, { ok: true, filePath: '/tmp/a.ratecad' });
    expect(a.dirty).toBe(false);
    expect(b.dirty).toBe(true);
    recordSaveOutcome(b, { ok: false });
    expect(b.dirty).toBe(true);
    disposeDocumentSession(a);
    disposeDocumentSession(b);
  });

  it('TEST J: create/dispose repeatedly without leftover dirty listeners', () => {
    for (let i = 0; i < 12; i += 1) {
      const session = createDocumentSession({ bindMinimalEngine: true });
      let calls = 0;
      const unsub = session._dirtyListeners;
      // attachBusDirtyTracking registers one bus unsubscriber
      expect(session._unsubscribers.length).toBeGreaterThan(0);
      markSessionDirty(session);
      clearSessionDirty(session);
      disposeDocumentSession(session);
      expect(session.disposed).toBe(true);
      expect(session._unsubscribers).toHaveLength(0);
      expect(unsub.size).toBe(0);
      expect(session.engine).toBeNull();
      expect(calls).toBe(0);
    }
  });

  it('selection and hover do not mark dirty (P3-B1 correction preserved)', () => {
    const session = createDocumentSession({ bindMinimalEngine: true });
    session.bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 1, y: 0 }));
    clearSessionDirty(session);
    const id = getSessionDocument(session).entities[0]!.id;
    session.selectionManager.select(id);
    setSessionHoveredId(session, id);
    expect(session.dirty).toBe(false);
    expect(session.hoveredId).toBe(id);
    disposeDocumentSession(session);
  });

  it('each session has independent SelectionManager and CommandBus', () => {
    const { a, b } = createIsolatedPair();
    expect(a.bus).not.toBe(b.bus);
    expect(a.selectionManager).not.toBe(b.selectionManager);
    expect(a.engine).not.toBe(b.engine);
    expect(a.id).not.toBe(b.id);
    disposeDocumentSession(a);
    disposeDocumentSession(b);
  });

  it('bindSessionEngine attaches engine to session bus only', () => {
    const session = createDocumentSession();
    expect(session.engine).toBeNull();
    const engine = bindSessionEngine(
      session,
      createMinimalEngineHost(session),
    );
    expect(session.engine).toBe(engine);
    engine.start('line');
    expect(session.engine?.isRunning()).toBe(true);
    disposeDocumentSession(session);
    expect(session.engine).toBeNull();
  });

  it('documents architecture ownership; P3-B4B1 enables individual close', () => {
    expect(DOCUMENT_SPECIFIC_STATE).toContain('CadCommandEngine');
    expect(DOCUMENT_SPECIFIC_STATE).toContain('SelectionManager');
    expect(REMAINING_FOR_P3_B3B_UI_SWITCH).toHaveLength(0);
    expect(REMAINING_FOR_P3_B4).toContain('applicationExitMultiDocumentPrompt');
    expect(MULTI_DOCUMENT_ACTIONS_ENABLED).toBe(true);
    expect(CLOSE_TAB_ACTIONS_ENABLED).toBe(true);
    expect(listSessions(createDocumentSessionStore())).toEqual([]);
  });
});
