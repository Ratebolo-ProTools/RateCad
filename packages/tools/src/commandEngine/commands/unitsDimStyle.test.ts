import { describe, expect, it } from 'vitest';
import { CommandBus } from '@ratecad/commands';
import { createEmptyDocument } from '@ratecad/core';
import { CadCommandEngine, createDefaultEngineRegistry } from '../../index.js';

function makeEngine() {
  const bus = new CommandBus(createEmptyDocument('cmd'));
  let unitsOpen = 0;
  let dimOpen = 0;
  const host = {
    getUnits: () => bus.getDocument().settings.units,
    getWorldUnit: () => bus.getDocument().settings.worldUnit ?? 'ft',
    getSelectedIds: () => bus.getDocument().selection,
    getCursor: () => ({ x: 0, y: 0 }),
    activateTool: () => undefined,
    activateSelect: () => undefined,
    openUnitsDialog: () => {
      unitsOpen += 1;
    },
    openDimStyleDialog: () => {
      dimOpen += 1;
    },
  };
  const engine = new CadCommandEngine(createDefaultEngineRegistry(), bus, host);
  return { engine, bus, getUnitsOpen: () => unitsOpen, getDimOpen: () => dimOpen };
}

describe('UNITS / DIMSTYLE / DIST aliases', () => {
  it('resolves UNITS, -UNITS, DIMSTYLE, D, DIST, AREA', () => {
    const reg = createDefaultEngineRegistry();
    for (const [alias, id] of [
      ['UNITS', 'units'],
      ['-UNITS', 'dash-units'],
      ['DIMSTYLE', 'dimstyle'],
      ['D', 'dimstyle'],
      ['DIST', 'dist'],
      ['DI', 'dist'],
      ['AREA', 'area'],
      ['AA', 'area'],
    ] as const) {
      const r = reg.resolve(alias);
      expect(r.ok, alias).toBe(true);
      if (r.ok) expect(r.command.id).toBe(id);
    }
  });

  it('UNITS opens dialog via host', () => {
    const { engine, getUnitsOpen } = makeEngine();
    engine.start('UNITS');
    expect(getUnitsOpen()).toBe(1);
    expect(engine.isRunning()).toBe(false);
  });

  it('DIMSTYLE opens manager via host', () => {
    const { engine, getDimOpen } = makeEngine();
    engine.start('D');
    expect(getDimOpen()).toBe(1);
  });

  it('DIST measures between two points', () => {
    const { engine } = makeEngine();
    engine.start('DIST');
    expect(engine.isRunning()).toBe(true);
    engine.submitPoint({ x: 0, y: 0 });
    engine.submitPoint({ x: 3, y: 4 });
    expect(engine.isRunning()).toBe(false);
    expect(engine.getStatusMessage() ?? '').toMatch(/Distance/i);
    expect(engine.getStatusMessage() ?? '').toMatch(/5/);
  });
});
