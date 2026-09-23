import { describe, expect, it } from 'vitest';
import { parseAiFilletIntent, proposeAiFilletCommand } from '../src/index.js';

describe('AI FILLET intents', () => {
  it('parses radius and asks for picks when ambiguous', () => {
    const intent = parseAiFilletIntent('Round this corner with a 500 mm radius', 'mm', 'mm');
    expect(intent.kind).toBe('fillet');
    if (intent.kind === 'fillet') {
      expect(intent.radiusWorld).toBeCloseTo(500);
      expect(intent.needsObjectPick).toBe(true);
    }
  });

  it('detects fillet all corners', () => {
    const p = proposeAiFilletCommand('Fillet all corners of this rectangle with 200 mm', 'mm', 'mm');
    expect(p).not.toBeNull();
    expect(p!.polylineAll).toBe(true);
    expect(p!.commandAlias).toBe('FILLET');
  });

  it('detects sharp corner / remove fillet', () => {
    const intent = parseAiFilletIntent('Make this a sharp corner');
    expect(intent.kind).toBe('fillet');
    if (intent.kind === 'fillet') {
      expect(intent.sharpCorner).toBe(true);
      expect(intent.radiusWorld).toBe(0);
    }
  });

  it('ignores non-fillet language', () => {
    expect(parseAiFilletIntent('trim this line').kind).toBe('none');
  });
});
