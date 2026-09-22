import { describe, expect, it, beforeEach } from 'vitest';
import {
  CommandBus,
  CreateRectangleCommand,
} from '@ratecad/commands';
import {
  createEmptyDocument,
  getEntity,
  resetIdCounter,
} from '@ratecad/core';
import { createCamera } from '@ratecad/viewport';
import {
  constrainRectangleCorner,
  createToolSession,
  handleToolPointerDown,
  handleToolPointerMove,
  isDegenerateRectangle,
  setActiveTool,
  setRectangleConstraints,
} from './index.js';

function camera() {
  return createCamera();
}

describe('constrainRectangleCorner', () => {
  it('free drag follows cursor', () => {
    const c2 = constrainRectangleCorner(
      { x: 0, y: 0 },
      { x: 4, y: -3 },
      null,
      null,
    );
    expect(c2).toEqual({ x: 4, y: -3 });
  });

  it('Length only constrains |Δx|; width follows cursor', () => {
    const c2 = constrainRectangleCorner(
      { x: 0, y: 0 },
      { x: 100, y: 5 },
      10,
      null,
    );
    expect(c2.x).toBe(10);
    expect(c2.y).toBe(5);
  });

  it('Width only constrains |Δy|; length follows cursor', () => {
    const c2 = constrainRectangleCorner(
      { x: 0, y: 0 },
      { x: 7, y: -100 },
      null,
      6,
    );
    expect(c2.x).toBe(7);
    expect(c2.y).toBe(-6);
  });

  it('Length + Width create exact size toward cursor quadrant', () => {
    const ne = constrainRectangleCorner({ x: 0, y: 0 }, { x: 1, y: 1 }, 10, 6);
    expect(ne).toEqual({ x: 10, y: 6 });
    const sw = constrainRectangleCorner(
      { x: 0, y: 0 },
      { x: -1, y: -1 },
      10,
      6,
    );
    expect(sw).toEqual({ x: -10, y: -6 });
  });

  it('detects degenerate rectangles', () => {
    expect(
      isDegenerateRectangle({ x: 0, y: 0 }, { x: 0, y: 5 }),
    ).toBe(true);
    expect(
      isDegenerateRectangle({ x: 0, y: 0 }, { x: 5, y: 5 }),
    ).toBe(false);
  });
});

describe('rectangle tool constraints via CommandBus', () => {
  beforeEach(() => resetIdCounter());

  it('preview does not mutate the document', () => {
    const bus = new CommandBus(createEmptyDocument());
    let session = setActiveTool(createToolSession(), 'rectangle');
    session = setRectangleConstraints(session, 10, null);
    session = handleToolPointerDown(session, bus, {
      world: { x: 0, y: 0 },
      camera: camera(),
    });
    session = handleToolPointerMove(session, bus, {
      world: { x: 50, y: 3 },
      camera: camera(),
    });
    expect(bus.getDocument().entities).toHaveLength(0);
    expect(session.preview?.kind).toBe('rectangle');
    expect(session.preview?.end).toEqual({ x: 10, y: 3 });
  });

  it('Length + Width creates exact rectangle through CreateRectangleCommand', () => {
    const bus = new CommandBus(createEmptyDocument());
    let session = setActiveTool(createToolSession(), 'rectangle');
    session = setRectangleConstraints(session, 10, 6);
    session = handleToolPointerDown(session, bus, {
      world: { x: 1, y: 2 },
      camera: camera(),
    });
    handleToolPointerDown(session, bus, {
      world: { x: 100, y: 100 },
      camera: camera(),
    });
    expect(bus.getDocument().entities).toHaveLength(1);
    const entity = bus.getDocument().entities[0]!;
    expect(entity.type).toBe('rectangle');
    if (entity.type === 'rectangle') {
      expect(entity.geometry.corner1).toEqual({ x: 1, y: 2 });
      expect(entity.geometry.corner2).toEqual({ x: 11, y: 8 });
      expect(entity.layerId).toBe(bus.getDocument().currentLayerId);
    }
  });

  it('Length only keeps length fixed while width follows cursor', () => {
    const bus = new CommandBus(createEmptyDocument());
    let session = setActiveTool(createToolSession(), 'rectangle');
    session = setRectangleConstraints(session, 10, null);
    session = handleToolPointerDown(session, bus, {
      world: { x: 0, y: 0 },
      camera: camera(),
    });
    handleToolPointerDown(session, bus, {
      world: { x: 99, y: -4 },
      camera: camera(),
    });
    const entity = bus.getDocument().entities[0]!;
    expect(entity.type).toBe('rectangle');
    if (entity.type === 'rectangle') {
      expect(Math.abs(entity.geometry.corner2.x - entity.geometry.corner1.x)).toBe(
        10,
      );
      expect(Math.abs(entity.geometry.corner2.y - entity.geometry.corner1.y)).toBe(
        4,
      );
    }
  });

  it('Width only keeps width fixed while length follows cursor', () => {
    const bus = new CommandBus(createEmptyDocument());
    let session = setActiveTool(createToolSession(), 'rectangle');
    session = setRectangleConstraints(session, null, 6);
    session = handleToolPointerDown(session, bus, {
      world: { x: 0, y: 0 },
      camera: camera(),
    });
    handleToolPointerDown(session, bus, {
      world: { x: 8, y: 99 },
      camera: camera(),
    });
    const entity = bus.getDocument().entities[0]!;
    expect(entity.type).toBe('rectangle');
    if (entity.type === 'rectangle') {
      expect(Math.abs(entity.geometry.corner2.x - entity.geometry.corner1.x)).toBe(
        8,
      );
      expect(Math.abs(entity.geometry.corner2.y - entity.geometry.corner1.y)).toBe(
        6,
      );
    }
  });

  it('free drag rectangle works with no constraints', () => {
    const bus = new CommandBus(createEmptyDocument());
    let session = setActiveTool(createToolSession(), 'rectangle');
    session = handleToolPointerDown(session, bus, {
      world: { x: 0, y: 0 },
      camera: camera(),
    });
    handleToolPointerDown(session, bus, {
      world: { x: 3, y: 2 },
      camera: camera(),
    });
    const entity = bus.getDocument().entities[0]!;
    expect(entity.type).toBe('rectangle');
    if (entity.type === 'rectangle') {
      expect(entity.geometry.corner2).toEqual({ x: 3, y: 2 });
    }
  });

  it('does not create a zero-size rectangle', () => {
    const bus = new CommandBus(createEmptyDocument());
    let session = setActiveTool(createToolSession(), 'rectangle');
    session = handleToolPointerDown(session, bus, {
      world: { x: 0, y: 0 },
      camera: camera(),
    });
    handleToolPointerDown(session, bus, {
      world: { x: 0, y: 0 },
      camera: camera(),
    });
    expect(bus.getDocument().entities).toHaveLength(0);
  });

  it('undo removes rectangle; redo restores it', () => {
    const bus = new CommandBus(createEmptyDocument());
    const cmd = new CreateRectangleCommand({ x: 0, y: 0 }, { x: 10, y: 6 });
    bus.execute(cmd);
    expect(bus.getDocument().entities).toHaveLength(1);
    const id = cmd.getEntityId();
    bus.undo();
    expect(getEntity(bus.getDocument(), id)).toBeUndefined();
    bus.redo();
    expect(getEntity(bus.getDocument(), id)?.type).toBe('rectangle');
  });

  it('UI setActiveTool rectangle path still works without constraints', () => {
    const bus = new CommandBus(createEmptyDocument());
    let session = setActiveTool(createToolSession('select'), 'rectangle');
    expect(session.activeTool).toBe('rectangle');
    session = handleToolPointerDown(session, bus, {
      world: { x: 1, y: 1 },
      camera: camera(),
    });
    handleToolPointerDown(session, bus, {
      world: { x: 4, y: 5 },
      camera: camera(),
    });
    expect(bus.getDocument().entities).toHaveLength(1);
  });
});
