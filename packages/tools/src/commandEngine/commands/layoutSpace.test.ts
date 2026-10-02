import { describe, expect, it } from 'vitest';
import { CommandBus } from '@ratecad/commands';
import {
  CreateLayoutCommand,
  RenameLayoutCommand,
  SetActiveLayoutCommand,
  SetViewportLayerOverrideCommand,
} from '@ratecad/commands';
import {
  WINDOWS_LAYER_ID,
  createEmptyDocument,
  createViewportFromRect,
  scaleFromRatio,
} from '@ratecad/core';
import { CadCommandEngine } from '../engine.js';
import { createDefaultEngineRegistry } from '../index.js';
import type { EngineHost } from '../engine.js';
import type { WorkspaceMode } from '@ratecad/core';

function makeHost(
  bus: CommandBus,
  mode: { current: WorkspaceMode },
): EngineHost {
  return {
    getUnits: () => 'ft',
    getWorldUnit: () => 'ft',
    getSelectedIds: () => [],
    getCursor: () => null,
    activateTool: () => undefined,
    activateSelect: () => undefined,
    getWorkspaceMode: () => mode.current,
    enterMspace: () => {
      if (mode.current !== 'PAPER_SPACE') {
        return { ok: false, message: 'need paper' };
      }
      mode.current = 'VIEWPORT_MODEL_SPACE';
      return { ok: true, message: 'MSPACE ok' };
    },
    enterPspace: () => {
      if (mode.current !== 'VIEWPORT_MODEL_SPACE') {
        return { ok: false, message: 'need vp model' };
      }
      mode.current = 'PAPER_SPACE';
      return { ok: true, message: 'PSPACE ok' };
    },
    onLayoutChanged: () => undefined,
  };
}

describe('LAYOUT / MSPACE / PSPACE commands', () => {
  it('registers aliases', () => {
    const reg = createDefaultEngineRegistry();
    for (const alias of ['LAYOUT', 'MSPACE', 'MS', 'PSPACE', 'PS', 'MVIEW', 'MV']) {
      expect(reg.resolve(alias).ok).toBe(true);
    }
  });

  it('LAYOUT CREATE / SET / RENAME', () => {
    const bus = new CommandBus(createEmptyDocument());
    const layoutId = bus.getDocument().layouts[0]!.id;
    bus.execute(new SetActiveLayoutCommand(layoutId));

    bus.execute(new CreateLayoutCommand('SheetA'));
    expect(bus.getDocument().layouts.some((l) => l.name === 'SheetA')).toBe(
      true,
    );
    const sheetA = bus.getDocument().layouts.find((l) => l.name === 'SheetA')!;
    expect(bus.getDocument().activeLayoutId).toBe(sheetA.id);

    bus.execute(new RenameLayoutCommand(sheetA.id, 'SheetB'));
    expect(bus.getDocument().layouts.find((l) => l.id === sheetA.id)!.name).toBe(
      'SheetB',
    );

    bus.execute(new SetActiveLayoutCommand(layoutId));
    expect(bus.getDocument().activeLayoutId).toBe(layoutId);
  });

  it('LAYOUT command-line Create path', () => {
    const bus = new CommandBus(createEmptyDocument());
    bus.execute(new SetActiveLayoutCommand(bus.getDocument().layouts[0]!.id));
    const mode = { current: 'PAPER_SPACE' as WorkspaceMode };
    const engine = new CadCommandEngine(
      createDefaultEngineRegistry(),
      bus,
      makeHost(bus, mode),
    );
    engine.start('LAYOUT');
    engine.submitText('CREATE');
    engine.submitText('MyLayout');
    expect(bus.getDocument().layouts.some((l) => l.name === 'MyLayout')).toBe(
      true,
    );
  });

  it('MSPACE Paper → viewport Model Space; PSPACE reverse', () => {
    const bus = new CommandBus(createEmptyDocument());
    bus.execute(new SetActiveLayoutCommand(bus.getDocument().layouts[0]!.id));
    const mode = { current: 'PAPER_SPACE' as WorkspaceMode };
    const engine = new CadCommandEngine(
      createDefaultEngineRegistry(),
      bus,
      makeHost(bus, mode),
    );
    engine.start('MSPACE');
    expect(mode.current).toBe('VIEWPORT_MODEL_SPACE');
    expect(engine.isRunning()).toBe(false);

    engine.start('PSPACE');
    expect(mode.current).toBe('PAPER_SPACE');
  });

  it('MSPACE on Model tab reports clear message', () => {
    const bus = new CommandBus(createEmptyDocument());
    const mode = { current: 'MODEL_SPACE' as WorkspaceMode };
    const engine = new CadCommandEngine(
      createDefaultEngineRegistry(),
      bus,
      makeHost(bus, mode),
    );
    engine.start('MSPACE');
    expect(engine.getStatusMessage()?.toLowerCase()).toContain('layout');
    expect(mode.current).toBe('MODEL_SPACE');
  });

  it('SetViewportLayerOverride is independent per viewport', () => {
    const bus = new CommandBus(createEmptyDocument());
    const layout = bus.getDocument().layouts[0]!;
    const vp = layout.viewports[0]!;
    bus.execute(
      new SetViewportLayerOverrideCommand(layout.id, vp, WINDOWS_LAYER_ID, false),
    );
    const next = bus.getDocument().layouts[0]!.viewports[0]!;
    expect(next.layerVisibilityOverrides[WINDOWS_LAYER_ID]).toBe(false);

    const other = createViewportFromRect(
      { x: 10, y: 10, width: 40, height: 30 },
      { scale: scaleFromRatio(50) },
    );
    expect(other.layerVisibilityOverrides[WINDOWS_LAYER_ID]).toBeUndefined();
  });
});
