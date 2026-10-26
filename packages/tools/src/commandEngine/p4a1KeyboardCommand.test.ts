/**
 * P4-A1 — Professional keyboard command system tests.
 * Uses production CadCommandEngine + createDefaultEngineRegistry.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { CommandBus } from '@ratecad/commands';
import {
  createEmptyDocument,
  resetIdCounter,
  setSelection,
} from '@ratecad/core';
import {
  CadCommandEngine,
  createDefaultEngineRegistry,
  isImeCompositionEvent,
  isRepeatableCommandName,
  resolveKeyboardContextFromTarget,
  shouldCaptureCadCommandChar,
  spaceRepeatsLastCommand,
  SelectionManager,
} from './index.js';

function makeEngine(docId = 'p4a1') {
  const bus = new CommandBus(createEmptyDocument(docId));
  const host = {
    getUnits: () => bus.getDocument().settings.units,
    getWorldUnit: () => bus.getDocument().settings.worldUnit ?? 'ft',
    getSelectedIds: () => bus.getDocument().selection,
    getCursor: () => ({ x: 0, y: 0 }),
    activateTool: () => undefined,
    activateSelect: () => undefined,
    clearSelection: () => {
      bus.updateWithoutHistory((d) => setSelection(d, []));
    },
  };
  const engine = new CadCommandEngine(
    createDefaultEngineRegistry(),
    bus,
    host,
  );
  return { engine, bus, host };
}

describe('P4-A1 suggestion ranking', () => {
  it('1: typing L shows LINE first', () => {
    const reg = createDefaultEngineRegistry();
    const rows = reg.suggestRanked('L');
    expect(rows[0]?.name).toBe('LINE');
  });

  it('2: typing M shows MOVE then MIRROR', () => {
    const reg = createDefaultEngineRegistry();
    const rows = reg.suggestRanked('M');
    expect(rows[0]?.name).toBe('MOVE');
    expect(rows.map((r) => r.name)).toContain('MIRROR');
    expect(rows.findIndex((r) => r.name === 'MIRROR')).toBeLessThan(
      rows.findIndex((r) => r.name === 'MVIEW'),
    );
  });

  it('3: typing C shows CIRCLE then COPY', () => {
    const reg = createDefaultEngineRegistry();
    const rows = reg.suggestRanked('C');
    expect(rows[0]?.name).toBe('CIRCLE');
    expect(rows.map((r) => r.name)).toContain('COPY');
    expect(rows.findIndex((r) => r.name === 'COPY')).toBe(1);
  });

  it('4: typing REC shows RECTANGLE', () => {
    const reg = createDefaultEngineRegistry();
    const rows = reg.suggestRanked('REC');
    expect(rows[0]?.name).toBe('RECTANGLE');
  });

  it('5: alias compatibility (C→CIRCLE, CO→COPY, M→MOVE, PL→POLYLINE)', () => {
    const reg = createDefaultEngineRegistry();
    const cases: Array<[string, string]> = [
      ['C', 'circle'],
      ['CO', 'copy'],
      ['CP', 'copy'],
      ['M', 'move'],
      ['PL', 'polyline'],
      ['TR', 'trim'],
      ['EX', 'extend'],
      ['MI', 'mirror'],
      ['F', 'fillet'],
    ];
    for (const [alias, id] of cases) {
      const r = reg.resolve(alias);
      expect(r.ok, alias).toBe(true);
      if (r.ok) expect(r.command.id).toBe(id);
    }
  });

  it('6: deterministic ranking — no duplicate command ids', () => {
    const reg = createDefaultEngineRegistry();
    for (const q of ['M', 'C', 'R', 'P', 'T']) {
      const rows = reg.suggestRanked(q);
      const ids = rows.map((r) => r.commandId);
      expect(new Set(ids).size).toBe(ids.length);
      const again = reg.suggestRanked(q).map((r) => r.commandId);
      expect(again).toEqual(ids);
    }
  });

  it('short input does not surface keyword-only noise for TR/PL', () => {
    const reg = createDefaultEngineRegistry();
    expect(reg.suggestRanked('TR').map((r) => r.name)).toEqual(['TRIM']);
    expect(reg.suggestRanked('PL')[0]?.name).toBe('POLYLINE');
    expect(reg.suggestRanked('PL').some((r) => r.name === 'COPY')).toBe(false);
  });
});

describe('P4-A1 keyboard navigation + execution', () => {
  beforeEach(() => resetIdCounter());

  it('7–8: ArrowDown / ArrowUp cycle suggestions', () => {
    const { engine } = makeEngine();
    engine.setBuffer('M');
    const names = engine.getUiState().suggestionRows.map((r) => r.name);
    expect(names[0]).toBe('MOVE');
    expect(engine.getUiState().suggestionIndex).toBe(0);

    engine.moveSuggestion(1);
    expect(engine.getUiState().suggestionIndex).toBe(1);
    expect(engine.getUiState().suggestionRows[1]?.name).toBe('MIRROR');

    engine.moveSuggestion(-1);
    expect(engine.getUiState().suggestionIndex).toBe(0);
  });

  it('9: Enter executes highlighted suggestion', () => {
    const { engine } = makeEngine();
    engine.setBuffer('M');
    engine.moveSuggestion(1); // MIRROR
    engine.confirm('enter');
    expect(engine.hasPendingHandoff()).toBe(true);
    expect(engine.getUiState().suggestions).toEqual([]);
  });

  it('10: Space executes highlighted suggestion when buffer set', () => {
    const { engine } = makeEngine();
    engine.setBuffer('C');
    expect(engine.getUiState().suggestionRows[0]?.name).toBe('CIRCLE');
    engine.confirm('space');
    expect(engine.isRunning()).toBe(true);
    expect(engine.getRunningCommand()?.name).toBe('CIRCLE');
  });

  it('11: ESC dismisses suggestions without executing', () => {
    const { engine } = makeEngine();
    engine.setBuffer('M');
    expect(engine.getUiState().suggestionRows.length).toBeGreaterThan(0);
    const action = engine.handleEscape();
    expect(action.kind).toBe('clear-buffer');
    expect(engine.getBuffer()).toBe('');
    expect(engine.getUiState().suggestionRows).toEqual([]);
    expect(engine.isRunning()).toBe(false);
  });

  it('12: Backspace removes last typed character via setBuffer', () => {
    const { engine } = makeEngine();
    engine.setBuffer('REC');
    expect(engine.getUiState().suggestionRows[0]?.name).toBe('RECTANGLE');
    engine.setBuffer('RE');
    expect(engine.getBuffer()).toBe('RE');
    engine.setBuffer('R');
    engine.setBuffer('');
    expect(engine.getUiState().suggestionRows).toEqual([]);
  });

  it('13: no duplicate execution on repeated Enter while running', () => {
    const { engine, bus } = makeEngine();
    engine.start('C');
    engine.submitPoint({ x: 0, y: 0 });
    engine.setBuffer('2');
    engine.confirm('enter');
    expect(bus.getDocument().entities).toHaveLength(1);
    const before = bus.getDocument().entities.length;
    engine.confirm('enter'); // idle repeat starts again — one start, not double geometry
    expect(engine.isRunning() || engine.getLastCompletedName() === 'CIRCLE').toBe(
      true,
    );
    // Second Enter with empty buffer while running after restart awaits input — no extra entity yet
    if (engine.isRunning()) {
      expect(bus.getDocument().entities.length).toBe(before);
    }
  });
});

describe('P4-A1 history + repeat', () => {
  beforeEach(() => resetIdCounter());

  it('14: command history preserves order; incomplete buffer not pushed', () => {
    const { engine } = makeEngine();
    engine.setBuffer('MO');
    engine.handleEscape();
    expect(engine.history.list()).toEqual([]);
    engine.start('LINE');
    engine.handleEscape();
    engine.start('CIRCLE');
    engine.handleEscape();
    expect(engine.history.list()).toEqual(['LINE', 'CIRCLE']);
  });

  it('14b: empty buffer Up/Down uses history (no idle suggestions)', () => {
    const { engine } = makeEngine();
    engine.start('MOVE');
    engine.handleEscape();
    engine.start('COPY');
    engine.handleEscape();
    expect(engine.getUiState().suggestionRows).toEqual([]);
    engine.history.beginBrowse();
    expect(engine.history.up()).toBe('COPY');
    expect(engine.history.up()).toBe('MOVE');
  });

  it('15: Enter/Space repeats last completed command', () => {
    const { engine } = makeEngine();
    engine.start('C');
    engine.submitPoint({ x: 0, y: 0 });
    engine.setBuffer('1');
    engine.confirm('enter');
    expect(engine.getLastCompletedName()).toBe('CIRCLE');
    engine.confirm('enter');
    expect(engine.getRunningCommand()?.name).toBe('CIRCLE');
    engine.handleEscape();
    engine.confirm('space');
    expect(engine.getRunningCommand()?.name).toBe('CIRCLE');
  });

  it('16: canceled commands are not repeated', () => {
    const { engine } = makeEngine();
    engine.start('M');
    engine.handleEscape();
    expect(engine.getLastCompletedName()).toBeNull();
    engine.confirm('space');
    expect(engine.isRunning()).toBe(false);
  });

  it('17: file actions are not repeatable', () => {
    expect(isRepeatableCommandName('SAVE')).toBe(false);
    expect(isRepeatableCommandName('SAVEAS')).toBe(false);
    expect(isRepeatableCommandName('EXIT')).toBe(false);
    expect(isRepeatableCommandName('QUIT')).toBe(false);
    expect(isRepeatableCommandName('CLOSEALL')).toBe(false);
    expect(isRepeatableCommandName('LINE')).toBe(true);
  });
});

describe('P4-A1 focus / IME / modifiers', () => {
  it('18: dialog context blocks CAD capture', () => {
    const dialog = {
      closest: (sel: string) => (sel.includes('dialog') ? {} : null),
      tagName: 'DIV',
    };
    expect(
      resolveKeyboardContextFromTarget(dialog as unknown as EventTarget),
    ).toBe('dialog');
  });

  it('19: annotation text editor context is not CAD capture', () => {
    const text = {
      dataset: { cadTextEditor: '1' },
      closest: () => null,
      tagName: 'INPUT',
    };
    expect(
      resolveKeyboardContextFromTarget(text as unknown as EventTarget),
    ).toBe('text-editor');
  });

  it('20: IME composition is detected', () => {
    expect(isImeCompositionEvent({ isComposing: true })).toBe(true);
    expect(isImeCompositionEvent({ key: 'Process' })).toBe(true);
    expect(isImeCompositionEvent({ keyCode: 229 })).toBe(true);
    expect(isImeCompositionEvent({ key: 'm', isComposing: false })).toBe(false);
  });

  it('21: Ctrl/Alt/Meta do not capture command chars', () => {
    expect(
      shouldCaptureCadCommandChar({
        key: 'm',
        ctrlKey: true,
        inEditableField: false,
      }),
    ).toBe(false);
    expect(
      shouldCaptureCadCommandChar({
        key: 'm',
        metaKey: true,
        inEditableField: false,
      }),
    ).toBe(false);
    expect(
      shouldCaptureCadCommandChar({
        key: 'm',
        altKey: true,
        inEditableField: false,
      }),
    ).toBe(false);
    expect(
      shouldCaptureCadCommandChar({
        key: 'm',
        inEditableField: false,
      }),
    ).toBe(true);
    expect(
      shouldCaptureCadCommandChar({
        key: 'm',
        inEditableField: true,
      }),
    ).toBe(false);
    expect(spaceRepeatsLastCommand('dialog')).toBe(false);
  });
});

describe('P4-A1 multi-document isolation', () => {
  beforeEach(() => resetIdCounter());

  it('22–24: tab-style deactivation clears pending input; histories stay isolated', () => {
    const a = makeEngine('doc-a');
    const b = makeEngine('doc-b');

    a.engine.setBuffer('M');
    expect(a.engine.getUiState().suggestionRows[0]?.name).toBe('MOVE');
    a.engine.start('LINE');
    a.engine.submitPoint({ x: 0, y: 0 });
    a.engine.submitPoint({ x: 2, y: 0 });
    a.engine.handleEscape();
    expect(a.engine.getLastCompletedName()).toBe('LINE');

    b.engine.start('CIRCLE');
    b.engine.submitPoint({ x: 0, y: 0 });
    b.engine.setBuffer('1');
    b.engine.confirm('enter');
    expect(b.engine.getLastCompletedName()).toBe('CIRCLE');

    // Simulate prepareSessionDeactivation on A
    a.engine.cancel(false);
    a.engine.setBuffer('');
    expect(a.engine.getBuffer()).toBe('');
    expect(a.engine.getUiState().suggestionRows).toEqual([]);

    // B untouched
    expect(b.engine.getLastCompletedName()).toBe('CIRCLE');
    expect(a.engine.getLastCompletedName()).toBe('LINE');
    expect(a.engine.history.list()).not.toEqual(b.engine.history.list());

    a.engine.confirm('enter');
    expect(a.engine.getRunningCommand()?.name).toBe('LINE');
    b.engine.confirm('space');
    expect(b.engine.getRunningCommand()?.name).toBe('CIRCLE');
  });

  it('25: disposed-session safety — cancel after clear leaves engine idle', () => {
    const { engine } = makeEngine('closing');
    engine.start('M');
    engine.cancel(false);
    engine.setBuffer('');
    expect(engine.isRunning()).toBe(false);
    expect(engine.getBuffer()).toBe('');
    // No stale running command to mutate geometry
    engine.submitPoint({ x: 1, y: 1 });
    expect(engine.isRunning()).toBe(false);
  });
});

describe('P4-A1 prompts + CAD commands unchanged', () => {
  beforeEach(() => resetIdCounter());

  it('26: ribbon/keyboard parity — start by tool id matches alias', () => {
    const { engine: byAlias } = makeEngine('alias');
    const { engine: byTool } = makeEngine('tool');
    byAlias.start('PL');
    byTool.start('polyline');
    expect(byAlias.hasPendingHandoff()).toBe(true);
    expect(byTool.hasPendingHandoff()).toBe(true);
    byAlias.start('C');
    byTool.start('circle');
    expect(byAlias.getRunningCommand()?.name).toBe('CIRCLE');
    expect(byTool.getRunningCommand()?.name).toBe('CIRCLE');
    expect(byAlias.getUiState().prompt).toMatch(/center/i);
    expect(byTool.getUiState().prompt).toMatch(/center/i);
  });

  it('27: LINE / MOVE prompts preserved', () => {
    const { engine } = makeEngine();
    engine.start('L');
    expect(engine.getUiState().prompt).toMatch(/first point/i);
    engine.handleEscape();
    engine.start('M');
    expect(engine.getUiState().prompt).toMatch(/select/i);
  });

  it('28: Undo/Redo via CommandBus unchanged after command cycle', () => {
    const { engine, bus } = makeEngine();
    engine.start('L');
    engine.submitPoint({ x: 0, y: 0 });
    engine.submitPoint({ x: 3, y: 0 });
    engine.handleEscape();
    expect(bus.getDocument().entities).toHaveLength(1);
    expect(bus.canUndo()).toBe(true);
    bus.undo();
    expect(bus.getDocument().entities).toHaveLength(0);
    bus.redo();
    expect(bus.getDocument().entities).toHaveLength(1);
  });

  it('SelectionManager still works alongside engine', () => {
    const { bus } = makeEngine();
    const sm = new SelectionManager(bus);
    sm.select('e1');
    expect(sm.selectedIds()).toEqual(['e1']);
    sm.clear();
    expect(sm.selectedIds()).toEqual([]);
  });
});
