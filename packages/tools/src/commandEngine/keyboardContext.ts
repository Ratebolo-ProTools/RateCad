/**
 * Keyboard focus context — CAD command capture only when appropriate.
 */

export type KeyboardContext =
  | 'cad-canvas'
  | 'command-input'
  | 'text-editor'
  | 'property-input'
  | 'dialog'
  | 'search'
  | 'other';

/** True when typing should go to CAD command / option / numeric entry. */
export function isCadKeyboardCaptureContext(ctx: KeyboardContext): boolean {
  return ctx === 'cad-canvas' || ctx === 'command-input';
}

type FocusLike = {
  closest?: (selector: string) => unknown;
  dataset?: DOMStringMap | Record<string, string | undefined>;
  tagName?: string;
  isContentEditable?: boolean;
};

/**
 * Infer keyboard context from a DOM event target.
 * Text editors, property panels, dialogs, and non-CAD inputs win over CAD capture.
 */
export function resolveKeyboardContextFromTarget(
  target: EventTarget | null,
): KeyboardContext {
  if (!target || typeof target !== 'object') return 'cad-canvas';

  const el = target as FocusLike;
  if (el.closest?.('[data-cad-dialog="1"]')) return 'dialog';
  if (el.closest?.('[data-cad-text-editor="1"]')) return 'text-editor';
  if (el.closest?.('[data-cad-property="1"]')) return 'property-input';
  if (el.closest?.('[data-cad-search="1"]')) return 'search';
  if (
    el.dataset?.cadCommand === '1' ||
    el.closest?.('[data-cad-command="1"]')
  ) {
    return 'command-input';
  }
  if (el.dataset?.cadRectDim === '1') return 'property-input';
  if (el.dataset?.cadTextEditor === '1') return 'text-editor';

  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    return 'other';
  }
  if (el.isContentEditable) return 'text-editor';

  if (el.closest?.('canvas') || el.closest?.('[data-cad-canvas="1"]')) {
    return 'cad-canvas';
  }

  // Default: treat as CAD canvas when focus is on the app shell / document body
  return 'cad-canvas';
}

/** Should Space act as Enter for command confirm? */
export function spaceConfirmsCommand(ctx: KeyboardContext): boolean {
  return ctx === 'cad-canvas' || ctx === 'command-input';
}

/**
 * SPACE repeats the last completed command only in CAD capture contexts.
 * Must not fire while typing in text editors, property fields, dialogs, or other inputs.
 */
export function spaceRepeatsLastCommand(ctx: KeyboardContext): boolean {
  return ctx === 'cad-canvas';
}
