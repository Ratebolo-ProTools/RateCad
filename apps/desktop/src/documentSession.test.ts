import { describe, expect, it, beforeEach } from 'vitest';
import {
  CommandBus,
  CreateLineCommand,
  SetDrawingUnitsCommand,
} from '@ratecad/commands';
import {
  clearSelection,
  createEmptyDocument,
  defaultPaperCamera,
  ensureLayouts,
  replaceViewport,
  resetIdCounter,
  setActiveLayout,
  setSelection,
  updateLayoutSheetMeta,
} from '@ratecad/core';
import { createCamera } from '@ratecad/viewport';
import {
  APPLICATION_SHARED_STATE_KEYS,
  DOCUMENT_SESSION_STATE_KEYS,
  REMAINING_SHARED_BEFORE_MULTI_TAB,
  clearSessionDirty,
  clearSessionViewHistory,
  createDocumentSession,
  createSessionId,
  createUntitledBus,
  disposeDocumentSession,
  getSessionDisplayName,
  getSessionDocument,
  getSessionTitle,
  markSessionDirty,
  recordSaveOutcome,
  replaceSessionDocument,
  setSessionCamera,
  setSessionFilePath,
  shouldMarkDirtyForBusChange,
  shouldPromptDiscard,
  withDirtySuppressed,
} from './documentSession.js';
import {
  createAndRegisterSession,
  createDocumentSessionStore,
  disposeAllSessions,
  getActiveSession,
  getSession,
  listSessions,
  registerSession,
  removeSession,
  setActiveSession,
} from './documentSessionStore.js';
import {
  DEFAULT_RIBBON_TAB,
  enabledRibbonTabs,
  isRibbonTabEnabled,
} from './ribbonTabs.js';
import { DEFAULT_DRAFTING_PREFS } from './draftingPrefs.js';

describe('P3-B1 DocumentSession model', () => {
  beforeEach(() => resetIdCounter());

  it('creates a session with a unique id and untitled document', () => {
    const session = createDocumentSession();
    expect(session.id).toMatch(/^[0-9a-f-]{36}$|session-/);
    expect(getSessionTitle(session)).toBe('Untitled Drawing');
    expect(session.filePath).toBeNull();
    expect(session.dirty).toBe(false);
    expect(session.disposed).toBe(false);
    expect(getSessionDocument(session).entities).toEqual([]);
    disposeDocumentSession(session);
  });

  it('assigns unique session IDs', () => {
    const a = createSessionId();
    const b = createSessionId();
    const s1 = createDocumentSession();
    const s2 = createDocumentSession();
    expect(a).not.toBe(b);
    expect(s1.id).not.toBe(s2.id);
    disposeDocumentSession(s1);
    disposeDocumentSession(s2);
  });

  it('reuses an existing CommandBus without duplicating the document', () => {
    const bus = createUntitledBus();
    const session = createDocumentSession({ bus });
    expect(session.bus).toBe(bus);
    expect(getSessionDocument(session)).toBe(bus.getDocument());
    bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 1, y: 0 }));
    expect(getSessionDocument(session).entities).toHaveLength(1);
    disposeDocumentSession(session);
  });

  it('keeps application-shared keys out of document session state lists', () => {
    for (const key of APPLICATION_SHARED_STATE_KEYS) {
      expect(DOCUMENT_SESSION_STATE_KEYS).not.toContain(key);
    }
    // Shared prefs remain module-level, not cloned per session.
    expect(DEFAULT_DRAFTING_PREFS.crosshairSize).toBe('medium');
    expect(DEFAULT_RIBBON_TAB).toBe('home');
  });
});

describe('P3-B1 DocumentSessionStore', () => {
  beforeEach(() => resetIdCounter());

  it('registers sessions and retrieves by id', () => {
    const store = createDocumentSessionStore();
    const session = createDocumentSession();
    registerSession(store, session);
    expect(getSession(store, session.id)).toBe(session);
    expect(listSessions(store)).toEqual([session]);
    disposeAllSessions(store);
  });

  it('createAndRegister activates the first session', () => {
    const store = createDocumentSessionStore();
    const session = createAndRegisterSession(store);
    expect(getActiveSession(store)).toBe(session);
    expect(store.activeSessionId).toBe(session.id);
    disposeAllSessions(store);
  });

  it('switches active session internally without disposing others', () => {
    const store = createDocumentSessionStore();
    const a = createAndRegisterSession(store);
    const b = createAndRegisterSession(store);
    expect(getActiveSession(store)).toBe(a);
    setActiveSession(store, b.id);
    expect(getActiveSession(store)).toBe(b);
    expect(getSession(store, a.id)).toBe(a);
    expect(a.disposed).toBe(false);
    disposeAllSessions(store);
  });

  it('removes and disposes a session', () => {
    const store = createDocumentSessionStore();
    const a = createAndRegisterSession(store);
    const b = createAndRegisterSession(store);
    setActiveSession(store, a.id);
    expect(removeSession(store, a.id)).toBe(true);
    expect(a.disposed).toBe(true);
    expect(getSession(store, a.id)).toBeUndefined();
    expect(getActiveSession(store)?.id).toBe(b.id);
    disposeAllSessions(store);
  });

  it('dispose clears view history and session listeners', () => {
    const session = createDocumentSession();
    session.viewHistory.push({
      kind: 'model',
      camera: createCamera({ zoom: 40 }),
    });
    expect(session.viewHistory.size).toBe(1);
    expect(session._unsubscribers.length).toBeGreaterThan(0);
    disposeDocumentSession(session);
    expect(session.disposed).toBe(true);
    expect(session.viewHistory.size).toBe(0);
    expect(session._unsubscribers).toHaveLength(0);
    expect(session.engine).toBeNull();
    expect(session.selectionManager.hoveredId).toBeNull();
    markSessionDirty(session);
    expect(session.dirty).toBe(false);
  });
});

describe('P3-B1 independent session state', () => {
  beforeEach(() => resetIdCounter());

  it('keeps independent document references', () => {
    const a = createDocumentSession();
    const b = createDocumentSession();
    a.bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 5, y: 0 }));
    expect(getSessionDocument(a).entities).toHaveLength(1);
    expect(getSessionDocument(b).entities).toHaveLength(0);
    expect(getSessionDocument(a)).not.toBe(getSessionDocument(b));
    disposeDocumentSession(a);
    disposeDocumentSession(b);
  });

  it('keeps independent file identities', () => {
    const a = createDocumentSession();
    const b = createDocumentSession();
    setSessionFilePath(a, '/drawings/a.ratecad');
    setSessionFilePath(b, '/drawings/b.ratecad');
    expect(a.filePath).toBe('/drawings/a.ratecad');
    expect(b.filePath).toBe('/drawings/b.ratecad');
    disposeDocumentSession(a);
    disposeDocumentSession(b);
  });

  it('keeps independent dirty flags', () => {
    const a = createDocumentSession();
    const b = createDocumentSession();
    markSessionDirty(a);
    expect(a.dirty).toBe(true);
    expect(b.dirty).toBe(false);
    markSessionDirty(b);
    clearSessionDirty(a);
    expect(a.dirty).toBe(false);
    expect(b.dirty).toBe(true);
    disposeDocumentSession(a);
    disposeDocumentSession(b);
  });
});

describe('P3-B1 dirty-state correction', () => {
  beforeEach(() => resetIdCounter());

  it('does not mark dirty for selection-only changes', () => {
    const session = createDocumentSession();
    session.bus.execute(
      new CreateLineCommand({ x: 0, y: 0 }, { x: 1, y: 0 }),
    );
    clearSessionDirty(session);
    const id = session.bus.getDocument().entities[0]!.id;
    session.bus.updateWithoutHistory((doc) => setSelection(doc, [id]));
    expect(session.bus.getDocument().selection).toEqual([id]);
    expect(session.dirty).toBe(false);
    session.bus.updateWithoutHistory((doc) => clearSelection(doc));
    expect(session.dirty).toBe(false);
    disposeDocumentSession(session);
  });

  it('does not mark dirty for hover highlighting', () => {
    const session = createDocumentSession();
    session.bus.execute(
      new CreateLineCommand({ x: 0, y: 0 }, { x: 2, y: 0 }),
    );
    clearSessionDirty(session);
    const id = session.bus.getDocument().entities[0]!.id;
    session.selectionManager.setHovered(id);
    expect(session.selectionManager.hoveredId).toBe(id);
    expect(session.dirty).toBe(false);
    session.selectionManager.setHovered(null);
    expect(session.dirty).toBe(false);
    disposeDocumentSession(session);
  });

  it('does not mark dirty for paper/viewport camera navigation', () => {
    const session = createDocumentSession();
    const doc = ensureLayouts(getSessionDocument(session));
    const layoutId = doc.layouts[0]!.id;
    const vp = doc.layouts[0]!.viewports[0]!;
    withDirtySuppressed(session, () => {
      session.bus.reset(doc);
      session.bus.updateWithoutHistory((d) => setActiveLayout(d, layoutId));
    });
    clearSessionDirty(session);

    session.bus.updateWithoutHistory((d) =>
      updateLayoutSheetMeta(d, layoutId, {
        paperCamera: { ...defaultPaperCamera(), offsetX: 12, zoom: 2 },
      }),
    );
    expect(session.dirty).toBe(false);

    session.bus.updateWithoutHistory((d) =>
      replaceViewport(d, layoutId, {
        ...vp,
        modelCenterX: 40,
        modelCenterY: -5,
        scale: vp.scale * 2,
      }),
    );
    expect(session.dirty).toBe(false);

    setSessionCamera(session, createCamera({ zoom: 90, centerX: 3 }));
    session.viewHistory.push({
      kind: 'model',
      camera: createCamera({ zoom: 90 }),
    });
    clearSessionViewHistory(session);
    expect(session.dirty).toBe(false);
    disposeDocumentSession(session);
  });

  it('marks dirty after geometry edit', () => {
    const session = createDocumentSession();
    expect(session.dirty).toBe(false);
    session.bus.execute(
      new CreateLineCommand({ x: 0, y: 0 }, { x: 10, y: 0 }),
    );
    expect(session.dirty).toBe(true);
    expect(getSessionDisplayName(session)).toContain('*');
    disposeDocumentSession(session);
  });

  it('marks dirty after persisted drawing settings edit', () => {
    const session = createDocumentSession();
    session.bus.execute(
      new SetDrawingUnitsCommand(session.bus.getDocument(), {
        units: 'm',
        precision: 3,
      }),
    );
    expect(session.dirty).toBe(true);
    expect(session.bus.getDocument().settings.units).toBe('m');
    disposeDocumentSession(session);
  });

  it('marks dirty on undo/redo after a clean save baseline', () => {
    const session = createDocumentSession();
    session.bus.execute(
      new CreateLineCommand({ x: 0, y: 0 }, { x: 4, y: 0 }),
    );
    expect(session.dirty).toBe(true);
    recordSaveOutcome(session, { ok: true, filePath: '/tmp/a.ratecad' });
    expect(session.dirty).toBe(false);

    session.bus.undo();
    expect(session.bus.getDocument().entities).toHaveLength(0);
    expect(session.dirty).toBe(true);

    clearSessionDirty(session);
    session.bus.redo();
    expect(session.bus.getDocument().entities).toHaveLength(1);
    expect(session.dirty).toBe(true);
    disposeDocumentSession(session);
  });

  it('clears dirty after successful save outcome', () => {
    const session = createDocumentSession();
    markSessionDirty(session);
    recordSaveOutcome(session, {
      ok: true,
      filePath: '/tmp/saved.ratecad',
    });
    expect(session.dirty).toBe(false);
    expect(session.filePath).toBe('/tmp/saved.ratecad');
    disposeDocumentSession(session);
  });

  it('preserves dirty after failed save outcome', () => {
    const session = createDocumentSession();
    markSessionDirty(session);
    recordSaveOutcome(session, { ok: false });
    expect(session.dirty).toBe(true);
    disposeDocumentSession(session);
  });

  it('still marks dirty for structural updateWithoutHistory (active layout)', () => {
    const session = createDocumentSession();
    const doc = ensureLayouts(getSessionDocument(session));
    const layoutId = doc.layouts[0]!.id;
    withDirtySuppressed(session, () => {
      session.bus.reset(doc);
    });
    clearSessionDirty(session);
    session.bus.updateWithoutHistory((d) => setActiveLayout(d, layoutId));
    expect(getSessionDocument(session).activeLayoutId).toBe(layoutId);
    expect(session.dirty).toBe(true);
    disposeDocumentSession(session);
  });

  it('classifies execute vs selection-only updateWithoutHistory', () => {
    const session = createDocumentSession();
    const before = getSessionDocument(session);
    session.bus.execute(
      new CreateLineCommand({ x: 0, y: 0 }, { x: 1, y: 0 }),
    );
    const afterGeom = getSessionDocument(session);
    expect(
      shouldMarkDirtyForBusChange('execute', before, afterGeom),
    ).toBe(true);
    const id = afterGeom.entities[0]!.id;
    const selected = setSelection(afterGeom, [id]);
    expect(
      shouldMarkDirtyForBusChange(
        'updateWithoutHistory',
        afterGeom,
        selected,
      ),
    ).toBe(false);
    disposeDocumentSession(session);
  });

  it('supports existing unsaved-change protection checks', () => {
    const session = createDocumentSession();
    expect(shouldPromptDiscard(session)).toBe(false);
    markSessionDirty(session);
    expect(shouldPromptDiscard(session)).toBe(true);
    clearSessionDirty(session);
    expect(shouldPromptDiscard(session)).toBe(false);
    disposeDocumentSession(session);
  });

  it('allows a new document to be marked unsaved', () => {
    const session = createDocumentSession({ dirty: true });
    expect(session.dirty).toBe(true);
    expect(shouldPromptDiscard(session)).toBe(true);
    disposeDocumentSession(session);
  });
});

describe('P3-B1 single-document compatibility', () => {
  beforeEach(() => resetIdCounter());

  it('preserves single-document New/Open replace behavior', () => {
    const store = createDocumentSessionStore();
    const session = createAndRegisterSession(store);
    session.bus.execute(
      new CreateLineCommand({ x: 0, y: 0 }, { x: 3, y: 0 }),
    );
    expect(session.dirty).toBe(true);
    replaceSessionDocument(
      session,
      ensureLayouts(createEmptyDocument('Untitled Drawing')),
      { filePath: null, dirty: false },
    );
    expect(getSessionDocument(session).entities).toHaveLength(0);
    expect(session.dirty).toBe(false);
    expect(session.filePath).toBeNull();
    expect(session.viewHistory.size).toBe(0);
    expect(listSessions(store)).toHaveLength(1);
    disposeAllSessions(store);
  });

  it('preserves undo/redo on the session CommandBus', () => {
    const session = createDocumentSession();
    session.bus.execute(
      new CreateLineCommand({ x: 0, y: 0 }, { x: 4, y: 0 }),
    );
    expect(session.bus.canUndo()).toBe(true);
    session.bus.undo();
    expect(getSessionDocument(session).entities).toHaveLength(0);
    expect(session.bus.canRedo()).toBe(true);
    session.bus.redo();
    expect(getSessionDocument(session).entities).toHaveLength(1);
    disposeDocumentSession(session);
  });

  it('preserves model/layout session fields with document activeLayoutId', () => {
    const session = createDocumentSession();
    expect(session.workspaceMode).toBe('MODEL_SPACE');
    const doc = ensureLayouts(getSessionDocument(session));
    const layoutId = doc.layouts[0]!.id;
    withDirtySuppressed(session, () => {
      session.bus.reset(doc);
      session.bus.updateWithoutHistory((d) => setActiveLayout(d, layoutId));
    });
    session.workspaceMode = 'PAPER_SPACE';
    expect(getSessionDocument(session).activeLayoutId).toBe(layoutId);
    expect(session.workspaceMode).toBe('PAPER_SPACE');
    session.workspaceMode = 'MODEL_SPACE';
    withDirtySuppressed(session, () => {
      session.bus.updateWithoutHistory((d) => setActiveLayout(d, null));
    });
    expect(getSessionDocument(session).activeLayoutId).toBeNull();
    disposeDocumentSession(session);
  });

  it('keeps P3-A ribbon tab regressions green', () => {
    expect(DEFAULT_RIBBON_TAB).toBe('home');
    expect(enabledRibbonTabs().map((t) => t.id)).toEqual([
      'home',
      'annotate',
      'view',
      'manage',
    ]);
    expect(isRibbonTabEnabled('insert')).toBe(false);
  });

  it('createUntitledBus matches prior createBus untitled document', () => {
    const bus = createUntitledBus();
    expect(bus).toBeInstanceOf(CommandBus);
    expect(bus.getDocument().meta.name).toBe('Untitled Drawing');
    expect(bus.getDocument().layouts.length).toBeGreaterThan(0);
  });

  it('documents remaining shared state before multi-tab', () => {
    // P3-B3A moved engine/selection onto DocumentSession; remaining items
    // are App React mirrors / UI switch wiring for P3-B3B.
    expect(REMAINING_SHARED_BEFORE_MULTI_TAB).toContain(
      'reactDocCameraMirrors',
    );
    expect(REMAINING_SHARED_BEFORE_MULTI_TAB).toContain(
      'documentTabSwitchHandlers',
    );
    expect(listSessions(createDocumentSessionStore())).toEqual([]);
  });

  it('UI foundation keeps a single active session in the store', () => {
    const store = createDocumentSessionStore();
    const session = createAndRegisterSession(store);
    expect(listSessions(store)).toHaveLength(1);
    expect(getActiveSession(store)).toBe(session);
    // B1 does not open additional UI sessions.
    disposeAllSessions(store);
  });
});
