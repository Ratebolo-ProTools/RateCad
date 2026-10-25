import { describe, expect, it } from 'vitest';
import { CommandBus, CreateLineCommand } from '@ratecad/commands';
import { createEmptyDocument } from '@ratecad/core';
import { createCamera } from '@ratecad/viewport';
import {
  createToolSession,
  handleToolPointerDown,
} from './index.js';

function busWithSnapOff() {
  const doc = createEmptyDocument();
  return new CommandBus({
    ...doc,
    settings: { ...doc.settings, snapToGrid: false },
  });
}

describe('pickbox selection aperture', () => {
  it('uses pickboxPx for single-click selection', () => {
    const bus = busWithSnapOff();
    bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 10, y: 0 }));
    const id = bus.getDocument().entities[0]!.id;
    const camera = createCamera({ zoom: 40, centerX: 5, centerY: 0 });
    const session = createToolSession('select');

    // 6px off the line — inside medium (8) pickbox
    const hit = handleToolPointerDown(session, bus, {
      world: { x: 5, y: 6 / 40 },
      camera,
      pickboxPx: 8,
    });
    expect(bus.getDocument().selection).toEqual([id]);
    expect(hit.statusMessage).toContain('Selected');

    // Clear then miss with small pickbox (4px) — 12 screen px away
    bus.updateWithoutHistory((doc) => ({ ...doc, selection: [] }));
    handleToolPointerDown(createToolSession('select'), bus, {
      world: { x: 5, y: 12 / 40 },
      camera,
      pickboxPx: 4,
    });
    expect(bus.getDocument().selection).toEqual([]);
    // Same point still hits with large pickbox (12px)
    handleToolPointerDown(createToolSession('select'), bus, {
      world: { x: 5, y: 12 / 40 },
      camera,
      pickboxPx: 12,
    });
    expect(bus.getDocument().selection).toEqual([id]);
  });

  it('preserves Ctrl multi-selection with pickbox', () => {
    const bus = busWithSnapOff();
    bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 10, y: 0 }));
    bus.execute(new CreateLineCommand({ x: 0, y: 2 }, { x: 10, y: 2 }));
    const ids = bus.getDocument().entities.map((e) => e.id);
    const camera = createCamera({ zoom: 40, centerX: 5, centerY: 1 });

    handleToolPointerDown(createToolSession('select'), bus, {
      world: { x: 5, y: 0 },
      camera,
      pickboxPx: 8,
    });
    handleToolPointerDown(createToolSession('select'), bus, {
      world: { x: 5, y: 2 },
      camera,
      pickboxPx: 8,
      ctrlKey: true,
    });
    expect(bus.getDocument().selection.sort()).toEqual([...ids].sort());
  });
});
