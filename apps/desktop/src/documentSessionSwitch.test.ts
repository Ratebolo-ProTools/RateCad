/**
 * P3-B3B — safe multi-document tab switching tests.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import {
  CreateCircleCommand,
  CreateLineCommand,
} from '@ratecad/commands';
import {
  createEmptyDocument,
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
  getSessionDocument,
  getSessionTitle,
  markSessionDirty,
  recordSaveOutcome,
  setSessionCamera,
  setSessionWorkspaceMode,
  withDirtySuppressed,
} from './documentSession.js';
import {
  createAndRegisterSession,
  createDocumentSessionStore,
  disposeAllSessions,
  getActiveSession,
  listSessions,
  setActiveSession,
} from './documentSessionStore.js';
import {
  allocateUntitledDrawingName,
  allocateUntitledDrawingNameFromStore,
  isSessionInputTarget,
  persistActiveSessionMirrors as persistMirrors,
  prepareSessionDeactivation,
  sessionDirtyMap,
} from './documentSessionSwitch.js';
import {
  CLOSE_TAB_ACTIONS_ENABLED,
  MULTI_DOCUMENT_ACTIONS_ENABLED,
  buildDocumentTabItems,
} from './documentTabsModel.js';
import { REMAINING_FOR_P3_B4 } from './documentSessionArchitecture.js';

describe('P3-B3B untitled naming', () => {
  it('allocates Untitled Drawing then numbered suffixes', () => {
    expect(allocateUntitledDrawingName([])).toBe('Untitled Drawing');
    expect(allocateUntitledDrawingName(['Untitled Drawing'])).toBe(
      'Untitled Drawing 2',
    );
    expect(
      allocateUntitledDrawingName([
        'Untitled Drawing',
        'Untitled Drawing 2',
        'Floor',
      ]),
    ).toBe('Untitled Drawing 3');
  });

  it('skips gaps filled by existing titles', () => {
    expect(
      allocateUntitledDrawingName([
        'Untitled Drawing',
        'Untitled Drawing 3',
      ]),
    ).toBe('Untitled Drawing 2');
  });
});

describe('P3-B3B multi-document switching', () => {
  beforeEach(() => resetIdCounter());

  function createPairWithEngines() {
    const store = createDocumentSessionStore();
    const a = createAndRegisterSession(store, { bindMinimalEngine: true });
    const bName = allocateUntitledDrawingNameFromStore(store);
    const b = createAndRegisterSession(store, {
      document: ensureLayouts(createEmptyDocument(bName)),
      bindMinimalEngine: true,
    });
    setActiveSession(store, a.id);
    return { store, a, b };
  }

  it('1–5: create A/B, draw LINE in A and CIRCLE in B, switch A→B→A', () => {
    const { store, a, b } = createPairWithEngines();
    expect(getSessionTitle(a)).toBe('Untitled Drawing');
    expect(getSessionTitle(b)).toBe('Untitled Drawing 2');

    a.bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 10, y: 0 }));
    setActiveSession(store, b.id);
    b.bus.execute(new CreateCircleCommand({ x: 5, y: 5 }, 2));

    setActiveSession(store, a.id);
    expect(getSessionDocument(a).entities).toHaveLength(1);
    expect(getSessionDocument(a).entities[0]!.type).toBe('line');
    setActiveSession(store, b.id);
    expect(getSessionDocument(b).entities).toHaveLength(1);
    expect(getSessionDocument(b).entities[0]!.type).toBe('circle');
    setActiveSession(store, a.id);
    expect(getSessionDocument(a).entities[0]!.type).toBe('line');
    expect(getActiveSession(store)?.id).toBe(a.id);
    disposeAllSessions(store);
  });

  it('6: geometry isolation across switches', () => {
    const { store, a, b } = createPairWithEngines();
    a.bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 1, y: 0 }));
    a.bus.execute(new CreateLineCommand({ x: 0, y: 1 }, { x: 1, y: 1 }));
    b.bus.execute(new CreateCircleCommand({ x: 0, y: 0 }, 3));
    for (let i = 0; i < 5; i += 1) {
      setActiveSession(store, i % 2 === 0 ? a.id : b.id);
    }
    expect(getSessionDocument(a).entities).toHaveLength(2);
    expect(getSessionDocument(b).entities).toHaveLength(1);
    disposeAllSessions(store);
  });

  it('7: independent Undo/Redo', () => {
    const { store, a, b } = createPairWithEngines();
    a.bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 2, y: 0 }));
    b.bus.execute(new CreateCircleCommand({ x: 1, y: 1 }, 1));
    b.bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 1, y: 0 }));
    a.bus.undo();
    expect(getSessionDocument(a).entities).toHaveLength(0);
    expect(getSessionDocument(b).entities).toHaveLength(2);
    b.bus.undo();
    expect(getSessionDocument(b).entities).toHaveLength(1);
    b.bus.redo();
    expect(getSessionDocument(b).entities).toHaveLength(2);
    expect(getSessionDocument(a).entities).toHaveLength(0);
    disposeAllSessions(store);
  });

  it('8: independent selections', () => {
    const { store, a, b } = createPairWithEngines();
    a.bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 3, y: 0 }));
    b.bus.execute(new CreateCircleCommand({ x: 0, y: 0 }, 1));
    const idA = getSessionDocument(a).entities[0]!.id;
    const idB = getSessionDocument(b).entities[0]!.id;
    a.selectionManager.select(idA);
    setActiveSession(store, b.id);
    expect(b.selectionManager.selectedIds()).toEqual([]);
    b.selectionManager.select(idB);
    setActiveSession(store, a.id);
    expect(a.selectionManager.selectedIds()).toEqual([idA]);
    expect(b.selectionManager.selectedIds()).toEqual([idB]);
    disposeAllSessions(store);
  });

  it('9: camera restoration after switch', () => {
    const { store, a, b } = createPairWithEngines();
    setSessionCamera(a, createCamera({ zoom: 80, centerX: 12, centerY: -4 }));
    a.viewHistory.push({ kind: 'model', camera: a.camera });
    setActiveSession(store, b.id);
    setSessionCamera(b, createCamera({ zoom: 40, centerX: 0, centerY: 0 }));
    setActiveSession(store, a.id);
    expect(a.camera.zoom).toBe(80);
    expect(a.camera.centerX).toBe(12);
    expect(a.viewHistory.size).toBe(1);
    expect(b.camera.zoom).toBe(40);
    expect(b.viewHistory.size).toBe(0);
    disposeAllSessions(store);
  });

  it('10: layout / workspace restoration after switch', () => {
    const { store, a, b } = createPairWithEngines();
    const layoutId = ensureLayouts(getSessionDocument(a)).layouts[0]!.id;
    withDirtySuppressed(a, () => {
      a.bus.updateWithoutHistory((d) => setActiveLayout(d, layoutId));
    });
    setSessionWorkspaceMode(a, 'PAPER_SPACE');
    setActiveSession(store, b.id);
    expect(b.workspaceMode).toBe('MODEL_SPACE');
    expect(getSessionDocument(b).activeLayoutId ?? null).toBeNull();
    setActiveSession(store, a.id);
    expect(a.workspaceMode).toBe('PAPER_SPACE');
    expect(getSessionDocument(a).activeLayoutId).toBe(layoutId);
    disposeAllSessions(store);
  });

  it('11: independent dirty indicators', () => {
    const { store, a, b } = createPairWithEngines();
    a.bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 1, y: 0 }));
    expect(a.dirty).toBe(true);
    expect(b.dirty).toBe(false);
    const tabs1 = buildDocumentTabItems(store);
    expect(tabs1.find((t) => t.sessionId === a.id)?.dirty).toBe(true);
    expect(tabs1.find((t) => t.sessionId === b.id)?.dirty).toBe(false);
    expect(tabs1.find((t) => t.sessionId === a.id)?.displayName).toContain(
      '*',
    );

    b.bus.execute(new CreateCircleCommand({ x: 0, y: 0 }, 1));
    expect(sessionDirtyMap(store)[a.id]).toBe(true);
    expect(sessionDirtyMap(store)[b.id]).toBe(true);

    recordSaveOutcome(a, { ok: true, filePath: '/tmp/a.ratecad' });
    expect(a.dirty).toBe(false);
    expect(b.dirty).toBe(true);
    disposeAllSessions(store);
  });

  it('12: command cancellation on switch (prepareSessionDeactivation)', () => {
    const { store, a, b } = createPairWithEngines();
    expect(a.engine!.start('line').ok).toBe(true);
    expect(a.engine!.isRunning()).toBe(true);
    const result = prepareSessionDeactivation(a);
    expect(result.cancelledCommand).toBe(true);
    expect(a.engine!.isRunning()).toBe(false);
    expect(a.toolSession.activeTool).toBe('select');
    setActiveSession(store, b.id);
    expect(b.engine!.isRunning()).toBe(false);
    expect(b.engine!.start('circle').ok).toBe(true);
    expect(b.engine!.isRunning()).toBe(true);
    disposeAllSessions(store);
  });

  it('13: keyboard routing targets only the active session', () => {
    const { store, a, b } = createPairWithEngines();
    setActiveSession(store, a.id);
    expect(isSessionInputTarget(store.activeSessionId, a.id)).toBe(true);
    expect(isSessionInputTarget(store.activeSessionId, b.id)).toBe(false);
    a.engine!.start('line');
    expect(a.engine!.isRunning()).toBe(true);
    expect(b.engine!.isRunning()).toBe(false);
    prepareSessionDeactivation(a);
    setActiveSession(store, b.id);
    expect(isSessionInputTarget(store.activeSessionId, b.id)).toBe(true);
    expect(a.engine!.isRunning()).toBe(false);
    b.engine!.start('rectangle');
    expect(b.engine!.isRunning()).toBe(true);
    expect(a.engine!.isRunning()).toBe(false);
    disposeAllSessions(store);
  });

  it('14: no duplicate dirty listeners after create/switch/dispose', () => {
    const store = createDocumentSessionStore();
    const sessions = [];
    for (let i = 0; i < 6; i += 1) {
      const name = allocateUntitledDrawingNameFromStore(store);
      const s = createAndRegisterSession(store, {
        document: ensureLayouts(createEmptyDocument(name)),
        bindMinimalEngine: true,
      });
      setActiveSession(store, s.id);
      sessions.push(s);
      expect(s._unsubscribers.length).toBeGreaterThan(0);
    }
    expect(listSessions(store)).toHaveLength(6);
    disposeAllSessions(store);
    for (const s of sessions) {
      expect(s.disposed).toBe(true);
      expect(s._unsubscribers).toHaveLength(0);
      expect(s._dirtyListeners.size).toBe(0);
      expect(s.engine).toBeNull();
    }
  });

  it('15: rapid repeated switching preserves isolation', () => {
    const { store, a, b } = createPairWithEngines();
    a.bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 4, y: 0 }));
    b.bus.execute(new CreateCircleCommand({ x: 2, y: 2 }, 1.5));
    markSessionDirty(a);
    clearSessionDirty(b);
    for (let i = 0; i < 40; i += 1) {
      const target = i % 2 === 0 ? a : b;
      const other = target === a ? b : a;
      prepareSessionDeactivation(other);
      persistMirrors(other, {
        camera: other.camera,
        modelCamera: other.modelCamera,
        toolSession: other.toolSession,
        workspaceMode: other.workspaceMode,
        activeViewportId: other.activeViewportId,
        selectedViewportId: other.selectedViewportId,
        selectedPaperEntityIds: other.selectedPaperEntityIds,
        commandLineBuffer: '',
        hoveredId: null,
        dirty: other.dirty,
        filePath: other.filePath,
      });
      setActiveSession(store, target.id);
    }
    expect(getSessionDocument(a).entities).toHaveLength(1);
    expect(getSessionDocument(b).entities).toHaveLength(1);
    expect(a.dirty).toBe(true);
    expect(b.dirty).toBe(false);
    disposeAllSessions(store);
  });

  it('16: existing single-document replace remains safe', () => {
    const store = createDocumentSessionStore();
    const session = createAndRegisterSession(store, { bindMinimalEngine: true });
    session.bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 1, y: 0 }));
    expect(session.dirty).toBe(true);
    // replaceSessionDocument remains for Exit soft-close; New uses a new tab (P3-B4A).
    withDirtySuppressed(session, () => {
      session.bus.reset(
        ensureLayouts(createEmptyDocument('Untitled Drawing')),
      );
    });
    clearSessionDirty(session);
    expect(getSessionDocument(session).entities).toHaveLength(0);
    expect(listSessions(store)).toHaveLength(1);
    disposeAllSessions(store);
  });

  it('preserves committed geometry when cancelling an in-progress command', () => {
    const { store, a } = createPairWithEngines();
    a.bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 5, y: 0 }));
    a.engine!.start('circle');
    expect(a.engine!.isRunning()).toBe(true);
    prepareSessionDeactivation(a);
    expect(getSessionDocument(a).entities).toHaveLength(1);
    expect(a.bus.canUndo()).toBe(true);
    disposeAllSessions(store);
  });

  it('feature flags: switch and individual close enabled; Close All deferred', () => {
    expect(MULTI_DOCUMENT_ACTIONS_ENABLED).toBe(true);
    expect(CLOSE_TAB_ACTIONS_ENABLED).toBe(true);
    expect(REMAINING_FOR_P3_B4).toContain('applicationExitMultiDocumentPrompt');
  });

  it('bindSessionEngine after switch attaches to the new session bus only', () => {
    const store = createDocumentSessionStore();
    const a = createAndRegisterSession(store);
    const b = createAndRegisterSession(store);
    bindSessionEngine(a, createMinimalEngineHost(a));
    bindSessionEngine(b, createMinimalEngineHost(b));
    a.engine!.start('line');
    prepareSessionDeactivation(a);
    setActiveSession(store, b.id);
    expect(a.engine!.isRunning()).toBe(false);
    b.engine!.start('move');
    expect(b.engine!.isRunning()).toBe(true);
    expect(a.bus).not.toBe(b.bus);
    disposeAllSessions(store);
  });
});

describe('P3-B3B persist mirrors', () => {
  it('writes App mirrors into the session before leaving it', () => {
    const session = createDocumentSession({ bindMinimalEngine: true });
    persistMirrors(session, {
      camera: createCamera({ zoom: 55, centerX: 3, centerY: 4 }),
      modelCamera: createCamera({ zoom: 10 }),
      toolSession: session.toolSession,
      workspaceMode: 'PAPER_SPACE',
      activeViewportId: null,
      selectedViewportId: 'vp-1',
      selectedPaperEntityIds: ['p1'],
      commandLineBuffer: 'LINE',
      hoveredId: null,
      dirty: true,
      filePath: null,
    });
    expect(session.camera.zoom).toBe(55);
    expect(session.workspaceMode).toBe('PAPER_SPACE');
    expect(session.selectedViewportId).toBe('vp-1');
    expect(session.selectedPaperEntityIds).toEqual(['p1']);
    expect(session.commandLineBuffer).toBe('LINE');
    expect(session.dirty).toBe(true);
    disposeDocumentSession(session);
  });
});
