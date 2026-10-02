/**
 * Focused AutoCAD-like command workflow tests (RateCAD requirement #1):
 * Selection Mode after ESC/complete, SPACE repeats last completed command.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { CommandBus } from '@ratecad/commands';
import {
  createEmptyDocument,
  resetIdCounter,
  setSelection,
} from '@ratecad/core';
import { CreateLineCommand } from '@ratecad/commands';
import {
  CadCommandEngine,
  createDefaultEngineRegistry,
  resolveKeyboardContextFromTarget,
  spaceRepeatsLastCommand,
} from './index.js';

function makeEngine() {
  const bus = new CommandBus(createEmptyDocument('workflow'));
  let tool = 'select';
  const selectCalls: string[] = [];
  const host = {
    getUnits: () => bus.getDocument().settings.units,
    getWorldUnit: () => bus.getDocument().settings.worldUnit ?? 'ft',
    getSelectedIds: () => bus.getDocument().selection,
    getCursor: () => ({ x: 10, y: 0 }),
    activateTool: (t: string) => {
      tool = t;
    },
    activateSelect: () => {
      tool = 'select';
      selectCalls.push('select');
    },
    clearSelection: () => {
      bus.updateWithoutHistory((d) => setSelection(d, []));
    },
  };
  const engine = new CadCommandEngine(createDefaultEngineRegistry(), bus, host);
  return { bus, engine, getTool: () => tool, selectCalls };
}

describe('AutoCAD workflow: ESC → Selection Mode', () => {
  beforeEach(() => resetIdCounter());

  it('ESC returns to Selection Mode after cancelling a running command', () => {
    const { engine, getTool, selectCalls } = makeEngine();
    engine.start('L');
    expect(engine.isRunning()).toBe(true);
    expect(getTool()).toBe('line');
    const action = engine.handleEscape();
    expect(action.kind).toBe('cancel-command');
    expect(engine.isRunning()).toBe(false);
    expect(getTool()).toBe('select');
    expect(selectCalls.length).toBeGreaterThan(0);
  });

  it('repeated ESC safely stays in Selection Mode', () => {
    const { engine, getTool } = makeEngine();
    engine.start('L');
    engine.handleEscape();
    expect(engine.handleEscape().kind).toBe('idle');
    expect(engine.handleEscape().kind).toBe('idle');
    expect(getTool()).toBe('select');
    expect(engine.isRunning()).toBe(false);
  });
});

describe('AutoCAD workflow: committed geometry survives ESC', () => {
  beforeEach(() => resetIdCounter());

  it('committed LINE segments survive ESC; preview session ends', () => {
    const { bus, engine, getTool } = makeEngine();
    engine.start('L');
    engine.submitPoint({ x: 0, y: 0 });
    engine.submitPoint({ x: 3, y: 0 }); // commits 3-unit segment
    expect(bus.getDocument().entities).toHaveLength(1);
    engine.onPointerMove({ x: 5, y: 2 });
    expect(engine.getUiState().preview?.kind).toBe('line');

    engine.handleEscape();

    expect(bus.getDocument().entities).toHaveLength(1);
    expect(engine.isRunning()).toBe(false);
    expect(engine.getUiState().preview).toBeNull();
    expect(getTool()).toBe('select');
    const line = bus.getDocument().entities[0]!;
    expect(line.type).toBe('line');
    if (line.type === 'line') {
      expect(line.geometry.end).toEqual({ x: 3, y: 0 });
    }
  });

  it('ESC cancels uncommitted preview without adding geometry', () => {
    const { bus, engine } = makeEngine();
    engine.start('L');
    engine.submitPoint({ x: 0, y: 0 });
    engine.onPointerMove({ x: 4, y: 1 });
    expect(engine.getUiState().preview?.kind).toBe('line');
    expect(bus.getDocument().entities).toHaveLength(0);

    engine.handleEscape();

    expect(bus.getDocument().entities).toHaveLength(0);
    expect(engine.getUiState().preview).toBeNull();
    expect(engine.isRunning()).toBe(false);
  });

  it('ESC does not undo already committed geometry (RECTANGLE)', () => {
    const { bus, engine } = makeEngine();
    engine.start('REC');
    engine.submitPoint({ x: 0, y: 0 });
    engine.submitPoint({ x: 4, y: 3 });
    expect(bus.getDocument().entities).toHaveLength(1);
    // After complete we are in select; ESC is idle/selection clear
    engine.handleEscape();
    expect(bus.getDocument().entities).toHaveLength(1);
  });
});

describe('AutoCAD workflow: SPACE repeats last completed command', () => {
  beforeEach(() => resetIdCounter());

  it('SPACE repeats LINE after draw + ESC', () => {
    const { bus, engine } = makeEngine();
    engine.start('L');
    engine.submitPoint({ x: 0, y: 0 });
    engine.submitPoint({ x: 3, y: 0 });
    engine.handleEscape();
    expect(engine.getLastCompletedName()).toBe('LINE');
    expect(engine.isRunning()).toBe(false);

    engine.confirm('space');
    expect(engine.isRunning()).toBe(true);
    expect(engine.getRunningCommand()?.name).toBe('LINE');

    engine.submitPoint({ x: 0, y: 1 });
    engine.submitPoint({ x: 2, y: 1 });
    engine.handleEscape();
    expect(bus.getDocument().entities.filter((e) => e.type === 'line')).toHaveLength(
      2,
    );

    engine.confirm('space');
    expect(engine.getRunningCommand()?.name).toBe('LINE');
  });

  it('SPACE does not repeat a cancelled command with no commits', () => {
    const { engine } = makeEngine();
    expect(engine.getLastCompletedName()).toBeNull();
    engine.start('L');
    engine.handleEscape();
    expect(engine.getLastCompletedName()).toBeNull();

    engine.confirm('space');
    expect(engine.isRunning()).toBe(false);
  });

  it('SPACE does not repeat unknown/invalid commands', () => {
    const { engine } = makeEngine();
    const r = engine.start('NOTACOMMAND');
    expect(r.ok).toBe(false);
    expect(engine.getLastCompletedName()).toBeNull();
    engine.confirm('space');
    expect(engine.isRunning()).toBe(false);
  });

  it('successful complete stores last command; ESC preserves it for SPACE', () => {
    const { engine } = makeEngine();
    engine.start('C');
    engine.submitPoint({ x: 0, y: 0 });
    engine.setBuffer('2');
    engine.confirm('enter');
    expect(engine.getLastCompletedName()).toBe('CIRCLE');
    engine.handleEscape();
    expect(engine.getLastCompletedName()).toBe('CIRCLE');
    engine.confirm('space');
    expect(engine.getRunningCommand()?.name).toBe('CIRCLE');
  });

  it('handoff MIRROR stores last command after commit + finalize', () => {
    const { bus, engine, getTool } = makeEngine();
    const line = new CreateLineCommand({ x: 0, y: 0 }, { x: 4, y: 0 });
    bus.execute(line);
    // Pretend handoff started then document mutated (mirror commit)
    engine.start('MI');
    expect(engine.hasPendingHandoff()).toBe(true);
    expect(engine.isRunning()).toBe(false);
    expect(getTool()).toBe('mirror');
    // Simulate tool commit on the bus
    bus.execute(new CreateLineCommand({ x: 0, y: 2 }, { x: 4, y: 2 }));
    expect(engine.finalizeHandoffIfCommitted()).toBe(true);
    expect(engine.getLastCompletedName()).toBe('MIRROR');
    expect(engine.hasPendingHandoff()).toBe(false);

    engine.handleEscape(); // selection mode
    engine.confirm('space');
    expect(engine.hasPendingHandoff()).toBe(true);
    expect(engine.getLastCompletedName()).toBe('MIRROR');
  });

  it('cancelled handoff without commit is not stored', () => {
    const { engine } = makeEngine();
    engine.start('MI');
    expect(engine.hasPendingHandoff()).toBe(true);
    engine.handleEscape();
    expect(engine.hasPendingHandoff()).toBe(false);
    expect(engine.getLastCompletedName()).toBeNull();
    engine.confirm('space');
    expect(engine.hasPendingHandoff()).toBe(false);
    expect(engine.isRunning()).toBe(false);
  });
});

describe('AutoCAD workflow: click after ESC selects (engine state)', () => {
  beforeEach(() => resetIdCounter());

  it('after ESC, engine is idle and select tool is active (no auto-restart)', () => {
    const { bus, engine, getTool } = makeEngine();
    const line = new CreateLineCommand({ x: 0, y: 0 }, { x: 5, y: 0 });
    bus.execute(line);
    engine.start('L');
    engine.submitPoint({ x: 1, y: 1 });
    engine.submitPoint({ x: 4, y: 1 });
    engine.handleEscape();

    expect(engine.isRunning()).toBe(false);
    expect(getTool()).toBe('select');
    expect(engine.getLastCompletedName()).toBe('LINE');
    // Clicking entities is select-tool responsibility; engine must not be awaiting points.
    expect(engine.getActivePrompt()).toBeNull();
  });
});

describe('AutoCAD workflow: SPACE ignores editable inputs', () => {
  it('spaceRepeatsLastCommand is false for text/property/dialog/inputs', () => {
    expect(spaceRepeatsLastCommand('cad-canvas')).toBe(true);
    expect(spaceRepeatsLastCommand('command-input')).toBe(false);
    expect(spaceRepeatsLastCommand('text-editor')).toBe(false);
    expect(spaceRepeatsLastCommand('property-input')).toBe(false);
    expect(spaceRepeatsLastCommand('dialog')).toBe(false);
    expect(spaceRepeatsLastCommand('search')).toBe(false);
    expect(spaceRepeatsLastCommand('other')).toBe(false);
  });

  it('resolveKeyboardContextFromTarget maps editable targets away from canvas', () => {
    const property = {
      dataset: { cadProperty: undefined },
      closest: (sel: string) => (sel.includes('property') ? {} : null),
      tagName: 'INPUT',
    };
    expect(
      resolveKeyboardContextFromTarget(property as unknown as EventTarget),
    ).toBe('property-input');

    const dialog = {
      closest: (sel: string) => (sel.includes('dialog') ? {} : null),
      tagName: 'DIV',
    };
    expect(
      resolveKeyboardContextFromTarget(dialog as unknown as EventTarget),
    ).toBe('dialog');

    const plainInput = {
      closest: () => null,
      tagName: 'INPUT',
      dataset: {},
    };
    expect(
      resolveKeyboardContextFromTarget(plainInput as unknown as EventTarget),
    ).toBe('other');
  });
});
