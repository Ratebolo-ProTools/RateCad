import { describe, expect, it, beforeEach } from 'vitest';
import {
  createEmptyDocument,
  getEntity,
  resetIdCounter,
  setSelection,
} from '@ratecad/core';
import {
  CommandBus,
  CreateBlockCommand,
  CreateCircleCommand,
  CreateLineCommand,
  CreateRectangleCommand,
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

describe('TRIM command engine', () => {
  beforeEach(() => resetIdCounter());

  it('resolves TR alias and starts Quick mode by default', () => {
    const bus = new CommandBus(createEmptyDocument());
    const engine = new CadCommandEngine(createDefaultEngineRegistry(), bus, host(bus));
    const started = engine.start('TR');
    expect(started.ok).toBe(true);
    expect(engine.isRunning()).toBe(true);
    expect(engine.getRunningCommand()?.name).toBe('TRIM');
    expect(engine.getStatusMessage()?.includes('QUICK')).toBe(true);
  });

  it('trims a line in Quick mode via click location', () => {
    const bus = new CommandBus(createEmptyDocument());
    const a = new CreateLineCommand({ x: 0, y: 0 }, { x: 10, y: 0 });
    const b = new CreateLineCommand({ x: 5, y: -2 }, { x: 5, y: 2 });
    bus.execute(a);
    bus.execute(b);
    const engine = new CadCommandEngine(createDefaultEngineRegistry(), bus, host(bus));
    engine.start('TRIM');
    // Click the portion to the right of the cutter
    engine.submitPoint({ x: 8, y: 0 });
    const after = getEntity(bus.getDocument(), a.getEntityId());
    expect(after?.type).toBe('line');
    if (after?.type === 'line') {
      expect(after.geometry.end.x).toBeCloseTo(5);
    }
  });

  it('Mode option switches to Standard cutting-edge prompt', () => {
    const bus = new CommandBus(createEmptyDocument());
    const engine = new CadCommandEngine(createDefaultEngineRegistry(), bus, host(bus));
    engine.start('TRIM');
    engine.submitText('mode');
    engine.submitText('standard');
    const ui = engine.getUiState();
    expect(ui.prompt.toLowerCase()).toMatch(/cutting/);
  });

  it('ESC cancels without committing pending preview', () => {
    const bus = new CommandBus(createEmptyDocument());
    const a = new CreateLineCommand({ x: 0, y: 0 }, { x: 10, y: 0 });
    const b = new CreateLineCommand({ x: 5, y: -2 }, { x: 5, y: 2 });
    bus.execute(a);
    bus.execute(b);
    const before = structuredClone(bus.getDocument());
    const engine = new CadCommandEngine(createDefaultEngineRegistry(), bus, host(bus));
    engine.start('TRIM');
    engine.onPointerMove({ x: 8, y: 0 });
    engine.handleEscape();
    expect(engine.isRunning()).toBe(false);
    const line = getEntity(bus.getDocument(), a.getEntityId());
    if (line?.type === 'line') {
      expect(line.geometry.end).toEqual(
        (before.entities.find((e) => e.id === a.getEntityId()) as typeof line)
          .geometry.end,
      );
    }
  });

  it('in-session Undo reverses last trim only', () => {
    const bus = new CommandBus(createEmptyDocument());
    const cutter = new CreateLineCommand({ x: 5, y: -2 }, { x: 5, y: 4 });
    const a = new CreateLineCommand({ x: 0, y: 0 }, { x: 10, y: 0 });
    const b = new CreateLineCommand({ x: 0, y: 2 }, { x: 10, y: 2 });
    bus.execute(cutter);
    bus.execute(a);
    bus.execute(b);
    const engine = new CadCommandEngine(createDefaultEngineRegistry(), bus, host(bus));
    engine.start('TRIM');
    engine.submitPoint({ x: 8, y: 0 });
    engine.submitPoint({ x: 8, y: 2 });
    expect(engine.getStatusMessage()?.toLowerCase()).toMatch(/trim/);
    engine.submitText('undo');
    const restoredB = getEntity(bus.getDocument(), b.getEntityId());
    if (restoredB?.type === 'line') {
      expect(restoredB.geometry.end.x).toBeCloseTo(10);
    }
    const keptA = getEntity(bus.getDocument(), a.getEntityId());
    if (keptA?.type === 'line') {
      expect(keptA.geometry.end.x).toBeCloseTo(5);
    }
  });

  it('removes the clicked portion between two boundaries', () => {
    const bus = new CommandBus(createEmptyDocument());
    const target = new CreateLineCommand({ x: 0, y: 0 }, { x: 10, y: 0 });
    bus.execute(new CreateLineCommand({ x: 3, y: -2 }, { x: 3, y: 2 }));
    bus.execute(new CreateLineCommand({ x: 7, y: -2 }, { x: 7, y: 2 }));
    bus.execute(target);
    const engine = new CadCommandEngine(
      createDefaultEngineRegistry(),
      bus,
      host(bus),
    );

    engine.start('TRIM');
    engine.submitPoint({ x: 1, y: 0 });
    const leftPieces = bus
      .getDocument()
      .entities.filter((e) => e.type === 'line' && e.geometry.start.y === 0);
    expect(leftPieces).toHaveLength(2);
    expect(
      leftPieces.every(
        (e) => e.type === 'line' && e.geometry.start.x >= 3 - 1e-6,
      ),
    ).toBe(true);

    engine.submitText('undo');
    engine.submitPoint({ x: 5, y: 0 });
    const pieces = bus
      .getDocument()
      .entities.filter((e) => e.type === 'line' && e.geometry.start.y === 0);
    expect(pieces).toHaveLength(2);
    const spans = pieces.map((e) =>
      e.type === 'line' ? [e.geometry.start.x, e.geometry.end.x] : [],
    );
    expect(spans).toEqual(
      expect.arrayContaining([
        [0, 3],
        [7, 10],
      ]),
    );

    engine.submitText('undo');
    engine.submitPoint({ x: 9, y: 0 });
    const rightPieces = bus
      .getDocument()
      .entities.filter((e) => e.type === 'line' && e.geometry.start.y === 0);
    expect(rightPieces).toHaveLength(2);
    expect(
      rightPieces.every(
        (e) => e.type === 'line' && e.geometry.end.x <= 7 + 1e-6,
      ),
    ).toBe(true);
  });

  it('trims crossed lines with one undo for a two-point fence and a freehand drag', () => {
    const bus = new CommandBus(createEmptyDocument());
    bus.execute(new CreateLineCommand({ x: 5, y: -3 }, { x: 5, y: 3 }));
    const a = new CreateLineCommand({ x: 0, y: 0 }, { x: 10, y: 0 });
    const b = new CreateLineCommand({ x: 0, y: 2 }, { x: 10, y: 2 });
    bus.execute(a);
    bus.execute(b);
    const engine = new CadCommandEngine(
      createDefaultEngineRegistry(),
      bus,
      host(bus),
    );
    engine.start('TRIM');
    engine.submitPoint({ x: 1, y: 4 });
    engine.submitPoint({ x: 1, y: -1 });
    expect(getEntity(bus.getDocument(), a.getEntityId())).toMatchObject({
      type: 'line',
      geometry: { start: { x: 5, y: 0 }, end: { x: 10, y: 0 } },
    });
    expect(getEntity(bus.getDocument(), b.getEntityId())).toMatchObject({
      type: 'line',
      geometry: { start: { x: 5, y: 2 }, end: { x: 10, y: 2 } },
    });
    const depth = bus.getUndoDepth();
    engine.submitText('undo');
    expect(bus.getUndoDepth()).toBe(depth - 1);
    expect(getEntity(bus.getDocument(), a.getEntityId())).toMatchObject({
      geometry: { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
    });

    engine.beginStroke({ x: 1, y: 4 });
    engine.updateStroke({ x: 1, y: 1 });
    engine.endStroke({ x: 1, y: -1 }, true);
    expect(getEntity(bus.getDocument(), b.getEntityId())).toMatchObject({
      geometry: { start: { x: 5, y: 2 }, end: { x: 10, y: 2 } },
    });
    engine.submitText('undo');
    expect(getEntity(bus.getDocument(), b.getEntityId())).toMatchObject({
      geometry: { start: { x: 0, y: 2 }, end: { x: 10, y: 2 } },
    });
  });

  it('reports a missing boundary unless erase-untrimmable is on', () => {
    const bus = new CommandBus(createEmptyDocument());
    const lone = new CreateLineCommand({ x: 0, y: 5 }, { x: 4, y: 5 });
    bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 4, y: 0 }));
    bus.execute(lone);
    const engine = new CadCommandEngine(
      createDefaultEngineRegistry(),
      bus,
      host(bus),
    );
    engine.start('TRIM');
    engine.submitPoint({ x: 2, y: 5 });
    expect(engine.getUiState().message).toMatch(/No valid trim boundary/);
    expect(getEntity(bus.getDocument(), lone.getEntityId())).toMatchObject({
      geometry: { start: { x: 0, y: 5 }, end: { x: 4, y: 5 } },
    });

    engine.submitText('untrimmable');
    engine.submitText('yes');
    engine.submitPoint({ x: 2, y: 5 });
    expect(getEntity(bus.getDocument(), lone.getEntityId())).toBeUndefined();
  });

  it('refuses locked layers, hidden layers, and block references', () => {
    const bus = new CommandBus(createEmptyDocument());
    const line = new CreateLineCommand({ x: 0, y: 0 }, { x: 10, y: 0 }, 'src');
    bus.execute(line);
    bus.execute(new CreateLineCommand({ x: 5, y: -2 }, { x: 5, y: 2 }, 'cut'));
    bus.updateWithoutHistory((doc) => ({
      ...doc,
      layers: doc.layers.map((layer) =>
        layer.id === doc.layers[0]!.id ? { ...layer, locked: true } : layer,
      ),
    }));
    const engine = new CadCommandEngine(
      createDefaultEngineRegistry(),
      bus,
      host(bus),
    );
    engine.start('TRIM');
    engine.submitPoint({ x: 8, y: 0 });
    expect(engine.getUiState().message).toMatch(/Locked layer/);
    engine.handleEscape();

    bus.updateWithoutHistory((doc) => ({
      ...doc,
      layers: doc.layers.map((layer) =>
        layer.id === doc.layers[0]!.id
          ? { ...layer, locked: false, visible: false }
          : layer,
      ),
    }));
    const hiddenBefore = structuredClone(
      getEntity(bus.getDocument(), line.getEntityId()),
    );
    engine.start('TRIM');
    engine.submitPoint({ x: 8, y: 0 });
    expect(getEntity(bus.getDocument(), line.getEntityId())).toEqual(hiddenBefore);
    expect(engine.getUiState().message ?? '').not.toMatch(/Trimmed/);

    bus.updateWithoutHistory((doc) => ({
      ...doc,
      layers: doc.layers.map((layer) => ({ ...layer, visible: true, locked: false })),
    }));
    bus.updateWithoutHistory((doc) => setSelection(doc, ['src', 'cut']));
    bus.execute(
      new CreateBlockCommand(['src', 'cut'], 'Mark', { x: 0, y: 0 }, 'MODEL_SPACE'),
    );
    const before = structuredClone(bus.getDocument().blockDefinitions);
    engine.start('TRIM');
    const reference = bus.getDocument().entities.find((e) => e.type === 'block');
    expect(reference).toBeTruthy();
    engine.submitPoint(
      reference && reference.type === 'block'
        ? reference.geometry.position
        : { x: 0, y: 0 },
    );
    expect(engine.getUiState().message).toMatch(/Block references cannot be trimmed|Select object/);
    expect(bus.getDocument().blockDefinitions).toEqual(before);
  });

  it('trims a circle into a native arc and restores it on undo', () => {
    const bus = new CommandBus(createEmptyDocument());
    const c = new CreateCircleCommand({ x: 0, y: 0 }, 5);
    const v = new CreateLineCommand({ x: 0, y: -10 }, { x: 0, y: 10 });
    bus.execute(c);
    bus.execute(v);
    const depth = bus.getUndoDepth();
    const engine = new CadCommandEngine(createDefaultEngineRegistry(), bus, host(bus));
    engine.start('TRIM');
    engine.submitPoint({ x: 5, y: 0 });
    const after = getEntity(bus.getDocument(), c.getEntityId());
    expect(after?.type).toBe('arc');
    if (after?.type === 'arc') {
      expect(after.geometry.radius).toBe(5);
      expect(after.geometry.startAngle).toBeCloseTo(Math.PI / 2);
      expect(after.geometry.endAngle).toBeCloseTo((3 * Math.PI) / 2);
    }
    expect(bus.getUndoDepth()).toBe(depth + 1);
    bus.undo();
    expect(getEntity(bus.getDocument(), c.getEntityId())?.type).toBe('circle');
    expect(engine.isRunning()).toBe(true);
  });

  it('trims one of four sectors and restores every remaining arc', () => {
    const bus = new CommandBus(createEmptyDocument());
    const circle = new CreateCircleCommand({ x: 0, y: 0 }, 5);
    const vertical = new CreateLineCommand({ x: 0, y: -10 }, { x: 0, y: 10 });
    const horizontal = new CreateLineCommand({ x: -10, y: 0 }, { x: 10, y: 0 });
    bus.execute(circle);
    bus.execute(vertical);
    bus.execute(horizontal);
    const layerId = getEntity(bus.getDocument(), circle.getEntityId())?.layerId;
    const engine = new CadCommandEngine(createDefaultEngineRegistry(), bus, host(bus));
    engine.start('TRIM');
    engine.submitPoint({
      x: 5 * Math.cos(Math.PI / 4),
      y: 5 * Math.sin(Math.PI / 4),
    });
    const arcs = bus
      .getDocument()
      .entities.filter((entity) => entity.type === 'arc');
    expect(arcs).toHaveLength(3);
    expect(arcs.every((entity) => entity.layerId === layerId)).toBe(true);
    expect(bus.getDocument().entities.filter((entity) => entity.type === 'line')).toHaveLength(2);
    expect(bus.getDocument().entities.some((entity) => entity.type === 'polyline')).toBe(false);
    expect(engine.isRunning()).toBe(true);
    bus.undo();
    expect(getEntity(bus.getDocument(), circle.getEntityId())?.type).toBe('circle');
    expect(bus.getDocument().entities.filter((entity) => entity.type === 'arc')).toHaveLength(0);
    bus.redo();
    expect(bus.getDocument().entities.filter((entity) => entity.type === 'arc')).toHaveLength(3);
    expect(getEntity(bus.getDocument(), circle.getEntityId())?.type).toBe('arc');
    expect(engine.isRunning()).toBe(true);
  });

  it('crossing trims the covered portion and skips a bbox-only overlap', () => {
    const bus = new CommandBus(createEmptyDocument());
    const cutter = new CreateLineCommand({ x: 5, y: -2 }, { x: 5, y: 2 });
    const target = new CreateLineCommand({ x: 0, y: 0 }, { x: 10, y: 0 });
    const miss = new CreateLineCommand({ x: 0, y: 0 }, { x: 10, y: 3 });
    bus.execute(cutter);
    bus.execute(target);
    bus.execute(miss);
    const engine = new CadCommandEngine(createDefaultEngineRegistry(), bus, host(bus));
    engine.start('TRIM');
    engine.submitText('crossing');
    engine.submitPoint({ x: 9, y: 1 });
    engine.submitPoint({ x: 6, y: -1 });
    const trimmed = getEntity(bus.getDocument(), target.getEntityId());
    const untouched = getEntity(bus.getDocument(), miss.getEntityId());
    expect(trimmed?.type).toBe('line');
    if (trimmed?.type === 'line') expect(trimmed.geometry.end.x).toBeCloseTo(5);
    expect(untouched?.type).toBe('line');
    if (untouched?.type === 'line') {
      expect(untouched.geometry.start).toEqual({ x: 0, y: 0 });
      expect(untouched.geometry.end).toEqual({ x: 10, y: 3 });
    }
    expect(engine.getUiState().message).toMatch(/Crossing trimmed 1/);
  });

  it('left-to-right window does not trim a line that only crosses the box', () => {
    const bus = new CommandBus(createEmptyDocument());
    const cutter = new CreateLineCommand({ x: 5, y: -2 }, { x: 5, y: 2 });
    const target = new CreateLineCommand({ x: 0, y: 0 }, { x: 10, y: 0 });
    bus.execute(cutter);
    bus.execute(target);
    const engine = new CadCommandEngine(createDefaultEngineRegistry(), bus, host(bus));
    engine.start('TRIM');
    engine.submitText('crossing');
    engine.submitPoint({ x: 6, y: -1 });
    engine.submitPoint({ x: 9, y: 1 });
    const after = getEntity(bus.getDocument(), target.getEntityId());
    expect(after?.type).toBe('line');
    if (after?.type === 'line') {
      expect(after.geometry.start.x).toBeCloseTo(0);
      expect(after.geometry.end.x).toBeCloseTo(10);
    }
    expect(engine.getUiState().message).toMatch(/Window: nothing fully inside/);
  });

  it('trims a rectangle, stays active, and undoes the click exactly', () => {
    const bus = new CommandBus(createEmptyDocument());
    const box = new CreateRectangleCommand({ x: 0, y: 0 }, { x: 10, y: 10 });
    const cutter = new CreateLineCommand({ x: -2, y: 5 }, { x: 12, y: 5 });
    bus.execute(box);
    bus.execute(cutter);
    const depth = bus.getUndoDepth();
    const engine = new CadCommandEngine(createDefaultEngineRegistry(), bus, host(bus));
    engine.start('TRIM');
    engine.onPointerMove({ x: 10, y: 8 });
    const preview = engine.getUiState().previewEntities ?? [];
    const removal = preview.find((entity) => entity.properties.color === '#ff6b6b');
    const keptPreview = preview.find((entity) => entity.properties.color === '#7eb6ff');
    expect(removal?.type).toBe('polyline');
    expect(keptPreview?.type).toBe('polyline');
    if (removal?.type !== 'polyline' || keptPreview?.type !== 'polyline') return;
    expect(removal.geometry.vertices).toEqual([
      { x: 10, y: 5 },
      { x: 10, y: 10 },
    ]);
    expect(keptPreview.geometry.vertices).toEqual([
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
    ]);

    engine.submitPoint({ x: 10, y: 8 });
    expect(engine.isRunning()).toBe(true);
    const trimmed = getEntity(bus.getDocument(), box.getEntityId());
    expect(trimmed?.type).toBe('polyline');
    if (trimmed?.type === 'polyline') {
      expect(trimmed.geometry.closed).toBe(false);
      expect(trimmed.geometry.vertices).toEqual(keptPreview.geometry.vertices);
    }
    expect(bus.getUndoDepth()).toBe(depth + 1);

    engine.submitPoint({ x: 5, y: 5 });
    expect(engine.isRunning()).toBe(true);
    const lineAfter = getEntity(bus.getDocument(), cutter.getEntityId());
    expect(lineAfter?.type).toBe('line');
    if (lineAfter?.type === 'line') expect(lineAfter.geometry.end.x).toBeLessThan(12);

    engine.submitText('undo');
    expect(getEntity(bus.getDocument(), cutter.getEntityId())?.type).toBe('line');
    if (getEntity(bus.getDocument(), cutter.getEntityId())?.type === 'line') {
      expect(getEntity(bus.getDocument(), cutter.getEntityId())).toMatchObject({
        geometry: { start: { x: -2, y: 5 }, end: { x: 12, y: 5 } },
      });
    }
    bus.undo();
    const restored = getEntity(bus.getDocument(), box.getEntityId());
    expect(restored?.type).toBe('rectangle');
    if (restored?.type === 'rectangle') {
      expect(restored.geometry.corner1).toEqual({ x: 0, y: 0 });
      expect(restored.geometry.corner2).toEqual({ x: 10, y: 10 });
    }
    bus.redo();
    expect(getEntity(bus.getDocument(), box.getEntityId())?.type).toBe('polyline');
    expect(engine.isRunning()).toBe(true);
  });

  it('does not record undo when a rectangle has no cutting intersection', () => {
    const bus = new CommandBus(createEmptyDocument());
    const outer = new CreateRectangleCommand({ x: 0, y: 0 }, { x: 20, y: 20 });
    const inner = new CreateRectangleCommand({ x: 5, y: 5 }, { x: 8, y: 8 });
    bus.execute(outer);
    bus.execute(inner);
    const depth = bus.getUndoDepth();
    const engine = new CadCommandEngine(createDefaultEngineRegistry(), bus, host(bus));
    engine.start('TRIM');
    engine.submitPoint({ x: 6.5, y: 8 });
    expect(engine.isRunning()).toBe(true);
    expect(bus.getUndoDepth()).toBe(depth);
    expect(getEntity(bus.getDocument(), inner.getEntityId())?.type).toBe('rectangle');
    engine.handleEscape();
    expect(engine.isRunning()).toBe(false);
    expect(getEntity(bus.getDocument(), inner.getEntityId())?.type).toBe('rectangle');
  });
});
