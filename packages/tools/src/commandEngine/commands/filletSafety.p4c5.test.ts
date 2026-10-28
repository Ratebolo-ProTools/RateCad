/**
 * P4-C5 — FILLET atomic undo + arc meta after ROTATE (command-layer).
 */
import { describe, expect, it, beforeEach } from 'vitest';
import {
  createEmptyDocument,
  getEntity,
  resetIdCounter,
} from '@ratecad/core';
import {
  CommandBus,
  CreateLineCommand,
  FilletEntitiesCommand,
  RotateEntitiesCommand,
} from '@ratecad/commands';
import {
  arcMetaConsistentWithVertices,
  computeFillet,
  degreesToRadians,
  mirrorEntity,
  readArcPolylineMeta,
  rotateEntity,
  translateEntity,
} from '@ratecad/geometry';
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

describe('P4-C5 FILLET command safety / transforms', () => {
  beforeEach(() => resetIdCounter());

  it('A16: rejected near-parallel fillet adds no Undo history', () => {
    const bus = new CommandBus(createEmptyDocument('a16'));
    bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 1000, y: 0 }));
    bus.execute(new CreateLineCommand({ x: 0, y: 1 }, { x: 1000, y: 1.01 }));
    const beforeEntities = structuredClone(bus.getDocument().entities);
    const eng = new CadCommandEngine(
      createDefaultEngineRegistry(),
      bus,
      host(bus),
    );
    eng.start('FILLET');
    eng.submitText('radius');
    eng.submitText('0');
    eng.submitPoint({ x: 500, y: 0 });
    const r = eng.submitPoint({ x: 500, y: 1 });
    // Command should reject; document unchanged beyond the two creates
    expect(bus.getDocument().entities).toEqual(beforeEntities);
    expect(eng.isRunning()).toBe(true);
    void r;
    // Undo twice removes only the lines — no third fillet step
    bus.undo();
    bus.undo();
    expect(bus.getDocument().entities).toHaveLength(0);
    expect(bus.canUndo()).toBe(false);
  });

  it('A17: valid r=0 fillet Undo/Redo', () => {
    const bus = new CommandBus(createEmptyDocument('a17'));
    const c1 = new CreateLineCommand({ x: 0, y: 0 }, { x: 100, y: 0 });
    const c2 = new CreateLineCommand({ x: 100, y: 0 }, { x: 100, y: 80 });
    bus.execute(c1);
    bus.execute(c2);
    const a = getEntity(bus.getDocument(), c1.getEntityId())!;
    const b = getEntity(bus.getDocument(), c2.getEntityId())!;
    const result = computeFillet(
      { entity: a, worldPoint: { x: 40, y: 0 } },
      { entity: b, worldPoint: { x: 100, y: 40 } },
      { radius: 0, trim: true },
      'f0',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    bus.execute(new FilletEntitiesCommand(result, bus.getDocument().entities));
    bus.undo();
    const restored = getEntity(bus.getDocument(), c1.getEntityId());
    expect(restored?.type).toBe('line');
    if (restored?.type === 'line') {
      expect(restored.geometry.start).toEqual({ x: 0, y: 0 });
    }
    bus.redo();
    expect(bus.getDocument().entities).toHaveLength(2);
  });

  it('B16: Undo/Redo after ROTATE preserves arc metadata', () => {
    const bus = new CommandBus(createEmptyDocument('b16'));
    bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 5000, y: 0 }));
    bus.execute(new CreateLineCommand({ x: 5000, y: 0 }, { x: 5000, y: 3500 }));
    const [l1, l2] = bus.getDocument().entities;
    const result = computeFillet(
      { entity: l1!, worldPoint: { x: 2500, y: 0 } },
      { entity: l2!, worldPoint: { x: 5000, y: 1750 } },
      { radius: 500, trim: true },
      'f500',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    bus.execute(new FilletEntitiesCommand(result, bus.getDocument().entities));
    const arc = bus
      .getDocument()
      .entities.find((e) => e.type === 'polyline' && e.metadata?.arc)!;
    const beforeMeta = readArcPolylineMeta(arc)!;
    bus.execute(
      new RotateEntitiesCommand(
        [arc],
        { x: 0, y: 0 },
        degreesToRadians(90),
        bus.getDocument().entities,
      ),
    );
    const after = getEntity(bus.getDocument(), arc.id)!;
    expect(arcMetaConsistentWithVertices(after)).toBe(true);
    expect(readArcPolylineMeta(after)?.radius).toBeCloseTo(beforeMeta.radius);
    bus.undo();
    const undone = getEntity(bus.getDocument(), arc.id)!;
    expect(arcMetaConsistentWithVertices(undone)).toBe(true);
    expect(readArcPolylineMeta(undone)?.center).toEqual(beforeMeta.center);
    bus.redo();
    expect(arcMetaConsistentWithVertices(getEntity(bus.getDocument(), arc.id)!)).toBe(
      true,
    );
  });

  it('B17: MIRROR arc metadata stays consistent', () => {
    const a = {
      id: 'a',
      type: 'line' as const,
      layerId: '0',
      visible: true,
      locked: false,
      geometry: { start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
      properties: {},
    };
    const b = {
      id: 'b',
      type: 'line' as const,
      layerId: '0',
      visible: true,
      locked: false,
      geometry: { start: { x: 100, y: 0 }, end: { x: 100, y: 80 } },
      properties: {},
    };
    const result = computeFillet(
      { entity: a, worldPoint: { x: 50, y: 0 } },
      { entity: b, worldPoint: { x: 100, y: 40 } },
      { radius: 10, trim: true },
      'fm',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const mirrored = mirrorEntity(
      result.created[0]!,
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      'fm2',
    )!;
    expect(arcMetaConsistentWithVertices(mirrored)).toBe(true);
  });

  it('B18: JSON round-trip after ROTATE keeps arc metadata', () => {
    const bus = new CommandBus(createEmptyDocument('b18'));
    bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 5000, y: 0 }));
    bus.execute(new CreateLineCommand({ x: 5000, y: 0 }, { x: 5000, y: 3500 }));
    const [l1, l2] = bus.getDocument().entities;
    const result = computeFillet(
      { entity: l1!, worldPoint: { x: 2500, y: 0 } },
      { entity: l2!, worldPoint: { x: 5000, y: 1750 } },
      { radius: 500, trim: true },
      'fs',
    );
    if (!result.ok) throw new Error('fillet failed');
    bus.execute(new FilletEntitiesCommand(result, bus.getDocument().entities));
    const arc = bus.getDocument().entities.find((e) => e.metadata?.arc)!;
    const rotated = rotateEntity(arc, { x: 100, y: 100 }, Math.PI / 3)!;
    const reArc = JSON.parse(JSON.stringify(rotated));
    expect(arcMetaConsistentWithVertices(reArc)).toBe(true);
    expect(readArcPolylineMeta(reArc)?.radius).toBeCloseTo(500);
  });

  it('MOVE keeps arc meta (COPY path uses translate)', () => {
    const a = {
      id: 'a',
      type: 'line' as const,
      layerId: '0',
      visible: true,
      locked: false,
      geometry: { start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
      properties: {},
    };
    const b = {
      id: 'b',
      type: 'line' as const,
      layerId: '0',
      visible: true,
      locked: false,
      geometry: { start: { x: 100, y: 0 }, end: { x: 100, y: 80 } },
      properties: {},
    };
    const result = computeFillet(
      { entity: a, worldPoint: { x: 50, y: 0 } },
      { entity: b, worldPoint: { x: 100, y: 40 } },
      { radius: 10, trim: true },
      'ft',
    );
    if (!result.ok) throw new Error('fail');
    const moved = translateEntity(result.created[0]!, { x: 5, y: -3 })!;
    expect(arcMetaConsistentWithVertices(moved)).toBe(true);
  });
});
