import { describe, expect, it } from 'vitest';
import { createEmptyDocument, SCHEMA_VERSION, type ArcEntity } from '@ratecad/core';
import { parseDocument, serializeDocument } from './index.js';

describe('arc schema', () => {
  it('saves and reopens a native arc at schema 12', () => {
    const base = createEmptyDocument('Arc');
    const arc: ArcEntity = {
      id: 'arc-1',
      type: 'arc',
      layerId: base.layers[0]!.id,
      visible: true,
      locked: false,
      geometry: {
        center: { x: 2, y: 3 },
        radius: 4,
        startAngle: 0.5,
        endAngle: 2,
      },
      properties: {
        color: '#abcdef',
        lineweight: 0.5,
        linetype: 'Continuous',
      },
    };
    const text = serializeDocument({ ...base, entities: [arc] });
    const opened = parseDocument(text);
    expect(opened.schemaVersion).toBe(SCHEMA_VERSION);
    expect(opened.schemaVersion).toBe(12);
    expect(opened.entities[0]).toMatchObject({
      type: 'arc',
      geometry: arc.geometry,
      properties: { color: '#abcdef' },
    });
  });

  it('reopens every sector left by a four-point circle trim', () => {
    const base = createEmptyDocument('Sectors');
    const layerId = base.layers[0]!.id;
    const sectors: ArcEntity[] = [
      [Math.PI / 2, Math.PI],
      [Math.PI, (3 * Math.PI) / 2],
      [(3 * Math.PI) / 2, 0],
    ].map(([startAngle, endAngle], index) => ({
      id: `arc-${index + 1}`,
      type: 'arc' as const,
      layerId,
      visible: true,
      locked: false,
      geometry: {
        center: { x: 0, y: 0 },
        radius: 5,
        startAngle: startAngle!,
        endAngle: endAngle!,
      },
      properties: { color: '#445566', lineweight: 0.35, linetype: 'Dashed' },
    }));
    const opened = parseDocument(serializeDocument({ ...base, entities: sectors }));
    expect(opened.schemaVersion).toBe(12);
    expect(opened.entities.map((entity) => entity.type)).toEqual(['arc', 'arc', 'arc']);
    expect(
      opened.entities.map((entity) =>
        entity.type === 'arc'
          ? [entity.geometry.startAngle, entity.geometry.endAngle, entity.geometry.radius]
          : null,
      ),
    ).toEqual([
      [Math.PI / 2, Math.PI, 5],
      [Math.PI, (3 * Math.PI) / 2, 5],
      [(3 * Math.PI) / 2, 0, 5],
    ]);
    expect(opened.entities.every((entity) => entity.layerId === layerId)).toBe(true);
  });

  it('rejects a full-circle arc', () => {
    const base = createEmptyDocument('Bad');
    const text = serializeDocument(base);
    const parsed = JSON.parse(text) as {
      document: { entities: unknown[] };
    };
    parsed.document.entities = [
      {
        id: 'arc-bad',
        type: 'arc',
        layerId: base.layers[0]!.id,
        visible: true,
        locked: false,
        geometry: {
          center: { x: 0, y: 0 },
          radius: 1,
          startAngle: 0,
          endAngle: Math.PI * 2,
        },
        properties: {},
      },
    ];
    expect(() => parseDocument(JSON.stringify(parsed))).toThrow(/invalid arc geometry/i);
  });
});
