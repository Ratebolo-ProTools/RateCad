import { describe, expect, it } from 'vitest';
import {
  WALLS_LAYER_ID,
  createEmptyDocument,
  updateLayer,
} from '@ratecad/core';
import {
  getStoredAppearance,
  resolveEffectiveAppearance,
} from '@ratecad/geometry';
import { CommandBus } from './bus.js';
import { CreateLineCommand } from './entityCommands.js';
import {
  ChangeEntitiesAppearanceCommand,
  MatchPropertiesCommand,
  SetByLayerCommand,
  SetCurrentAppearanceCommand,
} from './propertyCommands.js';

function lineAt(bus: CommandBus, x0: number, y0: number, x1: number, y1: number) {
  const cmd = new CreateLineCommand({ x: x0, y: y0 }, { x: x1, y: y1 });
  bus.execute(cmd);
  return cmd.getEntityId();
}

describe('property commands', () => {
  it('multi-select color change is one undoable transaction', () => {
    const bus = new CommandBus(createEmptyDocument());
    const ids = [
      lineAt(bus, 0, 0, 1, 0),
      lineAt(bus, 0, 1, 1, 1),
      lineAt(bus, 0, 2, 1, 2),
    ];
    bus.execute(
      new ChangeEntitiesAppearanceCommand(ids, {
        color: {
          mode: 'EXPLICIT',
          value: { type: 'RGB', r: 255, g: 0, b: 0 },
        },
      }),
    );
    for (const id of ids) {
      const e = bus.getDocument().entities.find((x) => x.id === id)!;
      expect(
        resolveEffectiveAppearance(e, bus.getDocument()).colorHex.toLowerCase(),
      ).toBe('#ff0000');
    }
    bus.undo();
    for (const id of ids) {
      const e = bus.getDocument().entities.find((x) => x.id === id)!;
      expect(getStoredAppearance(e).color.mode).toBe('BY_LAYER');
    }
  });

  it('MATCHPROP + SETBYLAYER + current appearance', () => {
    let doc = createEmptyDocument();
    doc = updateLayer(doc, WALLS_LAYER_ID, { color: '#ff0000' });
    const bus = new CommandBus(doc);
    bus.execute(
      new SetCurrentAppearanceCommand({
        color: {
          mode: 'EXPLICIT',
          value: { type: 'RGB', r: 0, g: 255, b: 0 },
        },
      }),
    );
    const a = lineAt(bus, 0, 0, 1, 0);
    const b = lineAt(bus, 0, 1, 1, 1);
    bus.execute(
      new ChangeEntitiesAppearanceCommand([a], {
        layerId: WALLS_LAYER_ID,
        color: {
          mode: 'EXPLICIT',
          value: { type: 'RGB', r: 0, g: 0, b: 255 },
        },
        linetype: { mode: 'EXPLICIT', value: 'Dashed' },
        lineweight: { mode: 'EXPLICIT', value: 0.5 },
      }),
    );
    bus.execute(new MatchPropertiesCommand(a, [b]));
    const dest = bus.getDocument().entities.find((e) => e.id === b)!;
    expect(getStoredAppearance(dest).linetype.mode).toBe('EXPLICIT');
    bus.undo();
    expect(
      getStoredAppearance(bus.getDocument().entities.find((e) => e.id === b)!)
        .color.mode,
    ).toBe('EXPLICIT'); // still green from current at creation

    bus.execute(new SetByLayerCommand([a], ['color']));
    const src = bus.getDocument().entities.find((e) => e.id === a)!;
    expect(getStoredAppearance(src).color.mode).toBe('BY_LAYER');
    expect(
      resolveEffectiveAppearance(src, bus.getDocument()).colorHex.toLowerCase(),
    ).toBe('#ff0000');
  });
});
