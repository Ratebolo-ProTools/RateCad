/**
 * While multiline text is being edited, printable keys belong to that editor.
 * Toolbar fields inside the editor still receive their own input.
 * CAD command capture stays unchanged when this returns false.
 */

type FocusLike = {
  closest?: (selector: string) => unknown;
  tagName?: string;
};

export function mtextEditorClaimsKey(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return true;
  const el = target as FocusLike;
  const tag = el.tagName;
  const inToolbarField =
    (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') &&
    !!el.closest?.('.mtext-ribbon');
  return !inToolbarField;
}
