/**
 * P3-B4A — session-aware multi-document file operations.
 *
 * Pure helpers for file identity, open/save transactions, duplicate
 * detection, and Save As collision checks. App remains the I/O bridge
 * to Electron / browser APIs.
 */

import { tryParseDocument } from '@ratecad/io';
import type { DrawingDocument } from '@ratecad/core';
import {
  clearSessionDirty,
  getSessionDocument,
  getSessionTitle,
  markSessionDirty,
  persistedContentFingerprint,
  setSessionFilePath,
  withDirtySuppressed,
  type DocumentSession,
  type DocumentSessionId,
} from './documentSession.js';
import {
  listSessions,
  type DocumentSessionStore,
} from './documentSessionStore.js';

/** Platform hint for path normalization (Electron `process.platform`). */
export type FileOpsPlatform = 'win32' | 'darwin' | 'linux' | 'browser' | string;

/**
 * Browser file picks often expose only a bare filename. That is not a
 * reliable unique identity across folders — do not merge sessions on it.
 */
export function isReliableFileIdentity(
  path: string | null | undefined,
): boolean {
  if (path == null) return false;
  const trimmed = path.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('/') || trimmed.startsWith('\\\\')) return true;
  if (/^[A-Za-z]:[\\/]/.test(trimmed)) return true;
  // UNC without leading backslash already handled; reject bare names.
  return false;
}

/**
 * Normalize a filesystem path for identity comparison.
 * Windows / macOS comparisons are case-insensitive; Linux is sensitive.
 */
export function normalizeFileIdentity(
  path: string,
  platform: FileOpsPlatform = 'linux',
): string {
  let p = path.trim().replace(/\\/g, '/');
  // Preserve UNC prefix //server/share
  if (p.startsWith('//')) {
    p = '//' + p.slice(2).replace(/\/+/g, '/');
  } else {
    p = p.replace(/\/+/g, '/');
  }
  if (/^[A-Za-z]:\//.test(p)) {
    p = p[0]!.toLowerCase() + p.slice(1);
  }
  if (platform === 'win32' || platform === 'darwin') {
    return p.toLowerCase();
  }
  return p;
}

export function fileIdentitiesEqual(
  a: string | null | undefined,
  b: string | null | undefined,
  platform: FileOpsPlatform = 'linux',
): boolean {
  if (!isReliableFileIdentity(a) || !isReliableFileIdentity(b)) return false;
  return (
    normalizeFileIdentity(a!, platform) ===
    normalizeFileIdentity(b!, platform)
  );
}

export function findSessionByFileIdentity(
  store: DocumentSessionStore,
  path: string | null | undefined,
  platform: FileOpsPlatform = 'linux',
): DocumentSession | undefined {
  if (!isReliableFileIdentity(path)) return undefined;
  const needle = normalizeFileIdentity(path!, platform);
  return listSessions(store).find(
    (s) =>
      isReliableFileIdentity(s.filePath) &&
      normalizeFileIdentity(s.filePath!, platform) === needle,
  );
}

/**
 * Save As must not overwrite a path already open in a *different* session.
 */
export function findSaveAsCollision(
  store: DocumentSessionStore,
  targetPath: string,
  excludeSessionId: DocumentSessionId,
  platform: FileOpsPlatform = 'linux',
): DocumentSession | undefined {
  if (!isReliableFileIdentity(targetPath)) return undefined;
  const hit = findSessionByFileIdentity(store, targetPath, platform);
  if (!hit || hit.id === excludeSessionId) return undefined;
  return hit;
}

export function describeSaveAsCollision(conflict: DocumentSession): string {
  const title = getSessionTitle(conflict);
  return `Cannot Save As: file is already open in another tab (${title})`;
}

export type ParseDrawingResult =
  | { ok: true; document: DrawingDocument }
  | { ok: false; error: string };

export function parseDrawingContents(contents: string): ParseDrawingResult {
  const parsed = tryParseDocument(contents);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }
  return { ok: true, document: parsed.document };
}

export type OpenResolved =
  | { kind: 'activate-existing'; session: DocumentSession }
  | { kind: 'open-new'; document: DrawingDocument; filePath: string | null }
  | { kind: 'invalid'; error: string };

/**
 * Resolve Open / Recent before mutating the store.
 * Validates contents first; never registers a session for invalid data.
 */
export function resolveOpenRequest(
  store: DocumentSessionStore,
  contents: string,
  filePath: string | null | undefined,
  platform: FileOpsPlatform = 'linux',
): OpenResolved {
  const parsed = parseDrawingContents(contents);
  if (!parsed.ok) return { kind: 'invalid', error: parsed.error };

  const existing = findSessionByFileIdentity(store, filePath, platform);
  if (existing) {
    return { kind: 'activate-existing', session: existing };
  }
  return {
    kind: 'open-new',
    document: parsed.document,
    filePath: filePath?.trim() ? filePath.trim() : null,
  };
}

export type SaveTransaction = {
  sessionId: DocumentSessionId;
  fingerprintAtStart: string;
  filePathAtStart: string | null;
  forceDialog: boolean;
  defaultName: string;
};

export function beginSaveTransaction(
  session: DocumentSession,
  forceDialog: boolean,
): SaveTransaction {
  const doc = getSessionDocument(session);
  const name = doc.meta.name || 'Untitled';
  return {
    sessionId: session.id,
    fingerprintAtStart: persistedContentFingerprint(doc),
    filePathAtStart: session.filePath,
    forceDialog,
    defaultName: `${name}.ratecad`,
  };
}

/**
 * After a successful write: update path + title on the *target* session.
 * Clear dirty only when the document content still matches what was saved
 * (edits during the async save keep the tab dirty).
 */
export function applySuccessfulSaveToSession(
  session: DocumentSession,
  savedPath: string,
  fingerprintWhenSerialized: string,
  options: { updateDocumentName?: boolean } = {},
): { clearedDirty: boolean; title: string } {
  const updateName = options.updateDocumentName !== false;
  const stillSame =
    persistedContentFingerprint(getSessionDocument(session)) ===
    fingerprintWhenSerialized;

  if (updateName) {
    const name = basenamePath(savedPath).replace(/\.ratecad$/i, '') || 'Untitled';
    withDirtySuppressed(session, () => {
      session.bus.updateWithoutHistory((d) => ({
        ...d,
        meta: {
          ...d.meta,
          name,
          updatedAt: new Date().toISOString(),
        },
      }));
    });
  }

  setSessionFilePath(session, savedPath);

  if (stillSame) {
    clearSessionDirty(session);
    return { clearedDirty: true, title: getSessionTitle(session) };
  }
  markSessionDirty(session);
  return { clearedDirty: false, title: getSessionTitle(session) };
}

export function basenamePath(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || filePath;
}

/** Detect Electron vs browser for capability messaging. */
export function resolveFileOpsPlatform(
  ratecadDesktop: { platform?: string } | null | undefined,
): FileOpsPlatform {
  if (!ratecadDesktop) return 'browser';
  return ratecadDesktop.platform || 'linux';
}

export function sessionHasReliablePath(session: DocumentSession): boolean {
  return isReliableFileIdentity(session.filePath);
}

/**
 * Whether Save can write without a Save As dialog (Electron path present).
 * Browser bare download names are not treated as writable identities.
 */
export function canQuickSaveToExistingPath(
  session: DocumentSession,
  platform: FileOpsPlatform,
): boolean {
  if (!session.filePath) return false;
  if (platform === 'browser') {
    // Browser "save" previously used download filename as identity — not a
    // real writable path. Force Save As / download each time unless Electron.
    return false;
  }
  return isReliableFileIdentity(session.filePath);
}
