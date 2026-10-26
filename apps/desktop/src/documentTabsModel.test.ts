import { describe, expect, it, beforeEach } from 'vitest';
import { CreateLineCommand } from '@ratecad/commands';
import { resetIdCounter } from '@ratecad/core';
import {
  clearSessionDirty,
  createDocumentSession,
  disposeDocumentSession,
  getSessionDisplayName,
  getSessionTitle,
  markSessionDirty,
  recordSaveOutcome,
  setSessionFilePath,
} from './documentSession.js';
import {
  createAndRegisterSession,
  createDocumentSessionStore,
  disposeAllSessions,
  listSessions,
  setActiveSession,
} from './documentSessionStore.js';
import {
  CLOSE_TAB_ACTIONS_ENABLED,
  CLOSE_TAB_DISABLED_TOOLTIP,
  MULTI_DOCUMENT_ACTIONS_ENABLED,
  NEW_TAB_ENABLED_TOOLTIP,
  START_TAB_TOOLTIP,
  applyLiveActiveTabState,
  areCloseTabActionsEnabled,
  areMultiDocumentActionsEnabled,
  buildDocumentTabItems,
  documentTabItemFromSession,
  getActiveDocumentTab,
  resolveDocumentTabItems,
  syncTabItemWithLiveState,
  truncateTabTitle,
} from './documentTabsModel.js';

describe('P3-B2 document tabs model', () => {
  beforeEach(() => resetIdCounter());

  it('maps session id, title, dirty, and active flag', () => {
    const store = createDocumentSessionStore();
    const session = createAndRegisterSession(store);
    markSessionDirty(session);
    const items = buildDocumentTabItems(store);
    expect(items).toHaveLength(1);
    expect(items[0]!.sessionId).toBe(session.id);
    expect(items[0]!.title).toBe('Untitled Drawing');
    expect(items[0]!.displayName).toBe('Untitled Drawing *');
    expect(items[0]!.dirty).toBe(true);
    expect(items[0]!.active).toBe(true);
    disposeAllSessions(store);
  });

  it('shows untitled drawing title for new sessions', () => {
    const session = createDocumentSession();
    expect(getSessionTitle(session)).toBe('Untitled Drawing');
    const item = documentTabItemFromSession(session, session.id);
    expect(item.title).toBe('Untitled Drawing');
    expect(item.displayName).toBe('Untitled Drawing');
    disposeDocumentSession(session);
  });

  it('shows saved filename title after successful save', () => {
    const session = createDocumentSession();
    markSessionDirty(session);
    recordSaveOutcome(session, {
      ok: true,
      filePath: '/drawings/Floor Plan.ratecad',
    });
    // Title comes from document meta — App updates meta on save; mirror here.
    session.bus.updateWithoutHistory((d) => ({
      ...d,
      meta: { ...d.meta, name: 'Floor Plan' },
    }));
    clearSessionDirty(session);
    const item = documentTabItemFromSession(session, session.id);
    expect(item.title).toBe('Floor Plan');
    expect(item.filePath).toBe('/drawings/Floor Plan.ratecad');
    expect(item.dirty).toBe(false);
    expect(item.displayName).toBe('Floor Plan');
    disposeDocumentSession(session);
  });

  it('shows unsaved indicator from session dirty state', () => {
    const session = createDocumentSession();
    session.bus.execute(
      new CreateLineCommand({ x: 0, y: 0 }, { x: 1, y: 0 }),
    );
    expect(session.dirty).toBe(true);
    expect(getSessionDisplayName(session)).toBe('Untitled Drawing *');
    disposeDocumentSession(session);
  });

  it('updates Save As title via live active tab sync', () => {
    const store = createDocumentSessionStore();
    const session = createAndRegisterSession(store);
    let items = buildDocumentTabItems(store);
    items = applyLiveActiveTabState(items, store, {
      title: 'Site Plan',
      dirty: false,
      filePath: '/tmp/Site Plan.ratecad',
    });
    expect(items[0]!.title).toBe('Site Plan');
    expect(items[0]!.displayName).toBe('Site Plan');
    expect(items[0]!.filePath).toBe('/tmp/Site Plan.ratecad');
    disposeAllSessions(store);
  });

  it('keeps dirty-state synchronized with session (no duplicate flag)', () => {
    const store = createDocumentSessionStore();
    const session = createAndRegisterSession(store);
    markSessionDirty(session);
    const a = buildDocumentTabItems(store)[0]!;
    expect(a.dirty).toBe(session.dirty);
    clearSessionDirty(session);
    const b = buildDocumentTabItems(store)[0]!;
    expect(b.dirty).toBe(false);
    expect(b.dirty).toBe(session.dirty);
    disposeAllSessions(store);
  });

  it('tracks active session id when switching store active', () => {
    const store = createDocumentSessionStore();
    const a = createAndRegisterSession(store);
    const b = createAndRegisterSession(store);
    setActiveSession(store, b.id);
    const items = buildDocumentTabItems(store);
    expect(getActiveDocumentTab(items)?.sessionId).toBe(b.id);
    expect(items.find((t) => t.sessionId === a.id)?.active).toBe(false);
    disposeAllSessions(store);
  });

  it('enables multi-document create/switch in P3-B3B; close stays disabled', () => {
    expect(MULTI_DOCUMENT_ACTIONS_ENABLED).toBe(true);
    expect(CLOSE_TAB_ACTIONS_ENABLED).toBe(false);
    expect(areMultiDocumentActionsEnabled()).toBe(true);
    expect(areMultiDocumentActionsEnabled(false)).toBe(false);
    expect(areCloseTabActionsEnabled()).toBe(false);
    expect(areCloseTabActionsEnabled(true)).toBe(true);
    expect(NEW_TAB_ENABLED_TOOLTIP.toLowerCase()).toContain('new drawing');
    expect(CLOSE_TAB_DISABLED_TOOLTIP.toLowerCase()).toContain('p3-b4');
    expect(START_TAB_TOOLTIP.toLowerCase()).toContain('placeholder');
  });

  it('truncates long titles for overflow-friendly labels', () => {
    const long = 'A'.repeat(40);
    const truncated = truncateTabTitle(long, 32);
    expect(truncated.length).toBeLessThanOrEqual(32);
    expect(truncated.endsWith('…')).toBe(true);
    expect(truncateTabTitle('Short')).toBe('Short');
  });

  it('preserves single-document resolve when store has one session', () => {
    const store = createDocumentSessionStore();
    const session = createAndRegisterSession(store);
    setSessionFilePath(session, null);
    const items = resolveDocumentTabItems(store, {
      sessionId: session.id,
      title: 'Untitled Drawing',
      dirty: false,
      filePath: null,
    });
    expect(listSessions(store)).toHaveLength(1);
    expect(items).toHaveLength(1);
    expect(items[0]!.active).toBe(true);
    disposeAllSessions(store);
  });

  it('syncTabItemWithLiveState updates display name for dirty live state', () => {
    const base = {
      sessionId: 's1',
      title: 'Old',
      displayName: 'Old',
      dirty: false,
      filePath: null,
      active: true,
    };
    const next = syncTabItemWithLiveState(base, {
      title: 'Renamed',
      dirty: true,
      filePath: '/x.ratecad',
    });
    expect(next.displayName).toBe('Renamed *');
    expect(next.dirty).toBe(true);
  });
});
