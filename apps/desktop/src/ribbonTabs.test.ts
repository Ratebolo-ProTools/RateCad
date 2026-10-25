import { describe, expect, it } from 'vitest';
import {
  ANNOTATE_COMMAND_STATUS,
  DEFAULT_RIBBON_TAB,
  MANAGE_COMMAND_STATUS,
  RIBBON_TAB_DEFS,
  SUPPORTED_DIMENSION_KINDS,
  VIEW_COMMAND_STATUS,
  enabledRibbonTabs,
  isRibbonTabEnabled,
  normalizeRibbonTab,
  ribbonTabPanels,
} from './ribbonTabs.js';

describe('P3-A ribbon tabs', () => {
  it('keeps Home as the default active tab', () => {
    expect(DEFAULT_RIBBON_TAB).toBe('home');
    expect(normalizeRibbonTab('view')).toBe('view');
    expect(normalizeRibbonTab('insert')).toBe('home');
    expect(normalizeRibbonTab('bogus')).toBe('home');
  });

  it('enables Home, Annotate, View, Manage only', () => {
    const enabled = enabledRibbonTabs().map((t) => t.id);
    expect(enabled).toEqual(['home', 'annotate', 'view', 'manage']);
    expect(isRibbonTabEnabled('home')).toBe(true);
    expect(isRibbonTabEnabled('annotate')).toBe(true);
    expect(isRibbonTabEnabled('view')).toBe(true);
    expect(isRibbonTabEnabled('manage')).toBe(true);
    expect(isRibbonTabEnabled('insert')).toBe(false);
    expect(isRibbonTabEnabled('parametric')).toBe(false);
  });

  it('preserves Home panel order', () => {
    expect(ribbonTabPanels('home')).toEqual([
      'Draw',
      'Modify',
      'Annotation',
      'Layers',
      'Block',
      'Properties',
      'Groups',
      'Utilities',
      'Clipboard',
      'View',
      'Select Mode',
    ]);
  });

  it('defines Annotate / View / Manage panels', () => {
    expect(ribbonTabPanels('annotate')).toEqual([
      'Text',
      'Dimensions',
      'Leaders',
      'Annotation Settings',
    ]);
    expect(ribbonTabPanels('view')).toEqual([
      'Navigation',
      'Viewport',
      'Display',
      'Model / Layout',
    ]);
    expect(ribbonTabPanels('manage')).toEqual([
      'Drawing Settings',
      'Layers',
      'Drawing Utilities',
      'Document Management',
    ]);
  });

  it('lists all implemented dimension kinds', () => {
    expect(SUPPORTED_DIMENSION_KINDS).toContain('aligned');
    expect(SUPPORTED_DIMENSION_KINDS).toContain('horizontal');
    expect(SUPPORTED_DIMENSION_KINDS).toContain('vertical');
    expect(SUPPORTED_DIMENSION_KINDS).toContain('angular');
    expect(SUPPORTED_DIMENSION_KINDS).toContain('radius');
    expect(SUPPORTED_DIMENSION_KINDS).toContain('diameter');
  });

  it('marks unsupported annotate/view/manage features disabled', () => {
    expect(ANNOTATE_COMMAND_STATUS.mtext).toBe('disabled');
    expect(ANNOTATE_COMMAND_STATUS.table).toBe('disabled');
    expect(ANNOTATE_COMMAND_STATUS.annotationScaleUi).toBe('disabled');
    expect(VIEW_COMMAND_STATUS.orbit3d).toBe('disabled');
    expect(VIEW_COMMAND_STATUS.viewCube).toBe('disabled');
    expect(MANAGE_COMMAND_STATUS.multiDocument).toBe('disabled');
  });

  it('keeps enabled command status for P0–P2 integrations', () => {
    expect(ANNOTATE_COMMAND_STATUS.text).toBe('enabled');
    expect(ANNOTATE_COMMAND_STATUS.dimension).toBe('enabled');
    expect(ANNOTATE_COMMAND_STATUS.leader).toBe('enabled');
    expect(ANNOTATE_COMMAND_STATUS.dimstyle).toBe('enabled');
    expect(VIEW_COMMAND_STATUS.pan).toBe('enabled');
    expect(VIEW_COMMAND_STATUS.zoomExtents).toBe('enabled');
    expect(VIEW_COMMAND_STATUS.grid).toBe('enabled');
    expect(VIEW_COMMAND_STATUS.crosshair).toBe('enabled');
    expect(MANAGE_COMMAND_STATUS.units).toBe('enabled');
    expect(MANAGE_COMMAND_STATUS.save).toBe('enabled');
    expect(MANAGE_COMMAND_STATUS.area).toBe('enabled');
  });

  it('exports a stable tab catalog length', () => {
    expect(RIBBON_TAB_DEFS).toHaveLength(10);
  });
});
