import { describe, expect, it } from 'vitest';
import { CommandBus, CreateLineCommand } from '@ratecad/commands';
import {
  createEmptyDocument,
  setSelection,
  type DrawingDocument,
} from '@ratecad/core';
import { describeEntity, describeSelection } from './entitySummary.js';
import { applyPreparedDraw, previewDrawPrompt } from './executeDrawPrompt.js';
import { parseDrawPrompt } from './parseDrawPrompt.js';

function modelDoc(): DrawingDocument {
  const doc = createEmptyDocument('AI-3A');
  return {
    ...doc,
    settings: { ...doc.settings, worldUnit: 'ft', units: 'ft-in' },
  };
}

const CLOSED_A =
  'Draw a closed polyline through 0,0; 20 ft,0; 20 ft,15 ft; 0,15 ft';
const CLOSED_B =
  'Draw a polyline through 0,0; 20 ft,0; 20 ft,15 ft; 0,15 ft; close';

describe('phase 3A drawing language', () => {
  it('treats both closed polyline phrases as the same geometry', () => {
    const first = parseDrawPrompt(CLOSED_A, 'ft', 'ft-in');
    const second = parseDrawPrompt(CLOSED_B, 'ft', 'ft-in');
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.parsed.intent).toEqual(second.parsed.intent);
    expect(first.parsed.intent).toMatchObject({ kind: 'polyline', closed: true });
    if (first.parsed.intent.kind !== 'polyline') return;
    expect(first.parsed.intent.vertices).toHaveLength(4);
    expect(first.parsed.intent.vertices[0]).toEqual({ x: 0, y: 0 });
    expect(first.parsed.intent.vertices[3]).toEqual({ x: 0, y: 15 });
    expect(first.parsed.intent.vertices[0]).not.toEqual(
      first.parsed.intent.vertices[3],
    );
  });

  it('keeps an open polyline open', () => {
    const parsed = parseDrawPrompt(
      'Draw a polyline through 0,0; 10 ft,0; 10 ft,8 ft',
      'ft',
      'ft-in',
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || parsed.parsed.intent.kind !== 'polyline') return;
    expect(parsed.parsed.intent.closed).toBe(false);
    expect(parsed.parsed.intent.vertices).toHaveLength(3);
  });

  it('still draws a line, rectangle, and circle', () => {
    const doc = modelDoc();
    const line = previewDrawPrompt('Draw a line from 0,0 to 30 ft,40 ft', {
      document: doc,
      workspaceMode: 'MODEL_SPACE',
    });
    const rect = previewDrawPrompt('Draw a rectangle 30 ft by 40 ft at 0,0', {
      document: doc,
      workspaceMode: 'MODEL_SPACE',
    });
    const circle = previewDrawPrompt(
      'Draw a circle of radius 5 ft at 15 ft,20 ft',
      { document: doc, workspaceMode: 'MODEL_SPACE' },
    );
    expect(line.ok && line.prepared.kind).toBe('draw');
    expect(rect.ok && rect.prepared.kind).toBe('draw');
    expect(circle.ok && circle.prepared.kind).toBe('draw');
    expect(doc.entities).toHaveLength(0);
  });
});

describe('phase 3A object identification', () => {
  it('classifies offset as OFFSET and previews the selected rectangle', () => {
    const bus = new CommandBus(modelDoc());
    const drawn = previewDrawPrompt('Draw a 30 ft by 40 ft rectangle at 0,0', {
      document: bus.getDocument(),
      workspaceMode: 'MODEL_SPACE',
    });
    expect(drawn.ok).toBe(true);
    if (!drawn.ok || drawn.prepared.kind !== 'draw') return;
    applyPreparedDraw(bus, drawn.prepared, 'MODEL_SPACE');
    const before = structuredClone(bus.getDocument().entities[0]);
    const selected = setSelection(bus.getDocument(), [before!.id]);
    const preview = previewDrawPrompt(
      'Offset the selected rectangle inward by 9 inches',
      { document: selected, workspaceMode: 'MODEL_SPACE' },
    );
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.prepared.kind).toBe('modify');
    expect(preview.prepared.canApply).toBe(false);
    if (preview.prepared.kind !== 'modify') return;
    expect(preview.prepared.operation).toBe('offset');
    expect(preview.prepared.entities[0]?.id).toBe(before!.id);
    expect(preview.prepared.summary).toMatch(/OFFSET/);
    expect(preview.prepared.summary).toMatch(/inward/i);
    const applied = applyPreparedDraw(bus, preview.prepared, 'MODEL_SPACE');
    expect(applied.ok).toBe(false);
    expect(bus.getDocument().entities).toHaveLength(1);
    expect(bus.getDocument().entities[0]).toEqual(before);
  });

  it('does not describe offset as a rectangle size error', () => {
    const preview = previewDrawPrompt(
      'Offset the selected rectangle inward by 9 inches',
      { document: modelDoc(), workspaceMode: 'MODEL_SPACE' },
    );
    expect(preview.ok).toBe(false);
    if (preview.ok) return;
    expect(preview.error).toMatch(/OFFSET|rectangle is selected/i);
    expect(preview.error).not.toMatch(/width and a height/i);
    expect(preview.error).toMatch(/No geometry was created/);
  });

  it('identifies the selected circle for a move preview', () => {
    const bus = new CommandBus(modelDoc());
    const drawn = previewDrawPrompt(
      'Draw a circle of radius 5 ft at 15 ft,20 ft',
      { document: bus.getDocument(), workspaceMode: 'MODEL_SPACE' },
    );
    if (!drawn.ok || drawn.prepared.kind !== 'draw') return;
    applyPreparedDraw(bus, drawn.prepared, 'MODEL_SPACE');
    const circle = bus.getDocument().entities[0]!;
    const selected = setSelection(bus.getDocument(), [circle.id]);
    const preview = previewDrawPrompt(
      'Move the selected circle 5 ft to the right',
      { document: selected, workspaceMode: 'MODEL_SPACE' },
    );
    expect(preview.ok).toBe(true);
    if (!preview.ok || preview.prepared.kind !== 'modify') return;
    expect(preview.prepared.operation).toBe('move');
    expect(preview.prepared.entities[0]).toMatchObject({
      id: circle.id,
      type: 'circle',
    });
    expect(preview.prepared.canApply).toBe(false);
    expect(bus.getDocument().entities[0]).toEqual(circle);
    expect(describeSelection(selected).count).toBe(1);
    expect(describeSelection(selected).items[0]?.detail).toMatch(/radius/i);
  });

  it('uses the last created entity and an explicit id', () => {
    const bus = new CommandBus(modelDoc());
    const rect = previewDrawPrompt('Draw a 12 ft by 10 ft rectangle at 0,0', {
      document: bus.getDocument(),
      workspaceMode: 'MODEL_SPACE',
    });
    if (!rect.ok || rect.prepared.kind !== 'draw') return;
    applyPreparedDraw(bus, rect.prepared, 'MODEL_SPACE');
    const circle = previewDrawPrompt(
      'Draw a circle of radius 5 ft at 10 ft,10 ft',
      { document: bus.getDocument(), workspaceMode: 'MODEL_SPACE' },
    );
    if (!circle.ok || circle.prepared.kind !== 'draw') return;
    applyPreparedDraw(bus, circle.prepared, 'MODEL_SPACE');
    const entities = bus.getDocument().entities;
    const last = previewDrawPrompt(
      'Move the last created entity 5 ft to the right',
      { document: bus.getDocument(), workspaceMode: 'MODEL_SPACE' },
    );
    expect(last.ok).toBe(true);
    if (!last.ok || last.prepared.kind !== 'modify') return;
    expect(last.prepared.entities[0]?.id).toBe(entities[1]?.id);
    expect(last.prepared.entities[0]?.type).toBe('circle');

    const byId = previewDrawPrompt(
      `Move entity id ${entities[0]!.id} 5 ft to the right`,
      { document: bus.getDocument(), workspaceMode: 'MODEL_SPACE' },
    );
    expect(byId.ok).toBe(true);
    if (!byId.ok || byId.prepared.kind !== 'modify') return;
    expect(byId.prepared.entities[0]?.id).toBe(entities[0]?.id);
    expect(bus.getDocument().entities).toEqual(entities);
  });

  it('asks for a selection when several objects match', () => {
    const bus = new CommandBus(modelDoc());
    bus.execute(new CreateLineCommand({ x: 0, y: 0 }, { x: 1, y: 0 }));
    bus.execute(new CreateLineCommand({ x: 0, y: 1 }, { x: 1, y: 1 }));
    bus.execute(new CreateLineCommand({ x: 0, y: 2 }, { x: 1, y: 2 }));
    const ids = bus.getDocument().entities.map((entity) => entity.id);
    const selected = setSelection(bus.getDocument(), ids);
    const preview = previewDrawPrompt(
      'Move the selected line 5 ft to the right',
      { document: selected, workspaceMode: 'MODEL_SPACE' },
    );
    expect(preview.ok).toBe(false);
    if (preview.ok) return;
    expect(preview.error).toMatch(/Select the one line/i);
    expect(preview.error).toMatch(/No geometry was created/);
    expect(bus.getDocument().entities).toHaveLength(3);
  });

  it('rejects an unsupported modification without creating geometry', () => {
    const bus = new CommandBus(modelDoc());
    const preview = previewDrawPrompt('Stretch the selected line by 2 ft', {
      document: bus.getDocument(),
      workspaceMode: 'MODEL_SPACE',
    });
    expect(preview.ok).toBe(false);
    if (preview.ok) return;
    expect(preview.error).toMatch(/STRETCH/);
    expect(preview.error).toMatch(/No geometry was created/);
    expect(bus.canUndo()).toBe(false);
  });
});

describe('phase 3A with a block in the drawing', () => {
  it('describes the block and still refuses to execute a modification', () => {
    const doc = modelDoc();
    doc.blockDefinitions = [
      {
        id: 'bdef-1',
        name: 'Mark',
        basePoint: { x: 0, y: 0 },
        entities: [
          {
            id: 'line-local',
            type: 'line',
            layerId: doc.currentLayerId,
            visible: true,
            locked: false,
            geometry: { start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
            properties: {},
          },
        ],
      },
    ];
    doc.entities = [
      {
        id: 'block-1',
        type: 'block',
        layerId: doc.currentLayerId,
        visible: true,
        locked: false,
        geometry: {
          definitionId: 'bdef-1',
          position: { x: 4, y: 5 },
          scaleX: 2,
          scaleY: -1,
          rotation: Math.PI / 2,
        },
        properties: {},
      },
    ];
    doc.selection = ['block-1'];
    const described = describeEntity(doc.entities[0]!, doc);
    expect(described.detail).toMatch(/Block Mark/);
    expect(described.detail).toMatch(/scale 2, -1/);
    const draw = previewDrawPrompt('Draw a line from 0,0 to 10 ft,0', {
      document: doc,
      workspaceMode: 'MODEL_SPACE',
    });
    expect(draw.ok && draw.prepared.kind).toBe('draw');
    const modify = previewDrawPrompt('Move the selected line 5 ft to the right', {
      document: doc,
      workspaceMode: 'MODEL_SPACE',
    });
    expect(doc.entities).toHaveLength(1);
    expect(doc.blockDefinitions[0]!.entities[0]!.geometry).toEqual({
      start: { x: 0, y: 0 },
      end: { x: 1, y: 0 },
    });
    if (modify.ok && modify.prepared.kind === 'modify') {
      expect(modify.prepared.canApply).toBe(false);
      const applied = applyPreparedDraw(
        new CommandBus(doc),
        modify.prepared,
        'MODEL_SPACE',
      );
      expect(applied.ok).toBe(false);
    }
  });
});
