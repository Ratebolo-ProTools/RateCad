import { describe, expect, it, beforeEach } from 'vitest';
import {
  createEmptyDocument,
  resetIdCounter,
  setSelection,
} from '@ratecad/core';
import { CommandBus, CreateLineCommand } from '@ratecad/commands';
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

describe('property commands registry', () => {
  beforeEach(() => resetIdCounter());

  it('resolves PROPERTIES / PR / CHPROP / SETBYLAYER / MATCHPROP', () => {
    const reg = createDefaultEngineRegistry();
    expect(reg.resolve('PR').ok).toBe(true);
    expect(reg.resolve('PROPERTIES').ok).toBe(true);
    expect(reg.resolve('CHPROP').ok).toBe(true);
    expect(reg.resolve('SETBYLAYER').ok).toBe(true);
    expect(reg.resolve('MATCHPROP').ok).toBe(true);
  });

  it('SETBYLAYER completes on selection + Enter', () => {
    const bus = new CommandBus(createEmptyDocument());
    const cmd = new CreateLineCommand({ x: 0, y: 0 }, { x: 2, y: 0 });
    bus.execute(cmd);
    bus.updateWithoutHistory((d) => setSelection(d, [cmd.getEntityId()]));
    const eng = new CadCommandEngine(
      createDefaultEngineRegistry(),
      bus,
      host(bus),
    );
    expect(eng.start('SETBYLAYER').ok).toBe(true);
    eng.confirm('enter');
    expect(eng.isRunning()).toBe(false);
  });
});
