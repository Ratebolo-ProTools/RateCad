/**
 * P3-B1 — lightweight DocumentSession manager.
 *
 * Supports create/register/get/active/list/setActive/remove/dispose.
 * P3-B3B wires App tab create/switch against this store.
 */

import {
  createDocumentSession,
  disposeDocumentSession,
  type CreateDocumentSessionOptions,
  type DocumentSession,
  type DocumentSessionId,
} from './documentSession.js';

export type DocumentSessionStore = {
  readonly sessions: Map<DocumentSessionId, DocumentSession>;
  activeSessionId: DocumentSessionId | null;
};

export function createDocumentSessionStore(): DocumentSessionStore {
  return {
    sessions: new Map(),
    activeSessionId: null,
  };
}

export function createAndRegisterSession(
  store: DocumentSessionStore,
  options?: CreateDocumentSessionOptions,
): DocumentSession {
  const session = createDocumentSession(options);
  registerSession(store, session);
  if (store.activeSessionId == null) {
    store.activeSessionId = session.id;
  }
  return session;
}

export function registerSession(
  store: DocumentSessionStore,
  session: DocumentSession,
): void {
  if (session.disposed) {
    throw new Error('Cannot register a disposed DocumentSession');
  }
  store.sessions.set(session.id, session);
}

export function getSession(
  store: DocumentSessionStore,
  id: DocumentSessionId,
): DocumentSession | undefined {
  return store.sessions.get(id);
}

export function getActiveSession(
  store: DocumentSessionStore,
): DocumentSession | undefined {
  if (store.activeSessionId == null) return undefined;
  return store.sessions.get(store.activeSessionId);
}

export function listSessions(store: DocumentSessionStore): DocumentSession[] {
  return [...store.sessions.values()];
}

export function setActiveSession(
  store: DocumentSessionStore,
  id: DocumentSessionId,
): DocumentSession {
  const session = store.sessions.get(id);
  if (!session || session.disposed) {
    throw new Error(`DocumentSession not found: ${id}`);
  }
  store.activeSessionId = id;
  return session;
}

/**
 * Remove a session from the store and dispose its resources.
 * If it was active, activates `preferredNextId` when still present,
 * otherwise the first remaining session (if any).
 */
export function removeSession(
  store: DocumentSessionStore,
  id: DocumentSessionId,
  options?: { preferredNextId?: DocumentSessionId | null },
): boolean {
  const session = store.sessions.get(id);
  if (!session) return false;
  store.sessions.delete(id);
  disposeDocumentSession(session);
  if (store.activeSessionId === id) {
    const preferred = options?.preferredNextId;
    if (preferred && store.sessions.has(preferred)) {
      store.activeSessionId = preferred;
    } else {
      const next = store.sessions.keys().next();
      store.activeSessionId = next.done ? null : next.value;
    }
  }
  return true;
}

/** Dispose and clear every session (e.g. tests / app teardown). */
export function disposeAllSessions(store: DocumentSessionStore): void {
  for (const id of [...store.sessions.keys()]) {
    removeSession(store, id);
  }
  store.activeSessionId = null;
}
