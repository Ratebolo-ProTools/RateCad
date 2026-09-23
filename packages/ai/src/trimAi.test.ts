import { describe, expect, it } from 'vitest';
import { parseAiTrimIntent, proposeAiTrimCommand } from '../src/index.js';

describe('AI TRIM intents', () => {
  it('detects trim and requires cutting edge when unspecified', () => {
    const intent = parseAiTrimIntent('Trim this line to the wall');
    expect(intent.kind).toBe('trim');
    if (intent.kind === 'trim') {
      expect(intent.needsCuttingEdge).toBe(false); // "to the wall" names boundary
      expect(intent.summary.length).toBeGreaterThan(0);
    }
  });

  it('does not guess a cutting edge when absent', () => {
    const proposal = proposeAiTrimCommand('Please trim these objects');
    expect(proposal).not.toBeNull();
    expect(proposal!.requireCuttingEdgePick).toBe(true);
    expect(proposal!.commandAlias).toBe('TRIM');
    expect(proposal!.summary.toLowerCase()).toMatch(/cutting edge/);
  });

  it('ignores non-trim language', () => {
    expect(parseAiTrimIntent('draw a circle').kind).toBe('none');
    expect(proposeAiTrimCommand('move selection')).toBeNull();
  });
});
