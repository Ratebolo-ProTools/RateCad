/**
 * P4-B4 — multi-document TRIM/EXTEND interaction isolation + save/reopen.
 */
import { describe, expect, it } from 'vitest';
import { createEmptyDocument, getEntity } from '@ratecad/core';
import { CreateLineCommand } from '@ratecad/commands';
import { serializeDocument, parseDocument } from '@ratecad/io';
import { createDocumentSession } from './documentSession.js';
import { prepareSessionDeactivation } from './documentSessionSwitch.js';

describe('P4-B4 multi-document TRIM/EXTEND interaction isolation', () => {
  it('23: TRIM on session A does not affect EXTEND state on session B', () => {
    const a = createDocumentSession({
      document: createEmptyDocument('A'),
      bindMinimalEngine: true,
    });
    const b = createDocumentSession({
      document: createEmptyDocument('B'),
      bindMinimalEngine: true,
    });

    a.bus.execute(new CreateLineCommand({ x: 4, y: -1 }, { x: 4, y: 1 }));
    const lineA = new CreateLineCommand({ x: 0, y: 0 }, { x: 10, y: 0 });
    a.bus.execute(lineA);

    b.bus.execute(new CreateLineCommand({ x: 8, y: -1 }, { x: 8, y: 1 }));
    const lineB = new CreateLineCommand({ x: 0, y: 0 }, { x: 2, y: 0 });
    b.bus.execute(lineB);
    const bBefore = structuredClone(b.bus.getDocument());

    b.engine!.start('EXTEND');
    expect(b.engine!.isRunning()).toBe(true);

    a.engine!.start('TRIM');
    a.engine!.submitPoint({ x: 8, y: 0 });
    const trimmed = getEntity(a.bus.getDocument(), lineA.getEntityId());
    if (trimmed?.type === 'line') {
      expect(trimmed.geometry.end.x).toBeCloseTo(4);
    }

    expect(b.bus.getDocument().entities).toEqual(bBefore.entities);
    expect(b.engine!.isRunning()).toBe(true);
    expect(b.engine!.getUiState().commandName).toBe('EXTEND');

    b.engine!.submitPoint({ x: 2, y: 0 });
    const extended = getEntity(b.bus.getDocument(), lineB.getEntityId());
    if (extended?.type === 'line') {
      expect(extended.geometry.end.x).toBeCloseTo(8);
    }
  });

  it('24: save/reopen preserves Quick-mode TRIM + EXTEND results', () => {
    const session = createDocumentSession({
      document: createEmptyDocument('SaveP4B4'),
      bindMinimalEngine: true,
    });
    // Isolated TRIM scene
    session.bus.execute(new CreateLineCommand({ x: 5, y: -1 }, { x: 5, y: 1 }));
    const trimTarget = new CreateLineCommand({ x: 0, y: 0 }, { x: 10, y: 0 });
    session.bus.execute(trimTarget);
    session.engine!.start('TRIM');
    session.engine!.submitPoint({ x: 8, y: 0 });
    session.engine!.submitText('');

    // Isolated EXTEND scene (y=4 — clear of prior TRIM cutters/targets)
    session.bus.execute(new CreateLineCommand({ x: 9, y: 3 }, { x: 9, y: 5 }));
    const extTarget = new CreateLineCommand({ x: 0, y: 4 }, { x: 2, y: 4 });
    session.bus.execute(extTarget);
    session.engine!.start('EXTEND');
    session.engine!.submitPoint({ x: 2, y: 4 });

    const json = serializeDocument(session.bus.getDocument());
    const restored = parseDocument(json);
    const t = getEntity(restored, trimTarget.getEntityId());
    const e = getEntity(restored, extTarget.getEntityId());
    if (t?.type === 'line') expect(t.geometry.end.x).toBeCloseTo(5);
    if (e?.type === 'line') expect(e.geometry.end.x).toBeCloseTo(9);
  });

  it('tab switch clears incomplete EXTEND preview/command without touching other docs', () => {
    const a = createDocumentSession({
      document: createEmptyDocument('A'),
      bindMinimalEngine: true,
    });
    const b = createDocumentSession({
      document: createEmptyDocument('B'),
      bindMinimalEngine: true,
    });
    b.bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 1, y: 0 }));
    const bBefore = structuredClone(b.bus.getDocument());

    a.engine!.start('EXTEND');
    a.engine!.submitText('fence');
    a.engine!.submitPoint({ x: 0, y: 0 });
    expect(a.engine!.isRunning()).toBe(true);
    prepareSessionDeactivation(a);
    expect(a.engine!.isRunning()).toBe(false);
    expect(a.engine!.getBuffer()).toBe('');
    expect(b.bus.getDocument().entities).toEqual(bBefore.entities);
  });
});
