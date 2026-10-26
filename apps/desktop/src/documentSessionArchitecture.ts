/**
 * DocumentSession architecture classification (P3-B1 → P3-B4B2A).
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
 * P3-B3B: App mirror rebind on tab switch.
 * P3-B4A: session-aware New / Open / Save / Save As / Recent.
 * P3-B4B1: individual tab close with Save / Don't Save / Cancel.
 * P3-B4B2A: Save All / Close All (two-stage prepare/commit).
 * Application-exit multi-doc remains P3-B4B2B.
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

/**
 * Remaining after P3-B4B2A (not started until P3-B4B2B approved).
 */
export const REMAINING_FOR_P3_B4 = [
  'applicationExitMultiDocumentPrompt',
  'closeLastDrawingWithoutReplacementPolicy',
] as const;

export const P3_B4A_FILE_OPS = [
  'sessionAwareNew',
  'sessionAwareOpen',
  'sessionAwareSave',
  'sessionAwareSaveAs',
  'duplicateFileActivation',
  'saveAsCollisionReject',
  'recentDrawingsSessionOpen',
] as const;

export const P3_B4B1_CLOSE_OPS = [
  'individualTabClose',
  'closeSaveDontSaveCancelDialog',
  'inactiveTabClose',
  'activeTabFallback',
  'lastTabReplaceWithUntitled',
] as const;

export const P3_B4B2A_BULK_OPS = [
  'saveAllDrawings',
  'closeAllDrawingsTwoStage',
  'closeAllPrepareWithoutDispose',
  'closeAllDirtyRevalidation',
  'closeAllLastTabReplaceOnce',
] as const;

/**
 * Browser limitation: file picker / download expose bare filenames only.
 * Those are not used as canonical identities for duplicate merging.
 */
export const BROWSER_FILE_IDENTITY_LIMITATION =
  'Browser environments do not provide stable absolute paths; duplicate-open detection and Save As collision checks apply only to reliable (absolute) Electron paths.';
