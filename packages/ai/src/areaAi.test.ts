import { describe, expect, it } from 'vitest';
import { createEmptyDocument } from '@ratecad/core';
import {
  executeAiAreaQuery,
  parseAiAreaIntent,
} from './index.js';

describe('AI area helpers', () => {
  it('parses area intents without guessing numbers', () => {
    expect(parseAiAreaIntent('Calculate the area of this rectangle').kind).toBe(
      'selection',
    );
    expect(parseAiAreaIntent('Calculate area of all rooms').kind).toBe(
      'all-rooms',
    );
    expect(
      parseAiAreaIntent('Subtract the staircase opening from the floor area')
        .kind,
    ).toBe('net-floor');
    expect(parseAiAreaIntent('Show the area in square meters')).toEqual({
      kind: 'show-unit',
      unit: 'm',
    });
  });

  it('all-rooms uses Area Engine on room entities', () => {
    let doc = createEmptyDocument('AI rooms');
    doc = {
      ...doc,
      settings: { ...doc.settings, worldUnit: 'ft', units: 'ft', precision: 2 },
      entities: [
        {
          id: 'r1',
          type: 'room',
          layerId: 'layer-rooms',
          visible: true,
          locked: false,
          geometry: {
            wallIds: [],
            wallDirs: [],
            polygon: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 10, y: 12 },
              { x: 0, y: 12 },
            ],
            labelPosition: { x: 5, y: 6 },
            area: 120,
          },
          properties: { name: 'Bedroom' },
        },
      ],
    };
    const result = executeAiAreaQuery(
      { kind: 'all-rooms' },
      {
        document: doc,
        selectedEntityIds: [],
        units: 'ft',
        worldUnit: 'ft',
      },
    );
    expect(result.rooms).toHaveLength(1);
    expect(result.rooms?.[0]?.area).toBeCloseTo(120, 8);
    expect(result.totalArea).toBeCloseTo(120, 8);
    expect(result.totalAreaText).toMatch(/120/);
  });

  it('selection area comes from geometry not LLM', () => {
    let doc = createEmptyDocument('AI sel');
    doc = {
      ...doc,
      entities: [
        {
          id: 'rect1',
          type: 'rectangle',
          layerId: 'layer-0',
          visible: true,
          locked: false,
          geometry: {
            corner1: { x: 0, y: 0 },
            corner2: { x: 10, y: 12 },
          },
          properties: {},
        },
      ],
    };
    const result = executeAiAreaQuery(
      { kind: 'selection' },
      {
        document: doc,
        selectedEntityIds: ['rect1'],
        units: 'ft',
        worldUnit: 'ft',
      },
    );
    expect(result.area).toBeCloseTo(120, 8);
  });
});
