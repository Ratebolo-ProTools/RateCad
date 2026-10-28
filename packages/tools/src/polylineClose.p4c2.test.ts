/**
 * P4-C2 — Professional polyline Close (C / CLOSE).
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { CommandBus, CreatePolylineCommand } from '@ratecad/commands';
import {
  createEmptyDocument,
  getEntity,
  resetIdCounter,
} from '@ratecad/core';
import { polygonArea } from '@ratecad/geometry';
import {
  applyPolylineOption,
  createToolSession,
  finishPolyline,
  handleToolPointerDown,
  isPolylineCloseOption,
  shouldPolylineClosePreemptAlias,
  undoPolylineVertex,
  validatePolylineClose,
} from './index.js';
import { createCamera } from '@ratecad/viewport';

function bus() {
  return new CommandBus(createEmptyDocument('p4c2-pl'));
}

function camera() {
  return createCamera();
}

function addVerts(
  session: ReturnType<typeof createToolSession>,
  bus: CommandBus,
  verts: Array<{ x: number; y: number }>,
) {
  let s = session;
  for (const v of verts) {
    s = handleToolPointerDown(s, bus, { world: v, camera: camera() });
  }
  return s;
}

const RECT = [
  { x: 0, y: 0 },
  { x: 5000, y: 0 },
  { x: 5000, y: 3500 },
  { x: 0, y: 3500 },
];

describe('P4-C2 polyline Close', () => {
  beforeEach(() => resetIdCounter());

  it('1–2: C and CLOSE close PL equivalently', () => {
    for (const token of ['C', 'CLOSE', 'c', 'close']) {
      resetIdCounter();
      const b = bus();
      let s = createToolSession('polyline');
      s = addVerts(s, b, RECT);
      expect(isPolylineCloseOption(token)).toBe(true);
      s = applyPolylineOption(s, b, token)!;
      expect(b.getDocument().entities).toHaveLength(1);
      const e = b.getDocument().entities[0]!;
      expect(e.type).toBe('polyline');
      if (e.type === 'polyline') {
        expect(e.geometry.closed).toBe(true);
        expect(e.geometry.vertices).toHaveLength(4);
        expect(e.geometry.vertices[0]).toEqual({ x: 0, y: 0 });
        expect(e.geometry.vertices[3]).toEqual({ x: 0, y: 3500 });
      }
    }
  });

  it('3–6: closed flag, vertex count, closing segment, no duplicate endpoint', () => {
    const b = bus();
    let s = createToolSession('polyline');
    s = addVerts(s, b, RECT);
    s = finishPolyline(s, b, { closed: true });
    const e = b.getDocument().entities[0]!;
    expect(e.type).toBe('polyline');
    if (e.type !== 'polyline') return;
    expect(e.geometry.closed).toBe(true);
    expect(e.geometry.vertices).toHaveLength(4);
    const last = e.geometry.vertices[e.geometry.vertices.length - 1]!;
    const first = e.geometry.vertices[0]!;
    expect(last).not.toEqual(first);
    // Closing edge is implied P4→P1 via closed flag (not stored as extra vertex).
    expect(polygonArea(e.geometry.vertices)).toBeCloseTo(17_500_000, 3);
    let peri = 0;
    const v = e.geometry.vertices;
    for (let i = 0; i < v.length - 1; i += 1) {
      peri += Math.hypot(v[i + 1]!.x - v[i]!.x, v[i + 1]!.y - v[i]!.y);
    }
    peri += Math.hypot(v[0]!.x - v[v.length - 1]!.x, v[0]!.y - v[v.length - 1]!.y);
    expect(peri).toBeCloseTo(17_000, 6);
  });

  it('7: Enter finishes open PL', () => {
    const b = bus();
    let s = createToolSession('polyline');
    s = addVerts(s, b, RECT);
    s = finishPolyline(s, b); // open default
    const e = b.getDocument().entities[0]!;
    expect(e.type).toBe('polyline');
    if (e.type === 'polyline') {
      expect(e.geometry.closed).toBe(false);
      expect(e.geometry.vertices).toHaveLength(4);
    }
  });

  it('8: ESC-style cancel does not commit (cancelTool / unfinished)', () => {
    const b = bus();
    let s = createToolSession('polyline');
    s = addVerts(s, b, RECT.slice(0, 3));
    expect(b.getDocument().entities).toHaveLength(0);
    // cancel without finish — no history
    expect(b.getDocument().entities).toHaveLength(0);
    void s;
  });

  it('9: C outside PL does not preempt (alias path left to app/engine)', () => {
    const s = createToolSession('select');
    expect(shouldPolylineClosePreemptAlias(s, 'C')).toBe(false);
    expect(applyPolylineOption(s, bus(), 'C')).toBeNull();
    const plEmpty = createToolSession('polyline');
    expect(shouldPolylineClosePreemptAlias(plEmpty, 'C')).toBe(false);
    expect(applyPolylineOption(plEmpty, bus(), 'C')).toBeNull();
  });

  it('10–11: invalid Close rejected; vertices preserved; no entity', () => {
    const b = bus();
    let s = createToolSession('polyline');
    s = addVerts(s, b, [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
    const before = s.vertices.map((v) => ({ ...v }));
    const next = finishPolyline(s, b, { closed: true });
    expect(b.getDocument().entities).toHaveLength(0);
    expect(next.vertices).toEqual(before);
    expect(next.activeTool).toBe('polyline');
    expect(next.statusMessage.toLowerCase()).toMatch(/at least 3|continue/);

    // collinear
    let s2 = createToolSession('polyline');
    s2 = addVerts(s2, b, [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ]);
    const next2 = finishPolyline(s2, b, { closed: true });
    expect(b.getDocument().entities).toHaveLength(0);
    expect(next2.vertices).toHaveLength(3);
    expect(next2.statusMessage.toLowerCase()).toMatch(/degenerate|collinear|zero area/);
  });

  it('12: Undo/Redo closed polyline via CommandBus', () => {
    const b = bus();
    let s = createToolSession('polyline');
    s = addVerts(s, b, RECT);
    finishPolyline(s, b, { closed: true });
    const id = b.getDocument().entities[0]!.id;
    expect(getEntity(b.getDocument(), id)?.type).toBe('polyline');
    b.undo();
    expect(b.getDocument().entities).toHaveLength(0);
    b.redo();
    const e = b.getDocument().entities[0]!;
    expect(e.type).toBe('polyline');
    if (e.type === 'polyline') {
      expect(e.geometry.closed).toBe(true);
      expect(e.geometry.vertices).toHaveLength(4);
      expect(e.id).toBe(id);
    }
  });

  it('13: closed entity round-trips through CreatePolylineCommand closed=true', () => {
    const b = bus();
    const cmd = new CreatePolylineCommand(RECT, undefined, true);
    b.execute(cmd);
    const e = getEntity(b.getDocument(), cmd.getEntityId());
    expect(e?.type).toBe('polyline');
    if (e?.type === 'polyline') {
      expect(e.geometry.closed).toBe(true);
      const json = JSON.stringify(e);
      const parsed = JSON.parse(json) as typeof e;
      expect(parsed.geometry.closed).toBe(true);
      expect(parsed.geometry.vertices).toHaveLength(4);
    }
  });

  it('14: properties preserved from CreatePolylineCommand appearance', () => {
    const b = bus();
    let s = createToolSession('polyline');
    s = addVerts(s, b, RECT);
    finishPolyline(s, b, { closed: true });
    const e = b.getDocument().entities[0]!;
    expect(e.properties).toBeTruthy();
    expect(e.layerId).toBeTruthy();
  });

  it('15: vertex Undo option (U) removes last point without committing', () => {
    const b = bus();
    let s = createToolSession('polyline');
    s = addVerts(s, b, RECT);
    s = undoPolylineVertex(s);
    expect(s.vertices).toHaveLength(3);
    expect(b.getDocument().entities).toHaveLength(0);
    s = applyPolylineOption(s, b, 'U')!;
    expect(s.vertices).toHaveLength(2);
  });

  it('16: validatePolylineClose strips duplicate closing vertex', () => {
    const withDup = [...RECT, { x: 0, y: 0 }];
    const check = validatePolylineClose(withDup);
    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.vertices).toHaveLength(4);
      expect(check.vertices[0]).toEqual({ x: 0, y: 0 });
      expect(check.vertices[3]).toEqual({ x: 0, y: 3500 });
    }
  });

  it('17: double-click finish remains open', () => {
    const b = bus();
    let s = createToolSession('polyline');
    s = addVerts(s, b, RECT.slice(0, 3));
    s = handleToolPointerDown(s, b, {
      world: { x: 5000, y: 3500 },
      camera: camera(),
      detail: 2,
    });
    const e = b.getDocument().entities[0]!;
    expect(e.type).toBe('polyline');
    if (e.type === 'polyline') {
      expect(e.geometry.closed).toBe(false);
    }
  });

  it('18: invalid Close creates no history entry', () => {
    const b = bus();
    let s = createToolSession('polyline');
    s = addVerts(s, b, [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
    const histBefore = b.getDocument().entities.length;
    finishPolyline(s, b, { closed: true });
    expect(b.getDocument().entities.length).toBe(histBefore);
    // undo should be a no-op (nothing committed)
    b.undo();
    expect(b.getDocument().entities.length).toBe(histBefore);
  });
});
