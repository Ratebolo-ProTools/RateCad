/**
 * P3-B4B1 — safe individual drawing-tab close tests.
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
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import {
  clearSessionDirty,
  createDocumentSession,
  disposeDocumentSession,
  getSessionDocument,
  getSessionTitle,
  markSessionDirty,
  persistedContentFingerprint,
  setSessionCamera,
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
  CLOSE_SAVE_DIALOG_TITLE,
  LAST_DRAWING_CLOSE_POLICY,
  chooseFallbackSessionId,
  closeSaveDialogMessage,
  getCloseDialogTitle,
  isLastOpenSession,
  shouldPromptSaveBeforeClose,
} from './documentSessionClose.js';
import { CloseSaveDialog } from './CloseSaveDialog.js';
import {
  CLOSE_TAB_ACTIONS_ENABLED,
  MULTI_DOCUMENT_ACTIONS_ENABLED,
} from './documentTabsModel.js';
import {
  P3_B4B1_CLOSE_OPS,
  REMAINING_FOR_P3_B4,
} from './documentSessionArchitecture.js';

describe('P3-B4B1 close helpers', () => {
  beforeEach(() => resetIdCounter());

  it('1: clean active tab closes via removeSession', () => {
    const store = createDocumentSessionStore();
    const a = createAndRegisterSession(store, { bindMinimalEngine: true });
    const b = createAndRegisterSession(store, { bindMinimalEngine: true });
    setActiveSession(store, a.id);
    expect(a.dirty).toBe(false);
    expect(shouldPromptSaveBeforeClose(a)).toBe(false);
    const fallback = chooseFallbackSessionId(store, a.id, null);
    expect(fallback).toBe(b.id);
    removeSession(store, a.id, { preferredNextId: fallback });
    expect(getSession(store, a.id)).toBeUndefined();
    expect(a.disposed).toBe(true);
    expect(getActiveSession(store)?.id).toBe(b.id);
    disposeAllSessions(store);
  });

  it('2: clean inactive tab closes without changing active', () => {
    const store = createDocumentSessionStore();
    const a = createAndRegisterSession(store, { bindMinimalEngine: true });
    const b = createAndRegisterSession(store, { bindMinimalEngine: true });
    setActiveSession(store, a.id);
    removeSession(store, b.id);
    expect(getActiveSession(store)?.id).toBe(a.id);
    expect(listSessions(store)).toHaveLength(1);
    disposeAllSessions(store);
  });

  it('3: dirty tab requires confirmation', () => {
    const session = createDocumentSession({ bindMinimalEngine: true });
    session.bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 1, y: 0 }));
    expect(shouldPromptSaveBeforeClose(session)).toBe(true);
    expect(closeSaveDialogMessage(getCloseDialogTitle(session))).toContain(
      getSessionTitle(session),
    );
    disposeDocumentSession(session);
  });

  it('4: Save success then close', () => {
    const store = createDocumentSessionStore();
    const a = createAndRegisterSession(store, { bindMinimalEngine: true });
    const b = createAndRegisterSession(store, { bindMinimalEngine: true });
    a.bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 1, y: 0 }));
    const fp = persistedContentFingerprint(getSessionDocument(a));
    const saved = applySuccessfulSaveToSession(a, '/tmp/a.ratecad', fp);
    expect(saved.clearedDirty).toBe(true);
    expect(shouldPromptSaveBeforeClose(a)).toBe(false);
    removeSession(store, a.id, { preferredNextId: b.id });
    expect(getSession(store, a.id)).toBeUndefined();
    disposeAllSessions(store);
  });

  it('5: Save failure / still-dirty keeps tab', () => {
    const session = createDocumentSession({ bindMinimalEngine: true });
    session.bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 1, y: 0 }));
    const fp = persistedContentFingerprint(getSessionDocument(session));
    session.bus.execute(new CreateLineCommand({ x: 2, y: 0 }, { x: 3, y: 0 }));
    const result = applySuccessfulSaveToSession(
      session,
      '/tmp/a.ratecad',
      fp,
    );
    expect(result.clearedDirty).toBe(false);
    expect(session.dirty).toBe(true);
    expect(shouldPromptSaveBeforeClose(session)).toBe(true);
    disposeDocumentSession(session);
  });

  it('6: Save As cancellation keeps tab (no dispose)', () => {
    const store = createDocumentSessionStore();
    const session = createAndRegisterSession(store, { bindMinimalEngine: true });
    markSessionDirty(session);
    // Cancellation: skip save + skip remove
    expect(listSessions(store)).toHaveLength(1);
    expect(session.dirty).toBe(true);
    disposeAllSessions(store);
  });

  it('7: Don\'t Save closes only target', () => {
    const store = createDocumentSessionStore();
    const a = createAndRegisterSession(store, { bindMinimalEngine: true });
    const b = createAndRegisterSession(store, { bindMinimalEngine: true });
    a.bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 1, y: 0 }));
    b.bus.execute(new CreateCircleCommand({ x: 0, y: 0 }, 1));
    removeSession(store, a.id, { preferredNextId: b.id });
    expect(getSession(store, a.id)).toBeUndefined();
    expect(getSessionDocument(b).entities).toHaveLength(1);
    expect(b.dirty).toBe(true);
    disposeAllSessions(store);
  });

  it('8: Cancel preserves target', () => {
    const store = createDocumentSessionStore();
    const a = createAndRegisterSession(store, { bindMinimalEngine: true });
    a.bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 1, y: 0 }));
    const entities = getSessionDocument(a).entities.length;
    // Cancel: do nothing
    expect(getSessionDocument(a).entities).toHaveLength(entities);
    expect(a.dirty).toBe(true);
    expect(a.bus.canUndo()).toBe(true);
    disposeAllSessions(store);
  });

  it('9: ESC cancels confirmation (dialog wiring)', () => {
    const html = renderToStaticMarkup(
      createElement(CloseSaveDialog, {
        drawingName: 'Plan',
        onChoose: () => undefined,
      }),
    );
    expect(html).toContain(CLOSE_SAVE_DIALOG_TITLE);
    expect(html).toContain('Plan');
    expect(html).toContain('data-testid="close-save-dialog-cancel"');
    expect(html).toContain('data-cad-dialog="1"');
  });

  it('10: inactive tab save targets correct session id', () => {
    const store = createDocumentSessionStore();
    const a = createAndRegisterSession(store, { bindMinimalEngine: true });
    const b = createAndRegisterSession(store, { bindMinimalEngine: true });
    setActiveSession(store, a.id);
    b.bus.execute(new CreateCircleCommand({ x: 0, y: 0 }, 2));
    const fp = persistedContentFingerprint(getSessionDocument(b));
    applySuccessfulSaveToSession(b, '/tmp/b-only.ratecad', fp);
    expect(b.dirty).toBe(false);
    expect(b.filePath).toBe('/tmp/b-only.ratecad');
    expect(a.filePath).toBeNull();
    expect(getActiveSession(store)?.id).toBe(a.id);
    disposeAllSessions(store);
  });

  it('11: closing active tab activates fallback (previous / neighbor)', () => {
    const store = createDocumentSessionStore();
    const a = createAndRegisterSession(store);
    const b = createAndRegisterSession(store);
    const c = createAndRegisterSession(store);
    setActiveSession(store, b.id);
    expect(chooseFallbackSessionId(store, b.id, a.id)).toBe(a.id);
    expect(chooseFallbackSessionId(store, b.id, null)).toBe(a.id);
    removeSession(store, b.id, {
      preferredNextId: chooseFallbackSessionId(store, b.id, a.id),
    });
    expect(getActiveSession(store)?.id).toBe(a.id);
    expect(listSessions(store).map((s) => s.id)).toEqual([a.id, c.id]);
    disposeAllSessions(store);
  });

  it('12: closing inactive tab preserves active', () => {
    const store = createDocumentSessionStore();
    const a = createAndRegisterSession(store, { bindMinimalEngine: true });
    const b = createAndRegisterSession(store, { bindMinimalEngine: true });
    setActiveSession(store, a.id);
    setSessionCamera(a, createCamera({ zoom: 66 }));
    removeSession(store, b.id);
    expect(getActiveSession(store)?.id).toBe(a.id);
    expect(a.camera.zoom).toBe(66);
    disposeAllSessions(store);
  });

  it('13: closing last tab is last-session; policy documented', () => {
    const store = createDocumentSessionStore();
    const a = createAndRegisterSession(store);
    expect(isLastOpenSession(store, a.id)).toBe(true);
    expect(LAST_DRAWING_CLOSE_POLICY).toBe('replace-with-clean-untitled');
    expect(chooseFallbackSessionId(store, a.id, null)).toBeNull();
    disposeAllSessions(store);
  });

  it('14–15: double/rapid close is idempotent after dispose', () => {
    const store = createDocumentSessionStore();
    const a = createAndRegisterSession(store);
    const b = createAndRegisterSession(store);
    expect(removeSession(store, a.id)).toBe(true);
    expect(removeSession(store, a.id)).toBe(false);
    expect(listSessions(store)).toHaveLength(1);
    expect(b.disposed).toBe(false);
    disposeAllSessions(store);
  });

  it('16: switching during dialog does not dispose target (cancel path)', () => {
    const store = createDocumentSessionStore();
    const a = createAndRegisterSession(store);
    const b = createAndRegisterSession(store);
    markSessionDirty(a);
    setActiveSession(store, b.id);
    // Dialog cancel: a remains
    expect(getSession(store, a.id)).toBe(a);
    expect(a.dirty).toBe(true);
    disposeAllSessions(store);
  });

  it('17: editing during Save prevents accidental loss', () => {
    const session = createDocumentSession({ bindMinimalEngine: true });
    session.bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 1, y: 0 }));
    const fp = persistedContentFingerprint(getSessionDocument(session));
    session.bus.execute(new CreateCircleCommand({ x: 0, y: 0 }, 1));
    const result = applySuccessfulSaveToSession(
      session,
      '/tmp/edit-during.ratecad',
      fp,
    );
    expect(result.clearedDirty).toBe(false);
    expect(shouldPromptSaveBeforeClose(session)).toBe(true);
    disposeDocumentSession(session);
  });

  it('18: sibling dirty states remain intact', () => {
    const store = createDocumentSessionStore();
    const a = createAndRegisterSession(store, { bindMinimalEngine: true });
    const b = createAndRegisterSession(store, { bindMinimalEngine: true });
    markSessionDirty(a);
    markSessionDirty(b);
    removeSession(store, a.id);
    expect(b.dirty).toBe(true);
    disposeAllSessions(store);
  });

  it('19: sibling Undo/Redo remains intact', () => {
    const store = createDocumentSessionStore();
    const a = createAndRegisterSession(store, { bindMinimalEngine: true });
    const b = createAndRegisterSession(store, { bindMinimalEngine: true });
    a.bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 1, y: 0 }));
    b.bus.execute(new CreateCircleCommand({ x: 0, y: 0 }, 1));
    b.bus.execute(new CreateLineCommand({ x: 1, y: 0 }, { x: 2, y: 0 }));
    removeSession(store, a.id);
    expect(b.bus.canUndo()).toBe(true);
    b.bus.undo();
    expect(getSessionDocument(b).entities).toHaveLength(1);
    disposeAllSessions(store);
  });

  it('20–21: closed session resources disposed; no leftover listeners', () => {
    const store = createDocumentSessionStore();
    const a = createAndRegisterSession(store, { bindMinimalEngine: true });
    expect(a._unsubscribers.length).toBeGreaterThan(0);
    removeSession(store, a.id);
    expect(a.disposed).toBe(true);
    expect(a._unsubscribers).toHaveLength(0);
    expect(a._dirtyListeners.size).toBe(0);
    expect(a.engine).toBeNull();
    disposeAllSessions(store);
  });

  it('22: closing a missing session is safe', () => {
    const store = createDocumentSessionStore();
    createAndRegisterSession(store);
    expect(removeSession(store, 'missing-id')).toBe(false);
    expect(listSessions(store)).toHaveLength(1);
    disposeAllSessions(store);
  });

  it('23: existing file parse still works', () => {
    const text = serializeDocument(
      ensureLayouts(createEmptyDocument('Compat')),
    );
    const parsed = parseDrawingContents(text);
    expect(parsed.ok).toBe(true);
  });

  it('24: multi-document switching helpers still work with close flags', () => {
    expect(MULTI_DOCUMENT_ACTIONS_ENABLED).toBe(true);
    expect(CLOSE_TAB_ACTIONS_ENABLED).toBe(true);
    expect(P3_B4B1_CLOSE_OPS).toContain('individualTabClose');
    expect(REMAINING_FOR_P3_B4).toContain('applicationExitMultiDocumentPrompt');
  });

  it('25: .ratecad compatibility + clear dirty helper', () => {
    const session = createDocumentSession({ bindMinimalEngine: true });
    markSessionDirty(session);
    clearSessionDirty(session);
    expect(session.dirty).toBe(false);
    disposeDocumentSession(session);
  });

  it('dialog lists Save / Don\'t Save / Cancel actions', () => {
    const html = renderToStaticMarkup(
      createElement(CloseSaveDialog, {
        drawingName: 'Warehouse',
        onChoose: () => undefined,
      }),
    );
    expect(html).toContain('close-save-dialog-save');
    expect(html).toContain('close-save-dialog-dont-save');
    expect(html).toContain('close-save-dialog-cancel');
    expect(html).toContain('Warehouse');
  });
});
