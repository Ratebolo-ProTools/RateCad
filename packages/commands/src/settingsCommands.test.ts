import { describe, expect, it, beforeEach } from 'vitest';
import { createEmptyDocument, resetIdCounter } from '@ratecad/core';
import { formatWorldLength, toMillimeters } from '@ratecad/geometry';
import { CommandBus } from '../src/bus.js';
import { CreateRectangleCommand } from '../src/entityCommands.js';
import {
  ConvertDrawingWorldUnitCommand,
  SetDrawingUnitsCommand,
} from '../src/settingsCommands.js';

describe('drawing units commands', () => {
  beforeEach(() => resetIdCounter());

  it('changes display units without altering geometry', () => {
    const bus = new CommandBus(createEmptyDocument());
    bus.execute(new CreateRectangleCommand({ x: 0, y: 0 }, { x: 10, y: 12 }));
    const before = structuredClone(bus.getDocument().entities[0]!);
    bus.execute(
      new SetDrawingUnitsCommand(bus.getDocument(), {
        units: 'm',
        precision: 4,
      }),
    );
    expect(bus.getDocument().settings.units).toBe('m');
    expect(bus.getDocument().entities[0]).toEqual(before);
    const w = Math.abs(
      (before as { geometry: { corner2: { x: number } } }).geometry.corner2.x,
    );
    expect(formatWorldLength(w, 'ft', 'm', { precision: 4 })).toBe('3.0480 m');
    expect(toMillimeters(w, 'ft')).toBeCloseTo(3048, 10);
    bus.undo();
    expect(bus.getDocument().settings.units).toBe('ft-in');
  });

  it('converts world unit by scaling geometry (import path)', () => {
    const bus = new CommandBus(createEmptyDocument());
    bus.execute(new CreateRectangleCommand({ x: 0, y: 0 }, { x: 10, y: 12 }));
    bus.execute(new ConvertDrawingWorldUnitCommand(bus.getDocument(), 'mm'));
    const r = bus.getDocument().entities[0]!;
    expect(bus.getDocument().settings.worldUnit).toBe('mm');
    expect(r.type).toBe('rectangle');
    if (r.type === 'rectangle') {
      expect(r.geometry.corner2.x).toBeCloseTo(3048, 6);
      expect(r.geometry.corner2.y).toBeCloseTo(3657.6, 6);
    }
    bus.undo();
    expect(bus.getDocument().settings.worldUnit).toBe('ft');
  });
});
