import { describe, expect, it } from 'vitest';
import { createEmptyDocument } from '@ratecad/core';
import { parseDocument, serializeDocument } from './index.js';

describe('layout schema migration', () => {
  it('migrates pre-v7 drawings to Model + Layout1 without losing entities', () => {
    const legacy = {
      format: 'ratecad',
      schemaVersion: 5,
      document: {
        schemaVersion: 5,
        meta: {
          name: 'Legacy',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          appVersion: '0.5.0',
        },
        settings: {
          worldUnit: 'ft',
          units: 'ft-in',
          precision: 2,
          fractionDenominator: 16,
          gridSize: 1,
          snapToGrid: true,
        },
        layers: [
          {
            id: 'layer-0',
            name: '0',
            color: '#d4d4d4',
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
            properties: {},
          },
        ],
      },
    };
    const opened = parseDocument(JSON.stringify(legacy));
    expect(opened.schemaVersion).toBe(7);
    expect(opened.entities).toHaveLength(1);
    expect(opened.entities[0]!.id).toBe('line-1');
    expect(opened.layouts.length).toBeGreaterThanOrEqual(1);
    expect(opened.layouts[0]!.name).toBe('Layout1');
    expect(opened.layouts[0]!.viewports.length).toBe(1);
    expect(opened.activeLayoutId).toBeNull();
  });

  it('round-trips layouts and viewports through save/open', () => {
    const doc = createEmptyDocument('LayoutSave');
    const text = serializeDocument(doc);
    expect(text).toContain('"layouts"');
    expect(text).toContain('Layout1');
    const opened = parseDocument(text);
    expect(opened.layouts).toHaveLength(1);
    expect(opened.layouts[0]!.viewports[0]!.scale).toBeGreaterThan(0);
    expect(opened.layouts[0]!.paperSpaceEntities).toEqual([]);
  });

  it('persists viewport position, size, scale, center, lock, rotation', () => {
    const doc = createEmptyDocument('VpPersist');
    const layout = doc.layouts[0]!;
    const vp = layout.viewports[0]!;
    vp.x = 33;
    vp.y = 44;
    vp.width = 120;
    vp.height = 90;
    vp.scale = 0.1;
    vp.modelCenterX = 7.5;
    vp.modelCenterY = -2;
    vp.rotation = 0.25;
    vp.locked = true;
    vp.visible = true;
    const opened = parseDocument(serializeDocument(doc));
    const ov = opened.layouts[0]!.viewports[0]!;
    expect(ov.x).toBe(33);
    expect(ov.y).toBe(44);
    expect(ov.width).toBe(120);
    expect(ov.height).toBe(90);
    expect(ov.scale).toBe(0.1);
    expect(ov.modelCenterX).toBe(7.5);
    expect(ov.modelCenterY).toBe(-2);
    expect(ov.rotation).toBe(0.25);
    expect(ov.locked).toBe(true);
    expect(ov.visible).toBe(true);
  });
});
