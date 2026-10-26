/**
 * P3-B2 — Document tab view-model helpers.
 *
 * Maps P3-B1 DocumentSession store state into UI tab descriptors.
 * Does not own dirty state or create a second session manager.
 */

import {
  getSessionDisplayName,
  getSessionTitle,
  type DocumentSession,
  type DocumentSessionId,
} from './documentSession.js';
import {
  getActiveSession,
  listSessions,
  type DocumentSessionStore,
} from './documentSessionStore.js';

/** Multi-document create/close/switch remain disabled until P3-B3 isolation. */
export const MULTI_DOCUMENT_ACTIONS_ENABLED = false;

export const START_TAB_TOOLTIP =
  'Start workspace — placeholder (not yet interactive)';

export const NEW_TAB_DISABLED_TOOLTIP =
  'Multiple drawings — not yet available (requires P3-B3 session isolation)';

export const CLOSE_TAB_DISABLED_TOOLTIP =
  'Close drawing — not yet available for multi-document (use Application Menu → New to replace this drawing)';

export type DocumentTabItem = {
  sessionId: DocumentSessionId;
  /** Base title without unsaved marker. */
  title: string;
  /** Title including trailing " *" when dirty. */
  displayName: string;
  dirty: boolean;
  filePath: string | null;
  active: boolean;
};

export function documentTabItemFromSession(
  session: DocumentSession,
  activeSessionId: DocumentSessionId | null,
): DocumentTabItem {
  return {
    sessionId: session.id,
    title: getSessionTitle(session),
    displayName: getSessionDisplayName(session),
    dirty: session.dirty,
    filePath: session.filePath,
    active: session.id === activeSessionId,
  };
}

/** Build tab items from the P3-B1 session store (no duplicated dirty state). */
export function buildDocumentTabItems(
  store: DocumentSessionStore,
): DocumentTabItem[] {
  const activeId = store.activeSessionId;
  return listSessions(store).map((session) =>
    documentTabItemFromSession(session, activeId),
  );
}

/**
 * Prefer store-backed tabs; fall back to a single synthetic tab when the
 * store is empty (should not happen in normal App boot).
 */
export function resolveDocumentTabItems(
  store: DocumentSessionStore,
  fallback: {
    sessionId: DocumentSessionId;
    title: string;
    dirty: boolean;
    filePath: string | null;
  },
): DocumentTabItem[] {
  const items = buildDocumentTabItems(store);
  if (items.length > 0) return items;
  const displayName = fallback.dirty
    ? `${fallback.title} *`
    : fallback.title;
  return [
    {
      sessionId: fallback.sessionId,
      title: fallback.title,
      displayName,
      dirty: fallback.dirty,
      filePath: fallback.filePath,
      active: true,
    },
  ];
}

export function getActiveDocumentTab(
  tabs: DocumentTabItem[],
): DocumentTabItem | undefined {
  return tabs.find((t) => t.active) ?? tabs[0];
}

export function truncateTabTitle(title: string, max = 32): string {
  const trimmed = title.trim() || 'Untitled Drawing';
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, Math.max(1, max - 1))}…`;
}

/** Whether + / close / inactive-tab switch are interactive in this phase. */
export function areMultiDocumentActionsEnabled(
  override?: boolean,
): boolean {
  return override ?? MULTI_DOCUMENT_ACTIONS_ENABLED;
}

export function syncTabItemWithLiveState(
  item: DocumentTabItem,
  live: { title: string; dirty: boolean; filePath: string | null },
): DocumentTabItem {
  const title = live.title.trim() || 'Untitled Drawing';
  return {
    ...item,
    title,
    dirty: live.dirty,
    filePath: live.filePath,
    displayName: live.dirty ? `${title} *` : title,
  };
}

/** Ensure the active session’s tab reflects App’s live doc/dirty mirrors. */
export function applyLiveActiveTabState(
  tabs: DocumentTabItem[],
  store: DocumentSessionStore,
  live: { title: string; dirty: boolean; filePath: string | null },
): DocumentTabItem[] {
  const active = getActiveSession(store);
  if (!active) return tabs;
  return tabs.map((tab) =>
    tab.sessionId === active.id
      ? syncTabItemWithLiveState(tab, live)
      : tab,
  );
}
