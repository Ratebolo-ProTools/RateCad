/**
 * Phase P3-A — ribbon tab catalog and panel descriptors.
 * Pure data — no React. Keeps tab enablement testable without UI mounts.
 */

export type RibbonTabId =
  | 'home'
  | 'insert'
  | 'annotate'
  | 'parametric'
  | 'view'
  | 'manage'
  | 'output'
  | 'addins'
  | 'collaborate'
  | 'express';

export type RibbonTabDef = {
  id: RibbonTabId;
  label: string;
  enabled: boolean;
  /** Panel titles shown when the tab is active (documentation + tests). */
  panels: readonly string[];
};

/**
 * RateCAD ribbon tabs. P3-A enables Home, Annotate, View, Manage.
 * Other tabs remain placeholders (disabled) until later phases.
 */
export const RIBBON_TAB_DEFS: readonly RibbonTabDef[] = [
  {
    id: 'home',
    label: 'Home',
    enabled: true,
    panels: [
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
    ],
  },
  {
    id: 'insert',
    label: 'Insert',
    enabled: false,
    panels: [],
  },
  {
    id: 'annotate',
    label: 'Annotate',
    enabled: true,
    panels: ['Text', 'Dimensions', 'Leaders', 'Annotation Settings'],
  },
  {
    id: 'parametric',
    label: 'Parametric',
    enabled: false,
    panels: [],
  },
  {
    id: 'view',
    label: 'View',
    enabled: true,
    panels: ['Navigation', 'Viewport', 'Display', 'Model / Layout'],
  },
  {
    id: 'manage',
    label: 'Manage',
    enabled: true,
    panels: [
      'Drawing Settings',
      'Layers',
      'Drawing Utilities',
      'Document Management',
    ],
  },
  {
    id: 'output',
    label: 'Output',
    enabled: false,
    panels: [],
  },
  {
    id: 'addins',
    label: 'Add-ins',
    enabled: false,
    panels: [],
  },
  {
    id: 'collaborate',
    label: 'Collaborate',
    enabled: false,
    panels: [],
  },
  {
    id: 'express',
    label: 'Express Tools',
    enabled: false,
    panels: [],
  },
] as const;

export const DEFAULT_RIBBON_TAB: RibbonTabId = 'home';

export function enabledRibbonTabs(): RibbonTabDef[] {
  return RIBBON_TAB_DEFS.filter((t) => t.enabled);
}

export function isRibbonTabEnabled(id: RibbonTabId): boolean {
  return RIBBON_TAB_DEFS.find((t) => t.id === id)?.enabled === true;
}

export function ribbonTabPanels(id: RibbonTabId): readonly string[] {
  return RIBBON_TAB_DEFS.find((t) => t.id === id)?.panels ?? [];
}

export function normalizeRibbonTab(raw: unknown): RibbonTabId {
  if (typeof raw !== 'string') return DEFAULT_RIBBON_TAB;
  const hit = RIBBON_TAB_DEFS.find((t) => t.id === raw);
  if (hit?.enabled) return hit.id;
  return DEFAULT_RIBBON_TAB;
}

/** Dimension kinds RateCAD implements today (all six are wired). */
export const SUPPORTED_DIMENSION_KINDS = [
  'aligned',
  'horizontal',
  'vertical',
  'radius',
  'diameter',
  'angular',
] as const;

/** Annotate-tab commands that are live vs intentionally disabled. */
export const ANNOTATE_COMMAND_STATUS = {
  text: 'enabled',
  mtext: 'disabled',
  dimension: 'enabled',
  leader: 'enabled',
  dimstyle: 'enabled',
  units: 'enabled',
  annotationScaleUi: 'disabled',
  table: 'disabled',
} as const;

/** View-tab commands that are live vs intentionally disabled. */
export const VIEW_COMMAND_STATUS = {
  pan: 'enabled',
  zoomExtents: 'enabled',
  zoomWindow: 'enabled',
  zoomPrevious: 'enabled',
  topView: 'display-only',
  wireframe2d: 'display-only',
  orbit3d: 'disabled',
  viewCube: 'disabled',
  grid: 'enabled',
  snap: 'enabled',
  ortho: 'enabled',
  polar: 'enabled',
  crosshair: 'enabled',
  pickbox: 'enabled',
  modelLayout: 'enabled',
} as const;

/** Manage-tab commands that are live vs intentionally disabled. */
export const MANAGE_COMMAND_STATUS = {
  units: 'enabled',
  layers: 'enabled',
  area: 'enabled',
  distance: 'enabled',
  new: 'enabled',
  open: 'enabled',
  save: 'enabled',
  saveAs: 'enabled',
  multiDocument: 'disabled',
} as const;
