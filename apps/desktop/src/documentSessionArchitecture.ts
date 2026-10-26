/**
 * DocumentSession architecture classification (P3-B1 → P3-B3B).
 *
 * Document-specific (must be per session):
 *   DrawingDocument (via CommandBus), CommandBus undo/redo,
 *   CadCommandEngine, SelectionManager, hover, tool session,
 *   cameras, ViewHistory, workspace/layout viewport UI fields,
 *   file path, dirty flag, command-line buffer.
 *
 * Application-global (shared, OK):
 *   Ribbon chrome tab, draftingPrefs (crosshair/pickbox),
 *   recent drawings, window/shell layout, polar tracking prefs,
 *   Electron/web file bridge, Application Menu chrome.
 *
 * Shared immutable services (reuse, do not duplicate):
 *   createDefaultEngineRegistry() factories, IO serialize/parse,
 *   geometry/viewport pure helpers, command class definitions.
 *
 * P3-B3B rebinds App React mirrors / canvas / command UI on tab switch.
 * Close / save / discard multi-file workflows remain P3-B4.
 */

export const DOCUMENT_SPECIFIC_STATE = [
  'DrawingDocument',
  'CommandBus',
  'CadCommandEngine',
  'SelectionManager',
  'hoveredId',
  'toolSession',
  'camera',
  'modelCamera',
  'viewHistory',
  'workspaceMode',
  'activeViewportId',
  'selectedViewportId',
  'selectedPaperEntityIds',
  'filePath',
  'dirty',
  'commandLineBuffer',
] as const;

export const APPLICATION_GLOBAL_STATE = [
  'activeRibbonTab',
  'draftingPrefs',
  'recentDrawings',
  'windowSettings',
  'polarTrackingPreferences',
  'applicationMenuChrome',
  'electronWebFileBridge',
] as const;

export const SHARED_IMMUTABLE_SERVICES = [
  'createDefaultEngineRegistry',
  'serializeDocument',
  'tryParseDocument',
  'geometryHelpers',
  'viewportCameraHelpers',
  'commandClassDefinitions',
] as const;

/** P3-B3B completed App mirror rebind on UI switch. */
export const REMAINING_FOR_P3_B3B_UI_SWITCH = [] as const;

/** Remaining work after P3-B3B (not started until approved). */
export const REMAINING_FOR_P3_B4 = [
  'closeTabWithSaveDiscardPrompt',
  'multiDocumentCloseWorkflows',
  'closeLastDrawingPolicy',
] as const;
