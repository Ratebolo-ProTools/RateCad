import { describe, expect, it } from 'vitest';
import { createDefaultEngineRegistry } from '../index.js';

describe('layout command stubs', () => {
  it('registers LAYOUT / MSPACE / PSPACE / MVIEW aliases', () => {
    const reg = createDefaultEngineRegistry();
    for (const alias of ['LAYOUT', 'MSPACE', 'MS', 'PSPACE', 'PS', 'MVIEW', 'MV']) {
      const r = reg.resolve(alias);
      expect(r.ok).toBe(true);
    }
  });

  it('returns not-implemented status for LAYOUT stub without faking behavior', () => {
    const reg = createDefaultEngineRegistry();
    const r = reg.resolve('LAYOUT');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const started = r.command.start({
      units: 'ft',
      worldUnit: 'ft',
      lastPoint: null,
      cursor: null,
      angleOverrideDeg: null,
      selectedIds: [],
    });
    expect(started.status?.toLowerCase()).toContain('not implemented');
  });

  it('MVIEW is a real command (not a stub)', () => {
    const reg = createDefaultEngineRegistry();
    const r = reg.resolve('MVIEW');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const started = r.command.start({
      units: 'ft',
      worldUnit: 'ft',
      lastPoint: null,
      cursor: null,
      angleOverrideDeg: null,
      selectedIds: [],
    });
    expect(started.status?.toLowerCase()).not.toContain('not implemented');
    expect(started.prompt.message.toLowerCase()).toContain('corner');
  });
});
