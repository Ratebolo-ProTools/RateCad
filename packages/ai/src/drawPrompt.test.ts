import { describe, expect, it } from 'vitest';
import { CommandBus, CreateLineCommand } from '@ratecad/commands';
import {
  createEmptyDocument,
  type DrawingDocument,
  type LineEntity,
} from '@ratecad/core';
import { compileDrawIntent } from './compileDrawIntent.js';
import { applyPreparedDraw, previewDrawPrompt } from './executeDrawPrompt.js';
import { parseDrawPrompt } from './parseDrawPrompt.js';

function modelDoc(name = 'AI-2'): DrawingDocument {
  const doc = createEmptyDocument(name);
  return {
    ...doc,
    settings: { ...doc.settings, worldUnit: 'ft', units: 'ft-in' },
  };
}

describe('AI-2 draw prompts', () => {
  it('parses the four foundation instructions', () => {
    const doc = modelDoc();
    const line = previewDrawPrompt('Draw a line from 0,0 to 12 ft,0', {
      document: doc,
      workspaceMode: 'MODEL_SPACE',
    });
    const rect = previewDrawPrompt('Draw a 12 ft by 10 ft rectangle at 0,0', {
      document: doc,
      workspaceMode: 'MODEL_SPACE',
    });
    const circle = previewDrawPrompt(
      'Draw a circle of radius 5 ft at 10 ft,10 ft',
      { document: doc, workspaceMode: 'MODEL_SPACE' },
    );
    const pline = previewDrawPrompt(
      'Draw a polyline through 0,0; 10 ft,0; 10 ft,8 ft; close',
      { document: doc, workspaceMode: 'MODEL_SPACE' },
    );
    expect(
      line.ok && line.prepared.kind === 'draw' && line.prepared.entities[0]?.kind,
    ).toBe('line');
    expect(
      rect.ok && rect.prepared.kind === 'draw' && rect.prepared.entities[0]?.kind,
    ).toBe('rectangle');
    expect(
      circle.ok &&
        circle.prepared.kind === 'draw' &&
        circle.prepared.entities[0]?.kind,
    ).toBe('circle');
    expect(
      pline.ok && pline.prepared.kind === 'draw' && pline.prepared.entities[0]?.kind,
    ).toBe('polyline');
    expect(doc.entities).toHaveLength(0);
  });

  it('accepts capitalization, spacing, and punctuation', () => {
    const parsed = parseDrawPrompt(
      '  DRAW   a   LINE   from  (0, 0)  to  (12 ft, 0). ',
      'ft',
      'ft-in',
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.parsed.intent).toMatchObject({
      kind: 'line',
      start: { x: 0, y: 0 },
      end: { x: 12, y: 0 },
    });
  });

  it('discloses an omitted rectangle origin and does not invent a size', () => {
    const omitted = parseDrawPrompt('Draw a 12 ft by 10 ft rectangle', 'ft', 'ft');
    expect(omitted.ok).toBe(true);
    if (!omitted.ok) return;
    expect(omitted.parsed.intent).toMatchObject({
      kind: 'rectangle',
      corner: { x: 0, y: 0 },
      originAssumed: true,
    });
    expect(omitted.parsed.assumptions.join(' ')).toMatch(/\(0,0\)/);

    const missing = parseDrawPrompt('Draw a rectangle at 0,0', 'ft', 'ft');
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.error).toMatch(/width and a height/i);
  });

  it('rejects a circle without a radius and converts a diameter', () => {
    const missing = parseDrawPrompt('Draw a circle at 10 ft,10 ft', 'ft', 'ft');
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toMatch(/radius or a diameter/i);

    const diameter = parseDrawPrompt(
      'Draw a circle diameter 8 ft at 0,0',
      'ft',
      'ft',
    );
    expect(diameter.ok).toBe(true);
    if (!diameter.ok) return;
    expect(diameter.parsed.intent).toMatchObject({ kind: 'circle', radius: 4 });
    expect(diameter.parsed.assumptions.join(' ')).toMatch(/radius/i);
  });

  it('applies world geometry, one undo, and redo', () => {
    const bus = new CommandBus(modelDoc());
    const preview = previewDrawPrompt(
      'Draw a circle of radius 5 ft at 10 ft, 10 ft',
      { document: bus.getDocument(), workspaceMode: 'MODEL_SPACE' },
    );
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const applied = applyPreparedDraw(bus, preview.prepared, 'MODEL_SPACE');
    expect(applied.ok).toBe(true);
    expect(bus.getUndoDepth()).toBe(1);
    const circle = bus.getDocument().entities[0];
    expect(circle?.type).toBe('circle');
    if (circle?.type !== 'circle') return;
    expect(circle.geometry.center).toEqual({ x: 10, y: 10 });
    expect(circle.geometry.radius).toBeCloseTo(5);
    expect(circle.layerId).toBe(bus.getDocument().currentLayerId);

    const line = previewDrawPrompt('Draw a line from 0,0 to 12 ft,0', {
      document: bus.getDocument(),
      workspaceMode: 'MODEL_SPACE',
    });
    expect(line.ok).toBe(true);
    if (!line.ok) return;
    applyPreparedDraw(bus, line.prepared, 'MODEL_SPACE');
    const segment = bus.getDocument().entities.find((entity) => entity.type === 'line');
    expect(segment && segment.type === 'line' && segment.geometry.end.x).toBeCloseTo(12);

    const rect = previewDrawPrompt('Draw a 12 ft by 10 ft rectangle at 0,0', {
      document: bus.getDocument(),
      workspaceMode: 'MODEL_SPACE',
    });
    expect(rect.ok).toBe(true);
    if (!rect.ok) return;
    applyPreparedDraw(bus, rect.prepared, 'MODEL_SPACE');
    const box = bus.getDocument().entities.find((entity) => entity.type === 'rectangle');
    expect(box && box.type === 'rectangle' && box.geometry.corner2).toEqual({
      x: 12,
      y: 10,
    });

    const pline = previewDrawPrompt(
      'Draw a polyline through 0,0; 10 ft,0; 10 ft,8 ft; close',
      { document: bus.getDocument(), workspaceMode: 'MODEL_SPACE' },
    );
    expect(pline.ok).toBe(true);
    if (!pline.ok) return;
    const depth = bus.getUndoDepth();
    applyPreparedDraw(bus, pline.prepared, 'MODEL_SPACE');
    expect(bus.getUndoDepth()).toBe(depth + 1);
    const poly = bus.getDocument().entities.find((entity) => entity.type === 'polyline');
    expect(poly && poly.type === 'polyline' && poly.geometry.closed).toBe(true);
    expect(poly && poly.type === 'polyline' && poly.geometry.vertices).toHaveLength(3);

    bus.undo();
    expect(bus.getDocument().entities.some((entity) => entity.type === 'polyline')).toBe(
      false,
    );
    bus.redo();
    expect(bus.getDocument().entities.some((entity) => entity.type === 'polyline')).toBe(
      true,
    );
  });

  it('leaves an existing entity and its properties untouched', () => {
    const bus = new CommandBus(modelDoc('keep'));
    bus.execute(new CreateLineCommand({ x: 1, y: 2 }, { x: 3, y: 4 }));
    const before = structuredClone(bus.getDocument().entities[0]) as LineEntity;
    const preview = previewDrawPrompt('Draw a 4 ft by 2 ft rectangle at 5 ft,5 ft', {
      document: bus.getDocument(),
      workspaceMode: 'MODEL_SPACE',
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    applyPreparedDraw(bus, preview.prepared, 'MODEL_SPACE');
    const kept = bus.getDocument().entities.find((entity) => entity.id === before.id);
    expect(kept).toEqual(before);
    expect(bus.getDocument().entities).toHaveLength(2);
  });

  it('does not commit when the request is rejected', () => {
    const bus = new CommandBus(modelDoc());
    const preview = previewDrawPrompt('Draw a wall from 0,0 to 12 ft,0', {
      document: bus.getDocument(),
      workspaceMode: 'MODEL_SPACE',
    });
    expect(preview.ok).toBe(false);
    expect(bus.canUndo()).toBe(false);
    expect(bus.getDocument().entities).toHaveLength(0);
  });

  it('rejects paper space, a missing layer, a locked layer, and bad geometry', () => {
    const doc = modelDoc();
    const paper = previewDrawPrompt('Draw a line from 0,0 to 1 ft,0', {
      document: doc,
      workspaceMode: 'PAPER_SPACE',
    });
    expect(paper.ok).toBe(false);
    if (!paper.ok) expect(paper.error).toMatch(/model space/i);

    const unknown = previewDrawPrompt(
      'Draw a line from 0,0 to 1 ft,0 on layer NotALayer',
      { document: doc, workspaceMode: 'MODEL_SPACE' },
    );
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.error).toMatch(/does not exist/);

    const lockedDoc: DrawingDocument = {
      ...doc,
      layers: doc.layers.map((layer) =>
        layer.id === doc.currentLayerId ? { ...layer, locked: true } : layer,
      ),
    };
    const locked = previewDrawPrompt('Draw a line from 0,0 to 1 ft,0', {
      document: lockedDoc,
      workspaceMode: 'MODEL_SPACE',
    });
    expect(locked.ok).toBe(false);
    if (!locked.ok) expect(locked.error).toMatch(/locked/i);

    const degenerate = compileDrawIntent(
      {
        assumptions: [],
        intent: {
          kind: 'line',
          start: { x: 0, y: 0 },
          end: { x: 0, y: 0 },
          layerName: null,
        },
      },
      { document: doc, workspaceMode: 'MODEL_SPACE' },
    );
    expect(degenerate.ok).toBe(false);

    const infinite = compileDrawIntent(
      {
        assumptions: [],
        intent: {
          kind: 'circle',
          center: { x: Number.NaN, y: 0 },
          radius: 1,
          originAssumed: false,
          layerName: null,
        },
      },
      { document: doc, workspaceMode: 'MODEL_SPACE' },
    );
    expect(infinite.ok).toBe(false);

    const zeroRadius = compileDrawIntent(
      {
        assumptions: [],
        intent: {
          kind: 'circle',
          center: { x: 0, y: 0 },
          radius: 0,
          originAssumed: false,
          layerName: null,
        },
      },
      { document: doc, workspaceMode: 'MODEL_SPACE' },
    );
    expect(zeroRadius.ok).toBe(false);
  });

  it('keeps another document isolated and refuses apply after the layer locks', () => {
    const a = new CommandBus(modelDoc('A'));
    const b = new CommandBus(modelDoc('B'));
    const preview = previewDrawPrompt('Draw a line from 0,0 to 12 ft,0', {
      document: a.getDocument(),
      workspaceMode: 'MODEL_SPACE',
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const prepared = preview.prepared;
    if (prepared.kind !== 'draw') return;
    const locked: DrawingDocument = {
      ...a.getDocument(),
      layers: a.getDocument().layers.map((layer) =>
        layer.id === prepared.layerId ? { ...layer, locked: true } : layer,
      ),
    };
    a.reset(locked);
    const applied = applyPreparedDraw(a, prepared, 'MODEL_SPACE');
    expect(applied.ok).toBe(false);
    expect(a.getDocument().entities).toHaveLength(0);
    expect(a.canUndo()).toBe(false);
    expect(b.getDocument().entities).toHaveLength(0);
  });

  it('places a polyline on the named Walls layer', () => {
    const doc = modelDoc();
    const preview = previewDrawPrompt(
      'Draw a polyline through 0,0; 10 ft,0; 10 ft,8 ft; close on layer Walls',
      { document: doc, workspaceMode: 'MODEL_SPACE' },
    );
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.prepared.entities[0]?.layerName).toBe('Walls');
  });
});
