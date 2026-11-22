import { describe, expect, it } from 'vitest';
import {
  SCHEMA_VERSION,
  createEmptyDocument,
  type DimensionEntity,
  type DimensionKind,
} from '@ratecad/core';
import { parseDocument, serializeDocument } from './index.js';

describe('dimension schema', () => {
  it('saves and reopens every dimension kind at schema 12', () => {
    const base = createEmptyDocument('Dimensions');
    const kinds: DimensionKind[] = [
      'horizontal',
      'vertical',
      'aligned',
      'angular',
      'radius',
      'diameter',
      'arc-length',
    ];
    const entities: DimensionEntity[] = kinds.map((kind, index) => ({
      id: `dim-${index}`,
      type: 'dimension',
      layerId: base.layers[0]!.id,
      visible: true,
      locked: false,
      geometry: {
        kind,
        start: { x: index, y: 0 },
        end: { x: index + 2, y: kind === 'vertical' ? 3 : 1 },
        offset: 1.5,
        ...((kind === 'angular' || kind === 'arc-length')
          ? { vertex: { x: index, y: 1 } }
          : {}),
      },
      properties: {},
      metadata: kind === 'arc-length' ? { sweepRadians: Math.PI / 2 } : undefined,
    }));
    const opened = parseDocument(serializeDocument({ ...base, entities }));
    expect(opened.schemaVersion).toBe(SCHEMA_VERSION);
    expect(opened.schemaVersion).toBe(12);
    expect(opened.entities.map((entity) =>
      entity.type === 'dimension' ? entity.geometry.kind : entity.type,
    )).toEqual(kinds);
    const arc = opened.entities.find((entity) => entity.id === 'dim-6');
    expect(arc?.type).toBe('dimension');
    if (arc?.type === 'dimension') {
      expect(arc.metadata?.sweepRadians).toBeCloseTo(Math.PI / 2);
      expect(arc.geometry.vertex).toEqual({ x: 6, y: 1 });
    }
  });
});
