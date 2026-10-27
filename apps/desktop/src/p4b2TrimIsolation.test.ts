/**
 * P4-B2 — multi-document TRIM isolation (session engines + buses).
 */
import { describe, expect, it } from 'vitest';
import { createEmptyDocument, getEntity } from '@ratecad/core';
import { CreateLineCommand } from '@ratecad/commands';
import { createDocumentSession } from './documentSession.js';
import { prepareSessionDeactivation } from './documentSessionSwitch.js';
import { serializeDocument, parseDocument } from '@ratecad/io';

describe('P4-B2 multi-document TRIM isolation', () => {
  it('21: TRIM on session A does not modify session B', () => {
    const a = createDocumentSession({
      document: createEmptyDocument('A'),
      bindMinimalEngine: true,
    });
    const b = createDocumentSession({
      document: createEmptyDocument('B'),
      bindMinimalEngine: true,
    });

    const cutterA = new CreateLineCommand({ x: 5, y: -1 }, { x: 5, y: 1 });
    const lineA = new CreateLineCommand({ x: 0, y: 0 }, { x: 10, y: 0 });
    a.bus.execute(cutterA);
    a.bus.execute(lineA);

    const cutterB = new CreateLineCommand({ x: 2, y: -1 }, { x: 2, y: 1 });
    const lineB = new CreateLineCommand({ x: 0, y: 0 }, { x: 10, y: 0 });
    b.bus.execute(cutterB);
    b.bus.execute(lineB);
    const bBefore = structuredClone(b.bus.getDocument());

    a.engine!.start('TRIM');
    a.engine!.submitPoint({ x: 8, y: 0 });
    const trimmed = getEntity(a.bus.getDocument(), lineA.getEntityId());
    if (trimmed?.type === 'line') {
      expect(trimmed.geometry.end.x).toBeCloseTo(5);
    }

    expect(b.bus.getDocument().entities).toEqual(bBefore.entities);
    expect(b.engine!.isRunning()).toBe(false);
  });

  it('22: save/reopen preserves trimmed line geometry', () => {
    const session = createDocumentSession({
      document: createEmptyDocument('SaveTrim'),
      bindMinimalEngine: true,
    });
    const cutter = new CreateLineCommand({ x: 4, y: -1 }, { x: 4, y: 1 });
    const target = new CreateLineCommand({ x: 0, y: 0 }, { x: 10, y: 0 });
    session.bus.execute(cutter);
    session.bus.execute(target);
    session.engine!.start('TRIM');
    session.engine!.submitPoint({ x: 8, y: 0 });

    const json = serializeDocument(session.bus.getDocument());
    const restored = parseDocument(json);
    const ent = getEntity(restored, target.getEntityId());
    expect(ent?.type).toBe('line');
    if (ent?.type === 'line') {
      expect(ent.geometry.end.x).toBeCloseTo(4);
    }
  });

  it('tab deactivate cancels incomplete TRIM without leaking buffer', () => {
    const a = createDocumentSession({
      document: createEmptyDocument('A'),
      bindMinimalEngine: true,
    });
    a.engine!.start('TRIM');
    expect(a.engine!.isRunning()).toBe(true);
    prepareSessionDeactivation(a);
    expect(a.engine!.isRunning()).toBe(false);
    expect(a.engine!.getBuffer()).toBe('');
  });
});
