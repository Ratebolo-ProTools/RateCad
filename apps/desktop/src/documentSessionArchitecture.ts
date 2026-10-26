/**
 * P3-B3A — architecture classification for DocumentSession isolation.
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
 * Still mirrored in App React state for the single active session
 * (P3-B3B will rebind these on tab switch):
 *   doc/camera React state, canvas renderer, status/command UI.
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

/** Remaining App mirrors / bindings before UI multi-tab switch (P3-B3B). */
export const REMAINING_FOR_P3_B3B_UI_SWITCH = [
  'reactDocCameraMirrors',
  'canvasRendererBindings',
  'statusAndCommandLineReactState',
  'documentTabSwitchHandlers',
] as const;
