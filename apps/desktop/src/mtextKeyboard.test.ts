import { describe, expect, it } from 'vitest';
import { mtextEditorClaimsKey } from './mtextKeyboard.js';

function element(tag: string, selectorMatch: string | null): EventTarget {
  return {
    tagName: tag,
    closest: (selector: string) => (selector === selectorMatch ? {} : null),
  } as unknown as EventTarget;
}

describe('mtext keyboard ownership', () => {
  it('claims keys from the CAD command input and the canvas', () => {
    expect(mtextEditorClaimsKey(element('INPUT', '[data-cad-command="1"]'))).toBe(true);
    expect(mtextEditorClaimsKey(element('CANVAS', 'canvas'))).toBe(true);
    expect(mtextEditorClaimsKey(null)).toBe(true);
  });

  it('leaves toolbar fields free so height and font entry still work', () => {
    expect(mtextEditorClaimsKey(element('INPUT', '.mtext-ribbon'))).toBe(false);
    expect(mtextEditorClaimsKey(element('SELECT', '.mtext-ribbon'))).toBe(false);
    expect(mtextEditorClaimsKey(element('TEXTAREA', '.mtext-ribbon'))).toBe(false);
  });

  it('still claims the editor text field and toolbar buttons', () => {
    expect(mtextEditorClaimsKey(element('INPUT', '.mtext-frame'))).toBe(true);
    expect(mtextEditorClaimsKey(element('BUTTON', '.mtext-ribbon'))).toBe(true);
  });
});
