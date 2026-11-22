import { beforeEach, describe, expect, it } from 'vitest';
import {
  addEntity,
  createEmptyDocument,
  getEntity,
  resetIdCounter,
  type ArcEntity,
} from '@ratecad/core';
import {
  CommandBus,
  CreateCircleCommand,
  CreateLineCommand,
  CreatePolylineCommand,
  CreateRectangleCommand,
  DeleteEntitiesCommand,
  MoveEntityGripCommand,
} from '@ratecad/commands';
import { dimensionMeasuredValue } from '@ratecad/geometry';
import { CadCommandEngine, createDefaultEngineRegistry } from '../index.js';
import type { EngineHost } from '../engine.js';
import type { DimensionEntity } from '@ratecad/core';

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

function engineFor(bus = new CommandBus(createEmptyDocument())) {
  return { bus, engine: new CadCommandEngine(createDefaultEngineRegistry(), bus, host(bus)) };
}

function dimensions(bus: CommandBus): DimensionEntity[] {
  return bus.getDocument().entities.filter((entity) => entity.type === 'dimension');
}

function measured(entity: DimensionEntity): number {
  return dimensionMeasuredValue(entity.geometry, entity.metadata);
}

describe('DIM command', () => {
  beforeEach(() => resetIdCounter());

  it('resolves dimension aliases without taking DIST, DIMSTYLE, or MEASUREGEOM', () => {
    const registry = createDefaultEngineRegistry();
    for (const [alias, id] of [
      ['DIM', 'dimension'],
      ['DLI', 'dimlinear'],
      ['DIMLINEAR', 'dimlinear'],
      ['DAL', 'dimaligned'],
      ['DAN', 'dimangular'],
      ['DRA', 'dimradius'],
      ['DDI', 'dimdiameter'],
      ['DAR', 'dimarc'],
      ['DCO', 'dimcontinue'],
      ['DBA', 'dimbaseline'],
      ['QM', 'quick-measure'],
      ['D', 'dimstyle'],
      ['DIST', 'dist'],
      ['MEASUREGEOM', 'area'],
    ] as const) {
      const resolved = registry.resolve(alias);
      expect(resolved.ok, alias).toBe(true);
      if (resolved.ok) expect(resolved.command.id).toBe(id);
    }
  });

  it('places a horizontal line dimension and stays active', () => {
    const { bus, engine } = engineFor();
    bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 12, y: 0 }));
    const before = bus.getUndoDepth();
    engine.start('DIM');
    expect(engine.getUiState().prompt).toContain('Select object or specify first extension line origin');
    engine.onPointerMove({ x: 6, y: 0 });
    expect(bus.getUndoDepth()).toBe(before);
    expect(dimensions(bus)).toHaveLength(0);
    engine.submitPoint({ x: 6, y: 0 });
    engine.onPointerMove({ x: 6, y: 2 });
    const preview = engine.getUiState().previewEntities?.[0];
    expect(preview?.type).toBe('dimension');
    engine.submitPoint({ x: 6, y: 2 });
    const dim = dimensions(bus)[0];
    expect(dim).toBeDefined();
    expect(preview?.type === 'dimension' && dim
      ? measured(dim)
      : 0).toBeCloseTo(12);
    expect(dim?.geometry.kind).toBe('horizontal');
    if (preview?.type === 'dimension' && dim) {
      expect(dim.geometry.offset).toBeCloseTo(preview.geometry.offset);
      expect(dim.geometry.start).toEqual(preview.geometry.start);
      expect(dim.geometry.end).toEqual(preview.geometry.end);
    }
    expect(engine.isRunning()).toBe(true);
  });

  it('dimensions a vertical line, a slope, a rectangle, and a polyline segment', () => {
    const { bus, engine } = engineFor();
    bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 0, y: 5 }));
    bus.execute(new CreateLineCommand({ x: 20, y: 0 }, { x: 23, y: 4 }));
    bus.execute(new CreateRectangleCommand({ x: 0, y: 20 }, { x: 5000, y: 4020 }));
    bus.execute(new CreatePolylineCommand([{ x: 0, y: -10 }, { x: 4, y: -10 }, { x: 4, y: -7 }]));
    engine.start('DIM');

    engine.submitPoint({ x: 0, y: 2.5 });
    engine.submitPoint({ x: -2, y: 2.5 });
    engine.submitPoint({ x: 21.5, y: 2 });
    engine.submitPoint({ x: 20.7, y: 2.6 });
    engine.submitPoint({ x: 2500, y: 4020 });
    engine.submitPoint({ x: 2500, y: 4100 });
    engine.submitPoint({ x: 5000, y: 2020 });
    engine.submitPoint({ x: 5100, y: 2020 });
    engine.submitPoint({ x: 2, y: -10 });
    engine.submitPoint({ x: 2, y: -8 });

    const dims = dimensions(bus);
    expect(dims).toHaveLength(5);
    expect(dims.map((dim) => dim.geometry.kind)).toEqual([
      'vertical',
      'aligned',
      'horizontal',
      'vertical',
      'horizontal',
    ]);
    expect(dims.map((dim) => measured(dim))).toEqual([
      expect.closeTo(5),
      expect.closeTo(5),
      expect.closeTo(5000),
      expect.closeTo(4000),
      expect.closeTo(4),
    ]);
    expect(engine.isRunning()).toBe(true);
  });

  it('dimensions circle radius, diameter, arc radius, and arc length', () => {
    const { bus, engine } = engineFor();
    const circle = new CreateCircleCommand({ x: 0, y: 0 }, 1500);
    bus.execute(circle);
    const arc: ArcEntity = {
      id: 'arc-1',
      type: 'arc',
      layerId: bus.getDocument().layers[0]!.id,
      visible: true,
      locked: false,
      geometry: { center: { x: 100, y: 0 }, radius: 1000, startAngle: 0, endAngle: Math.PI / 2 },
      properties: {},
    };
    bus.updateWithoutHistory((doc) => addEntity(doc, arc));
    const onArc = {
      x: 100 + 1000 * Math.cos(Math.PI / 4),
      y: 1000 * Math.sin(Math.PI / 4),
    };

    engine.start('DRA');
    engine.submitPoint({ x: 1500, y: 0 });
    engine.submitPoint({ x: 1800, y: 200 });
    engine.start('DDI');
    engine.submitPoint({ x: 0, y: 1500 });
    engine.submitPoint({ x: 0, y: 2000 });
    engine.start('DRA');
    engine.submitPoint(onArc);
    engine.submitPoint({ x: onArc.x * 0.2 + 100, y: onArc.y * 0.2 });
    engine.start('DAR');
    engine.submitPoint(onArc);
    engine.submitPoint({ x: 100 + (onArc.x - 100) * 1.4, y: onArc.y * 1.4 });

    const dims = dimensions(bus);
    expect(dims.map((dim) => dim.geometry.kind)).toEqual([
      'radius',
      'diameter',
      'radius',
      'arc-length',
    ]);
    expect(measured(dims[0]!)).toBeCloseTo(1500);
    expect(measured(dims[1]!)).toBeCloseTo(3000);
    expect(measured(dims[2]!)).toBeCloseTo(1000);
    expect(measured(dims[3]!)).toBeCloseTo((1000 * Math.PI) / 2, 5);
  });

  it('dimensions the angle between two lines and a three-point angle', () => {
    const { bus, engine } = engineFor();
    bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 10, y: 0 }));
    bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 0, y: 10 }));
    engine.start('DAN');
    engine.submitPoint({ x: 5, y: 0 });
    engine.submitPoint({ x: 0, y: 5 });
    engine.onPointerMove({ x: 3, y: 3 });
    const preview = engine.getUiState().previewEntities?.[0];
    engine.submitPoint({ x: 3, y: 3 });
    expect(preview?.type).toBe('dimension');
    if (preview?.type === 'dimension') expect(measured(preview)).toBeCloseTo(90, 4);
    expect(measured(dimensions(bus)[0]!)).toBeCloseTo(90, 4);

    engine.handleEscape();
    const empty = engineFor();
    empty.engine.start('DAN');
    empty.engine.submitPoint({ x: 0, y: 0 });
    empty.engine.submitPoint({ x: 10, y: 0 });
    empty.engine.submitPoint({ x: 0, y: 10 });
    expect(measured(dimensions(empty.bus)[0]!)).toBeCloseTo(90, 4);
  });

  it('does not create a dimension for parallel lines', () => {
    const { bus, engine } = engineFor();
    bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 10, y: 0 }));
    bus.execute(new CreateLineCommand({ x: 0, y: 2 }, { x: 10, y: 2 }));
    engine.start('DAN');
    engine.submitPoint({ x: 5, y: 0 });
    engine.submitPoint({ x: 5, y: 2 });
    expect(dimensions(bus)).toHaveLength(0);
    expect(engine.isRunning()).toBe(true);
  });

  it('keeps the clicked 90 degree quadrant after a later command', () => {
    const { bus, engine } = engineFor();
    bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 0, y: 10 }));
    bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 10, y: 0 }));
    engine.start('DAN');
    engine.submitPoint({ x: 0, y: 5 });
    engine.submitPoint({ x: 5, y: 0 });
    engine.submitPoint({ x: 3, y: 3 });
    expect(measured(dimensions(bus)[0]!)).toBeCloseTo(90, 4);
    bus.execute(new CreateLineCommand({ x: 20, y: 0 }, { x: 21, y: 0 }));
    expect(measured(dimensions(bus)[0]!)).toBeCloseTo(90, 4);
  });

  it('continues and stacks baseline dimensions', () => {
    const { bus, engine } = engineFor();
    bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 10, y: 0 }));
    engine.start('DIM');
    engine.submitPoint({ x: 5, y: 0 });
    engine.submitPoint({ x: 5, y: 2 });
    engine.handleEscape();
    engine.start('DCO');
    engine.submitPoint({ x: 16, y: 0 });
    engine.handleEscape();
    engine.start('DBA');
    engine.submitPoint({ x: 4, y: 0 });
    const dims = dimensions(bus);
    expect(dims).toHaveLength(3);
    expect(measured(dims[1]!)).toBeCloseTo(6);
    expect(Math.abs(dims[2]!.geometry.offset)).toBeGreaterThan(Math.abs(dims[0]!.geometry.offset));
  });

  it('updates an associative dimension when the source moves and detaches when it is deleted', () => {
    const { bus, engine } = engineFor();
    const created = new CreateLineCommand({ x: 0, y: 0 }, { x: 10, y: 0 });
    bus.execute(created);
    engine.start('DIM');
    engine.submitPoint({ x: 5, y: 0 });
    engine.submitPoint({ x: 5, y: 2 });
    const line = getEntity(bus.getDocument(), created.getEntityId());
    expect(line?.type).toBe('line');
    bus.execute(new MoveEntityGripCommand(line!, { kind: 'line-end' }, { x: 20, y: 0 }));
    expect(measured(dimensions(bus)[0]!)).toBeCloseTo(20);
    expect(dimensions(bus)[0]?.geometry.offset).toBeCloseTo(2);
    bus.undo();
    expect(measured(dimensions(bus)[0]!)).toBeCloseTo(10);
    bus.execute(new DeleteEntitiesCommand([created.getEntityId()]));
    const detached = dimensions(bus)[0];
    expect(measured(detached!)).toBeCloseTo(10);
    expect(detached?.metadata?.modelDimension).toMatchObject({ valid: false });
  });

  it('supports undo, redo, escape, and measurement that does not create entities', () => {
    const { bus, engine } = engineFor();
    bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 8, y: 0 }));
    engine.start('DIM');
    engine.onPointerMove({ x: 4, y: 1 });
    engine.handleEscape();
    expect(dimensions(bus)).toHaveLength(0);
    engine.start('DIM');
    engine.submitPoint({ x: 4, y: 0 });
    engine.submitPoint({ x: 4, y: 1 });
    expect(dimensions(bus)).toHaveLength(1);
    engine.handleEscape();
    expect(engine.isRunning()).toBe(false);
    expect(dimensions(bus)).toHaveLength(1);
    bus.undo();
    expect(dimensions(bus)).toHaveLength(0);
    bus.redo();
    expect(dimensions(bus)).toHaveLength(1);

    const measure = engineFor(bus);
    const count = measure.bus.getDocument().entities.length;
    measure.engine.start('QM');
    measure.engine.onPointerMove({ x: 4, y: 0 });
    measure.engine.submitPoint({ x: 4, y: 0 });
    expect(measure.bus.getDocument().entities).toHaveLength(count);
    expect(measure.engine.getStatusMessage() ?? '').toContain('Length');
    expect(measure.engine.isRunning()).toBe(true);
    measure.engine.handleEscape();
    expect(measure.engine.isRunning()).toBe(false);
  });
});
