import { describe, expect, it } from 'vitest';
import { createEmptyDocument } from '@ratecad/core';
import { CommandBus } from './bus.js';
import {
  CopyDimensionStyleCommand,
  DeleteDimensionStyleCommand,
  SetActiveDimensionStyleCommand,
  SetDrawingUnitsSettingsCommand,
} from './unitsDimStyleCommands.js';

describe('UNITS / DIMSTYLE commands', () => {
  it('SetDrawingUnitsSettings changes display only', () => {
    const bus = new CommandBus(createEmptyDocument('u'));
    const beforeEntities = structuredClone(bus.getDocument().entities);
    bus.execute(
      new SetDrawingUnitsSettingsCommand(bus.getDocument(), {
        linearFormat: 'decimal',
        linearPrecision: 3,
        insertionUnit: 'mm',
      }),
    );
    const doc = bus.getDocument();
    expect(doc.settings.drawingUnits.linearFormat).toBe('decimal');
    expect(doc.settings.drawingUnits.linearPrecision).toBe(3);
    expect(doc.settings.units).toBe('mm');
    expect(doc.settings.precision).toBe(3);
    expect(doc.settings.worldUnit).toBe('ft');
    expect(doc.entities).toEqual(beforeEntities);
  });

  it('cannot delete the active dimension style', () => {
    const bus = new CommandBus(createEmptyDocument('d'));
    const before = bus.getDocument().settings.dimensionStyles.length;
    bus.execute(
      new DeleteDimensionStyleCommand(bus.getDocument(), 'Standard'),
    );
    expect(bus.getDocument().settings.dimensionStyles.length).toBe(before);
  });

  it('copy + set active + delete non-active works', () => {
    const bus = new CommandBus(createEmptyDocument('d2'));
    bus.execute(
      new CopyDimensionStyleCommand(bus.getDocument(), 'Standard', 'MyStyle'),
    );
    expect(
      bus.getDocument().settings.dimensionStyles.some((s) => s.name === 'MyStyle'),
    ).toBe(true);
    bus.execute(new SetActiveDimensionStyleCommand(bus.getDocument(), 'MyStyle'));
    expect(bus.getDocument().settings.activeDimensionStyleName).toBe('MyStyle');
    bus.execute(new DeleteDimensionStyleCommand(bus.getDocument(), 'Standard'));
    expect(
      bus.getDocument().settings.dimensionStyles.some((s) => s.name === 'Standard'),
    ).toBe(false);
  });
});
