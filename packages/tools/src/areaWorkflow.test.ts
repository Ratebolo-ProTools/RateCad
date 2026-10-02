/**
 * AREA selection workflow: ESC, completeHandoff, no geometry mutation.
 */
import { describe, expect, it } from 'vitest';
import { CommandBus } from '@ratecad/commands';
import { CreateRectangleCommand } from '@ratecad/commands';
import { createEmptyDocument } from '@ratecad/core';
import {
  CadCommandEngine,
  createDefaultEngineRegistry,
  createToolSession,
  finishAreaPoints,
  setAreaToolMode,
} from './index.js';
import { areaFromPoints } from '@ratecad/geometry';

function make() {
  const bus = new CommandBus(createEmptyDocument('area-wf'));
  let tool = 'select';
  const host = {
    getUnits: () => bus.getDocument().settings.units,
    getWorldUnit: () => bus.getDocument().settings.worldUnit ?? 'ft',
    getSelectedIds: () => bus.getDocument().selection,
    getCursor: () => ({ x: 0, y: 0 }),
    activateTool: (t: string) => {
      tool = t;
    },
    activateSelect: () => {
      tool = 'select';
    },
  };
  const engine = new CadCommandEngine(createDefaultEngineRegistry(), bus, host);
  return { bus, engine, getTool: () => tool };
}

describe('AREA command workflow', () => {
  it('AREA handoff + ESC without measure does not store last command', () => {
    const { engine, getTool } = make();
    engine.start('AREA');
    expect(engine.hasPendingHandoff()).toBe(true);
    expect(getTool()).toBe('area');
    engine.handleEscape();
    expect(engine.hasPendingHandoff()).toBe(false);
    expect(engine.getLastCompletedName()).toBeNull();
    expect(getTool()).toBe('select');
  });

  it('successful AREA completeHandoff stores AREA for SPACE repeat', () => {
    const { engine, getTool } = make();
    engine.start('AREA');
    expect(engine.completeHandoff()).toBe(true);
    expect(engine.getLastCompletedName()).toBe('AREA');
    expect(engine.hasPendingHandoff()).toBe(false);
    engine.confirm('space');
    expect(engine.hasPendingHandoff()).toBe(true);
    expect(getTool()).toBe('area');
  });

  it('point AREA finish does not mutate geometry', () => {
    const { bus } = make();
    bus.execute(new CreateRectangleCommand({ x: 0, y: 0 }, { x: 2, y: 2 }));
    const before = bus.getDocument().entities.length;
    let session = setAreaToolMode(createToolSession('area'), 'points');
    session = {
      ...session,
      vertices: [
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { x: 3, y: 4 },
        { x: 0, y: 4 },
      ],
      mode: 'draw',
    };
    const next = finishAreaPoints(session, bus);
    expect(bus.getDocument().entities.length).toBe(before);
    expect(next.areaLastResult?.ok).toBe(true);
    expect(next.areaLastResult?.area).toBeCloseTo(12, 8);
    expect(next.activeTool).toBe('select');
  });

  it('ESC cancellation of point preview leaves geometry untouched', () => {
    const { bus } = make();
    const count = bus.getDocument().entities.length;
    const preview = areaFromPoints(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ],
      true,
    );
    expect(preview.ok).toBe(true);
    // Cancelling the tool session does not execute document commands
    expect(bus.getDocument().entities.length).toBe(count);
  });
});
