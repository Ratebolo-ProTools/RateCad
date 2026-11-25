import { describe, expect, it } from 'vitest';
import { CommandBus } from '@ratecad/commands';
import { createEmptyDocument } from '@ratecad/core';
import { CadCommandEngine, createDefaultEngineRegistry } from '../index.js';
import type { MTextCreateRequest } from './mtext.js';

function makeEngine() {
  const bus = new CommandBus(createEmptyDocument('mtext'));
  const opened: MTextCreateRequest[] = [];
  const host = {
    getUnits: () => bus.getDocument().settings.units,
    getWorldUnit: () => bus.getDocument().settings.worldUnit ?? 'ft',
    getSelectedIds: () => bus.getDocument().selection,
    getCursor: () => ({ x: 1, y: 1 }),
    activateTool: () => undefined,
    activateSelect: () => undefined,
    openMTextEditor: (draft: MTextCreateRequest) => {
      opened.push(draft);
    },
  };
  return {
    engine: new CadCommandEngine(createDefaultEngineRegistry(), bus, host),
    opened,
  };
}

describe('MTEXT command', () => {
  it('resolves MT and MTEXT and leaves single-line TEXT on DT', () => {
    const registry = createDefaultEngineRegistry();
    const mt = registry.resolve('MT');
    const mtext = registry.resolve('MTEXT');
    const text = registry.resolve('TEXT');
    expect(mt.ok).toBe(true);
    expect(mtext.ok).toBe(true);
    expect(text.ok).toBe(true);
    if (mt.ok) expect(mt.command.id).toBe('mtext');
    if (mtext.ok) expect(mtext.command.id).toBe('mtext');
    if (text.ok) {
      expect(text.command.id).toBe('text');
      expect(text.command.aliases).not.toContain('MTEXT');
    }
  });

  it('asks for the first corner, previews the boundary, and opens the editor', () => {
    const { engine, opened } = makeEngine();
    engine.start('MT');
    expect(engine.isRunning()).toBe(true);
    expect(engine.getUiState().prompt).toBe('Specify first corner');
    engine.submitPoint({ x: 0, y: 10 });
    engine.onPointerMove({ x: 25, y: 0 });
    expect(engine.getUiState().preview?.kind).toBe('rectangle');
    engine.submitPoint({ x: 25, y: 0 });
    expect(engine.isRunning()).toBe(false);
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({
      position: { x: 0, y: 10 },
      width: 25,
      attachment: 'TL',
    });
    expect(opened[0]!.height).toBeGreaterThan(0);
  });
});
