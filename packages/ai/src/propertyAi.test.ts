import { describe, expect, it } from 'vitest';
import { parseAiPropertyIntent, proposeAiPropertyCommand } from './index.js';

describe('AI property intent', () => {
  it('distinguishes selection vs current color', () => {
    const sel = parseAiPropertyIntent('Make this line red');
    expect(sel.kind).toBe('chprop');
    if (sel.kind === 'chprop') {
      expect(sel.target).toBe('selection');
      expect(sel.changes?.color?.toLowerCase()).toBe('red');
    }

    const cur = parseAiPropertyIntent('Change the current line color to blue');
    expect(cur.kind).toBe('chprop');
    if (cur.kind === 'chprop') {
      expect(cur.target).toBe('current');
      expect(cur.changes?.color?.toLowerCase()).toBe('blue');
    }
  });

  it('parses SETBYLAYER and MATCHPROP', () => {
    expect(parseAiPropertyIntent('Set this wall to ByLayer').kind).toBe(
      'setbylayer',
    );
    expect(
      parseAiPropertyIntent('Copy the properties of this wall to these walls')
        .kind,
    ).toBe('matchprop');
  });

  it('parses lineweight and linetype', () => {
    const intent = parseAiPropertyIntent(
      'Make all selected lines 0.35 mm and dashed',
    );
    expect(intent.kind).toBe('chprop');
    if (intent.kind === 'chprop') {
      expect(intent.changes?.lineweightMm).toBe(0.35);
      expect(intent.changes?.linetype).toBe('Dashed');
    }
  });

  it('proposeAiPropertyCommand returns aliases', () => {
    const p = proposeAiPropertyCommand('Make this line red');
    expect(p?.commandAlias).toBe('CHPROP');
  });
});
