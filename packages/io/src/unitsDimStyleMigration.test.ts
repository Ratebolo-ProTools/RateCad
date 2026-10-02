import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION } from '@ratecad/core';
import { parseDocument, serializeDocument } from './index.js';

describe('UNITS / DIMSTYLE migration', () => {
  it('migrates schema 9 docs to v10 with drawingUnits + dim styles', () => {
    const legacy = {
      format: 'ratecad',
      schemaVersion: 9,
      document: {
        schemaVersion: 9,
        meta: {
          name: 'legacy',
          createdAt: '2020-01-01T00:00:00.000Z',
          updatedAt: '2020-01-01T00:00:00.000Z',
          appVersion: '0.9.0',
        },
        settings: {
          worldUnit: 'ft',
          units: 'ft-in',
          precision: 2,
          fractionDenominator: 16,
          gridSize: 1,
          snapToGrid: true,
          dimensionStyle: {
            textHeight: 0.4,
            arrowSize: 0.3,
            precision: 2,
            extensionGap: 0.1,
            extensionBeyond: 0.15,
          },
          constructionDefaults: {
            wallThickness: 0.75,
            wallHeight: 8,
            doorWidth: 3,
            doorHeight: 7,
            windowWidth: 3,
            windowHeight: 4,
            windowSill: 3,
          },
        },
        layers: [
          {
            id: 'layer-0',
            name: '0',
            color: '#fff',
            linetype: 'Continuous',
            lineweight: 0.25,
            transparency: 0,
            visible: true,
            locked: false,
          },
        ],
        currentLayerId: 'layer-0',
        entities: [
          {
            id: 'line-1',
            type: 'line',
            layerId: 'layer-0',
            visible: true,
            locked: false,
            geometry: { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
            properties: {
              color: 'ByLayer',
              linetype: 'ByLayer',
              lineweight: 'ByLayer',
              transparency: 0,
            },
          },
        ],
        layouts: [],
        activeLayoutId: null,
      },
    };

    const opened = parseDocument(JSON.stringify(legacy));
    expect(opened.schemaVersion).toBe(SCHEMA_VERSION);
    expect(opened.schemaVersion).toBe(10);
    expect(opened.settings.drawingUnits).toBeDefined();
    expect(opened.settings.drawingUnits.linearFormat).toBe('architectural');
    expect(opened.settings.dimensionStyles.length).toBeGreaterThanOrEqual(3);
    expect(opened.settings.dimensionStyle.textHeight).toBeCloseTo(0.4);
    // Geometry survives migration
    expect(opened.entities).toHaveLength(1);
    const line = opened.entities[0]!;
    expect(line.type).toBe('line');
    if (line.type === 'line') {
      expect(line.geometry.end.x).toBe(10);
    }

    // Round-trip persistence
    const again = parseDocument(serializeDocument(opened));
    expect(again.settings.activeDimensionStyleName).toBe(
      opened.settings.activeDimensionStyleName,
    );
    expect(again.settings.drawingUnits.linearPrecision).toBe(
      opened.settings.drawingUnits.linearPrecision,
    );
  });
});
