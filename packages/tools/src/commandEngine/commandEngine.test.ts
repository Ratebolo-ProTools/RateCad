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
  parseAngleInput,
  parseDistanceInput,
  parsePointInput,
  pointFromDirectDistance,
} from '../index.js';

function makeEngine() {
  const bus = new CommandBus(createEmptyDocument());
  let tool = 'select';
  const cursor = { x: 10, y: 0 };
  const host = {
    getUnits: () => bus.getDocument().settings.units,
    getWorldUnit: () => bus.getDocument().settings.worldUnit ?? 'ft',
    getSelectedIds: () => bus.getDocument().selection,
    getCursor: () => cursor,
    activateTool: (t: string) => {
      tool = t;
    },
    activateSelect: () => {
      tool = 'select';
    },
  };
  const engine = new CadCommandEngine(createDefaultEngineRegistry(), bus, host);
  return { bus, engine, host, getTool: () => tool, cursor };
}

describe('command engine registry', () => {
  it('resolves aliases case-insensitively', () => {
    const { engine } = makeEngine();
    expect(engine.registry.resolve('rec').ok).toBe(true);
    expect(engine.registry.resolve('L').ok).toBe(true);
    expect(engine.registry.resolve('PL').ok).toBe(true);
    expect(engine.registry.resolve('CO').ok).toBe(true);
    expect(engine.registry.resolve('xyz').ok).toBe(false);
  });

  it('suggests autocomplete matches', () => {
    const { engine } = makeEngine();
    const s = engine.registry.suggest('RE');
    expect(s.some((x) => x.startsWith('RE'))).toBe(true);
  });

  it('detects alias collisions on register', () => {
    const reg = createDefaultEngineRegistry();
    expect(() =>
      reg.register({
        id: 'other',
        name: 'OTHER',
        aliases: ['L'],
        description: 'x',
        tool: 'pan',
        start: () => ({
          prompt: { id: 'a', message: 'x', inputType: 'string' },
        }),
        onPoint: () => ({ kind: 'complete' }),
        onText: () => ({ kind: 'complete' }),
      }),
    ).toThrow(/Alias conflict/);
  });

  it('resolves AREA / AA / MEASUREGEOM to area tool handoff', () => {
    const reg = createDefaultEngineRegistry();
    for (const alias of ['AREA', 'AA', 'MEASUREGEOM']) {
      const r = reg.resolve(alias);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.command.tool).toBe('area');
      expect(r.command.handoffToTool).toBe(true);
    }
  });
});

describe('point / distance / angle parsers', () => {
  const units = 'ft-in' as const;
  const ctx = {
    lastPoint: { x: 0, y: 0 },
    cursor: { x: 10, y: 0 },
    angleOverrideDeg: null as number | null,
    units,
    worldUnit: 'ft' as const,
  };

  it('parses absolute and relative Cartesian', () => {
    const abs = parsePointInput('10,20', ctx);
    expect(abs).toMatchObject({ ok: true, point: { x: 10, y: 20 } });
    const rel = parsePointInput('@5,0', ctx);
    expect(rel).toMatchObject({ ok: true, point: { x: 5, y: 0 } });
  });

  it('parses relative polar', () => {
    const p = parsePointInput('@10<0', ctx);
    expect(p).toMatchObject({ ok: true });
    if ('point' in p && p.ok) {
      expect(p.point.x).toBeCloseTo(10);
      expect(p.point.y).toBeCloseTo(0);
    }
  });

  it('parses absolute polar', () => {
    const p = parsePointInput('5<90', ctx);
    expect(p).toMatchObject({ ok: true });
    if ('point' in p && p.ok) {
      expect(p.point.x).toBeCloseTo(0, 5);
      expect(p.point.y).toBeCloseTo(5, 5);
    }
  });

  it('parses angle override', () => {
    const a = parsePointInput('<30', ctx);
    expect(a).toMatchObject({ ok: true, angleOverrideDeg: 30 });
  });

  it('parses direct distance token', () => {
    const d = parsePointInput('10', ctx);
    expect(d).toMatchObject({ ok: true, value: 10 });
  });

  it('rejects invalid coordinates', () => {
    expect(parsePointInput('nope', ctx)).toMatchObject({ ok: false });
  });

  it('distance and angle parsers', () => {
    expect(parseDistanceInput('10', 'ft-in', 'ft')).toMatchObject({
      ok: true,
      value: 10,
    });
    expect(parseDistanceInput('abc', 'ft-in', 'ft').ok).toBe(false);
    expect(parseAngleInput('45')).toMatchObject({ ok: true, degrees: 45 });
    expect(parseAngleInput('x').ok).toBe(false);
  });

  it('direct distance uses cursor direction', () => {
    const p = pointFromDirectDistance({ x: 0, y: 0 }, { x: 1, y: 0 }, 10, null);
    expect(p).toEqual({ x: 10, y: 0 });
    const a = pointFromDirectDistance({ x: 0, y: 0 }, null, 10, 90);
    expect(a!.x).toBeCloseTo(0);
    expect(a!.y).toBeCloseTo(10);
  });
});

describe('command engine sessions', () => {
  beforeEach(() => resetIdCounter());

  it('starts REC and creates rectangle without mutating until commit', () => {
    const { bus, engine } = makeEngine();
    engine.start('REC');
    expect(engine.isRunning()).toBe(true);
    expect(bus.getDocument().entities).toHaveLength(0);
    engine.submitPoint({ x: 0, y: 0 });
    engine.onPointerMove({ x: 4, y: 3 });
    expect(bus.getDocument().entities).toHaveLength(0);
    expect(engine.getUiState().preview?.kind).toBe('rectangle');
    engine.submitPoint({ x: 4, y: 3 });
    expect(bus.getDocument().entities).toHaveLength(1);
    expect(engine.isRunning()).toBe(false);
  });

  it('Escape cancels without committing', () => {
    const { bus, engine } = makeEngine();
    engine.start('L');
    engine.submitPoint({ x: 0, y: 0 });
    engine.cancel(true);
    expect(bus.getDocument().entities).toHaveLength(0);
    expect(engine.isRunning()).toBe(false);
  });

  it('unknown command is safe', () => {
    const { engine } = makeEngine();
    const r = engine.start('XYZ');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/Unknown command/);
  });

  it('LINE with relative coordinates', () => {
    const { bus, engine } = makeEngine();
    engine.start('L');
    engine.submitPoint({ x: 0, y: 0 });
    engine.setBuffer('@10,0');
    engine.confirm('enter');
    expect(bus.getDocument().entities).toHaveLength(1);
    const e = bus.getDocument().entities[0]!;
    expect(e.type).toBe('line');
    if (e.type === 'line') {
      expect(e.geometry.end).toEqual({ x: 10, y: 0 });
    }
  });

  it('LINE polar and direct distance', () => {
    const { bus, engine, cursor } = makeEngine();
    engine.start('L');
    engine.submitPoint({ x: 0, y: 0 });
    engine.setBuffer('@5<0');
    engine.confirm('enter');
    expect(bus.getDocument().entities.length).toBeGreaterThanOrEqual(1);

    engine.start('L');
    engine.submitPoint({ x: 0, y: 0 });
    cursor.x = 1;
    cursor.y = 0;
    engine.setBuffer('10');
    engine.confirm('enter');
    const lines = bus.getDocument().entities.filter((e) => e.type === 'line');
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });

  it('LINE angle override then distance', () => {
    const { bus, engine } = makeEngine();
    engine.start('L');
    engine.submitPoint({ x: 0, y: 0 });
    engine.setBuffer('<90');
    engine.confirm('enter');
    engine.setBuffer('5');
    engine.confirm('enter');
    const line = bus.getDocument().entities.find((e) => e.type === 'line');
    expect(line?.type).toBe('line');
    if (line?.type === 'line') {
      expect(line.geometry.end.x).toBeCloseTo(0);
      expect(line.geometry.end.y).toBeCloseTo(5);
    }
  });

  it('CIRCLE center/radius typed', () => {
    const { bus, engine } = makeEngine();
    engine.start('C');
    engine.submitPoint({ x: 1, y: 1 });
    engine.setBuffer('3');
    engine.confirm('enter');
    expect(bus.getDocument().entities[0]?.type).toBe('circle');
  });

  it('CIRCLE accepts default radius on empty Enter', () => {
    const { bus, engine } = makeEngine();
    engine.start('C');
    engine.submitPoint({ x: 0, y: 0 });
    expect(engine.getUiState().defaultText).toContain('5');
    engine.setBuffer('');
    engine.confirm('enter');
    const e = bus.getDocument().entities[0];
    expect(e?.type).toBe('circle');
    if (e?.type === 'circle') {
      expect(e.geometry.radius).toBeCloseTo(5);
    }
  });

  it('CIRCLE rejects zero and invalid radius', () => {
    const { bus, engine } = makeEngine();
    engine.start('C');
    engine.submitPoint({ x: 0, y: 0 });
    engine.setBuffer('0');
    engine.confirm('enter');
    expect(bus.getDocument().entities).toHaveLength(0);
    expect(engine.isRunning()).toBe(true);
    engine.setBuffer('abc');
    engine.confirm('enter');
    expect(bus.getDocument().entities).toHaveLength(0);
    expect(engine.isRunning()).toBe(true);
  });

  it('MOVE selection Enter then base/destination with preview and undo', () => {
    const { bus, engine } = makeEngine();
    const line = new CreateLineCommand({ x: 0, y: 0 }, { x: 5, y: 0 });
    bus.execute(line);
    engine.start('M');
    expect(engine.isAwaitingSelection()).toBe(true);
    bus.updateWithoutHistory((d) => setSelection(d, [line.getEntityId()]));
    engine.setBuffer('');
    engine.confirm('enter');
    expect(engine.isAwaitingSelection()).toBe(false);
    engine.submitPoint({ x: 0, y: 0 });
    engine.onPointerMove({ x: 3, y: 0 });
    expect(bus.getDocument().entities[0]).toMatchObject({
      type: 'line',
      geometry: { start: { x: 0, y: 0 } },
    });
    expect(engine.getUiState().previewEntities?.length).toBe(1);
    engine.submitPoint({ x: 3, y: 0 });
    const e = bus.getDocument().entities[0]!;
    expect(e.type).toBe('line');
    if (e.type === 'line') {
      expect(e.geometry.start.x).toBeCloseTo(3);
    }
    bus.undo();
    expect(bus.getDocument().entities[0]).toMatchObject({
      type: 'line',
      geometry: { start: { x: 0, y: 0 } },
    });
    bus.redo();
    expect(bus.getDocument().entities[0]).toMatchObject({
      type: 'line',
      geometry: { start: { x: 3, y: 0 } },
    });
  });

  it('MOVE cancel leaves document unchanged', () => {
    const { bus, engine } = makeEngine();
    const line = new CreateLineCommand({ x: 0, y: 0 }, { x: 5, y: 0 });
    bus.execute(line);
    bus.updateWithoutHistory((d) => setSelection(d, [line.getEntityId()]));
    engine.start('M');
    engine.submitPoint({ x: 0, y: 0 });
    engine.onPointerMove({ x: 4, y: 0 });
    engine.cancel(true);
    expect(bus.getDocument().entities[0]).toMatchObject({
      type: 'line',
      geometry: { start: { x: 0, y: 0 } },
    });
  });

  it('COPY supports repeated copies then Enter finish', () => {
    const { bus, engine } = makeEngine();
    const line = new CreateLineCommand({ x: 0, y: 0 }, { x: 5, y: 0 });
    bus.execute(line);
    bus.updateWithoutHistory((d) => setSelection(d, [line.getEntityId()]));
    engine.start('CO');
    engine.submitPoint({ x: 0, y: 0 });
    engine.submitPoint({ x: 0, y: 2 });
    engine.submitPoint({ x: 0, y: 4 });
    engine.submitPoint({ x: 0, y: 6 });
    expect(bus.getDocument().entities.length).toBe(4); // original + 3
    expect(engine.isRunning()).toBe(true);
    engine.setBuffer('');
    engine.confirm('enter');
    expect(engine.isRunning()).toBe(false);
    bus.undo();
    expect(bus.getDocument().entities.length).toBe(3);
    bus.redo();
    expect(bus.getDocument().entities.length).toBe(4);
  });

  it('LINE connected segments finish with Enter and Undo option', () => {
    const { bus, engine } = makeEngine();
    engine.start('L');
    engine.submitPoint({ x: 0, y: 0 });
    engine.submitPoint({ x: 5, y: 0 });
    engine.submitPoint({ x: 5, y: 5 });
    expect(bus.getDocument().entities.filter((e) => e.type === 'line')).toHaveLength(
      2,
    );
    engine.setBuffer('U');
    engine.confirm('enter');
    expect(bus.getDocument().entities.filter((e) => e.type === 'line')).toHaveLength(
      1,
    );
    engine.setBuffer('');
    engine.confirm('enter');
    expect(engine.isRunning()).toBe(false);
  });

  it('command history up/down', () => {
    const { engine } = makeEngine();
    engine.start('L');
    engine.cancel(true);
    engine.start('REC');
    engine.cancel(true);
    engine.history.beginBrowse();
    expect(engine.history.up()).toBe('RECTANGLE');
    expect(engine.history.up()).toBe('LINE');
  });

  it('Tab cycles suggestions into buffer', () => {
    const { engine } = makeEngine();
    engine.setBuffer('R');
    engine.cycleSuggestion();
    expect(engine.getBuffer().length).toBeGreaterThan(0);
  });

  it('empty Enter repeats last successfully completed command', () => {
    const { engine } = makeEngine();
    engine.start('REC');
    engine.submitPoint({ x: 0, y: 0 });
    engine.submitPoint({ x: 4, y: 3 });
    expect(engine.isRunning()).toBe(false);
    expect(engine.getLastCompletedName()).toBe('RECTANGLE');
    engine.setBuffer('');
    engine.confirm('enter');
    expect(engine.isRunning()).toBe(true);
    expect(engine.getRunningCommand()?.name).toBe('RECTANGLE');
  });

  it('rectangle Length option via command text', () => {
    const { bus, engine } = makeEngine();
    engine.start('REC');
    engine.submitPoint({ x: 0, y: 0 });
    engine.setBuffer('L');
    engine.confirm('enter');
    engine.setBuffer('10');
    engine.confirm('enter');
    engine.setBuffer('W');
    engine.confirm('enter');
    engine.setBuffer('6');
    engine.confirm('enter');
    engine.submitPoint({ x: 1, y: 1 });
    const e = bus.getDocument().entities[0]!;
    expect(e.type).toBe('rectangle');
    if (e.type === 'rectangle') {
      expect(
        Math.abs(e.geometry.corner2.x - e.geometry.corner1.x),
      ).toBeCloseTo(10);
      expect(
        Math.abs(e.geometry.corner2.y - e.geometry.corner1.y),
      ).toBeCloseTo(6);
    }
  });

  it('RECTANGLE free drag cancel leaves document empty', () => {
    const { bus, engine } = makeEngine();
    engine.start('REC');
    engine.submitPoint({ x: 0, y: 0 });
    engine.onPointerMove({ x: 4, y: 3 });
    expect(engine.getUiState().preview?.kind).toBe('rectangle');
    engine.cancel(true);
    expect(bus.getDocument().entities).toHaveLength(0);
  });

  it('TR EX O MI RO SC still resolve via registry', () => {
    const { engine } = makeEngine();
    for (const a of ['TR', 'EX', 'O', 'MI', 'RO', 'SC', 'PL']) {
      expect(engine.registry.resolve(a).ok).toBe(true);
    }
  });
});
