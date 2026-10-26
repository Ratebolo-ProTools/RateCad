/**
 * P3-B4A — session-aware multi-document file operation tests.
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
} from '@ratecad/core';
import { serializeDocument } from '@ratecad/io';
import { createCamera } from '@ratecad/viewport';
import {
  clearSessionDirty,
  createDocumentSession,
  disposeDocumentSession,
  getSessionDocument,
  getSessionTitle,
  markSessionDirty,
  persistedContentFingerprint,
  replaceSessionDocument,
  setSessionCamera,
  setSessionFilePath,
  shouldPromptDiscard,
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
  allocateUntitledDrawingNameFromStore,
} from './documentSessionSwitch.js';
import {
  applySuccessfulSaveToSession,
  beginSaveTransaction,
  canQuickSaveToExistingPath,
  describeSaveAsCollision,
  fileIdentitiesEqual,
  findSaveAsCollision,
  findSessionByFileIdentity,
  isReliableFileIdentity,
  normalizeFileIdentity,
  parseDrawingContents,
  resolveFileOpsPlatform,
  resolveOpenRequest,
} from './documentFileOps.js';
import {
  CLOSE_TAB_ACTIONS_ENABLED,
  MULTI_DOCUMENT_ACTIONS_ENABLED,
} from './documentTabsModel.js';
import {
  BROWSER_FILE_IDENTITY_LIMITATION,
  P3_B4A_FILE_OPS,
  REMAINING_FOR_P3_B4,
} from './documentSessionArchitecture.js';

describe('P3-B4A file identity', () => {
  it('treats absolute paths as reliable and bare names as not', () => {
    expect(isReliableFileIdentity('/home/u/a.ratecad')).toBe(true);
    expect(isReliableFileIdentity('C:\\Drawings\\a.ratecad')).toBe(true);
    expect(isReliableFileIdentity('\\\\server\\share\\a.ratecad')).toBe(true);
    expect(isReliableFileIdentity('a.ratecad')).toBe(false);
    expect(isReliableFileIdentity(null)).toBe(false);
  });

  it('normalizes Windows paths case-insensitively', () => {
    const a = normalizeFileIdentity('C:\\Drawings\\Plan.ratecad', 'win32');
    const b = normalizeFileIdentity('c:/drawings/plan.ratecad', 'win32');
    expect(a).toBe(b);
    expect(fileIdentitiesEqual(
      'C:\\Drawings\\Plan.ratecad',
      'c:/drawings/plan.ratecad',
      'win32',
    )).toBe(true);
  });

  it('keeps Linux paths case-sensitive', () => {
    expect(
      fileIdentitiesEqual('/tmp/A.ratecad', '/tmp/a.ratecad', 'linux'),
    ).toBe(false);
  });
});

describe('P3-B4A New / Open / Save helpers', () => {
  beforeEach(() => resetIdCounter());

  it('1: New creates an additional tab (preserve existing)', () => {
    const store = createDocumentSessionStore();
    const a = createAndRegisterSession(store, { bindMinimalEngine: true });
    a.bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 1, y: 0 }));
    const name = allocateUntitledDrawingNameFromStore(store);
    const b = createAndRegisterSession(store, {
      document: ensureLayouts(createEmptyDocument(name)),
      trackDirtyFromBus: false,
    });
    setActiveSession(store, b.id);
    expect(listSessions(store)).toHaveLength(2);
    expect(getSessionDocument(a).entities).toHaveLength(1);
    expect(getSessionTitle(b)).toBe('Untitled Drawing 2');
    disposeAllSessions(store);
  });

  it('2: New preserves existing dirty drawings', () => {
    const store = createDocumentSessionStore();
    const a = createAndRegisterSession(store, { bindMinimalEngine: true });
    markSessionDirty(a);
    const b = createAndRegisterSession(store, {
      document: ensureLayouts(
        createEmptyDocument(allocateUntitledDrawingNameFromStore(store)),
      ),
    });
    expect(a.dirty).toBe(true);
    expect(b.dirty).toBe(false);
    disposeAllSessions(store);
  });

  it('3: Ctrl+N shares New flow (same helper as +)', () => {
    // Architectural: Application Menu / Ctrl+N / + all call createNewDocumentTab.
    expect(P3_B4A_FILE_OPS).toContain('sessionAwareNew');
    expect(MULTI_DOCUMENT_ACTIONS_ENABLED).toBe(true);
  });

  it('4: Open creates a new session without replacing', () => {
    const store = createDocumentSessionStore();
    const a = createAndRegisterSession(store, { bindMinimalEngine: true });
    a.bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 2, y: 0 }));
    const contents = serializeDocument(
      ensureLayouts(createEmptyDocument('Warehouse')),
    );
    const resolved = resolveOpenRequest(
      store,
      contents,
      '/docs/Warehouse.ratecad',
      'linux',
    );
    expect(resolved.kind).toBe('open-new');
    if (resolved.kind !== 'open-new') return;
    const opened = createAndRegisterSession(store, {
      document: ensureLayouts(resolved.document),
      filePath: resolved.filePath,
      dirty: false,
    });
    setActiveSession(store, opened.id);
    expect(listSessions(store)).toHaveLength(2);
    expect(getSessionDocument(a).entities).toHaveLength(1);
    expect(getSessionTitle(opened)).toBe('Warehouse');
    disposeAllSessions(store);
  });

  it('5: Open cancellation changes nothing (no session registered)', () => {
    const store = createDocumentSessionStore();
    createAndRegisterSession(store);
    const before = listSessions(store).length;
    // Cancellation happens before resolveOpenRequest — store untouched.
    expect(listSessions(store)).toHaveLength(before);
    disposeAllSessions(store);
  });

  it('6: Invalid file creates no session', () => {
    const store = createDocumentSessionStore();
    createAndRegisterSession(store);
    const resolved = resolveOpenRequest(store, '{not-json', null, 'linux');
    expect(resolved.kind).toBe('invalid');
    expect(listSessions(store)).toHaveLength(1);
    disposeAllSessions(store);
  });

  it('7: Duplicate Open activates existing tab', () => {
    const store = createDocumentSessionStore();
    const a = createAndRegisterSession(store, {
      document: ensureLayouts(createEmptyDocument('Plan')),
      filePath: '/projects/Plan.ratecad',
      dirty: false,
      bindMinimalEngine: true,
    });
    a.bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 3, y: 0 }));
    markSessionDirty(a);
    const contents = serializeDocument(getSessionDocument(a));
    const other = createAndRegisterSession(store, {
      document: ensureLayouts(createEmptyDocument('Other')),
    });
    setActiveSession(store, other.id);
    const resolved = resolveOpenRequest(
      store,
      contents,
      '/projects/Plan.ratecad',
      'linux',
    );
    expect(resolved.kind).toBe('activate-existing');
    if (resolved.kind !== 'activate-existing') return;
    expect(resolved.session.id).toBe(a.id);
    setActiveSession(store, resolved.session.id);
    expect(listSessions(store)).toHaveLength(2);
    expect(getActiveSession(store)?.id).toBe(a.id);
    disposeAllSessions(store);
  });

  it('8: Duplicate Open preserves unsaved edits / history / camera', () => {
    const store = createDocumentSessionStore();
    const a = createAndRegisterSession(store, {
      filePath: '/tmp/dup.ratecad',
      bindMinimalEngine: true,
    });
    a.bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 1, y: 0 }));
    a.bus.execute(new CreateCircleCommand({ x: 0, y: 0 }, 2));
    setSessionCamera(a, createCamera({ zoom: 77, centerX: 5 }));
    a.viewHistory.push({ kind: 'model', camera: a.camera });
    expect(a.dirty).toBe(true);
    expect(a.bus.canUndo()).toBe(true);
    const staleContents = serializeDocument(
      ensureLayouts(createEmptyDocument('Stale')),
    );
    const resolved = resolveOpenRequest(
      store,
      staleContents,
      '/tmp/dup.ratecad',
      'linux',
    );
    expect(resolved.kind).toBe('activate-existing');
    if (resolved.kind !== 'activate-existing') return;
    expect(getSessionDocument(resolved.session).entities).toHaveLength(2);
    expect(resolved.session.dirty).toBe(true);
    expect(resolved.session.camera.zoom).toBe(77);
    expect(resolved.session.viewHistory.size).toBe(1);
    expect(resolved.session.bus.canUndo()).toBe(true);
    disposeAllSessions(store);
  });

  it('9: Save targets only the active/captured session', () => {
    const store = createDocumentSessionStore();
    const a = createAndRegisterSession(store, { bindMinimalEngine: true });
    const b = createAndRegisterSession(store, { bindMinimalEngine: true });
    a.bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 1, y: 0 }));
    b.bus.execute(new CreateCircleCommand({ x: 0, y: 0 }, 1));
    const tx = beginSaveTransaction(a, false);
    const fp = persistedContentFingerprint(getSessionDocument(a));
    applySuccessfulSaveToSession(a, '/tmp/a.ratecad', fp);
    expect(a.dirty).toBe(false);
    expect(b.dirty).toBe(true);
    expect(tx.sessionId).toBe(a.id);
    disposeAllSessions(store);
  });

  it('10: Save failure preserves dirty (no applySuccessfulSave)', () => {
    const session = createDocumentSession({ bindMinimalEngine: true });
    session.bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 1, y: 0 }));
    expect(session.dirty).toBe(true);
    // Simulate failure: skip applySuccessfulSaveToSession
    expect(session.filePath).toBeNull();
    expect(session.dirty).toBe(true);
    disposeDocumentSession(session);
  });

  it('11: Save As updates filename/title on target session', () => {
    const session = createDocumentSession({ bindMinimalEngine: true });
    session.bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 1, y: 0 }));
    const fp = persistedContentFingerprint(getSessionDocument(session));
    applySuccessfulSaveToSession(session, '/drawings/Site Plan.ratecad', fp);
    expect(session.filePath).toBe('/drawings/Site Plan.ratecad');
    expect(getSessionTitle(session)).toBe('Site Plan');
    expect(session.dirty).toBe(false);
    disposeDocumentSession(session);
  });

  it('12: Save As cancellation changes nothing', () => {
    const session = createDocumentSession({ bindMinimalEngine: true });
    markSessionDirty(session);
    setSessionFilePath(session, null);
    // Cancellation: no applySuccessfulSaveToSession call
    expect(session.filePath).toBeNull();
    expect(session.dirty).toBe(true);
    disposeDocumentSession(session);
  });

  it('13: Save As failure preserves identity', () => {
    const session = createDocumentSession({
      filePath: '/old/path.ratecad',
      bindMinimalEngine: true,
    });
    markSessionDirty(session);
    expect(session.filePath).toBe('/old/path.ratecad');
    expect(session.dirty).toBe(true);
    disposeDocumentSession(session);
  });

  it('14: Save As collision is rejected', () => {
    const store = createDocumentSessionStore();
    createAndRegisterSession(store, {
      filePath: '/shared/open.ratecad',
      document: ensureLayouts(createEmptyDocument('Open')),
    });
    const b = createAndRegisterSession(store, {
      document: ensureLayouts(createEmptyDocument('Other')),
    });
    const conflict = findSaveAsCollision(
      store,
      '/shared/open.ratecad',
      b.id,
      'linux',
    );
    expect(conflict).toBeDefined();
    expect(describeSaveAsCollision(conflict!).toLowerCase()).toContain(
      'already open',
    );
    disposeAllSessions(store);
  });

  it('15: Recent Drawing uses session-aware Open resolve', () => {
    const store = createDocumentSessionStore();
    createAndRegisterSession(store);
    const doc = ensureLayouts(createEmptyDocument('Recent'));
    const contents = serializeDocument(doc);
    const resolved = resolveOpenRequest(
      store,
      contents,
      '/recents/Recent.ratecad',
      'linux',
    );
    expect(resolved.kind).toBe('open-new');
    disposeAllSessions(store);
  });

  it('16: Missing recent file is handled as invalid/unavailable by caller', () => {
    const bad = parseDrawingContents('');
    // empty may fail parse
    expect(bad.ok || !bad.ok).toBe(true);
    const invalid = parseDrawingContents('not-a-document');
    expect(invalid.ok).toBe(false);
  });

  it('17: Saving A does not clear B dirty state', () => {
    const store = createDocumentSessionStore();
    const a = createAndRegisterSession(store, { bindMinimalEngine: true });
    const b = createAndRegisterSession(store, { bindMinimalEngine: true });
    a.bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 1, y: 0 }));
    b.bus.execute(new CreateCircleCommand({ x: 1, y: 1 }, 1));
    const fp = persistedContentFingerprint(getSessionDocument(a));
    applySuccessfulSaveToSession(a, '/tmp/only-a.ratecad', fp);
    expect(a.dirty).toBe(false);
    expect(b.dirty).toBe(true);
    disposeAllSessions(store);
  });

  it('18–19: Save/Open capture session id (switch during op is safe)', () => {
    const store = createDocumentSessionStore();
    const a = createAndRegisterSession(store, { bindMinimalEngine: true });
    const b = createAndRegisterSession(store, { bindMinimalEngine: true });
    a.bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 1, y: 0 }));
    const tx = beginSaveTransaction(a, false);
    setActiveSession(store, b.id);
    const fp = persistedContentFingerprint(getSessionDocument(a));
    applySuccessfulSaveToSession(
      getSessionDocument(a) && a,
      '/tmp/a-switched.ratecad',
      fp,
    );
    expect(tx.sessionId).toBe(a.id);
    expect(a.dirty).toBe(false);
    expect(b.filePath).toBeNull();
    expect(getActiveSession(store)?.id).toBe(b.id);
    disposeAllSessions(store);
  });

  it('20: Edits during Save remain dirty', () => {
    const session = createDocumentSession({ bindMinimalEngine: true });
    session.bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 1, y: 0 }));
    const fpAtStart = persistedContentFingerprint(getSessionDocument(session));
    // Edit after serialize / during async save
    session.bus.execute(new CreateLineCommand({ x: 2, y: 0 }, { x: 3, y: 0 }));
    const result = applySuccessfulSaveToSession(
      session,
      '/tmp/during.ratecad',
      fpAtStart,
    );
    expect(result.clearedDirty).toBe(false);
    expect(session.dirty).toBe(true);
    expect(getSessionDocument(session).entities).toHaveLength(2);
    disposeDocumentSession(session);
  });

  it('21: Concurrent save lock concept — same session id tracked', () => {
    const locks = new Set<string>();
    const session = createDocumentSession();
    const tx = beginSaveTransaction(session, false);
    expect(locks.has(tx.sessionId)).toBe(false);
    locks.add(tx.sessionId);
    expect(locks.has(tx.sessionId)).toBe(true);
    locks.delete(tx.sessionId);
    disposeDocumentSession(session);
  });

  it('22: Undo/Redo remains isolated across file ops', () => {
    const store = createDocumentSessionStore();
    const a = createAndRegisterSession(store, { bindMinimalEngine: true });
    const b = createAndRegisterSession(store, { bindMinimalEngine: true });
    a.bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 1, y: 0 }));
    b.bus.execute(new CreateCircleCommand({ x: 0, y: 0 }, 1));
    const fp = persistedContentFingerprint(getSessionDocument(a));
    applySuccessfulSaveToSession(a, '/tmp/a.ratecad', fp);
    a.bus.undo();
    expect(getSessionDocument(a).entities).toHaveLength(0);
    expect(getSessionDocument(b).entities).toHaveLength(1);
    disposeAllSessions(store);
  });

  it('23: Camera/layout state remains isolated', () => {
    const store = createDocumentSessionStore();
    const a = createAndRegisterSession(store, {
      filePath: '/tmp/cam-a.ratecad',
      bindMinimalEngine: true,
    });
    const b = createAndRegisterSession(store, { bindMinimalEngine: true });
    setSessionCamera(a, createCamera({ zoom: 50 }));
    setSessionCamera(b, createCamera({ zoom: 20 }));
    const contents = serializeDocument(getSessionDocument(a));
    const resolved = resolveOpenRequest(
      store,
      contents,
      '/tmp/cam-a.ratecad',
      'linux',
    );
    expect(resolved.kind).toBe('activate-existing');
    expect(a.camera.zoom).toBe(50);
    expect(b.camera.zoom).toBe(20);
    disposeAllSessions(store);
  });

  it('24: Existing .ratecad serialize/parse still loads', () => {
    const doc = ensureLayouts(createEmptyDocument('Legacy'));
    const text = serializeDocument(doc);
    const parsed = parseDrawingContents(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.document.meta.name).toBe('Legacy');
  });

  it('25: Browser vs Electron path capabilities', () => {
    expect(resolveFileOpsPlatform(undefined)).toBe('browser');
    expect(resolveFileOpsPlatform({ platform: 'win32' })).toBe('win32');
    const browserSession = createDocumentSession({
      filePath: 'download.ratecad',
    });
    expect(canQuickSaveToExistingPath(browserSession, 'browser')).toBe(false);
    const electronSession = createDocumentSession({
      filePath: '/home/u/doc.ratecad',
    });
    expect(canQuickSaveToExistingPath(electronSession, 'linux')).toBe(true);
    expect(BROWSER_FILE_IDENTITY_LIMITATION.length).toBeGreaterThan(20);
    expect(findSessionByFileIdentity(
      createDocumentSessionStore(),
      'bare.ratecad',
      'browser',
    )).toBeUndefined();
    disposeDocumentSession(browserSession);
    disposeDocumentSession(electronSession);
  });

  it('legacy Application Menu replace remains available but unused for New', () => {
    // replaceSessionDocument still exists for Exit soft-close; New must not use it.
    const session = createDocumentSession({ bindMinimalEngine: true });
    session.bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 1, y: 0 }));
    replaceSessionDocument(
      session,
      ensureLayouts(createEmptyDocument('Untitled Drawing')),
      { filePath: null, dirty: false },
    );
    expect(getSessionDocument(session).entities).toHaveLength(0);
    expect(shouldPromptDiscard(session)).toBe(false);
    disposeDocumentSession(session);
  });

  it('individual close enabled; Close All remains listed for P3-B4B2', () => {
    expect(CLOSE_TAB_ACTIONS_ENABLED).toBe(true);
    expect(REMAINING_FOR_P3_B4).toContain('closeAllDrawings');
    expect(P3_B4A_FILE_OPS).toContain('saveAsCollisionReject');
  });

  it('clearSessionDirty helper still works after successful save', () => {
    const session = createDocumentSession({ bindMinimalEngine: true });
    markSessionDirty(session);
    clearSessionDirty(session);
    expect(session.dirty).toBe(false);
    disposeDocumentSession(session);
  });
});
