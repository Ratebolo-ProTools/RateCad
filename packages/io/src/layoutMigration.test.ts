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
    expect(opened.schemaVersion).toBe(10);
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

  it('persists paper entities, title block, sheet info, viewport labels (schema 8)', () => {
    const doc = createEmptyDocument('PaperPersist');
    const layout = doc.layouts[0]!;
    layout.sheetInfo = {
      project: 'Tower',
      drawingTitle: 'GF Plan',
      drawingNo: 'A-101',
      scale: '1:100',
      date: '2026-10-02',
      drawnBy: 'RB',
      checkedBy: 'QA',
      revision: 'A',
    };
    layout.titleBlock = {
      templateId: 'a3-landscape-default',
      enabled: true,
      x: 100,
      y: 10,
      width: 160,
      height: 45,
    };
    layout.paperCamera = { offsetX: 2, offsetY: -1, zoom: 1.25 };
    layout.viewports[0]!.label = 'GROUND FLOOR PLAN';
    layout.viewports[0]!.scaleLabel = 'Scale 1:100';
    layout.viewports[0]!.showLabel = true;
    layout.paperSpaceEntities = [
      {
        id: 'ps-text-1',
        type: 'text',
        layerId: 'layer-text',
        visible: true,
        locked: false,
        metadata: { paperSpace: true },
        geometry: {
          position: { x: 20, y: 30 },
          content: 'PROJECT NAME',
          height: 3.5,
          rotation: 0,
          alignment: 'left',
        },
        properties: {},
      },
    ];
    const opened = parseDocument(serializeDocument(doc));
    expect(opened.schemaVersion).toBe(10);
    expect(opened.layouts[0]!.sheetInfo?.project).toBe('Tower');
    expect(opened.layouts[0]!.titleBlock?.enabled).toBe(true);
    expect(opened.layouts[0]!.paperCamera?.zoom).toBe(1.25);
    expect(opened.layouts[0]!.viewports[0]!.label).toBe('GROUND FLOOR PLAN');
    expect(opened.layouts[0]!.paperSpaceEntities).toHaveLength(1);
    expect(opened.layouts[0]!.paperSpaceEntities[0]!.type).toBe('text');
    expect(opened.entities).toHaveLength(0);
    expect(opened.layers.some((l) => l.name === 'TitleBlock')).toBe(true);
  });

  it('migrates pre-v8 files and adds TitleBlock layer', () => {
    const legacy = {
      format: 'ratecad',
      schemaVersion: 7,
      document: {
        schemaVersion: 7,
        meta: {
          name: 'V7',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          appVersion: '0.8.0',
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
        entities: [],
        layouts: [
          {
            id: 'layout-1',
            name: 'Layout1',
            pageSettings: {
              paperSize: 'A4',
              orientation: 'landscape',
              units: 'mm',
              margin: 10,
            },
            paperSpaceEntities: [],
            viewports: [
              {
                id: 'vp1',
                x: 25,
                y: 25,
                width: 200,
                height: 140,
                modelCenterX: 0,
                modelCenterY: 0,
                scale: 0.05,
                rotation: 0,
                locked: false,
                visible: true,
                layerVisibilityOverrides: {},
              },
            ],
          },
        ],
        activeLayoutId: null,
      },
    };
    const opened = parseDocument(JSON.stringify(legacy));
    expect(opened.schemaVersion).toBe(10);
    expect(opened.layers.some((l) => l.id === 'layer-titleblock')).toBe(true);
  });

  it('persists viewport layer overrides + annotation scale (schema v9)', () => {
    const doc = createEmptyDocument('Annot');
    doc.settings.annotationScale = {
      ratio: 100,
      paperTextHeightMm: 2.5,
      paperDimTextHeightMm: 2.5,
      paperArrowSizeMm: 2,
      annotativeByDefault: true,
    };
    const layout = doc.layouts[0]!;
    layout.viewports[0]!.layerVisibilityOverrides = {
      'layer-windows': false,
    };
    layout.viewports[0]!.scale = 0.1;
    const text = serializeDocument(doc);
    const opened = parseDocument(text);
    expect(opened.schemaVersion).toBe(10);
    expect(opened.settings.annotationScale.ratio).toBe(100);
    expect(opened.settings.annotationScale.paperTextHeightMm).toBe(2.5);
    expect(
      opened.layouts[0]!.viewports[0]!.layerVisibilityOverrides['layer-windows'],
    ).toBe(false);
    expect(opened.layouts[0]!.viewports[0]!.scale).toBe(0.1);
  });
});
