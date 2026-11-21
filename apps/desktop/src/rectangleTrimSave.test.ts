import { describe, expect, it, beforeEach } from 'vitest';
import { applyPreparedDraw, previewDrawPrompt } from '@ratecad/ai';
import { CommandBus, CreateLineCommand } from '@ratecad/commands';
import { createEmptyDocument, getEntity, resetIdCounter } from '@ratecad/core';
import { parseDocument, serializeDocument } from '@ratecad/io';
import { CadCommandEngine, createDefaultEngineRegistry } from '@ratecad/tools';

describe('rectangle trim save and AI rectangle', () => {
  beforeEach(() => resetIdCounter());

  it('trims an AI rectangle and reopens the open polyline', () => {
    const bus = new CommandBus(createEmptyDocument());
    const drawn = previewDrawPrompt('Draw a 10 ft by 10 ft rectangle at 0,0', {
      document: bus.getDocument(),
      workspaceMode: 'MODEL_SPACE',
    });
    expect(drawn.ok).toBe(true);
    if (!drawn.ok || drawn.prepared.kind !== 'draw') return;
    applyPreparedDraw(bus, drawn.prepared, 'MODEL_SPACE');
    const box = bus.getDocument().entities.find((entity) => entity.type === 'rectangle');
    expect(box?.type).toBe('rectangle');
    if (!box || box.type !== 'rectangle') return;
    const line = new CreateLineCommand({ x: -2, y: 5 }, { x: 12, y: 5 });
    bus.execute(line);
    const engine = new CadCommandEngine(createDefaultEngineRegistry(), bus, {
      getUnits: () => bus.getDocument().settings.units,
      getWorldUnit: () => bus.getDocument().settings.worldUnit,
      getSelectedIds: () => bus.getDocument().selection,
      getCursor: () => null,
      activateTool: () => {},
      activateSelect: () => {},
    });
    engine.start('TRIM');
    engine.submitPoint({ x: 5, y: 10 });
    expect(engine.isRunning()).toBe(true);
    const trimmed = getEntity(bus.getDocument(), box.id);
    expect(trimmed?.type).toBe('polyline');
    if (trimmed?.type !== 'polyline') return;
    expect(trimmed.geometry.closed).toBe(false);
    expect(trimmed.geometry.vertices).toEqual([
      { x: 0, y: 5 },
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
    ]);

    const opened = parseDocument(serializeDocument(bus.getDocument()));
    const saved = getEntity(opened, box.id);
    expect(saved).toEqual(trimmed);
    engine.handleEscape();
    expect(engine.isRunning()).toBe(false);
  });
});
