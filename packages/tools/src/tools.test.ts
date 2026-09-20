import { describe, expect, it, beforeEach } from 'vitest';
import {
  CommandBus,
  CreateLineCommand,
  CreateRectangleCommand,
  MoveEntitiesCommand,
} from '@ratecad/commands';
import {
  createEmptyDocument,
  getEntity,
  resetIdCounter,
  setSelection,
  toggleSelectionId,
} from '@ratecad/core';
import { resolveSnap } from '@ratecad/geometry';
import { createCamera } from '@ratecad/viewport';
import {
  cancelTool,
  createToolSession,
  handleToolPointerDown,
  handleToolPointerMove,
  handleToolPointerUp,
  setActiveTool,
} from './index.js';

function camera() {
  return createCamera();
}

describe('multi-selection', () => {
  beforeEach(() => resetIdCounter());

  it('adds and removes selection via toggle', () => {
    const bus = new CommandBus(createEmptyDocument());
    const a = new CreateLineCommand({ x: 0, y: 0 }, { x: 5, y: 0 });
    const b = new CreateLineCommand({ x: 10, y: 0 }, { x: 15, y: 0 });
    bus.execute(a);
    bus.execute(b);
    bus.updateWithoutHistory((doc) => setSelection(doc, [a.getEntityId()]));
    bus.updateWithoutHistory((doc) => toggleSelectionId(doc, b.getEntityId()));
    expect(bus.getDocument().selection).toEqual([
      a.getEntityId(),
      b.getEntityId(),
    ]);
    bus.updateWithoutHistory((doc) => toggleSelectionId(doc, a.getEntityId()));
    expect(bus.getDocument().selection).toEqual([b.getEntityId()]);
  });

  it('Ctrl+click toggles via select tool', () => {
    const bus = new CommandBus(createEmptyDocument());
    const a = new CreateLineCommand({ x: 0, y: 0 }, { x: 5, y: 0 });
    const b = new CreateLineCommand({ x: 10, y: 0 }, { x: 15, y: 0 });
    bus.execute(a);
    bus.execute(b);
    let session = createToolSession('select');
    session = handleToolPointerDown(session, bus, {
      world: { x: 2.5, y: 0 },
      camera: camera(),
    });
    expect(bus.getDocument().selection).toEqual([a.getEntityId()]);
    session = handleToolPointerDown(session, bus, {
      world: { x: 12.5, y: 0 },
      camera: camera(),
      ctrlKey: true,
    });
    expect(bus.getDocument().selection).toEqual([
      a.getEntityId(),
      b.getEntityId(),
    ]);
    handleToolPointerDown(session, bus, {
      world: { x: 2.5, y: 0 },
      camera: camera(),
      ctrlKey: true,
    });
    expect(bus.getDocument().selection).toEqual([b.getEntityId()]);
  });
});

describe('Move / Copy cancel', () => {
  beforeEach(() => resetIdCounter());

  it('Escape during Move restores original geometry (no commit)', () => {
    const bus = new CommandBus(createEmptyDocument());
    const create = new CreateLineCommand({ x: 0, y: 0 }, { x: 10, y: 0 });
    bus.execute(create);
    bus.updateWithoutHistory((doc) => setSelection(doc, [create.getEntityId()]));
    const before = structuredClone(getEntity(bus.getDocument(), create.getEntityId())!);

    let session = setActiveTool(createToolSession(), 'move');
    session = handleToolPointerDown(session, bus, {
      world: { x: 0, y: 0 },
      camera: camera(),
    });
    expect(session.mode).toBe('move');
    expect(session.anchor).toEqual({ x: 0, y: 0 });

    session = handleToolPointerMove(session, bus, {
      world: { x: 5, y: 5 },
      camera: camera(),
    });
    expect(session.previewEntities?.length).toBe(1);

    session = cancelTool(session);
    expect(session.mode).toBe('idle');
    expect(session.previewEntities).toBeNull();
    expect(getEntity(bus.getDocument(), create.getEntityId())).toEqual(before);
    expect(bus.canUndo()).toBe(true); // only the create remains undoable
  });

  it('Escape during Copy creates no new entities', () => {
    const bus = new CommandBus(createEmptyDocument());
    const create = new CreateRectangleCommand({ x: 0, y: 0 }, { x: 4, y: 3 });
    bus.execute(create);
    bus.updateWithoutHistory((doc) => setSelection(doc, [create.getEntityId()]));

    let session = setActiveTool(createToolSession(), 'copy');
    session = handleToolPointerDown(session, bus, {
      world: { x: 0, y: 0 },
      camera: camera(),
    });
    session = handleToolPointerMove(session, bus, {
      world: { x: 8, y: 0 },
      camera: camera(),
    });
    expect(session.previewEntities?.length).toBe(1);
    cancelTool(session);
    expect(bus.getDocument().entities).toHaveLength(1);
  });

  it('Escape during grip editing restores original geometry', () => {
    const bus = new CommandBus(createEmptyDocument());
    const create = new CreateLineCommand({ x: 0, y: 0 }, { x: 10, y: 0 });
    bus.execute(create);
    bus.updateWithoutHistory((doc) => setSelection(doc, [create.getEntityId()]));
    const before = structuredClone(getEntity(bus.getDocument(), create.getEntityId())!);

    let session = createToolSession('select');
    session = handleToolPointerDown(session, bus, {
      world: { x: 10, y: 0 },
      camera: camera(),
    });
    expect(session.mode).toBe('grip');

    session = handleToolPointerMove(session, bus, {
      world: { x: 20, y: 5 },
      camera: camera(),
    });
    expect(session.previewEntities?.[0]).not.toEqual(before);

    cancelTool(session);
    expect(getEntity(bus.getDocument(), create.getEntityId())).toEqual(before);
  });
});

describe('snap-aware modify tools', () => {
  beforeEach(() => resetIdCounter());

  it('Move destination uses SnapEngine endpoint', () => {
    const bus = new CommandBus(createEmptyDocument());
    bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 10, y: 0 }));
    const target = new CreateLineCommand({ x: 20, y: 0 }, { x: 30, y: 0 });
    bus.execute(target);
    bus.updateWithoutHistory((doc) =>
      setSelection(doc, [bus.getDocument().entities[0]!.id]),
    );

    // Near endpoint of second line — should snap
    const snap = resolveSnap(
      { x: 20.15, y: 0.1 },
      bus.getDocument(),
      { enabled: true, gridSize: 1, tolerance: 0.5 },
    );
    expect(snap.kind).toBe('endpoint');
    expect(snap.point).toEqual({ x: 20, y: 0 });

    let session = setActiveTool(createToolSession(), 'move');
    session = handleToolPointerDown(session, bus, {
      world: { x: 0, y: 0 },
      camera: camera(),
    });
    session = handleToolPointerDown(session, bus, {
      world: { x: 20.15, y: 0.1 },
      camera: camera(),
    });
    const moved = getEntity(bus.getDocument(), bus.getDocument().entities[0]!.id);
    if (moved?.type === 'line') {
      expect(moved.geometry.start).toEqual({ x: 20, y: 0 });
      expect(moved.geometry.end).toEqual({ x: 30, y: 0 });
    }
  });

  it('grip edit pointerUp commits via command (SnapEngine path)', () => {
    const bus = new CommandBus(createEmptyDocument());
    // Anchor line for snap target
    bus.execute(new CreateLineCommand({ x: 50, y: 0 }, { x: 60, y: 0 }));
    const create = new CreateLineCommand({ x: 0, y: 0 }, { x: 10, y: 0 });
    bus.execute(create);
    bus.updateWithoutHistory((doc) => setSelection(doc, [create.getEntityId()]));

    let session = createToolSession('select');
    session = handleToolPointerDown(session, bus, {
      world: { x: 10, y: 0 },
      camera: camera(),
    });
    expect(session.mode).toBe('grip');

    // Drag near endpoint (50,0) — snap should apply through handleToolPointerUp
    session = handleToolPointerMove(session, bus, {
      world: { x: 50.1, y: 0.05 },
      camera: camera(),
    });
    expect(session.lastSnap?.kind).toBe('endpoint');

    session = handleToolPointerUp(session, bus, {
      world: { x: 50.1, y: 0.05 },
      camera: camera(),
    });
    expect(session.mode).toBe('idle');
    const after = getEntity(bus.getDocument(), create.getEntityId());
    if (after?.type === 'line') {
      expect(after.geometry.end).toEqual({ x: 50, y: 0 });
    }
  });
});

describe('window selection tool', () => {
  beforeEach(() => resetIdCounter());

  it('window drag selects fully inside entities', () => {
    const bus = new CommandBus(createEmptyDocument());
    const inside = new CreateLineCommand({ x: 1, y: 1 }, { x: 2, y: 1 });
    const outside = new CreateLineCommand({ x: 20, y: 20 }, { x: 25, y: 20 });
    bus.execute(inside);
    bus.execute(outside);

    let session = createToolSession('select');
    session = handleToolPointerDown(session, bus, {
      world: { x: 0, y: 0 },
      camera: camera(),
    });
    expect(session.mode).toBe('window');
    session = handleToolPointerMove(session, bus, {
      world: { x: 5, y: 5 },
      camera: camera(),
    });
    session = handleToolPointerUp(session, bus, {
      world: { x: 5, y: 5 },
      camera: camera(),
    });
    expect(bus.getDocument().selection).toEqual([inside.getEntityId()]);
  });
});

describe('move multi entities via tool', () => {
  beforeEach(() => resetIdCounter());

  it('moves multiple selected entities together', () => {
    const bus = new CommandBus(createEmptyDocument());
    const a = new CreateLineCommand({ x: 0, y: 0 }, { x: 5, y: 0 });
    const b = new CreateRectangleCommand({ x: 0, y: 2 }, { x: 3, y: 4 });
    bus.execute(a);
    bus.execute(b);
    const ids = [a.getEntityId(), b.getEntityId()];
    bus.updateWithoutHistory((doc) => setSelection(doc, ids));
    const entities = ids.map((id) => getEntity(bus.getDocument(), id)!);
    bus.execute(new MoveEntitiesCommand(entities, { x: 2, y: 1 }));
    const line = getEntity(bus.getDocument(), a.getEntityId());
    if (line?.type === 'line') {
      expect(line.geometry.start).toEqual({ x: 2, y: 1 });
    }
    const rect = getEntity(bus.getDocument(), b.getEntityId());
    if (rect?.type === 'rectangle') {
      expect(rect.geometry.corner1).toEqual({ x: 2, y: 3 });
    }
  });
});
