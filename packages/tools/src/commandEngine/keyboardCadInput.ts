/**
 * Helpers for AutoCAD-style automatic command typing.
 * Keeps IME / modifier / printable rules out of App.tsx.
 */

/** True while an IME composition session is active (do not capture CAD keys). */
export function isImeCompositionEvent(event: {
  isComposing?: boolean;
  key?: string;
  keyCode?: number;
}): boolean {
  if (event.isComposing) return true;
  // Legacy browsers / some IMEs emit keyCode 229 or key "Process".
  if (event.key === 'Process') return true;
  if (event.keyCode === 229) return true;
  return false;
}

/**
 * Printable character that may begin / extend a CAD command token
 * (letters, digits, and coordinate punctuation). Excludes Space.
 */
export function isCadCommandChar(key: string): boolean {
  if (key.length !== 1) return false;
  return /^[a-z0-9_\-./\\@,<°]$/i.test(key);
}

/**
 * Whether window-level CAD capture should append a typed character.
 * Never captures with Ctrl/Meta/Alt, during IME, or inside text fields.
 */
export function shouldCaptureCadCommandChar(opts: {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  inEditableField: boolean;
  isComposing?: boolean;
  keyCode?: number;
}): boolean {
  if (opts.inEditableField) return false;
  if (opts.metaKey || opts.ctrlKey || opts.altKey) return false;
  if (
    isImeCompositionEvent({
      isComposing: opts.isComposing,
      key: opts.key,
      keyCode: opts.keyCode,
    })
  ) {
    return false;
  }
  return isCadCommandChar(opts.key);
}

/** Commands that must never be stored / repeated as "last command". */
const NON_REPEATABLE = new Set([
  'SAVE',
  'SAVEAS',
  'QSAVE',
  'OPEN',
  'NEW',
  'CLOSE',
  'CLOSEALL',
  'EXIT',
  'QUIT',
  'SAVEALL',
]);

export function isRepeatableCommandName(name: string | null | undefined): boolean {
  if (!name) return false;
  return !NON_REPEATABLE.has(name.trim().toUpperCase());
}
