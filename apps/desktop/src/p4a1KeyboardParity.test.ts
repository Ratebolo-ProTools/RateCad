/**
 * P4-A1 — ribbon / keyboard pathway parity + session isolation helpers.
 */
import { describe, expect, it } from 'vitest';
import { createEmptyDocument } from '@ratecad/core';
import {
  CadCommandEngine,
  createDefaultEngineRegistry,
  createToolSession,
} from '@ratecad/tools';
import { CommandBus } from '@ratecad/commands';
import {
  createDocumentSession,
} from './documentSession.js';
import {
  prepareSessionDeactivation,
} from './documentSessionSwitch.js';
import { ENGINE_TOOLS } from './engineTools.js';

describe('P4-A1 ribbon/keyboard ENGINE_TOOLS parity', () => {
  it('29: polyline is on the engine pathway with other modify/draw tools', () => {
    expect(ENGINE_TOOLS.has('polyline')).toBe(true);
    expect(ENGINE_TOOLS.has('line')).toBe(true);
    expect(ENGINE_TOOLS.has('mirror')).toBe(true);
  });

  it('ribbon tool ids resolve through the live engine registry', () => {
    const reg = createDefaultEngineRegistry();
    for (const tool of ENGINE_TOOLS) {
      const byTool = reg.getByTool(tool);
      expect(byTool, tool).toBeTruthy();
      const started = new CadCommandEngine(
        reg,
        new CommandBus(createEmptyDocument(`t-${tool}`)),
        {
          getUnits: () => 'ft' as const,
          getWorldUnit: () => 'ft' as const,
          getSelectedIds: () => [],
          getCursor: () => ({ x: 0, y: 0 }),
          activateTool: () => undefined,
          activateSelect: () => undefined,
        },
      );
      const result = started.start(tool);
      expect(result.ok, tool).toBe(true);
    }
  });
});

describe('P4-A1 session command isolation', () => {
  it('22/24: prepareSessionDeactivation clears pending autocomplete per session', () => {
    const a = createDocumentSession({
      document: createEmptyDocument('A'),
      bindMinimalEngine: true,
    });
    const b = createDocumentSession({
      document: createEmptyDocument('B'),
      bindMinimalEngine: true,
    });
    expect(a.engine).toBeTruthy();
    expect(b.engine).toBeTruthy();
    a.engine!.setBuffer('M');
    a.commandLineBuffer = 'M';
    b.engine!.start('CIRCLE');
    b.engine!.submitPoint({ x: 0, y: 0 });
    b.engine!.setBuffer('2');
    b.engine!.confirm('enter');

    prepareSessionDeactivation(a);
    expect(a.engine!.getBuffer()).toBe('');
    expect(a.commandLineBuffer).toBe('');
    expect(a.toolSession.activeTool).toBe('select');

    // B session last-completed untouched
    expect(b.engine!.getLastCompletedName()).toBe('CIRCLE');
    expect(b.engine!.getBuffer()).not.toBe('M');
  });

  it('30: Save All / Close All / Exit pathways remain independent of engine repeat', () => {
    // File ops are not registered as CadCommandEngine commands — repeat cannot launch them.
    const reg = createDefaultEngineRegistry();
    for (const name of ['SAVE', 'SAVEAS', 'EXIT', 'QUIT', 'CLOSEALL', 'OPEN', 'NEW']) {
      expect(reg.resolve(name).ok).toBe(false);
    }
    void createToolSession('select');
  });
});
