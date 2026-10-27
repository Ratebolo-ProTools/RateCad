/**
 * P4-B4 — TRIM / EXTEND interaction parity tests.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import {
  createEmptyDocument,
  getEntity,
  resetIdCounter,
} from '@ratecad/core';
import {
  CommandBus,
  CreateLineCommand,
} from '@ratecad/commands';
import {
  CadCommandEngine,
  createDefaultEngineRegistry,
} from '../index.js';
import type { EngineHost } from '../engine.js';

function host(bus: CommandBus): EngineHost {
  return {
    getUnits: () => bus.getDocument().settings.units,
    getWorldUnit: () => bus.getDocument().settings.worldUnit,
    getSelectedIds: () => bus.getDocument().selection,
    getCursor: () => null,
    activateTool: () => {},
    activateSelect: () => {},
  };
}

function makeEngine(bus: CommandBus) {
  return new CadCommandEngine(createDefaultEngineRegistry(), bus, host(bus));
}

describe('P4-B4 TRIM/EXTEND interaction', () => {
  beforeEach(() => resetIdCounter());

  it('1: TRIM Quick Mode (default)', () => {
    const bus = new CommandBus(createEmptyDocument());
    bus.execute(new CreateLineCommand({ x: 5, y: -1 }, { x: 5, y: 1 }));
    const target = new CreateLineCommand({ x: 0, y: 0 }, { x: 10, y: 0 });
    bus.execute(target);
    const engine = makeEngine(bus);
    engine.start('TRIM');
    expect(engine.getUiState().prompt.toLowerCase()).toMatch(/object to trim/);
    expect(engine.getStatusMessage()?.toUpperCase()).toMatch(/QUICK/);
    engine.submitPoint({ x: 8, y: 0 });
    const after = getEntity(bus.getDocument(), target.getEntityId());
    if (after?.type === 'line') expect(after.geometry.end.x).toBeCloseTo(5);
  });

  it('2: EXTEND Quick Mode (default)', () => {
    const bus = new CommandBus(createEmptyDocument());
    bus.execute(new CreateLineCommand({ x: 6, y: -1 }, { x: 6, y: 1 }));
    const target = new CreateLineCommand({ x: 0, y: 0 }, { x: 2, y: 0 });
    bus.execute(target);
    const engine = makeEngine(bus);
    engine.start('EXTEND');
    expect(engine.getStatusMessage()?.toUpperCase()).toMatch(/QUICK/);
    engine.submitPoint({ x: 2, y: 0 });
    const after = getEntity(bus.getDocument(), target.getEntityId());
    if (after?.type === 'line') expect(after.geometry.end.x).toBeCloseTo(6);
  });

  it('3: TRIM Standard Mode cutting edges then trim', () => {
    const bus = new CommandBus(createEmptyDocument());
    const cutter = new CreateLineCommand({ x: 4, y: -1 }, { x: 4, y: 1 });
    bus.execute(cutter);
    const target = new CreateLineCommand({ x: 0, y: 0 }, { x: 10, y: 0 });
    bus.execute(target);
    const engine = makeEngine(bus);
    engine.start('TRIM');
    engine.submitText('mode');
    engine.submitText('standard');
    expect(engine.getUiState().prompt.toLowerCase()).toMatch(/cutting/);
    expect(engine.isAwaitingSelection()).toBe(true);
    bus.updateWithoutHistory((d) => ({
      ...d,
      selection: [cutter.getEntityId()],
    }));
    engine.submitText('');
    engine.submitPoint({ x: 8, y: 0 });
    const after = getEntity(bus.getDocument(), target.getEntityId());
    if (after?.type === 'line') expect(after.geometry.end.x).toBeCloseTo(4);
  });

  it('4: EXTEND Standard Mode boundary then extend', () => {
    const bus = new CommandBus(createEmptyDocument());
    const boundary = new CreateLineCommand({ x: 7, y: -1 }, { x: 7, y: 1 });
    bus.execute(boundary);
    const target = new CreateLineCommand({ x: 0, y: 0 }, { x: 2, y: 0 });
    bus.execute(target);
    const engine = makeEngine(bus);
    engine.start('EXTEND');
    engine.submitText('mode');
    engine.submitText('standard');
    expect(engine.getUiState().prompt.toLowerCase()).toMatch(/boundary/);
    expect(engine.isAwaitingSelection()).toBe(true);
    bus.updateWithoutHistory((d) => ({
      ...d,
      selection: [boundary.getEntityId()],
    }));
    engine.submitText('');
    engine.submitPoint({ x: 2, y: 0 });
    const after = getEntity(bus.getDocument(), target.getEntityId());
    if (after?.type === 'line') expect(after.geometry.end.x).toBeCloseTo(7);
  });

  it('5: TRIM Fence regression', () => {
    const bus = new CommandBus(createEmptyDocument());
    bus.execute(new CreateLineCommand({ x: 5, y: -2 }, { x: 5, y: 6 }));
    const a = new CreateLineCommand({ x: 0, y: 0 }, { x: 10, y: 0 });
    const b = new CreateLineCommand({ x: 0, y: 2 }, { x: 10, y: 2 });
    bus.execute(a);
    bus.execute(b);
    const engine = makeEngine(bus);
    engine.start('TRIM');
    engine.submitText('fence');
    engine.submitPoint({ x: 8, y: -1 });
    engine.submitPoint({ x: 8, y: 3 });
    engine.submitText('');
    const la = getEntity(bus.getDocument(), a.getEntityId());
    const lb = getEntity(bus.getDocument(), b.getEntityId());
    if (la?.type === 'line') expect(la.geometry.end.x).toBeCloseTo(5);
    if (lb?.type === 'line') expect(lb.geometry.end.x).toBeCloseTo(5);
  });

  it('6: EXTEND Fence', () => {
    const bus = new CommandBus(createEmptyDocument());
    bus.execute(new CreateLineCommand({ x: 6, y: -3 }, { x: 6, y: 5 }));
    const a = new CreateLineCommand({ x: 0, y: 0 }, { x: 2, y: 0 });
    const b = new CreateLineCommand({ x: 0, y: 2 }, { x: 2, y: 2 });
    bus.execute(a);
    bus.execute(b);
    const engine = makeEngine(bus);
    engine.start('EXTEND');
    engine.submitText('fence');
    engine.submitPoint({ x: 1.5, y: -1 });
    engine.submitPoint({ x: 1.5, y: 3 });
    engine.submitText('');
    const la = getEntity(bus.getDocument(), a.getEntityId());
    const lb = getEntity(bus.getDocument(), b.getEntityId());
    if (la?.type === 'line') expect(la.geometry.end.x).toBeCloseTo(6);
    if (lb?.type === 'line') expect(lb.geometry.end.x).toBeCloseTo(6);
  });

  it('7/8: TRIM Crossing regression + EXTEND Crossing', () => {
    const bus = new CommandBus(createEmptyDocument());
    bus.execute(new CreateLineCommand({ x: 5, y: -2 }, { x: 5, y: 4 }));
    const target = new CreateLineCommand({ x: 0, y: 0 }, { x: 10, y: 0 });
    bus.execute(target);
    const engine = makeEngine(bus);
    engine.start('TRIM');
    engine.submitText('crossing');
    engine.submitPoint({ x: 6, y: -1 });
    engine.submitPoint({ x: 9, y: 1 });
    const afterTrim = getEntity(bus.getDocument(), target.getEntityId());
    if (afterTrim?.type === 'line') {
      expect(afterTrim.geometry.end.x).toBeCloseTo(5);
    }

    const bus2 = new CommandBus(createEmptyDocument());
    bus2.execute(new CreateLineCommand({ x: 8, y: -2 }, { x: 8, y: 2 }));
    const short = new CreateLineCommand({ x: 0, y: 0 }, { x: 3, y: 0 });
    bus2.execute(short);
    const eng2 = makeEngine(bus2);
    eng2.start('EXTEND');
    eng2.submitText('crossing');
    eng2.submitPoint({ x: -1, y: -1 });
    eng2.submitPoint({ x: 4, y: 1 });
    const afterExt = getEntity(bus2.getDocument(), short.getEntityId());
    if (afterExt?.type === 'line') {
      expect(afterExt.geometry.end.x).toBeCloseTo(8);
    }
  });

  it('9: Mode switching resets incomplete selection', () => {
    const bus = new CommandBus(createEmptyDocument());
    const engine = makeEngine(bus);
    engine.start('EXTEND');
    engine.submitText('mode');
    engine.submitText('standard');
    expect(engine.getUiState().prompt.toLowerCase()).toMatch(/boundary/);
    engine.submitText('mode');
    engine.submitText('quick');
    expect(engine.getStatusMessage()?.toUpperCase()).toMatch(/QUICK/);
    expect(engine.getUiState().prompt.toLowerCase()).toMatch(/object to extend/);
  });

  it('10: Boundary highlighting state (Standard mode selection)', () => {
    const bus = new CommandBus(createEmptyDocument());
    const boundary = new CreateLineCommand({ x: 7, y: -1 }, { x: 7, y: 1 });
    bus.execute(boundary);
    bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 2, y: 0 }));
    const engine = makeEngine(bus);
    engine.start('EXTEND');
    engine.submitText('mode');
    engine.submitText('standard');
    expect(engine.isAwaitingSelection()).toBe(true);
    // Live UI selects via SelectionManager while prompt.inputType === 'entities'.
    bus.updateWithoutHistory((d) => ({
      ...d,
      selection: [boundary.getEntityId()],
    }));
    expect(bus.getDocument().selection).toContain(boundary.getEntityId());
    engine.submitText(''); // confirm boundaries
    expect(engine.getUiState().prompt.toLowerCase()).toMatch(/object to extend/);
    engine.submitText('mode');
    engine.submitText('quick');
    expect(bus.getDocument().selection).toEqual([]);
  });

  it('11/12: Hover preview / preview-commit consistency via onMove', () => {
    const bus = new CommandBus(createEmptyDocument());
    bus.execute(new CreateLineCommand({ x: 5, y: -1 }, { x: 5, y: 1 }));
    bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 2, y: 0 }));
    const engine = makeEngine(bus);
    engine.start('EXTEND');
    engine.onPointerMove({ x: 2, y: 0 });
    const ui = engine.getUiState();
    expect(ui.previewEntities?.length ?? 0).toBeGreaterThan(0);
    expect(ui.hideEntityIds?.length ?? 0).toBeGreaterThan(0);
  });

  it('13: Invalid hover clears misleading preview', () => {
    const bus = new CommandBus(createEmptyDocument());
    bus.execute(new CreateLineCommand({ x: 0, y: 2 }, { x: 5, y: 2 }));
    bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 4, y: 0 }));
    const engine = makeEngine(bus);
    engine.start('EXTEND');
    engine.onPointerMove({ x: 4, y: 0 }); // parallel — no preview
    const ui = engine.getUiState();
    expect(ui.previewEntities == null || ui.previewEntities.length === 0).toBe(
      true,
    );
  });

  it('14: Shift during TRIM performs EXTEND', () => {
    const bus = new CommandBus(createEmptyDocument());
    bus.execute(new CreateLineCommand({ x: 6, y: -1 }, { x: 6, y: 1 }));
    const target = new CreateLineCommand({ x: 0, y: 0 }, { x: 2, y: 0 });
    bus.execute(target);
    const engine = makeEngine(bus);
    engine.start('TRIM');
    engine.submitPoint({ x: 2, y: 0 }, { shiftKey: true });
    const after = getEntity(bus.getDocument(), target.getEntityId());
    if (after?.type === 'line') expect(after.geometry.end.x).toBeCloseTo(6);
    expect(engine.isRunning()).toBe(true);
    expect(engine.getUiState().commandName).toBe('TRIM');
  });

  it('15: Shift during EXTEND performs TRIM', () => {
    const bus = new CommandBus(createEmptyDocument());
    bus.execute(new CreateLineCommand({ x: 4, y: -1 }, { x: 4, y: 1 }));
    const target = new CreateLineCommand({ x: 0, y: 0 }, { x: 10, y: 0 });
    bus.execute(target);
    const engine = makeEngine(bus);
    engine.start('EXTEND');
    engine.submitPoint({ x: 8, y: 0 }, { shiftKey: true });
    const after = getEntity(bus.getDocument(), target.getEntityId());
    if (after?.type === 'line') expect(after.geometry.end.x).toBeCloseTo(4);
    expect(engine.getUiState().commandName).toBe('EXTEND');
  });

  it('16: In-command Undo for TRIM', () => {
    const bus = new CommandBus(createEmptyDocument());
    bus.execute(new CreateLineCommand({ x: 5, y: -1 }, { x: 5, y: 1 }));
    const target = new CreateLineCommand({ x: 0, y: 0 }, { x: 10, y: 0 });
    bus.execute(target);
    const engine = makeEngine(bus);
    engine.start('TRIM');
    engine.submitPoint({ x: 8, y: 0 });
    engine.submitText('undo');
    const after = getEntity(bus.getDocument(), target.getEntityId());
    if (after?.type === 'line') expect(after.geometry.end.x).toBeCloseTo(10);
    expect(engine.isRunning()).toBe(true);
  });

  it('17: In-command Undo for EXTEND', () => {
    const bus = new CommandBus(createEmptyDocument());
    bus.execute(new CreateLineCommand({ x: 6, y: -1 }, { x: 6, y: 1 }));
    const target = new CreateLineCommand({ x: 0, y: 0 }, { x: 2, y: 0 });
    bus.execute(target);
    const engine = makeEngine(bus);
    engine.start('EXTEND');
    engine.submitPoint({ x: 2, y: 0 });
    engine.submitText('undo');
    const after = getEntity(bus.getDocument(), target.getEntityId());
    if (after?.type === 'line') expect(after.geometry.end.x).toBeCloseTo(2);
    expect(engine.isRunning()).toBe(true);
  });

  it('18: Consecutive operations stay in command', () => {
    const bus = new CommandBus(createEmptyDocument());
    bus.execute(new CreateLineCommand({ x: 5, y: -2 }, { x: 5, y: 4 }));
    const a = new CreateLineCommand({ x: 0, y: 0 }, { x: 2, y: 0 });
    const b = new CreateLineCommand({ x: 0, y: 2 }, { x: 2, y: 2 });
    bus.execute(a);
    bus.execute(b);
    const engine = makeEngine(bus);
    engine.start('EXTEND');
    engine.submitPoint({ x: 2, y: 0 });
    engine.submitPoint({ x: 2, y: 2 });
    expect(engine.isRunning()).toBe(true);
  });

  it('19/20: Keyboard TR and EX', () => {
    const reg = createDefaultEngineRegistry();
    expect(reg.resolve('TR').ok).toBe(true);
    expect(reg.resolve('EX').ok).toBe(true);
    const bus = new CommandBus(createEmptyDocument());
    const engine = makeEngine(bus);
    engine.start('TR');
    expect(engine.getUiState().commandName).toBe('TRIM');
    engine.cancel();
    engine.start('EX');
    expect(engine.getUiState().commandName).toBe('EXTEND');
  });

  it('21: ESC cancellation', () => {
    const bus = new CommandBus(createEmptyDocument());
    const engine = makeEngine(bus);
    engine.start('EXTEND');
    engine.cancel();
    expect(engine.isRunning()).toBe(false);
  });

  it('22: Ribbon parity start(trim/extend)', () => {
    const bus = new CommandBus(createEmptyDocument());
    const engine = makeEngine(bus);
    engine.start('trim');
    expect(engine.getUiState().commandName).toBe('TRIM');
    engine.cancel();
    engine.start('extend');
    expect(engine.getUiState().commandName).toBe('EXTEND');
    expect(createDefaultEngineRegistry().resolve('extend').ok).toBe(true);
    const r = createDefaultEngineRegistry().resolve('extend');
    if (r.ok) expect(r.command.handoffToTool).not.toBe(true);
  });

  it('25/26: P4-B2 TRIM + P4-B3 EXTEND regression smoke', () => {
    const bus = new CommandBus(createEmptyDocument());
    bus.execute(new CreateLineCommand({ x: 3, y: -1 }, { x: 3, y: 1 }));
    bus.execute(new CreateLineCommand({ x: 7, y: -1 }, { x: 7, y: 1 }));
    const target = new CreateLineCommand({ x: 0, y: 0 }, { x: 10, y: 0 });
    bus.execute(target);
    const engine = makeEngine(bus);
    engine.start('TRIM');
    engine.submitPoint({ x: 5, y: 0 }); // MIDDLE
    const mid = getEntity(bus.getDocument(), target.getEntityId());
    // After middle trim, original id keeps one remaining part
    expect(mid).toBeTruthy();

    const bus2 = new CommandBus(createEmptyDocument());
    bus2.execute(new CreateLineCommand({ x: 9, y: -1 }, { x: 9, y: 1 }));
    const short = new CreateLineCommand({ x: 0, y: 0 }, { x: 1, y: 0 });
    bus2.execute(short);
    const eng2 = makeEngine(bus2);
    eng2.start('EXTEND');
    eng2.submitPoint({ x: 1, y: 0 });
    const ext = getEntity(bus2.getDocument(), short.getEntityId());
    if (ext?.type === 'line') expect(ext.geometry.end.x).toBeCloseTo(9);
  });
});
