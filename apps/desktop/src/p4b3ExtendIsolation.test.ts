/**
 * P4-B3 — multi-document EXTEND isolation + save/reopen.
 */
import { describe, expect, it } from 'vitest';
import { createEmptyDocument, getEntity } from '@ratecad/core';
import { CreateLineCommand } from '@ratecad/commands';
import { serializeDocument, parseDocument } from '@ratecad/io';
import { createDocumentSession } from './documentSession.js';
import { prepareSessionDeactivation } from './documentSessionSwitch.js';

describe('P4-B3 multi-document EXTEND isolation', () => {
  it('26: EXTEND on session A does not modify session B', () => {
    const a = createDocumentSession({
      document: createEmptyDocument('A'),
      bindMinimalEngine: true,
    });
    const b = createDocumentSession({
      document: createEmptyDocument('B'),
      bindMinimalEngine: true,
    });

    const boundaryA = new CreateLineCommand({ x: 5, y: -1 }, { x: 5, y: 1 });
    const lineA = new CreateLineCommand({ x: 0, y: 0 }, { x: 2, y: 0 });
    a.bus.execute(boundaryA);
    a.bus.execute(lineA);

    const boundaryB = new CreateLineCommand({ x: 8, y: -1 }, { x: 8, y: 1 });
    const lineB = new CreateLineCommand({ x: 0, y: 0 }, { x: 3, y: 0 });
    b.bus.execute(boundaryB);
    b.bus.execute(lineB);
    const bBefore = structuredClone(b.bus.getDocument());

    a.engine!.start('EXTEND');
    a.engine!.submitPoint({ x: 5, y: 0 });
    a.engine!.submitText('');
    a.engine!.submitPoint({ x: 2, y: 0 });

    const trimmed = getEntity(a.bus.getDocument(), lineA.getEntityId());
    if (trimmed?.type === 'line') {
      expect(trimmed.geometry.end.x).toBeCloseTo(5);
    }

    expect(b.bus.getDocument().entities).toEqual(bBefore.entities);
    expect(b.engine!.isRunning()).toBe(false);
  });

  it('27: save/reopen preserves extended line geometry', () => {
    const session = createDocumentSession({
      document: createEmptyDocument('SaveExtend'),
      bindMinimalEngine: true,
    });
    const boundary = new CreateLineCommand({ x: 7, y: -1 }, { x: 7, y: 1 });
    const target = new CreateLineCommand({ x: 0, y: 0 }, { x: 2, y: 0 });
    session.bus.execute(boundary);
    session.bus.execute(target);
    session.engine!.start('EXTEND');
    session.engine!.submitPoint({ x: 7, y: 0 });
    session.engine!.submitText('');
    session.engine!.submitPoint({ x: 2, y: 0 });

    const json = serializeDocument(session.bus.getDocument());
    const restored = parseDocument(json);
    const ent = getEntity(restored, target.getEntityId());
    expect(ent?.type).toBe('line');
    if (ent?.type === 'line') {
      expect(ent.geometry.end.x).toBeCloseTo(7);
    }
  });

  it('tab deactivate cancels incomplete EXTEND without leaking buffer', () => {
    const a = createDocumentSession({
      document: createEmptyDocument('A'),
      bindMinimalEngine: true,
    });
    a.engine!.start('EXTEND');
    expect(a.engine!.isRunning()).toBe(true);
    prepareSessionDeactivation(a);
    expect(a.engine!.isRunning()).toBe(false);
    expect(a.engine!.getBuffer()).toBe('');
  });
});
