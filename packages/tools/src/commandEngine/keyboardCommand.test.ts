import { describe, expect, it } from 'vitest';
import { CommandBus } from '@ratecad/commands';
import { createEmptyDocument, setSelection } from '@ratecad/core';
import {
  CadCommandEngine,
  CommandUsageTracker,
  classifyIdleCommandInput,
  createDefaultEngineRegistry,
  editDistance,
  resolveKeyboardContextFromTarget,
  SelectionManager,
} from './index.js';

function makeEngine() {
  const bus = new CommandBus(createEmptyDocument('kb'));
  const cleared: string[] = [];
  const nl: string[] = [];
  const host = {
    getUnits: () => bus.getDocument().settings.units,
    getWorldUnit: () => bus.getDocument().settings.worldUnit ?? 'ft',
    getSelectedIds: () => bus.getDocument().selection,
    getCursor: () => ({ x: 0, y: 0 }),
    activateTool: () => undefined,
    activateSelect: () => undefined,
    clearSelection: () => {
      cleared.push('clear');
      bus.updateWithoutHistory((d) => setSelection(d, []));
    },
    onNaturalLanguage: (t: string) => nl.push(t),
  };
  const usage = new CommandUsageTracker();
  const engine = new CadCommandEngine(
    createDefaultEngineRegistry(),
    bus,
    host,
    usage,
  );
  return { engine, bus, cleared, nl, usage };
}

describe('suggestion ranking', () => {
  it('ranks exact alias M ahead of other M* commands', () => {
    const reg = createDefaultEngineRegistry();
    const rows = reg.suggestRanked('M');
    expect(rows[0]?.name).toBe('MOVE');
    expect(rows.some((r) => r.name === 'MIRROR')).toBe(true);
  });

  it('ranks MI as MIRROR', () => {
    const reg = createDefaultEngineRegistry();
    const rows = reg.suggestRanked('MI');
    expect(rows[0]?.name).toBe('MIRROR');
  });

  it('ranks CIR toward CIRCLE', () => {
    const reg = createDefaultEngineRegistry();
    const rows = reg.suggestRanked('CIR');
    expect(rows[0]?.name).toBe('CIRCLE');
  });

  it('C lists CIRCLE and COPY among matches', () => {
    const reg = createDefaultEngineRegistry();
    const rows = reg.suggestRanked('C');
    const names = rows.map((r) => r.name);
    expect(names).toContain('CIRCLE');
    expect(names).toContain('COPY');
  });

  it('does not auto-resolve ambiguous CIR without Enter on highlight', () => {
    const { engine } = makeEngine();
    engine.setBuffer('CIR');
    const ui = engine.getUiState();
    expect(ui.suggestionRows[0]?.name).toBe('CIRCLE');
    // confirm uses highlighted suggestion
    engine.confirm('enter');
    expect(engine.getUiState().commandName ?? engine.getStatusMessage()).toMatch(
      /CIRCLE|radius|center/i,
    );
  });

  it('typo CIRLCE suggests CIRCLE without executing', () => {
    const { engine } = makeEngine();
    const r = engine.start('CIRLCE');
    expect(r.ok).toBe(false);
    expect(engine.getUiState().message).toMatch(/Did you mean: CIRCLE/);
  });
});

describe('ESC state machine', () => {
  it('cancels running command first', () => {
    const { engine } = makeEngine();
    engine.start('M');
    expect(engine.isRunning()).toBe(true);
    const a = engine.handleEscape();
    expect(a.kind).toBe('cancel-command');
    expect(engine.isRunning()).toBe(false);
  });

  it('clears buffer then selection', () => {
    const { engine, bus, cleared } = makeEngine();
    bus.updateWithoutHistory((d) => setSelection(d, ['x']));
    engine.setBuffer('ABC');
    expect(engine.handleEscape().kind).toBe('clear-buffer');
    expect(engine.getBuffer()).toBe('');
    expect(engine.handleEscape().kind).toBe('clear-selection');
    expect(cleared.length).toBe(1);
  });
});

describe('input classifier', () => {
  it('keeps single letters as CAD tokens', () => {
    expect(classifyIdleCommandInput('M')).toEqual({
      kind: 'cad-token',
      token: 'M',
    });
  });

  it('routes sentences to natural language', () => {
    const c = classifyIdleCommandInput('make this wall 4 meters long');
    expect(c.kind).toBe('natural-language');
  });

  it('editDistance finds near typos', () => {
    expect(editDistance('CIRLCE', 'CIRCLE')).toBe(2);
  });
});

describe('keyboard context', () => {
  it('detects command input and text editor', () => {
    const cmd = {
      dataset: { cadCommand: '1' },
      closest: () => null,
      tagName: 'INPUT',
    };
    expect(resolveKeyboardContextFromTarget(cmd as unknown as EventTarget)).toBe(
      'command-input',
    );

    const text = {
      dataset: { cadTextEditor: '1' },
      closest: () => null,
      tagName: 'INPUT',
    };
    expect(
      resolveKeyboardContextFromTarget(text as unknown as EventTarget),
    ).toBe('text-editor');
  });
});

describe('SelectionManager', () => {
  it('select / toggle / clear', () => {
    const bus = new CommandBus(createEmptyDocument('sel'));
    const sm = new SelectionManager(bus);
    sm.select('a');
    expect(sm.selectedIds()).toEqual(['a']);
    sm.toggle('b');
    expect(sm.selectedIds().sort()).toEqual(['a', 'b']);
    sm.clear();
    expect(sm.selectedIds()).toEqual([]);
  });
});

describe('aliases', () => {
  it('resolves RateCAD alias table', () => {
    const reg = createDefaultEngineRegistry();
    const cases: Array<[string, string]> = [
      ['L', 'line'],
      ['PL', 'polyline'],
      ['C', 'circle'],
      ['REC', 'rectangle'],
      ['M', 'move'],
      ['CO', 'copy'],
      ['CP', 'copy'],
      ['MI', 'mirror'],
      ['RO', 'rotate'],
      ['SC', 'scale'],
      ['TR', 'trim'],
      ['EX', 'extend'],
      ['O', 'offset'],
      ['E', 'erase'],
      ['AA', 'area'],
    ];
    for (const [alias, id] of cases) {
      const r = reg.resolve(alias);
      expect(r.ok, alias).toBe(true);
      if (r.ok) expect(r.command.id).toBe(id);
    }
  });
});

describe('MOVE preselection', () => {
  it('skips select prompt when selection exists', () => {
    const { engine, bus } = makeEngine();
    bus.updateWithoutHistory((d) => setSelection(d, ['ent1']));
    engine.start('M');
    const ui = engine.getUiState();
    expect(ui.commandName).toBe('MOVE');
    expect(ui.prompt).toMatch(/base point/i);
  });
});

describe('usage boost', () => {
  it('boosts frequently used commands for shared prefix', () => {
    const usage = new CommandUsageTracker();
    usage.record('mirror');
    usage.record('mirror');
    usage.record('mirror');
    const reg = createDefaultEngineRegistry();
    // Empty buffer shows recent
    const idle = reg.suggestRanked('', { usage, limit: 5 });
    expect(idle[0]?.commandId).toBe('mirror');
  });
});
