/**
 * P4-C2 — desktop-facing Close routing / CIRCLE alias safety.
 */
import { describe, expect, it } from 'vitest';
import { CommandBus } from '@ratecad/commands';
import { createEmptyDocument } from '@ratecad/core';
import {
  CadCommandEngine,
  applyPolylineOption,
  createDefaultEngineRegistry,
  createToolSession,
  finishPolyline,
  handleToolPointerDown,
  shouldPolylineClosePreemptAlias,
} from '@ratecad/tools';
import { createCamera } from '@ratecad/viewport';
import {
  createDocumentSession,
  disposeDocumentSession,
} from './documentSession.js';
import { prepareSessionDeactivation } from './documentSessionSwitch.js';

describe('P4-C2 keyboard / alias safety', () => {
  it('C outside PL resolves to CIRCLE via engine registry', () => {
    const reg = createDefaultEngineRegistry();
    const r = reg.resolve('C');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.command.name).toBe('CIRCLE');
  });

  it('C during eligible PL preempts CIRCLE alias', () => {
    const bus = new CommandBus(createEmptyDocument('pl-c'));
    let s = createToolSession('polyline');
    const cam = createCamera();
    for (const w of [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 4 },
      { x: 0, y: 4 },
    ]) {
      s = handleToolPointerDown(s, bus, { world: w, camera: cam });
    }
    expect(shouldPolylineClosePreemptAlias(s, 'C')).toBe(true);
    const next = applyPolylineOption(s, bus, 'C');
    expect(next).toBeTruthy();
    expect(bus.getDocument().entities).toHaveLength(1);
    const e = bus.getDocument().entities[0]!;
    expect(e.type).toBe('polyline');
    if (e.type === 'polyline') expect(e.geometry.closed).toBe(true);
  });

  it('CLOSEALL remains unresolved as a CAD engine command (file op)', () => {
    const reg = createDefaultEngineRegistry();
    expect(reg.resolve('CLOSEALL').ok).toBe(false);
    expect(reg.resolve('CLOSE').ok).toBe(false);
  });

  it('multi-document: PL vertices in A do not leak into B on deactivate', () => {
    const a = createDocumentSession({
      document: createEmptyDocument('A'),
      bindMinimalEngine: true,
    });
    const b = createDocumentSession({
      document: createEmptyDocument('B'),
      bindMinimalEngine: true,
    });
    a.toolSession = createToolSession('polyline');
    a.toolSession = {
      ...a.toolSession,
      vertices: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ],
      mode: 'draw',
    };
    prepareSessionDeactivation(a);
    expect(a.toolSession.activeTool).toBe('select');
    expect(a.toolSession.vertices).toHaveLength(0);
    expect(b.bus.getDocument().entities).toHaveLength(0);
    expect(a.bus.getDocument().entities).toHaveLength(0);
    disposeDocumentSession(a);
    disposeDocumentSession(b);
  });

  it('engine CIRCLE start still works after a closed PL commit on a bus', () => {
    const bus = new CommandBus(createEmptyDocument('mix'));
    let s = createToolSession('polyline');
    const cam = createCamera();
    for (const w of [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
    ]) {
      s = handleToolPointerDown(s, bus, { world: w, camera: cam });
    }
    finishPolyline(s, bus, { closed: true });
    expect(bus.getDocument().entities).toHaveLength(1);

    let tool = 'select';
    const eng = new CadCommandEngine(createDefaultEngineRegistry(), bus, {
      getUnits: () => 'ft' as const,
      getWorldUnit: () => 'ft' as const,
      getSelectedIds: () => [],
      getCursor: () => ({ x: 0, y: 0 }),
      activateTool: (t: string) => {
        tool = t;
      },
      activateSelect: () => {
        tool = 'select';
      },
    });
    const started = eng.start('C');
    expect(started.ok).toBe(true);
    expect(tool).toBe('circle');
  });
});
