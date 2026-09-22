import { describe, expect, it } from 'vitest';
import {
  CadCommandRegistry,
  createDefaultCadCommandRegistry,
  defaultCadCommandRegistry,
  normalizeCommandInput,
} from './cadCommands.js';

describe('CadCommandRegistry', () => {
  it('resolves REC to Rectangle tool', () => {
    const result = defaultCadCommandRegistry.resolve('REC');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command.tool).toBe('rectangle');
      expect(result.command.name).toBe('Rectangle');
    }
  });

  it('resolves aliases case-insensitively', () => {
    expect(defaultCadCommandRegistry.resolve('rec').ok).toBe(true);
    expect(defaultCadCommandRegistry.resolve('l').ok).toBe(true);
    expect(defaultCadCommandRegistry.resolve('CO').ok).toBe(true);
    expect(defaultCadCommandRegistry.resolve('mi').ok).toBe(true);
  });

  it('rejects unknown commands safely', () => {
    const result = defaultCadCommandRegistry.resolve('XYZ');
    expect(result).toEqual({ ok: false, reason: 'unknown', input: 'XYZ' });
  });

  it('ignores empty commands', () => {
    expect(defaultCadCommandRegistry.resolve('')).toEqual({
      ok: false,
      reason: 'empty',
      input: '',
    });
    expect(defaultCadCommandRegistry.resolve('   ').reason).toBe('empty');
  });

  it('maps required aliases to existing tools', () => {
    const cases: Array<[string, string]> = [
      ['L', 'line'],
      ['REC', 'rectangle'],
      ['C', 'circle'],
      ['PL', 'polyline'],
      ['M', 'move'],
      ['CO', 'copy'],
      ['TR', 'trim'],
      ['EX', 'extend'],
      ['O', 'offset'],
      ['MI', 'mirror'],
      ['RO', 'rotate'],
      ['SC', 'scale'],
    ];
    for (const [alias, tool] of cases) {
      const r = defaultCadCommandRegistry.resolve(alias);
      expect(r.ok, alias).toBe(true);
      if (r.ok) expect(r.command.tool).toBe(tool);
    }
  });

  it('allows registering additional commands', () => {
    const registry = new CadCommandRegistry();
    registry.register({
      id: 'pan',
      name: 'Pan',
      aliases: ['P', 'PAN'],
      description: 'Pan view',
      tool: 'pan',
    });
    const r = registry.resolve('P');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.command.tool).toBe('pan');
  });

  it('normalizes command input', () => {
    expect(normalizeCommandInput('  rec ')).toBe('REC');
  });

  it('createDefaultCadCommandRegistry returns a fresh registry', () => {
    const a = createDefaultCadCommandRegistry();
    const b = createDefaultCadCommandRegistry();
    expect(a.resolve('REC').ok).toBe(true);
    expect(b.resolve('L').ok).toBe(true);
    expect(a).not.toBe(b);
  });
});
