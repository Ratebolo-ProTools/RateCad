import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import {
  CommandBus,
  ConvertDrawingWorldUnitCommand,
  CreateLayerCommand,
  DeleteEntitiesCommand,
  DeleteLayerCommand,
  DeletePaperEntitiesCommand,
  MoveViewportCommand,
  ResizeViewportCommand,
  SetCurrentLayerCommand,
  SetDrawingUnitsCommand,
  SetDrawingUnitsSettingsCommand,
  SetActiveDimensionStyleCommand,
  UpdateDimensionStyleCommand,
  CopyDimensionStyleCommand,
  RenameDimensionStyleCommand,
  DeleteDimensionStyleCommand,
  SyncViewportLabelsCommand,
  UpdateDoorCommand,
  UpdateLayerCommand,
  UpdateRoomCommand,
  UpdateTextCommand,
  UpdateWallCommand,
  UpdateWindowCommand,
} from '@ratecad/commands';
import {
  addLayout,
  clearSelection,
  createEmptyDocument,
  defaultPaperCamera,
  ensureLayouts,
  formatAnnotationScale,
  formatViewportScale,
  getAssociativeRef,
  getEntity,
  getHostedByWall,
  getLayer,
  getSelectedEntities,
  getWall,
  isAnnotativeEntity,
  hitTestViewport,
  hitTestViewportBoundary,
  isEntityModifiable,
  replaceViewport,
  setActiveLayout,
  sheetSizeInPageUnits,
  updateLayoutSheetMeta,
  workspaceModeLabel,
  type DimensionKind,
  type DoorEntity,
  type DrawingDocument,
  type Entity,
  type Layer,
  type LengthUnit,
  type LayoutId,
  type LayoutViewport,
  type RoomEntity,
  type TextEntity,
  type ViewportId,
  type WallEntity,
  type WindowEntity,
  type WorkspaceMode,
  LINEAR_UNIT_FORMAT_LABELS,
} from '@ratecad/core';
import {
  findDoorsForRoom,
  findWallsForRoom,
  findWindowsForRoom,
  formatAreaInUnits,
  formatLength,
  formatLengthInUnits,
  formatWorldLength,
  LENGTH_UNIT_LABELS,
  measuredLength,
  parseLength,
  parseLengthInput,
  PolarTrackingEngine,
  resolveSnap,
  SUPPORTED_LENGTH_UNITS,
  suggestedGridSize,
  toMillimeters,
  wallLength,
} from '@ratecad/geometry';
import { PropertiesPanel } from './PropertiesPanel';
import {
  ViewportPropertiesPanel,
  viewportStatusLine,
} from './ViewportPropertiesPanel';
import { LayoutPropertiesPanel } from './LayoutPropertiesPanel';
import { UnitsDialog } from './UnitsDialog';
import { DimStyleManager } from './DimStyleManager';
import { AreaModeStrip, Ribbon } from './Ribbon';
import type { RecentDrawing } from './ApplicationMenu';
import {
  bindSessionEngine,
  clearSessionDirty,
  createUntitledBus,
  getSessionTitle,
  markSessionDirty,
  persistedContentFingerprint,
  replaceSessionDocument,
  setSessionFilePath,
  setSessionHoveredId,
  shouldMarkDirtyForBusChange,
  shouldPromptDiscard,
  type DocumentSession,
} from './documentSession';
import {
  createAndRegisterSession,
  createDocumentSessionStore,
  getSession,
  listSessions,
  removeSession,
  setActiveSession,
  type DocumentSessionStore,
} from './documentSessionStore';
import {
  CLOSE_TAB_ACTIONS_ENABLED,
  MULTI_DOCUMENT_ACTIONS_ENABLED,
  applyLiveActiveTabState,
  resolveDocumentTabItems,
} from './documentTabsModel';
import {
  allocateUntitledDrawingNameFromStore,
  persistActiveSessionMirrors,
  prepareSessionDeactivation,
} from './documentSessionSwitch';
import {
  applySuccessfulSaveToSession,
  beginSaveTransaction,
  canQuickSaveToExistingPath,
  describeSaveAsCollision,
  findSaveAsCollision,
  resolveFileOpsPlatform,
  resolveOpenRequest,
} from './documentFileOps';
import {
  LAST_DRAWING_CLOSE_POLICY,
  chooseFallbackSessionId,
  getCloseDialogTitle,
  shouldPromptSaveBeforeClose,
  type CloseSaveChoice,
} from './documentSessionClose';
import {
  CLOSE_ALL_SAVE_DIALOG_TITLE,
  closeAllSaveDialogMessage,
  collectCloseableSessionIds,
  filterDirtySessionIds,
  formatCloseAllProgress,
  formatSaveAllCompleted,
  formatSaveAllProgress,
  formatSaveAllStopped,
  revalidateAllCloseAllDecisions,
  snapshotOpenSessionIds,
  type BulkOpKind,
  type CloseAllDecision,
} from './documentSessionBulkOps';
import {
  BROWSER_EXIT_POLICY,
  EXIT_SAVE_DIALOG_TITLE,
  anySessionDirty,
  armElectronAuthorizedUnload,
  createElectronExitUnloadGate,
  disarmElectronAuthorizedUnload,
  exitSaveDialogMessage,
  prepareDirtyLifecycleDecisions,
  sessionsChangedSinceSnapshot,
  shouldPreventUnloadForDirtySessions,
  type ExitStatus,
} from './documentSessionExit';
import { CloseSaveDialog } from './CloseSaveDialog';
import { serializeDocument } from '@ratecad/io';
import {
  appendInputBuffer,
  CadCommandEngine,
  cancelTool,
  closeAreaTemporarily,
  commitLeaderContent,
  commitNumericInput,
  commitPaperLeaderContent,
  commitPaperTextContent,
  commitTextContent,
  createAreaLabel,
  createBoundaryFromArea,
  createDefaultEngineRegistry,
  createToolSession,
  finishAreaPoints,
  finishAreaSession,
  finishPolyline,
  formatAreaMeasurementReport,
  formatRoomAreaReport,
  handlePaperDimensionPointerDown,
  handlePaperLeaderPointerDown,
  handlePaperTextPointerDown,
  handleToolPointerDown,
  handleToolPointerMove,
  handleToolPointerUp,
  isPaperAnnotationTool,
  resolveKeyboardContextFromTarget,
  SelectionManager,
  setActiveTool,
  setAreaToolMode,
  setRectangleConstraints,
  spaceConfirmsCommand,
  spaceRepeatsLastCommand,
  undoAreaPoint,
  undoAreaSessionEntry,
  type AreaToolMode,
  type CadCommandUiState,
  type ToolId,
  type ToolSession,
} from '@ratecad/tools';
import {
  applyViewportGripResize,
  applyViewportMove,
  cameraForViewport,
  cameraForZoomWindow,
  clampCameraZoom,
  createCamera,
  documentVisibleBounds,
  draftingCssCursor,
  fitCameraToBounds,
  fitPaperCameraToBounds,
  fitPaperInCanvas,
  getViewportGrips,
  hitTestPaperSpaceEntities,
  hitTestViewportGrip,
  layoutPaperBounds,
  panCamera,
  panViewportModel,
  paperViewForLayout,
  pickboxHalfPx,
  pickboxToleranceWorld,
  renderDocument,
  resolveDraftingCursorMode,
  screenToPaper,
  screenToWorld,
  screenToleranceToWorld,
  shouldDrawCrosshair,
  shouldDrawPickbox,
  viewportPatchFromCamera,
  ViewHistory,
  zoomAtScreenPoint,
  zoomViewportScale,
  type Camera,
  type CrosshairSize,
  type PickboxSize,
  type ViewSnapshot,
  type ViewportGripRole,
} from '@ratecad/viewport';
import { loadDraftingPrefs, updateDraftingPrefs } from './draftingPrefs';
import { ViewportOverlays } from './ViewportOverlays';
import './styles/app.css';

const UNIT_OPTIONS: LengthUnit[] = [...SUPPORTED_LENGTH_UNITS];

function fmtLen(doc: DrawingDocument, value: number, precision?: number): string {
  return formatLengthInUnits(
    value,
    doc.settings.units,
    precision ?? doc.settings.precision,
    doc.settings.worldUnit ?? 'ft',
    doc.settings.fractionDenominator ?? 16,
  );
}

/** @deprecated P3-B1 — prefer createUntitledBus / DocumentSession. */
function createBus(): CommandBus {
  return createUntitledBus();
}

function basename(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || filePath;
}

const RECENT_DRAWINGS_KEY = 'ratecad.recentDrawings';
const MAX_RECENT_DRAWINGS = 10;
const MAX_RECENT_CONTENTS_CHARS = 750_000;

function loadRecentDrawings(): RecentDrawing[] {
  try {
    const raw = localStorage.getItem(RECENT_DRAWINGS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (entry): entry is RecentDrawing =>
          !!entry &&
          typeof entry === 'object' &&
          typeof (entry as RecentDrawing).path === 'string' &&
          typeof (entry as RecentDrawing).name === 'string' &&
          typeof (entry as RecentDrawing).at === 'number',
      )
      .slice(0, MAX_RECENT_DRAWINGS);
  } catch {
    return [];
  }
}

function persistRecentDrawings(entries: RecentDrawing[]): void {
  try {
    localStorage.setItem(RECENT_DRAWINGS_KEY, JSON.stringify(entries));
  } catch {
    // Quota / private mode — keep in-memory only.
  }
}

function layerName(doc: DrawingDocument, layerId: string): string {
  return getLayer(doc, layerId)?.name ?? layerId;
}

function describeEntity(
  entity: Entity,
  doc: DrawingDocument,
): Array<{ label: string; value: string }> {
  const common = [
    { label: 'ID', value: entity.id },
    { label: 'Type', value: entity.type },
    { label: 'Layer', value: layerName(doc, entity.layerId) },
  ];

  switch (entity.type) {
    case 'line':
      return [
        ...common,
        {
          label: 'Length',
          value: fmtLen(
            doc,
            Math.hypot(
              entity.geometry.end.x - entity.geometry.start.x,
              entity.geometry.end.y - entity.geometry.start.y,
            ),
          ),
        },
        {
          label: 'Start',
          value: `${fmtLen(doc, entity.geometry.start.x)}, ${fmtLen(doc, entity.geometry.start.y)}`,
        },
        {
          label: 'End',
          value: `${fmtLen(doc, entity.geometry.end.x)}, ${fmtLen(doc, entity.geometry.end.y)}`,
        },
      ];
    case 'rectangle':
      return [
        ...common,
        {
          label: 'Width',
          value: fmtLen(
            doc,
            Math.abs(entity.geometry.corner2.x - entity.geometry.corner1.x),
          ),
        },
        {
          label: 'Height',
          value: fmtLen(
            doc,
            Math.abs(entity.geometry.corner2.y - entity.geometry.corner1.y),
          ),
        },
        {
          label: 'Corner1',
          value: `${fmtLen(doc, entity.geometry.corner1.x)}, ${fmtLen(doc, entity.geometry.corner1.y)}`,
        },
        {
          label: 'Corner2',
          value: `${fmtLen(doc, entity.geometry.corner2.x)}, ${fmtLen(doc, entity.geometry.corner2.y)}`,
        },
      ];
    case 'circle':
      return [
        ...common,
        {
          label: 'Center',
          value: `${fmtLen(doc, entity.geometry.center.x)}, ${fmtLen(doc, entity.geometry.center.y)}`,
        },
        { label: 'Radius', value: fmtLen(doc, entity.geometry.radius) },
        {
          label: 'Diameter',
          value: fmtLen(doc, entity.geometry.radius * 2),
        },
      ];
    case 'polyline':
      return [
        ...common,
        { label: 'Vertices', value: String(entity.geometry.vertices.length) },
        { label: 'Closed', value: entity.geometry.closed ? 'Yes' : 'No' },
      ];
    case 'dimension': {
      const measured = measuredLength(
        entity.geometry.start,
        entity.geometry.end,
        entity.geometry.kind,
      );
      const precision =
        entity.properties.precision ?? doc.settings.dimensionStyle.precision;
      const assoc = getAssociativeRef(entity);
      const rows = [
        ...common,
        { label: 'Kind', value: entity.geometry.kind },
        {
          label: 'Measured',
          value: formatLengthInUnits(measured, doc.settings.units, precision),
        },
        { label: 'Units', value: doc.settings.units },
        { label: 'Precision', value: String(precision) },
        { label: 'Offset', value: formatLength(entity.geometry.offset) },
        {
          label: 'Text Δ',
          value: formatLength(entity.geometry.textOffset ?? 0),
        },
        {
          label: 'Annotation',
          value: entity.metadata?.paperSpace
            ? 'Paper'
            : isAnnotativeEntity(entity)
              ? `Annotative ${formatAnnotationScale(doc.settings.annotationScale?.ratio ?? 50)}`
              : 'Model',
        },
      ];
      if (assoc) {
        rows.push({
          label: 'Associative',
          value: assoc.valid
            ? `Yes → ${assoc.modelEntityId}`
            : `Broken (${assoc.brokenReason ?? 'invalid'})`,
        });
      }
      return rows;
    }
    case 'text':
      return [
        ...common,
        { label: 'Content', value: entity.geometry.content },
        { label: 'Size', value: formatLength(entity.geometry.height) },
        {
          label: 'Annotation',
          value: entity.metadata?.paperSpace
            ? 'Paper'
            : isAnnotativeEntity(entity)
              ? `Annotative ${formatAnnotationScale(doc.settings.annotationScale?.ratio ?? 50)}`
              : 'Model',
        },
        {
          label: 'Rotation',
          value: `${((entity.geometry.rotation * 180) / Math.PI).toFixed(1)}°`,
        },
        {
          label: 'Position',
          value: `${formatLength(entity.geometry.position.x)}, ${formatLength(entity.geometry.position.y)}`,
        },
      ];
    case 'leader':
      return [
        ...common,
        { label: 'Content', value: entity.geometry.content },
        { label: 'Size', value: formatLength(entity.geometry.textHeight) },
        {
          label: 'Annotation',
          value: entity.metadata?.paperSpace
            ? 'Paper'
            : isAnnotativeEntity(entity)
              ? `Annotative ${formatAnnotationScale(doc.settings.annotationScale?.ratio ?? 50)}`
              : 'Model',
        },
        {
          label: 'Arrow',
          value: `${formatLength(entity.geometry.arrow.x)}, ${formatLength(entity.geometry.arrow.y)}`,
        },
      ];
    case 'wall':
      return [
        ...common,
        {
          label: 'Length',
          value: fmtLen(doc, wallLength(entity)),
        },
        {
          label: 'Thickness',
          value: fmtLen(doc, entity.geometry.thickness),
        },
        {
          label: 'Height',
          value: fmtLen(doc, entity.geometry.height),
        },
        { label: 'Material', value: entity.properties.material ?? '—' },
        { label: 'Type', value: entity.properties.wallType ?? '—' },
        {
          label: 'Start',
          value: `${formatLength(entity.geometry.start.x)}, ${formatLength(entity.geometry.start.y)}`,
        },
        {
          label: 'End',
          value: `${formatLength(entity.geometry.end.x)}, ${formatLength(entity.geometry.end.y)}`,
        },
      ];
    case 'door': {
      const host = getWall(doc, entity.geometry.hostWallId);
      return [
        ...common,
        { label: 'Host wall', value: host?.id ?? entity.geometry.hostWallId },
        {
          label: 'Width',
          value: fmtLen(doc, entity.geometry.width),
        },
        {
          label: 'Height',
          value: fmtLen(doc, entity.geometry.height),
        },
        { label: 'Swing', value: entity.geometry.swing },
        {
          label: 'Swing ∠',
          value: `${((entity.geometry.swingAngle * 180) / Math.PI).toFixed(0)}°`,
        },
        { label: 'Type', value: entity.properties.doorType ?? '—' },
        {
          label: 'Position',
          value: `${(entity.geometry.position * 100).toFixed(1)}%`,
        },
      ];
    }
    case 'window': {
      const host = getWall(doc, entity.geometry.hostWallId);
      return [
        ...common,
        { label: 'Host wall', value: host?.id ?? entity.geometry.hostWallId },
        {
          label: 'Width',
          value: fmtLen(doc, entity.geometry.width),
        },
        {
          label: 'Height',
          value: fmtLen(doc, entity.geometry.height),
        },
        {
          label: 'Sill',
          value: fmtLen(doc, entity.geometry.sillHeight),
        },
        { label: 'Type', value: entity.properties.windowType ?? '—' },
        {
          label: 'Position',
          value: `${(entity.geometry.position * 100).toFixed(1)}%`,
        },
      ];
    }
    case 'room': {
      const walls = findWallsForRoom(doc, entity.id);
      const doors = findDoorsForRoom(doc, entity.id);
      const windows = findWindowsForRoom(doc, entity.id);
      return [
        ...common,
        { label: 'Name', value: entity.properties.name },
        { label: 'Room type', value: entity.properties.roomType ?? '—' },
        {
          label: 'Area',
          value: formatAreaInUnits(
            entity.geometry.area,
            doc.settings.units,
            doc.settings.precision,
          ),
        },
        { label: 'Walls', value: String(walls.length) },
        { label: 'Doors', value: String(doors.length) },
        { label: 'Windows', value: String(windows.length) },
        {
          label: 'Boundary',
          value: entity.geometry.wallIds.join(', '),
        },
        {
          label: 'Label',
          value: `${formatLength(entity.geometry.labelPosition.x)}, ${formatLength(entity.geometry.labelPosition.y)}`,
        },
      ];
    }
  }
}

export function App() {
  const busRef = useRef<CommandBus>(createBus());
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const cameraRef = useRef<Camera>(createCamera());
  /** Preserved Model Space camera when switching to a layout tab. */
  const modelCameraRef = useRef<Camera>(createCamera());
  const viewHistoryRef = useRef(new ViewHistory(32));
  const wheelHistoryArmedRef = useRef(true);
  const panHistoryPushedRef = useRef(false);
  const sizeRef = useRef({ width: 800, height: 600 });
  const navApiRef = useRef({
    zoomExtents: (): { ok: boolean; message: string } => ({
      ok: false,
      message: 'ZOOM Extents unavailable',
    }),
    zoomWindow: (
      _a: { x: number; y: number },
      _b: { x: number; y: number },
    ): { ok: boolean; message: string } => ({
      ok: false,
      message: 'ZOOM Window unavailable',
    }),
    zoomPrevious: (): { ok: boolean; message: string } => ({
      ok: false,
      message: 'ZOOM Previous unavailable',
    }),
    beginPanTool: (): void => undefined,
  });
  const sessionRef = useRef<ToolSession>(createToolSession('select'));
  const workspaceModeRef = useRef<WorkspaceMode>('MODEL_SPACE');
  const activeViewportIdRef = useRef<ViewportId | null>(null);
  const isPanningRef = useRef(false);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const spaceDownRef = useRef(false);
  const filePathRef = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  const suppressDirtyRef = useRef(false);
  /**
   * P3-B3B: DocumentSession store holds N isolated sessions; App mirrors
   * only the active session's bus / selection / engine / cameras / history.
   */
  const sessionStoreRef = useRef<DocumentSessionStore>(
    createDocumentSessionStore(),
  );
  const documentSessionRef = useRef<DocumentSession | null>(null);
  if (documentSessionRef.current == null) {
    documentSessionRef.current = createAndRegisterSession(
      sessionStoreRef.current,
      {
        bus: busRef.current,
        camera: cameraRef.current,
        modelCamera: modelCameraRef.current,
        viewHistory: viewHistoryRef.current,
        toolSession: sessionRef.current,
        // App subscribe remains the dirty notifier for active-session UI.
        trackDirtyFromBus: false,
      },
    );
  }
  const [activeSessionId, setActiveSessionId] = useState<string>(
    () => documentSessionRef.current!.id,
  );
  /** Bumps when the session list or active tab changes (tab strip refresh). */
  const [sessionListVersion, setSessionListVersion] = useState(0);
  /** Prevent concurrent saves for the same session / overlapping writes. */
  const saveInFlightRef = useRef<Set<string>>(new Set());
  /** Prevent duplicate close workflows for the same session. */
  const closeInFlightRef = useRef<Set<string>>(new Set());
  /** P3-B4B2A — exclusive Save All / Close All lock. */
  const bulkOpRef = useRef<BulkOpKind | null>(null);
  /** ISS-N1 — allow one authorized Electron unload without clearing dirty. */
  const electronExitUnloadGateRef = useRef(createElectronExitUnloadGate());
  const [bulkOpBusy, setBulkOpBusy] = useState(false);
  /** Prefer this session when closing the active tab (MRU). */
  const previousActiveSessionIdRef = useRef<string | null>(null);
  const [closePrompt, setClosePrompt] = useState<{
    sessionId: string;
    title: string;
    dialogTitle?: string;
    message?: string;
    progressLabel?: string;
    resolve: (choice: CloseSaveChoice) => void;
  } | null>(null);
  const [closePromptBusy, setClosePromptBusy] = useState(false);
  const closePromptOpenRef = useRef(false);
  const closePromptRef = useRef(closePrompt);
  useEffect(() => {
    closePromptOpenRef.current = closePrompt != null;
    closePromptRef.current = closePrompt;
  }, [closePrompt]);
  const rafPanRef = useRef<number | null>(null);
  const pendingPanRef = useRef<{ dx: number; dy: number } | null>(null);
  const commandLineRef = useRef('');
  const commandInputRef = useRef<HTMLInputElement | null>(null);
  const cursorWorldRef = useRef({ x: 0, y: 0 });
  const engineRef = useRef<CadCommandEngine | null>(null);
  const selectionManagerRef = useRef<SelectionManager | null>(
    documentSessionRef.current.selectionManager,
  );
  const hoveredIdRef = useRef<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const polarEngineRef = useRef(
    new PolarTrackingEngine(
      { enabled: false },
      {
        enabled: false,
        incrementDeg: 90,
        extraAnglesDeg: [45, 135, 225, 315],
        snapToleranceDeg: 180,
      },
    ),
  );

  const [doc, setDoc] = useState<DrawingDocument>(() =>
    ensureLayouts(busRef.current.getDocument()),
  );
  const [session, setSession] = useState<ToolSession>(() => sessionRef.current);
  const [camera, setCamera] = useState<Camera>(() => cameraRef.current);
  const [workspaceMode, setWorkspaceMode] =
    useState<WorkspaceMode>('MODEL_SPACE');
  const [activeViewportId, setActiveViewportId] = useState<ViewportId | null>(
    null,
  );
  const [selectedViewportId, setSelectedViewportId] =
    useState<ViewportId | null>(null);
  const selectedViewportIdRef = useRef<ViewportId | null>(null);
  useEffect(() => {
    selectedViewportIdRef.current = selectedViewportId;
  }, [selectedViewportId]);
  const [selectedPaperEntityIds, setSelectedPaperEntityIds] = useState<
    string[]
  >([]);
  const selectedPaperEntityIdsRef = useRef<string[]>([]);
  useEffect(() => {
    selectedPaperEntityIdsRef.current = selectedPaperEntityIds;
  }, [selectedPaperEntityIds]);
  /** Live paper-space viewport drag (move/resize) — preview only until pointer up. */
  type VpDragSession =
    | {
        kind: 'move';
        layoutId: LayoutId;
        viewportId: ViewportId;
        startPaper: { x: number; y: number };
        original: LayoutViewport;
        preview: LayoutViewport;
      }
    | {
        kind: 'resize';
        layoutId: LayoutId;
        viewportId: ViewportId;
        role: ViewportGripRole;
        original: LayoutViewport;
        preview: LayoutViewport;
      };
  const vpDragRef = useRef<VpDragSession | null>(null);
  const [vpDragTick, setVpDragTick] = useState(0);
  const bumpVpDrag = useCallback(() => setVpDragTick((n) => n + 1), []);
  const [cursorWorld, setCursorWorld] = useState({ x: 0, y: 0 });
  const [cursorScreen, setCursorScreen] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [pointerOverCanvas, setPointerOverCanvas] = useState(false);
  const [draftingPrefs, setDraftingPrefs] = useState(() => loadDraftingPrefs());
  const pickboxPxRef = useRef(pickboxHalfPx(draftingPrefs.pickboxSize));
  useEffect(() => {
    pickboxPxRef.current = pickboxHalfPx(draftingPrefs.pickboxSize);
  }, [draftingPrefs.pickboxSize]);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [statusExtra, setStatusExtra] = useState<string | null>(null);
  const [discardPrompt, setDiscardPrompt] = useState<{
    resolve: (ok: boolean) => void;
  } | null>(null);
  const [textPrompt, setTextPrompt] = useState('');
  const textInputRef = useRef<HTMLInputElement | null>(null);
  const [commandLine, setCommandLine] = useState('');
  const [commandFeedback, setCommandFeedback] = useState<string | null>(null);
  const [rectLengthText, setRectLengthText] = useState('');
  const [rectWidthText, setRectWidthText] = useState('');
  const [engineUi, setEngineUi] = useState<CadCommandUiState | null>(null);
  const [orthoOn, setOrthoOn] = useState(false);
  const [showUnitsDialog, setShowUnitsDialog] = useState(false);
  const [showDimStyleDialog, setShowDimStyleDialog] = useState(false);
  const showUnitsDialogRef = useRef(false);
  const showDimStyleDialogRef = useRef(false);
  const [polarOn, setPolarOn] = useState(false);
  const [polarIncrement, setPolarIncrement] = useState(90);
  const [appMenuOpen, setAppMenuOpen] = useState(false);
  const appMenuOpenRef = useRef(false);
  const [recentDrawings, setRecentDrawings] = useState<RecentDrawing[]>(() =>
    loadRecentDrawings(),
  );

  useEffect(() => {
    appMenuOpenRef.current = appMenuOpen;
  }, [appMenuOpen]);

  const syncSession = useCallback((next: ToolSession) => {
    sessionRef.current = next;
    if (documentSessionRef.current) {
      documentSessionRef.current.toolSession = next;
    }
    setSession(next);
  }, []);

  const refreshEngineUi = useCallback(() => {
    const eng = engineRef.current;
    if (!eng) return;
    setEngineUi(eng.getUiState());
    setCommandLine(eng.getBuffer());
    commandLineRef.current = eng.getBuffer();
    const ui = eng.getUiState();
    if (ui.message) setCommandFeedback(ui.message);
    else if (ui.commandName) setCommandFeedback(ui.commandName);
  }, []);

  const syncCamera = useCallback((next: Camera) => {
    cameraRef.current = next;
    if (documentSessionRef.current) {
      documentSessionRef.current.camera = next;
    }
    setCamera(next);
  }, []);

  const captureViewSnapshot = useCallback((): ViewSnapshot | null => {
    const mode = workspaceModeRef.current;
    const d = busRef.current.getDocument();
    if (mode === 'MODEL_SPACE') {
      return { kind: 'model', camera: { ...cameraRef.current } };
    }
    const layoutId = d.activeLayoutId;
    if (!layoutId) return null;
    const layout = d.layouts.find((l) => l.id === layoutId);
    if (!layout) return null;
    if (mode === 'PAPER_SPACE') {
      return {
        kind: 'paper',
        layoutId,
        paperCamera: {
          ...(layout.paperCamera ?? defaultPaperCamera()),
        },
      };
    }
    const vpId = activeViewportIdRef.current;
    if (!vpId) return null;
    const vp = layout.viewports.find((v) => v.id === vpId);
    if (!vp) return null;
    return {
      kind: 'viewport',
      layoutId,
      viewportId: vpId,
      modelCenterX: vp.modelCenterX,
      modelCenterY: vp.modelCenterY,
      scale: vp.scale,
    };
  }, []);

  const pushViewHistory = useCallback(() => {
    const snap = captureViewSnapshot();
    if (snap) viewHistoryRef.current.push(snap);
  }, [captureViewSnapshot]);

  const applyViewSnapshot = useCallback(
    (snap: ViewSnapshot): { ok: boolean; message: string } => {
      if (snap.kind === 'model') {
        if (workspaceModeRef.current !== 'MODEL_SPACE') {
          return { ok: false, message: 'Previous view is Model Space only' };
        }
        syncCamera(clampCameraZoom(snap.camera));
        return { ok: true, message: 'ZOOM Previous' };
      }
      const d = busRef.current.getDocument();
      if (snap.kind === 'paper') {
        if (
          workspaceModeRef.current !== 'PAPER_SPACE' ||
          d.activeLayoutId !== snap.layoutId
        ) {
          return { ok: false, message: 'Previous view is for another layout' };
        }
        busRef.current.updateWithoutHistory((doc) =>
          updateLayoutSheetMeta(doc, snap.layoutId, {
            paperCamera: snap.paperCamera,
          }),
        );
        return { ok: true, message: 'ZOOM Previous' };
      }
      if (
        workspaceModeRef.current !== 'VIEWPORT_MODEL_SPACE' ||
        d.activeLayoutId !== snap.layoutId ||
        activeViewportIdRef.current !== snap.viewportId
      ) {
        return { ok: false, message: 'Previous view is for another viewport' };
      }
      const layout = d.layouts.find((l) => l.id === snap.layoutId);
      const vp = layout?.viewports.find((v) => v.id === snap.viewportId);
      if (!vp) return { ok: false, message: 'Viewport not found' };
      if (vp.locked) {
        return { ok: false, message: 'Viewport locked — unlock to restore view' };
      }
      busRef.current.updateWithoutHistory((doc) =>
        replaceViewport(doc, snap.layoutId, {
          ...vp,
          modelCenterX: snap.modelCenterX,
          modelCenterY: snap.modelCenterY,
          scale: snap.scale,
        }),
      );
      return { ok: true, message: 'ZOOM Previous' };
    },
    [syncCamera],
  );

  const applyModelOrViewportCamera = useCallback(
    (next: Camera): { ok: boolean; message: string } => {
      const cam = clampCameraZoom(next);
      const mode = workspaceModeRef.current;
      if (mode === 'MODEL_SPACE') {
        pushViewHistory();
        syncCamera(cam);
        return { ok: true, message: 'View updated' };
      }
      if (mode === 'VIEWPORT_MODEL_SPACE') {
        const d = busRef.current.getDocument();
        const layoutId = d.activeLayoutId;
        const vpId = activeViewportIdRef.current;
        if (!layoutId || !vpId) {
          return { ok: false, message: 'No active viewport' };
        }
        const layout = d.layouts.find((l) => l.id === layoutId);
        const vp = layout?.viewports.find((v) => v.id === vpId);
        if (!layout || !vp) return { ok: false, message: 'Viewport not found' };
        if (vp.locked) {
          return { ok: false, message: 'Viewport locked — unlock to pan/zoom' };
        }
        const view = fitPaperInCanvas(
          layout.pageSettings,
          sizeRef.current.width,
          sizeRef.current.height,
        );
        const paperUnitMm = view.page.units === 'inch' ? 25.4 : 1;
        const pxPerPaperUnit = view.pxPerMm * paperUnitMm;
        const patch = viewportPatchFromCamera(cam, pxPerPaperUnit);
        pushViewHistory();
        busRef.current.updateWithoutHistory((doc) =>
          replaceViewport(doc, layoutId, { ...vp, ...patch }),
        );
        return { ok: true, message: 'View updated' };
      }
      return { ok: false, message: 'Use Extents/Window in Model or viewport' };
    },
    [pushViewHistory, syncCamera],
  );

  const zoomExtents = useCallback((): { ok: boolean; message: string } => {
    const { width, height } = sizeRef.current;
    const mode = workspaceModeRef.current;
    const d = busRef.current.getDocument();

    if (mode === 'PAPER_SPACE') {
      const layoutId = d.activeLayoutId;
      if (!layoutId) return { ok: false, message: 'No active layout' };
      const layout = d.layouts.find((l) => l.id === layoutId);
      if (!layout) return { ok: false, message: 'Layout not found' };
      pushViewHistory();
      const bounds = layoutPaperBounds(layout);
      const sheet = sheetSizeInPageUnits(layout.pageSettings);
      const paperCamera = bounds
        ? fitPaperCameraToBounds(
            bounds,
            sheet.width,
            sheet.height,
            width,
            height,
          )
        : defaultPaperCamera();
      busRef.current.updateWithoutHistory((doc) =>
        updateLayoutSheetMeta(doc, layoutId, { paperCamera }),
      );
      return { ok: true, message: 'ZOOM Extents' };
    }

    const bounds = documentVisibleBounds(d);
    if (!bounds) {
      if (mode === 'MODEL_SPACE') {
        pushViewHistory();
        syncCamera(createCamera());
      } else {
        const result = applyModelOrViewportCamera(createCamera());
        if (!result.ok) return result;
      }
      return { ok: true, message: 'ZOOM Extents (empty drawing)' };
    }

    let fitWidth = width;
    let fitHeight = height;
    if (mode === 'VIEWPORT_MODEL_SPACE') {
      const layoutId = d.activeLayoutId;
      const vpId = activeViewportIdRef.current;
      const layout = d.layouts.find((l) => l.id === layoutId);
      const vp = layout?.viewports.find((v) => v.id === vpId);
      if (layout && vp) {
        const view = fitPaperInCanvas(layout.pageSettings, width, height);
        const { screenRect } = cameraForViewport(vp, view);
        fitWidth = Math.max(1, screenRect.w);
        fitHeight = Math.max(1, screenRect.h);
      }
    }

    const next = fitCameraToBounds(bounds, fitWidth, fitHeight);
    const result = applyModelOrViewportCamera(next);
    if (!result.ok) return result;
    return { ok: true, message: 'ZOOM Extents' };
  }, [applyModelOrViewportCamera, pushViewHistory, syncCamera]);

  const zoomWindow = useCallback(
    (
      a: { x: number; y: number },
      b: { x: number; y: number },
    ): { ok: boolean; message: string } => {
      const { width, height } = sizeRef.current;
      const mode = workspaceModeRef.current;
      if (mode === 'PAPER_SPACE') {
        // Paper zoom window: approximate via zoom factor on paper camera
        const d = busRef.current.getDocument();
        const layoutId = d.activeLayoutId;
        if (!layoutId) return { ok: false, message: 'No active layout' };
        const layout = d.layouts.find((l) => l.id === layoutId);
        if (!layout) return { ok: false, message: 'Layout not found' };
        const minX = Math.min(a.x, b.x);
        const maxX = Math.max(a.x, b.x);
        const minY = Math.min(a.y, b.y);
        const maxY = Math.max(a.y, b.y);
        if (maxX - minX < 1e-9 || maxY - minY < 1e-9) {
          return { ok: false, message: 'Null view window' };
        }
        const sheet = sheetSizeInPageUnits(layout.pageSettings);
        pushViewHistory();
        const paperCamera = fitPaperCameraToBounds(
          { minX, minY, maxX, maxY },
          sheet.width,
          sheet.height,
          width,
          height,
        );
        busRef.current.updateWithoutHistory((doc) =>
          updateLayoutSheetMeta(doc, layoutId, { paperCamera }),
        );
        return { ok: true, message: 'ZOOM Window' };
      }

      let fitWidth = width;
      let fitHeight = height;
      if (mode === 'VIEWPORT_MODEL_SPACE') {
        const d = busRef.current.getDocument();
        const layout = d.layouts.find((l) => l.id === d.activeLayoutId);
        const vp = layout?.viewports.find(
          (v) => v.id === activeViewportIdRef.current,
        );
        if (layout && vp) {
          const view = fitPaperInCanvas(
            layout.pageSettings,
            width,
            height,
          );
          const { screenRect } = cameraForViewport(vp, view);
          fitWidth = Math.max(1, screenRect.w);
          fitHeight = Math.max(1, screenRect.h);
        }
      }

      const next = cameraForZoomWindow(a, b, fitWidth, fitHeight);
      if (!next) return { ok: false, message: 'Null view window' };
      const result = applyModelOrViewportCamera(next);
      if (!result.ok) return result;
      return { ok: true, message: 'ZOOM Window' };
    },
    [applyModelOrViewportCamera, pushViewHistory],
  );

  const zoomPrevious = useCallback((): { ok: boolean; message: string } => {
    const prev = viewHistoryRef.current.previous();
    if (!prev) return { ok: false, message: 'No previous view' };
    return applyViewSnapshot(prev);
  }, [applyViewSnapshot]);

  const markDirty = useCallback((value: boolean) => {
    dirtyRef.current = value;
    const ds = documentSessionRef.current;
    if (ds) {
      if (value) markSessionDirty(ds);
      else clearSessionDirty(ds);
    }
    setDirty(value);
  }, []);

  const setSuppressDirty = useCallback((value: boolean) => {
    suppressDirtyRef.current = value;
    const ds = documentSessionRef.current;
    if (ds) ds.suppressDirty = value;
  }, []);

  const setProjectPath = useCallback((path: string | null) => {
    filePathRef.current = path;
    if (documentSessionRef.current) {
      setSessionFilePath(documentSessionRef.current, path);
    }
    setFilePath(path);
  }, []);

  const rememberRecentDrawing = useCallback(
    (path: string, contents?: string) => {
      if (!path.trim()) return;
      const name = basename(path);
      setRecentDrawings((prev) => {
        const prior = prev.find((entry) => entry.path === path);
        const cached =
          contents && contents.length <= MAX_RECENT_CONTENTS_CHARS
            ? contents
            : prior?.contents &&
                prior.contents.length <= MAX_RECENT_CONTENTS_CHARS
              ? prior.contents
              : undefined;
        const next: RecentDrawing[] = [
          { path, name, at: Date.now(), ...(cached ? { contents: cached } : {}) },
          ...prev.filter((entry) => entry.path !== path),
        ].slice(0, MAX_RECENT_DRAWINGS);
        persistRecentDrawings(next);
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    const bus = busRef.current;
    let previous = bus.getDocument();
    return bus.subscribe((next) => {
      // Ignore notifications from a bus that is no longer active.
      if (busRef.current !== bus) return;
      setDoc(next);
      setCanUndo(bus.canUndo());
      setCanRedo(bus.canRedo());
      if (!suppressDirtyRef.current) {
        const kind = bus.getLastChangeKind();
        if (shouldMarkDirtyForBusChange(kind, previous, next)) {
          markDirty(true);
        }
      }
      previous = next;
    });
  }, [markDirty, activeSessionId]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      const nextSize = {
        width: Math.max(1, Math.floor(width)),
        height: Math.max(1, Math.floor(height)),
      };
      sizeRef.current = nextSize;
      setSize(nextSize);
    });
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(size.width * dpr);
    canvas.height = Math.floor(size.height * dpr);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sess = sessionRef.current;
    const engUi = engineRef.current?.getUiState();
    const activeLayout =
      doc.activeLayoutId != null
        ? doc.layouts.find((l) => l.id === doc.activeLayoutId)
        : null;
    const inPaper =
      workspaceMode === 'PAPER_SPACE' ||
      workspaceMode === 'VIEWPORT_MODEL_SPACE';
    const drag = vpDragRef.current;
    const paperPreviewFromEngine =
      inPaper &&
      engUi?.preview?.kind === 'rectangle' &&
      engineRef.current?.getRunningCommand()?.id === 'mview'
        ? { a: engUi.preview.start, b: engUi.preview.end }
        : null;
    renderDocument(ctx, {
      width: size.width,
      height: size.height,
      camera: cameraRef.current,
      document: doc,
      preview: inPaper ? null : engUi?.preview ?? sess.preview,
      previewEntities: inPaper
        ? null
        : engUi?.previewEntities ?? sess.previewEntities,
      selectionRect: inPaper ? null : sess.selectionRect,
      hideEntityIds: engUi?.hideEntityIds?.length
        ? engUi.hideEntityIds
        : sess.hideEntityIds,
      cursorWorld,
      cursorScreen,
      showDraftingCursor:
        pointerOverCanvas &&
        shouldDrawCrosshair(
          resolveDraftingCursorMode({
            activeTool: sess.activeTool,
            sessionMode: sess.mode,
            spacePan: spaceDownRef.current,
            isPanning: isPanningRef.current,
            pointerOverCanvas,
            engineCommandName: engUi?.commandName,
            enginePrompt: engUi?.prompt,
            textDialogOpen: sess.mode === 'text-input',
          }),
        ),
      showPickbox:
        pointerOverCanvas &&
        shouldDrawPickbox(
          resolveDraftingCursorMode({
            activeTool: sess.activeTool,
            sessionMode: sess.mode,
            spacePan: spaceDownRef.current,
            isPanning: isPanningRef.current,
            pointerOverCanvas,
            engineCommandName: engUi?.commandName,
            enginePrompt: engUi?.prompt,
            textDialogOpen: sess.mode === 'text-input',
          }),
        ),
      crosshairSize: draftingPrefs.crosshairSize,
      pickboxSize: draftingPrefs.pickboxSize,
      snap: inPaper ? null : sess.lastSnap,
      hoveredEntityId: hoveredId,
      paperSpaceLayout: inPaper ? activeLayout : null,
      workspaceMode,
      activeViewportId,
      selectedViewportId,
      paperPreviewRect: paperPreviewFromEngine,
      viewportPreviewOverride: drag?.preview ?? null,
      selectedPaperEntityIds,
    });
  }, [
    doc,
    session,
    camera,
    size,
    cursorWorld,
    cursorScreen,
    pointerOverCanvas,
    draftingPrefs.crosshairSize,
    draftingPrefs.pickboxSize,
    engineUi,
    hoveredId,
    workspaceMode,
    activeViewportId,
    selectedViewportId,
    selectedPaperEntityIds,
    vpDragTick,
  ]);

  const switchToModelTab = useCallback(() => {
    // Restore Model Space camera preserved when leaving MODEL
    const restored = { ...modelCameraRef.current };
    cameraRef.current = restored;
    setCamera(restored);
    workspaceModeRef.current = 'MODEL_SPACE';
    setWorkspaceMode('MODEL_SPACE');
    setActiveViewportId(null);
    activeViewportIdRef.current = null;
    setSelectedViewportId(null);
    setSelectedPaperEntityIds([]);
    busRef.current.updateWithoutHistory((d) =>
      setActiveLayout(ensureLayouts(d), null),
    );
    setStatusExtra('MODEL SPACE');
  }, []);

  const switchToLayoutTab = useCallback((layoutId: LayoutId) => {
    if (workspaceModeRef.current === 'MODEL_SPACE') {
      modelCameraRef.current = { ...cameraRef.current };
    }
    workspaceModeRef.current = 'PAPER_SPACE';
    setWorkspaceMode('PAPER_SPACE');
    setActiveViewportId(null);
    activeViewportIdRef.current = null;
    setSelectedViewportId(null);
    setSelectedPaperEntityIds([]);
    busRef.current.updateWithoutHistory((d) =>
      setActiveLayout(ensureLayouts(d), layoutId),
    );
    const layout = busRef.current
      .getDocument()
      .layouts.find((l) => l.id === layoutId);
    setStatusExtra(layout ? `PAPER SPACE · ${layout.name}` : 'PAPER SPACE');
  }, []);

  const createNewLayoutTab = useCallback(() => {
    if (workspaceModeRef.current === 'MODEL_SPACE') {
      modelCameraRef.current = { ...cameraRef.current };
    }
    busRef.current.updateWithoutHistory((d) => {
      const { document } = addLayout(ensureLayouts(d));
      return document;
    });
    const next = busRef.current.getDocument();
    const layoutId = next.activeLayoutId;
    workspaceModeRef.current = 'PAPER_SPACE';
    setWorkspaceMode('PAPER_SPACE');
    setActiveViewportId(null);
    activeViewportIdRef.current = null;
    setSelectedViewportId(null);
    setSelectedPaperEntityIds([]);
    const layout = next.layouts.find((l) => l.id === layoutId);
    setStatusExtra(layout ? `PAPER SPACE · ${layout.name}` : 'PAPER SPACE');
    markDirty(true);
  }, [markDirty]);

  useEffect(() => {
    const name = doc.meta.name + (dirty ? ' *' : '');
    document.title = `${name} — RateCAD`;
  }, [doc.meta.name, dirty]);

  const getScreenFromEvent = useCallback(
    (event: { clientX: number; clientY: number }) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
    },
    [],
  );

  const getPaperFromEvent = useCallback(
    (event: { clientX: number; clientY: number }) => {
      const d = busRef.current.getDocument();
      const layout = d.layouts.find((l) => l.id === d.activeLayoutId);
      if (!layout) return { x: 0, y: 0 };
      const view = paperViewForLayout(layout, size.width, size.height);
      return screenToPaper(getScreenFromEvent(event), view);
    },
    [getScreenFromEvent, size.height, size.width],
  );

  const getWorldFromEvent = useCallback(
    (event: { clientX: number; clientY: number }) => {
      const screen = getScreenFromEvent(event);
      // Inside an active layout viewport: map through that viewport's camera.
      if (workspaceModeRef.current === 'VIEWPORT_MODEL_SPACE') {
        const d = busRef.current.getDocument();
        const layout = d.layouts.find((l) => l.id === d.activeLayoutId);
        const vpId = activeViewportIdRef.current;
        const vp = layout?.viewports.find((v) => v.id === vpId);
        if (layout && vp) {
          const view = fitPaperInCanvas(
            layout.pageSettings,
            size.width,
            size.height,
          );
          const { camera, screenRect } = cameraForViewport(vp, view);
          const local = {
            x: screen.x - screenRect.x,
            y: screen.y - screenRect.y,
          };
          // Outside the active viewport → still return a world point but tools
          // should prefer clipped selection; mapping uses full vp size.
          return screenToWorld(local, camera, screenRect.w, screenRect.h);
        }
      }
      return screenToWorld(screen, cameraRef.current, size.width, size.height);
    },
    [getScreenFromEvent, size.height, size.width],
  );

  const getActiveInteractionCamera = useCallback((): Camera => {
    if (workspaceModeRef.current === 'VIEWPORT_MODEL_SPACE') {
      const d = busRef.current.getDocument();
      const layout = d.layouts.find((l) => l.id === d.activeLayoutId);
      const vp = layout?.viewports.find(
        (v) => v.id === activeViewportIdRef.current,
      );
      if (layout && vp) {
        const view = fitPaperInCanvas(
          layout.pageSettings,
          size.width,
          size.height,
        );
        return cameraForViewport(vp, view).camera;
      }
    }
    return cameraRef.current;
  }, [size.height, size.width]);

  const cancelViewportDrag = useCallback(() => {
    if (!vpDragRef.current) return;
    vpDragRef.current = null;
    bumpVpDrag();
  }, [bumpVpDrag]);

  const activateToolOnly = useCallback(
    (tool: ToolId, dimKind?: DimensionKind) => {
      isPanningRef.current = false;
      lastPointerRef.current = null;
      setRectLengthText('');
      setRectWidthText('');
      syncSession(
        setActiveTool(sessionRef.current, tool, dimKind ? { dimKind } : undefined),
      );
    },
    [syncSession],
  );

  const beginPanTool = useCallback(() => {
    activateToolOnly('pan');
    setCommandFeedback('PAN: Drag to pan — ESC for Select');
  }, [activateToolOnly]);

  useEffect(() => {
    navApiRef.current = {
      zoomExtents,
      zoomWindow,
      zoomPrevious,
      beginPanTool,
    };
  }, [beginPanTool, zoomExtents, zoomPrevious, zoomWindow]);

  // Bind CadCommandEngine onto the active DocumentSession (P3-B3A/B3B).
  // Host methods guard on session id so stale engines cannot mutate the
  // newly active drawing after a tab switch.
  useEffect(() => {
    const ds = documentSessionRef.current;
    if (!ds) return;
    const boundSessionId = ds.id;
    selectionManagerRef.current = ds.selectionManager;

    const activeDs = (): DocumentSession | null => {
      const current = documentSessionRef.current;
      if (!current || current.disposed || current.id !== boundSessionId) {
        return null;
      }
      return current;
    };

    const host = {
      getUnits: () =>
        (activeDs() ?? ds).bus.getDocument().settings.units,
      getWorldUnit: () =>
        (activeDs() ?? ds).bus.getDocument().settings.worldUnit ?? 'ft',
      getSelectedIds: () =>
        (activeDs() ?? ds).bus.getDocument().selection,
      getCursor: () => cursorWorldRef.current,
      activateTool: (tool: string) => {
        if (!activeDs()) return;
        activateToolOnly(tool as ToolId);
      },
      activateSelect: () => {
        if (!activeDs()) return;
        activateToolOnly('select');
      },
      clearSelection: () => {
        const session = activeDs();
        if (!session) return;
        session.selectionManager.clear();
        setDoc(session.bus.getDocument());
        setSessionHoveredId(session, null);
        hoveredIdRef.current = null;
        setHoveredId(null);
      },
      onNaturalLanguage: (text: string) => {
        if (!activeDs()) return;
        setCommandFeedback(`AI (NL): ${text}`);
      },
      getWorkspaceMode: () => workspaceModeRef.current,
      enterMspace: () => {
        const session = activeDs();
        if (!session) return { ok: false, message: 'MSPACE: Inactive session' };
        const d = session.bus.getDocument();
        const layout = d.layouts.find((l) => l.id === d.activeLayoutId);
        if (!layout) {
          return { ok: false, message: 'MSPACE: No active layout' };
        }
        const selected = selectedViewportIdRef.current
          ? layout.viewports.find((v) => v.id === selectedViewportIdRef.current)
          : null;
        const target =
          selected ??
          layout.viewports.find((v) => v.visible) ??
          layout.viewports[0] ??
          null;
        if (!target) {
          return { ok: false, message: 'MSPACE: No active viewport' };
        }
        workspaceModeRef.current = 'VIEWPORT_MODEL_SPACE';
        session.workspaceMode = 'VIEWPORT_MODEL_SPACE';
        setWorkspaceMode('VIEWPORT_MODEL_SPACE');
        setActiveViewportId(target.id);
        activeViewportIdRef.current = target.id;
        session.activeViewportId = target.id;
        setSelectedViewportId(target.id);
        session.selectedViewportId = target.id;
        const vpIndex = layout.viewports.findIndex((v) => v.id === target.id);
        const msg = workspaceModeLabel(
          'VIEWPORT_MODEL_SPACE',
          layout.name,
          vpIndex,
        );
        setStatusExtra(msg);
        return { ok: true, message: `MSPACE: ${msg}` };
      },
      enterPspace: () => {
        const session = activeDs();
        if (!session) return { ok: false, message: 'PSPACE: Inactive session' };
        const d = session.bus.getDocument();
        const layout = d.layouts.find((l) => l.id === d.activeLayoutId);
        if (!layout) {
          return { ok: false, message: 'PSPACE: No active layout' };
        }
        workspaceModeRef.current = 'PAPER_SPACE';
        session.workspaceMode = 'PAPER_SPACE';
        setWorkspaceMode('PAPER_SPACE');
        setActiveViewportId(null);
        activeViewportIdRef.current = null;
        session.activeViewportId = null;
        setStatusExtra(`PAPER SPACE · ${layout.name}`);
        return { ok: true, message: `PSPACE: PAPER SPACE · ${layout.name}` };
      },
      onLayoutChanged: (layoutId: string | null, message: string) => {
        const session = activeDs();
        if (!session) return;
        setDoc(session.bus.getDocument());
        markDirty(true);
        if (layoutId == null) {
          workspaceModeRef.current = 'MODEL_SPACE';
          session.workspaceMode = 'MODEL_SPACE';
          setWorkspaceMode('MODEL_SPACE');
          setActiveViewportId(null);
          activeViewportIdRef.current = null;
          session.activeViewportId = null;
          setStatusExtra('MODEL SPACE');
        } else {
          if (workspaceModeRef.current === 'MODEL_SPACE') {
            modelCameraRef.current = { ...cameraRef.current };
            session.modelCamera = modelCameraRef.current;
          }
          workspaceModeRef.current = 'PAPER_SPACE';
          session.workspaceMode = 'PAPER_SPACE';
          setWorkspaceMode('PAPER_SPACE');
          setActiveViewportId(null);
          activeViewportIdRef.current = null;
          session.activeViewportId = null;
          setSelectedViewportId(null);
          session.selectedViewportId = null;
          setSelectedPaperEntityIds([]);
          session.selectedPaperEntityIds = [];
          const layout = session.bus
            .getDocument()
            .layouts.find((l) => l.id === layoutId);
          setStatusExtra(
            layout ? `PAPER SPACE · ${layout.name}` : 'PAPER SPACE',
          );
        }
        setCommandFeedback(message);
      },
      openUnitsDialog: () => {
        if (!activeDs()) return;
        showUnitsDialogRef.current = true;
        setShowUnitsDialog(true);
      },
      openDimStyleDialog: () => {
        if (!activeDs()) return;
        showDimStyleDialogRef.current = true;
        setShowDimStyleDialog(true);
      },
      zoomExtents: () => navApiRef.current.zoomExtents(),
      zoomWindow: (a: { x: number; y: number }, b: { x: number; y: number }) =>
        navApiRef.current.zoomWindow(a, b),
      zoomPrevious: () => navApiRef.current.zoomPrevious(),
      beginPanTool: () => navApiRef.current.beginPanTool(),
    };
    // One engine per session — bind once; do not share across sessions.
    if (!ds.engine) {
      bindSessionEngine(ds, host, createDefaultEngineRegistry());
    }
    engineRef.current = ds.engine;
    refreshEngineUi();
  }, [activateToolOnly, activeSessionId, markDirty, refreshEngineUi]);

  const activateTool = useCallback(
    (tool: ToolId, dimKind?: DimensionKind) => {
      const eng = engineRef.current;
      const ENGINE_TOOLS = new Set([
        'line',
        'rectangle',
        'circle',
        'move',
        'copy',
        'trim',
        'fillet',
        'extend',
        'offset',
        'mirror',
        'rotate',
        'scale',
        'area',
      ]);
      if (eng && ENGINE_TOOLS.has(tool)) {
        eng.start(tool);
        refreshEngineUi();
        return;
      }
      eng?.cancel(false);
      activateToolOnly(tool, dimKind);
      refreshEngineUi();
      if (tool === 'rectangle') setCommandFeedback('RECTANGLE');
      if (tool === 'area') setCommandFeedback('AREA');
    },
    [activateToolOnly, refreshEngineUi],
  );

  const activateAreaMode = useCallback(
    (mode: AreaToolMode) => {
      engineRef.current?.cancel(false);
      isPanningRef.current = false;
      syncSession(setAreaToolMode(sessionRef.current, mode));
      setCommandFeedback(`AREA · ${mode}`);
      refreshEngineUi();
    },
    [refreshEngineUi, syncSession],
  );

  /** Ribbon / UI entry into the same command-engine path as the command line. */
  const runEngineCommand = useCallback(
    (alias: string) => {
      const eng = engineRef.current;
      if (!eng) return;
      const result = eng.start(alias);
      refreshEngineUi();
      const ui = eng.getUiState();
      if (ui.message) setCommandFeedback(ui.message);
      else if (ui.commandName) setCommandFeedback(ui.commandName);
      else if (!result.ok) setCommandFeedback(`Unknown command: ${alias}`);
    },
    [refreshEngineUi],
  );

  const clearCommandLine = useCallback(() => {
    commandLineRef.current = '';
    setCommandLine('');
    engineRef.current?.setBuffer('');
    refreshEngineUi();
  }, [refreshEngineUi]);

  const submitCommandLine = useCallback(() => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.setBuffer(commandLineRef.current);
    eng.confirm('enter');
    setRectLengthText('');
    setRectWidthText('');
    refreshEngineUi();
    const ui = eng.getUiState();
    if (ui.message) setCommandFeedback(ui.message);
    else if (ui.commandName) setCommandFeedback(ui.commandName);
  }, [refreshEngineUi]);

  const applyRectangleDimensions = useCallback(
    (lengthRaw: string, widthRaw: string) => {
      const units = busRef.current.getDocument().settings.units;
      const worldUnit =
        busRef.current.getDocument().settings.worldUnit ?? 'ft';
      const length = lengthRaw.trim()
        ? parseLengthInput(lengthRaw, units, worldUnit)
        : null;
      const width = widthRaw.trim()
        ? parseLengthInput(widthRaw, units, worldUnit)
        : null;
      const nextLength = lengthRaw.trim() === '' ? null : length;
      const nextWidth = widthRaw.trim() === '' ? null : width;
      if (lengthRaw.trim() && nextLength == null) return;
      if (widthRaw.trim() && nextWidth == null) return;
      syncSession(
        setRectangleConstraints(sessionRef.current, nextLength, nextWidth),
      );
      engineRef.current?.setRectangleDims(nextLength, nextWidth);
      refreshEngineUi();
    },
    [refreshEngineUi, syncSession],
  );

  const confirmDiscardIfNeeded = useCallback((): Promise<boolean> => {
    const ds = documentSessionRef.current;
    const dirty = ds ? shouldPromptDiscard(ds) : dirtyRef.current;
    if (!dirty) return Promise.resolve(true);
    return new Promise((resolve) => {
      setDiscardPrompt({ resolve });
    });
  }, []);

  const syncDocumentSessionAfterReplace = useCallback(
    (ds: DocumentSession) => {
      workspaceModeRef.current = ds.workspaceMode;
      setWorkspaceMode(ds.workspaceMode);
      setActiveViewportId(ds.activeViewportId);
      activeViewportIdRef.current = ds.activeViewportId;
      setSelectedViewportId(ds.selectedViewportId);
      setSelectedPaperEntityIds([...ds.selectedPaperEntityIds]);
      sessionRef.current = ds.toolSession;
      syncSession(ds.toolSession);
      cameraRef.current = ds.camera;
      modelCameraRef.current = ds.modelCamera;
      syncCamera(ds.camera);
    },
    [syncCamera, syncSession],
  );

  const flushActiveSessionMirrors = useCallback(() => {
    const ds = documentSessionRef.current;
    if (!ds || ds.disposed) return;
    persistActiveSessionMirrors(ds, {
      camera: cameraRef.current,
      modelCamera: modelCameraRef.current,
      toolSession: sessionRef.current,
      workspaceMode: workspaceModeRef.current,
      activeViewportId: activeViewportIdRef.current,
      selectedViewportId: selectedViewportIdRef.current,
      selectedPaperEntityIds: selectedPaperEntityIdsRef.current,
      commandLineBuffer: commandLineRef.current,
      hoveredId: hoveredIdRef.current,
      dirty: dirtyRef.current,
      filePath: filePathRef.current,
    });
  }, []);

  const cancelActiveTransientWork = useCallback(() => {
    engineRef.current?.cancel(false);
    engineRef.current?.setBuffer('');
    isPanningRef.current = false;
    lastPointerRef.current = null;
    spaceDownRef.current = false;
    cancelViewportDrag();
    const cancelled = createToolSession('select');
    sessionRef.current = cancelled;
    setSession(cancelled);
    commandLineRef.current = '';
    setCommandLine('');
    setRectLengthText('');
    setRectWidthText('');
    setEngineUi(null);
    setCommandFeedback(null);
    hoveredIdRef.current = null;
    setHoveredId(null);
  }, [cancelViewportDrag]);

  /**
   * P3-B3B — activate an existing DocumentSession: cancel incomplete work on
   * the current tab, persist mirrors, rebind App refs to the target session.
   */
  const switchToDocumentSession = useCallback(
    (sessionId: string) => {
      const store = sessionStoreRef.current;
      const current = documentSessionRef.current;
      if (current?.id === sessionId) return;
      const next = getSession(store, sessionId);
      if (!next || next.disposed) return;

      if (current && !current.disposed) {
        previousActiveSessionIdRef.current = current.id;
      }

      cancelActiveTransientWork();
      if (current && !current.disposed) {
        flushActiveSessionMirrors();
        prepareSessionDeactivation(current);
      }

      setActiveSession(store, next.id);
      documentSessionRef.current = next;
      busRef.current = next.bus;
      viewHistoryRef.current = next.viewHistory;
      selectionManagerRef.current = next.selectionManager;
      cameraRef.current = next.camera;
      modelCameraRef.current = next.modelCamera;
      sessionRef.current = next.toolSession;
      workspaceModeRef.current = next.workspaceMode;
      activeViewportIdRef.current = next.activeViewportId;
      selectedViewportIdRef.current = next.selectedViewportId;
      selectedPaperEntityIdsRef.current = [...next.selectedPaperEntityIds];
      filePathRef.current = next.filePath;
      dirtyRef.current = next.dirty;
      hoveredIdRef.current = next.hoveredId;
      commandLineRef.current = next.commandLineBuffer;
      suppressDirtyRef.current = next.suppressDirty;
      engineRef.current = next.engine;

      setActiveSessionId(next.id);
      setSessionListVersion((n) => n + 1);
      setDoc(ensureLayouts(next.bus.getDocument()));
      setCanUndo(next.bus.canUndo());
      setCanRedo(next.bus.canRedo());
      setCamera(next.camera);
      setSession(next.toolSession);
      setWorkspaceMode(next.workspaceMode);
      setActiveViewportId(next.activeViewportId);
      setSelectedViewportId(next.selectedViewportId);
      setSelectedPaperEntityIds([...next.selectedPaperEntityIds]);
      setFilePath(next.filePath);
      setDirty(next.dirty);
      setHoveredId(next.hoveredId);
      setCommandLine(next.commandLineBuffer);
      setRectLengthText('');
      setRectWidthText('');
      setStatusExtra(null);
      refreshEngineUi();
      wheelHistoryArmedRef.current = true;
      panHistoryPushedRef.current = false;
    },
    [cancelActiveTransientWork, flushActiveSessionMirrors, refreshEngineUi],
  );

  /** P3-B3B — create a new untitled DocumentSession tab and activate it. */
  const createNewDocumentTab = useCallback(() => {
    if (bulkOpRef.current) {
      setStatusExtra('Cannot create a drawing during Save All / Close All');
      return;
    }
    const store = sessionStoreRef.current;
    cancelActiveTransientWork();
    const current = documentSessionRef.current;
    if (current && !current.disposed) {
      flushActiveSessionMirrors();
      prepareSessionDeactivation(current);
    }

    const name = allocateUntitledDrawingNameFromStore(store);
    const session = createAndRegisterSession(store, {
      document: ensureLayouts(createEmptyDocument(name)),
      trackDirtyFromBus: false,
    });
    setActiveSession(store, session.id);
    documentSessionRef.current = session;
    busRef.current = session.bus;
    viewHistoryRef.current = session.viewHistory;
    selectionManagerRef.current = session.selectionManager;
    cameraRef.current = session.camera;
    modelCameraRef.current = session.modelCamera;
    sessionRef.current = session.toolSession;
    workspaceModeRef.current = session.workspaceMode;
    activeViewportIdRef.current = null;
    selectedViewportIdRef.current = null;
    selectedPaperEntityIdsRef.current = [];
    filePathRef.current = null;
    dirtyRef.current = false;
    hoveredIdRef.current = null;
    commandLineRef.current = '';
    suppressDirtyRef.current = false;
    engineRef.current = null;

    setActiveSessionId(session.id);
    setSessionListVersion((n) => n + 1);
    setDoc(ensureLayouts(session.bus.getDocument()));
    setCanUndo(false);
    setCanRedo(false);
    setCamera(session.camera);
    setSession(session.toolSession);
    setWorkspaceMode('MODEL_SPACE');
    setActiveViewportId(null);
    setSelectedViewportId(null);
    setSelectedPaperEntityIds([]);
    setFilePath(null);
    setDirty(false);
    setHoveredId(null);
    setCommandLine('');
    setRectLengthText('');
    setRectWidthText('');
    setStatusExtra(`New drawing · ${getSessionTitle(session)}`);
    setCommandFeedback(null);
    setEngineUi(null);
    wheelHistoryArmedRef.current = true;
    panHistoryPushedRef.current = false;
  }, [cancelActiveTransientWork, flushActiveSessionMirrors]);

  /**
   * P3-B4A — Application Menu / QAT / Ctrl+N share the tab + New flow.
   * Never replaces an existing session.
   */
  const newDrawing = useCallback(() => {
    createNewDocumentTab();
  }, [createNewDocumentTab]);

  const syncUiAfterTargetedSave = useCallback(
    (session: DocumentSession) => {
      setSessionListVersion((n) => n + 1);
      if (documentSessionRef.current?.id !== session.id) return;
      filePathRef.current = session.filePath;
      dirtyRef.current = session.dirty;
      setFilePath(session.filePath);
      setDirty(session.dirty);
      setDoc(ensureLayouts(session.bus.getDocument()));
    },
    [],
  );

  type SaveOutcome =
    | { ok: true; clearedDirty: boolean; sessionId: string }
    | {
        ok: false;
        reason:
          | 'missing'
          | 'busy'
          | 'canceled'
          | 'failed'
          | 'collision'
          | 'still-dirty';
        sessionId?: string;
        message?: string;
      };

  /**
   * Session-targeted save (P3-B4A/B4B1). Works for inactive sessions —
   * does not require switching the active tab.
   */
  const saveDrawingForSession = useCallback(
    async (
      sessionId: string,
      forceDialog = false,
    ): Promise<SaveOutcome> => {
      const store = sessionStoreRef.current;
      const target = getSession(store, sessionId);
      if (!target || target.disposed) {
        return { ok: false, reason: 'missing', sessionId };
      }

      const tx = beginSaveTransaction(target, forceDialog);
      if (saveInFlightRef.current.has(tx.sessionId)) {
        setStatusExtra('Save already in progress for this drawing');
        return { ok: false, reason: 'busy', sessionId: tx.sessionId };
      }
      saveInFlightRef.current.add(tx.sessionId);

      const platform = resolveFileOpsPlatform(window.ratecadDesktop);
      const api = window.ratecadDesktop;
      const contents = serializeDocument(target.bus.getDocument());
      const fingerprint = persistedContentFingerprint(target.bus.getDocument());
      setStatusExtra('Saving…');

      const finishLocalSave = (
        savedPath: string,
      ): SaveOutcome => {
        const session = getSession(store, tx.sessionId);
        if (!session || session.disposed) {
          setStatusExtra('Save finished but drawing tab is no longer open');
          return { ok: false, reason: 'missing', sessionId: tx.sessionId };
        }
        const conflict = findSaveAsCollision(
          store,
          savedPath,
          tx.sessionId,
          platform,
        );
        if (conflict) {
          const message = describeSaveAsCollision(conflict);
          setStatusExtra(message);
          return {
            ok: false,
            reason: 'collision',
            sessionId: tx.sessionId,
            message,
          };
        }
        const result = applySuccessfulSaveToSession(
          session,
          savedPath,
          fingerprint,
        );
        rememberRecentDrawing(savedPath, contents);
        syncUiAfterTargetedSave(session);
        setStatusExtra(
          result.clearedDirty
            ? `Saved ${basename(savedPath)}`
            : `Saved ${basename(savedPath)} · further edits remain unsaved`,
        );
        if (!result.clearedDirty) {
          return {
            ok: false,
            reason: 'still-dirty',
            sessionId: tx.sessionId,
            message: 'Latest changes are not saved',
          };
        }
        return {
          ok: true,
          clearedDirty: true,
          sessionId: tx.sessionId,
        };
      };

      try {
        const canQuick =
          !forceDialog && canQuickSaveToExistingPath(target, platform);

        if (api?.saveDrawing && canQuick && target.filePath) {
          const result = await api.saveDrawing({
            contents,
            filePath: target.filePath,
            forceDialog: false,
          });
          if (result.filePath) {
            return finishLocalSave(result.filePath);
          }
          if (result.error) {
            setStatusExtra(`Save failed: ${result.error}`);
            return {
              ok: false,
              reason: 'failed',
              sessionId: tx.sessionId,
              message: result.error,
            };
          }
        }

        // Browser: download-only — no persistent writable path.
        if (!api?.saveDrawing && !api?.quickSave) {
          const blob = new Blob([contents], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = tx.defaultName;
          a.click();
          URL.revokeObjectURL(url);
          return finishLocalSave(tx.defaultName);
        }

        if (api?.saveDrawing) {
          const result = await api.saveDrawing({
            contents,
            filePath: forceDialog ? null : target.filePath,
            defaultPath: tx.defaultName,
            forceDialog:
              forceDialog || !canQuickSaveToExistingPath(target, platform),
          });
          if (result.canceled) {
            setStatusExtra('Save canceled');
            return { ok: false, reason: 'canceled', sessionId: tx.sessionId };
          }
          if (result.error) {
            setStatusExtra(`Dialog: ${result.error}`);
          } else if (result.filePath) {
            return finishLocalSave(result.filePath);
          }
        }

        if (api?.quickSave) {
          const quick = await api.quickSave({
            contents,
            preferredName: tx.defaultName,
          });
          if (quick.filePath) {
            return finishLocalSave(quick.filePath);
          }
          setStatusExtra(`Save failed: ${quick.error ?? 'unknown'}`);
          return {
            ok: false,
            reason: 'failed',
            sessionId: tx.sessionId,
            message: quick.error,
          };
        }

        setStatusExtra('Save failed: no save API available');
        return { ok: false, reason: 'failed', sessionId: tx.sessionId };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown';
        setStatusExtra(`Save failed: ${message}`);
        return {
          ok: false,
          reason: 'failed',
          sessionId: tx.sessionId,
          message,
        };
      } finally {
        saveInFlightRef.current.delete(tx.sessionId);
      }
    },
    [rememberRecentDrawing, syncUiAfterTargetedSave],
  );

  const saveDrawing = useCallback(
    async (forceDialog = false) => {
      const id = documentSessionRef.current?.id;
      if (!id) {
        setStatusExtra('No active drawing to save');
        return;
      }
      await saveDrawingForSession(id, forceDialog);
    },
    [saveDrawingForSession],
  );

  const promptCloseSave = useCallback(
    (
      session: DocumentSession,
      options?: {
        dialogTitle?: string;
        message?: string;
        progressLabel?: string;
      },
    ): Promise<CloseSaveChoice> => {
      return new Promise((resolve) => {
        setClosePromptBusy(false);
        setClosePrompt({
          sessionId: session.id,
          title: getCloseDialogTitle(session),
          dialogTitle: options?.dialogTitle,
          message: options?.message,
          progressLabel: options?.progressLabel,
          resolve,
        });
      });
    },
    [],
  );

  /**
   * Finalize close for a resolved session (already clean / discard confirmed).
   * Last-tab policy: replace with a clean untitled session
   * (`LAST_DRAWING_CLOSE_POLICY`).
   */
  const finalizeCloseSession = useCallback(
    (sessionId: string) => {
      const store = sessionStoreRef.current;
      const target = getSession(store, sessionId);
      if (!target) {
        setSessionListVersion((n) => n + 1);
        return;
      }

      const wasActive = documentSessionRef.current?.id === sessionId;
      const fallbackId = wasActive
        ? chooseFallbackSessionId(
            store,
            sessionId,
            previousActiveSessionIdRef.current,
          )
        : documentSessionRef.current?.id ?? null;

      const closingLast =
        listSessions(store).filter((s) => s.id !== sessionId).length === 0;

      if (wasActive && fallbackId) {
        switchToDocumentSession(fallbackId);
      }

      removeSession(store, sessionId, {
        preferredNextId: wasActive ? fallbackId : store.activeSessionId,
      });

      if (previousActiveSessionIdRef.current === sessionId) {
        previousActiveSessionIdRef.current = null;
      }

      if (closingLast) {
        void LAST_DRAWING_CLOSE_POLICY;
        // App cannot operate with zero sessions — create a clean untitled.
        createNewDocumentTab();
        setStatusExtra('Drawing closed · started a new untitled drawing');
        return;
      }

      setSessionListVersion((n) => n + 1);
      if (!wasActive && documentSessionRef.current) {
        // Active tab unchanged; refresh strip only.
        setStatusExtra(`Closed drawing`);
      } else if (wasActive && documentSessionRef.current) {
        setStatusExtra(
          `Closed drawing · activated ${getSessionTitle(documentSessionRef.current)}`,
        );
      }
    },
    [createNewDocumentTab, switchToDocumentSession],
  );

  /** P3-B4B1 — safe individual tab close with Save / Don't Save / Cancel. */
  const requestCloseDocumentTab = useCallback(
    async (sessionId: string) => {
      if (bulkOpRef.current) {
        setStatusExtra('Cannot close a tab during Save All / Close All');
        return;
      }
      if (closeInFlightRef.current.has(sessionId)) return;
      if (closePromptOpenRef.current) return;

      const store = sessionStoreRef.current;
      const session = getSession(store, sessionId);
      if (!session || session.disposed) return;

      if (saveInFlightRef.current.has(sessionId)) {
        setStatusExtra('Cannot close while this drawing is saving');
        return;
      }

      if (shouldPromptSaveBeforeClose(session)) {
        const choice = await promptCloseSave(session);
        if (choice === 'cancel') {
          setClosePrompt(null);
          setStatusExtra('Close canceled');
          return;
        }
        if (choice === 'save') {
          setClosePromptBusy(true);
          closeInFlightRef.current.add(sessionId);
          try {
            const platform = resolveFileOpsPlatform(window.ratecadDesktop);
            const forceDialog = !canQuickSaveToExistingPath(session, platform);
            const outcome = await saveDrawingForSession(sessionId, forceDialog);
            if (!outcome.ok) {
              setClosePrompt(null);
              setClosePromptBusy(false);
              if (outcome.reason === 'canceled') {
                setStatusExtra('Close canceled — save was canceled');
              } else if (outcome.reason === 'still-dirty') {
                setStatusExtra(
                  'Close canceled — latest changes are not saved',
                );
              } else {
                setStatusExtra(
                  outcome.message
                    ? `Close canceled — ${outcome.message}`
                    : 'Close canceled — save failed',
                );
              }
              return;
            }
            const after = getSession(store, sessionId);
            if (!after || after.disposed) {
              setClosePrompt(null);
              setClosePromptBusy(false);
              setSessionListVersion((n) => n + 1);
              return;
            }
            if (after.dirty) {
              setClosePrompt(null);
              setClosePromptBusy(false);
              setStatusExtra(
                'Close canceled — latest changes are not saved',
              );
              return;
            }
            setClosePrompt(null);
            setClosePromptBusy(false);
            finalizeCloseSession(sessionId);
          } finally {
            closeInFlightRef.current.delete(sessionId);
            setClosePromptBusy(false);
            setClosePrompt(null);
          }
          return;
        }
        // Don't Save
        setClosePrompt(null);
      }

      closeInFlightRef.current.add(sessionId);
      try {
        finalizeCloseSession(sessionId);
      } finally {
        closeInFlightRef.current.delete(sessionId);
      }
    },
    [finalizeCloseSession, promptCloseSave, saveDrawingForSession],
  );

  /**
   * P3-B4B2A — Save All: sequential session-aware saves. Never closes tabs.
   */
  const saveAllDrawings = useCallback(async () => {
    if (bulkOpRef.current) {
      setStatusExtra('A bulk file operation is already in progress');
      return;
    }
    if (closePromptOpenRef.current) return;

    const store = sessionStoreRef.current;
    const snapshot = snapshotOpenSessionIds(store);
    const dirtyIds = filterDirtySessionIds(store, snapshot);
    if (dirtyIds.length === 0) {
      setStatusExtra(formatSaveAllCompleted(0));
      return;
    }

    bulkOpRef.current = 'save-all';
    setBulkOpBusy(true);
    const savedTitles: string[] = [];
    const activeIdAtStart = documentSessionRef.current?.id ?? null;

    try {
      const platform = resolveFileOpsPlatform(window.ratecadDesktop);
      for (let i = 0; i < dirtyIds.length; i += 1) {
        const sessionId = dirtyIds[i]!;
        const session = getSession(store, sessionId);
        if (!session || session.disposed) {
          setStatusExtra(
            formatSaveAllStopped('a drawing that is no longer open'),
          );
          return;
        }
        const title = getSessionTitle(session);
        setStatusExtra(formatSaveAllProgress(i + 1, dirtyIds.length, title));
        const forceDialog = !canQuickSaveToExistingPath(session, platform);
        const outcome = await saveDrawingForSession(sessionId, forceDialog);
        if (!outcome.ok) {
          setStatusExtra(formatSaveAllStopped(title));
          return;
        }
        const after = getSession(store, sessionId);
        if (!after || after.disposed || after.dirty) {
          setStatusExtra(formatSaveAllStopped(title));
          return;
        }
        savedTitles.push(title);
      }

      // Preserve active selection — do not switch tabs during Save All.
      if (
        activeIdAtStart &&
        documentSessionRef.current?.id !== activeIdAtStart
      ) {
        const still = getSession(store, activeIdAtStart);
        if (still && !still.disposed) {
          switchToDocumentSession(activeIdAtStart);
        }
      }
      setSessionListVersion((n) => n + 1);
      setStatusExtra(formatSaveAllCompleted(savedTitles.length));
    } finally {
      bulkOpRef.current = null;
      setBulkOpBusy(false);
    }
  }, [saveDrawingForSession, switchToDocumentSession]);

  /**
   * Shared dirty-session Stage A used by Close All and Exit.
   * Never disposes sessions and never creates replacement drawings.
   */
  const runLifecyclePrepare = useCallback(
    async (
      mode: 'close-all' | 'exit',
      snapshot: string[],
    ): Promise<
      | { status: 'approved'; decisions: CloseAllDecision[] }
      | { status: 'canceled' | 'failed'; reason: string }
    > => {
      const store = sessionStoreRef.current;
      const platform = resolveFileOpsPlatform(window.ratecadDesktop);
      const prepared = await prepareDirtyLifecycleDecisions({
        store,
        snapshot,
        prompt: async (session, index1, total) => {
          const title = getSessionTitle(session);
          if (mode === 'exit') {
            return promptCloseSave(session, {
              dialogTitle: EXIT_SAVE_DIALOG_TITLE,
              message: exitSaveDialogMessage(title),
              progressLabel: formatCloseAllProgress(index1, total),
            });
          }
          return promptCloseSave(session, {
            dialogTitle: CLOSE_ALL_SAVE_DIALOG_TITLE,
            message: closeAllSaveDialogMessage(title),
            progressLabel: formatCloseAllProgress(index1, total),
          });
        },
        save: async (sessionId, forceDialog) => {
          setClosePromptBusy(true);
          const outcome = await saveDrawingForSession(sessionId, forceDialog);
          setClosePrompt(null);
          setClosePromptBusy(false);
          if (outcome.ok) return { ok: true };
          return {
            ok: false,
            reason:
              outcome.reason === 'canceled'
                ? 'Save was canceled'
                : outcome.message || 'Save failed',
          };
        },
        needsForceDialog: (session) =>
          !canQuickSaveToExistingPath(session, platform),
      });

      if (prepared.status !== 'approved') {
        return {
          status: prepared.status,
          reason: prepared.reason,
        };
      }

      if (sessionsChangedSinceSnapshot(store, snapshot)) {
        return {
          status: 'failed',
          reason: 'Open drawings changed during preparation',
        };
      }

      const recheck = revalidateAllCloseAllDecisions(
        store,
        prepared.decisions,
      );
      if (!recheck.ok) {
        return {
          status: 'failed',
          reason:
            recheck.reason === 'edited-after-dont-save'
              ? `${recheck.title ?? 'A drawing'} changed after Don't Save`
              : `${recheck.title ?? 'A drawing'} has unsaved changes`,
        };
      }

      return { status: 'approved', decisions: prepared.decisions };
    },
    [promptCloseSave, saveDrawingForSession],
  );

  /**
   * P3-B4B2A — Close All with two-stage prepare / commit.
   * Stage A: shared prepare (never dispose).
   * Stage B: dispose all targets, replace with one untitled.
   */
  const closeAllDrawings = useCallback(async () => {
    if (bulkOpRef.current) {
      setStatusExtra('A bulk file operation is already in progress');
      return;
    }
    if (closePromptOpenRef.current) return;

    const store = sessionStoreRef.current;
    const snapshot = snapshotOpenSessionIds(store);
    if (snapshot.length === 0) {
      createNewDocumentTab();
      return;
    }

    bulkOpRef.current = 'close-all';
    setBulkOpBusy(true);

    try {
      const prepared = await runLifecyclePrepare('close-all', snapshot);
      if (prepared.status !== 'approved') {
        setStatusExtra(
          prepared.status === 'canceled'
            ? 'Close All canceled'
            : `Close All stopped — ${prepared.reason}`,
        );
        return;
      }

      const toClose = collectCloseableSessionIds(store, prepared.decisions);
      cancelActiveTransientWork();
      for (const id of toClose) {
        const session = getSession(store, id);
        if (session && !session.disposed) {
          prepareSessionDeactivation(session);
        }
      }

      for (const id of toClose) {
        removeSession(store, id);
      }
      previousActiveSessionIdRef.current = null;

      void LAST_DRAWING_CLOSE_POLICY;
      bulkOpRef.current = null;
      createNewDocumentTab();
      setStatusExtra('Close All completed · started a new untitled drawing');
    } finally {
      bulkOpRef.current = null;
      setBulkOpBusy(false);
      setClosePrompt(null);
      setClosePromptBusy(false);
    }
  }, [
    cancelActiveTransientWork,
    createNewDocumentTab,
    prepareSessionDeactivation,
    runLifecyclePrepare,
  ]);

  /**
   * P3-B4B2B — prepare safe application exit (no dispose, no untitled).
   * Returns approved only after all dirty drawings are resolved and revalidated.
   */
  const prepareApplicationExit = useCallback(async (): Promise<ExitStatus> => {
    if (bulkOpRef.current && bulkOpRef.current !== 'exit') {
      setStatusExtra('Cannot exit during Save All / Close All');
      return 'failed';
    }
    if (bulkOpRef.current === 'exit') {
      return 'failed';
    }
    if (closePromptOpenRef.current) {
      return 'failed';
    }

    const store = sessionStoreRef.current;
    const snapshot = snapshotOpenSessionIds(store);

    bulkOpRef.current = 'exit';
    setBulkOpBusy(true);
    try {
      const prepared = await runLifecyclePrepare('exit', snapshot);
      if (prepared.status !== 'approved') {
        setStatusExtra(
          prepared.status === 'canceled'
            ? 'Exit canceled'
            : `Exit stopped — ${prepared.reason}`,
        );
        return prepared.status === 'canceled' ? 'canceled' : 'failed';
      }

      // Final revalidation immediately before authorization.
      if (sessionsChangedSinceSnapshot(store, snapshot)) {
        setStatusExtra('Exit stopped — open drawings changed');
        return 'failed';
      }
      const recheck = revalidateAllCloseAllDecisions(
        store,
        prepared.decisions,
      );
      if (!recheck.ok) {
        setStatusExtra(
          `Exit stopped — ${recheck.title ?? 'a drawing'} is not safe to leave`,
        );
        return 'failed';
      }

      // Exit does NOT dispose sessions and does NOT create untitled.
      setStatusExtra('Exit approved');
      return 'approved';
    } finally {
      bulkOpRef.current = null;
      setBulkOpBusy(false);
      setClosePrompt(null);
      setClosePromptBusy(false);
    }
  }, [runLifecyclePrepare]);

  /** P3-B4A — open validated contents into a new tab (or activate duplicate). */
  const openContentsInSession = useCallback(
    (contents: string, path?: string | null) => {
      const store = sessionStoreRef.current;
      const platform = resolveFileOpsPlatform(window.ratecadDesktop);
      const resolved = resolveOpenRequest(
        store,
        contents,
        path ?? null,
        platform,
      );
      if (resolved.kind === 'invalid') {
        setStatusExtra(`Invalid file: ${resolved.error}`);
        return;
      }
      if (resolved.kind === 'activate-existing') {
        switchToDocumentSession(resolved.session.id);
        setStatusExtra(
          `Already open — activated ${getSessionTitle(resolved.session)}`,
        );
        if (path) rememberRecentDrawing(path, contents);
        return;
      }

      const session = createAndRegisterSession(store, {
        document: ensureLayouts(resolved.document),
        filePath: resolved.filePath,
        dirty: false,
        trackDirtyFromBus: false,
      });
      switchToDocumentSession(session.id);
      if (path) rememberRecentDrawing(path, contents);
      setStatusExtra(path ? `Opened ${basename(path)}` : 'Opened drawing');
    },
    [rememberRecentDrawing, switchToDocumentSession],
  );

  const openDrawing = useCallback(async () => {
    if (bulkOpRef.current) {
      setStatusExtra('Cannot open a drawing during Save All / Close All');
      return;
    }
    // Multi-document Open never discards siblings or replaces the active tab.
    const api = window.ratecadDesktop;

    const fileInputFallback = () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.ratecad,application/json';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
          const text = await file.text();
          // Browser: file.name is not a reliable absolute identity.
          openContentsInSession(text, file.name);
        } catch (err) {
          setStatusExtra(
            `Open failed: ${err instanceof Error ? err.message : 'read error'}`,
          );
        }
      };
      input.click();
    };

    if (!api?.openDrawing) {
      fileInputFallback();
      return;
    }

    try {
      const result = await Promise.race([
        api.openDrawing(),
        new Promise<{ error: string }>((resolve) =>
          setTimeout(() => resolve({ error: 'dialog-timeout' }), 8000),
        ),
      ]);

      if ('canceled' in result && result.canceled) return;
      if ('error' in result && result.error) {
        if (result.error === 'dialog-timeout') {
          setStatusExtra('Open dialog unavailable — using file picker');
          fileInputFallback();
          return;
        }
        setStatusExtra(`Open failed: ${result.error}`);
        return;
      }
      if (!('contents' in result) || !result.contents) {
        setStatusExtra('Open failed: empty file');
        return;
      }
      openContentsInSession(result.contents, result.filePath ?? null);
    } catch (err) {
      setStatusExtra(
        `Open failed: ${err instanceof Error ? err.message : 'unknown'} — file picker`,
      );
      fileInputFallback();
    }
  }, [openContentsInSession]);

  const openRecentDrawing = useCallback(
    async (entry: RecentDrawing) => {
      const apply = (contents: string, path?: string) => {
        openContentsInSession(contents, path ?? entry.path);
      };

      const api = window.ratecadDesktop;
      if (api?.openDrawingPath) {
        try {
          const result = await api.openDrawingPath(entry.path);
          if (result.error) {
            if (entry.contents) {
              apply(entry.contents, entry.path);
              return;
            }
            setStatusExtra(`Open failed: ${result.error}`);
            return;
          }
          if (result.contents) {
            apply(result.contents, result.filePath ?? entry.path);
            return;
          }
        } catch (err) {
          if (entry.contents) {
            apply(entry.contents, entry.path);
            return;
          }
          setStatusExtra(
            `Open failed: ${err instanceof Error ? err.message : 'unknown'}`,
          );
          return;
        }
      }

      if (entry.contents) {
        apply(entry.contents, entry.path);
        return;
      }

      setStatusExtra(
        `Recent file unavailable — use Open to select ${entry.name}`,
      );
    },
    [openContentsInSession],
  );

  /**
   * P3-B4B2B — Application Menu Exit.
   * Electron: prepare → quitApp (main authorizes final close).
   * Browser: prepare only; never pretends to quit the browser process.
   */
  const exitApp = useCallback(async () => {
    const status = await prepareApplicationExit();
    if (status !== 'approved') {
      // Canceled / failed prepare must never leave the unload gate armed.
      disarmElectronAuthorizedUnload(electronExitUnloadGateRef.current);
      return;
    }

    const api = window.ratecadDesktop;
    if (api?.quitApp) {
      // ISS-N1: arm only for this approved Electron unload attempt so
      // beforeunload does not block mainWindow.close() while Don't-Save
      // sessions remain dirty by design. Keep armed across the IPC return
      // — Chromium may run beforeunload after quitApp resolves.
      armElectronAuthorizedUnload(electronExitUnloadGateRef.current);
      try {
        await api.quitApp();
        // If the window is somehow still open, restore protection shortly.
        window.setTimeout(() => {
          disarmElectronAuthorizedUnload(electronExitUnloadGateRef.current);
        }, 2500);
        return;
      } catch {
        disarmElectronAuthorizedUnload(electronExitUnloadGateRef.current);
        setStatusExtra('Exit approved but quit failed — close the window manually');
        return;
      }
    }

    // Browser preview: never arm the Electron unload gate. Clear
    // discard-authorized dirty flags so beforeunload does not keep
    // warning after the user resolved Don't Save during Exit prepare.
    // Do not create untitled / dispose.
    void BROWSER_EXIT_POLICY;
    disarmElectronAuthorizedUnload(electronExitUnloadGateRef.current);
    const store = sessionStoreRef.current;
    for (const session of listSessions(store)) {
      if (session.dirty) {
        // User authorized Don't Save (or Save already cleared dirty).
        // Prefer leaving saved clean; for remaining dirty after approve,
        // fingerprints already matched discard decisions — clear dirty
        // only to silence beforeunload after explicit exit consent.
        clearSessionDirty(session);
      }
    }
    setDirty(false);
    dirtyRef.current = false;
    setSessionListVersion((n) => n + 1);
    setStatusExtra(
      'Exit prepared — close this browser tab when ready (browser cannot quit RateCAD)',
    );
  }, [prepareApplicationExit]);

  /** Electron main → renderer: window X / OS close handshake. */
  useEffect(() => {
    const api = window.ratecadDesktop;
    if (!api?.onPrepareExit || !api.respondExitPreparation) return;
    return api.onPrepareExit((requestId) => {
      void (async () => {
        let status: ExitStatus = 'failed';
        try {
          status = await prepareApplicationExit();
        } catch {
          status = 'failed';
        }
        // Arm only when prepare approved so main's subsequent close() is
        // not blocked by beforeunload; disarm when not closing.
        if (status === 'approved') {
          armElectronAuthorizedUnload(electronExitUnloadGateRef.current);
        } else {
          disarmElectronAuthorizedUnload(electronExitUnloadGateRef.current);
        }
        try {
          const reply = await api.respondExitPreparation?.({
            requestId,
            status,
          });
          // Stale / ignored / non-close replies must not leave the gate armed.
          if (!reply?.closed) {
            disarmElectronAuthorizedUnload(electronExitUnloadGateRef.current);
          } else {
            // Close was requested — keep armed for pending beforeunload,
            // then disarm if the window is still alive (failed unload).
            window.setTimeout(() => {
              disarmElectronAuthorizedUnload(electronExitUnloadGateRef.current);
            }, 2500);
          }
        } catch {
          // Main ignores missing reply as non-approval.
          disarmElectronAuthorizedUnload(electronExitUnloadGateRef.current);
        }
      })();
    });
  }, [prepareApplicationExit]);

  /**
   * Dirty-session beforeunload guard.
   * ISS-N1: when Electron exit was just authorized, skip prevention so
   * mainWindow.close() can complete — without clearing dirty flags and
   * without disabling this guard for ordinary / browser tab closes.
   */
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      const block = shouldPreventUnloadForDirtySessions(
        anySessionDirty(sessionStoreRef.current),
        electronExitUnloadGateRef.current,
      );
      if (!block) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [sessionListVersion, dirty]);

  const deleteSelection = useCallback(() => {
    const doc = busRef.current.getDocument();
    if (
      workspaceModeRef.current === 'PAPER_SPACE' &&
      selectedPaperEntityIds.length > 0 &&
      doc.activeLayoutId
    ) {
      busRef.current.execute(
        new DeletePaperEntitiesCommand(
          doc.activeLayoutId,
          selectedPaperEntityIds,
        ),
      );
      setSelectedPaperEntityIds([]);
      return;
    }
    const selected = getSelectedEntities(doc).filter((e) =>
      isEntityModifiable(doc, e),
    );
    if (selected.length === 0) {
      if (doc.selection.length > 0) {
        setStatusExtra('Locked layer — cannot delete');
      }
      return;
    }
    const hostedCount = selected
      .filter((e) => e.type === 'wall')
      .reduce((n, w) => n + getHostedByWall(doc, w.id).length, 0);
    if (hostedCount > 0) {
      const ok = window.confirm(
        `Delete wall(s) and ${hostedCount} hosted door/window object(s)?`,
      );
      if (!ok) return;
    }
    busRef.current.execute(
      new DeleteEntitiesCommand(selected.map((e) => e.id)),
    );
  }, [selectedPaperEntityIds]);

  const undo = useCallback(() => busRef.current.undo(), []);
  const redo = useCallback(() => busRef.current.redo(), []);

  const toggleSnap = useCallback(() => {
    busRef.current.updateWithoutHistory((d) => ({
      ...d,
      settings: { ...d.settings, snapToGrid: !d.settings.snapToGrid },
    }));
  }, []);

  const toggleGrid = useCallback(() => {
    busRef.current.updateWithoutHistory((d) => ({
      ...d,
      settings: {
        ...d.settings,
        showGrid: !(d.settings.showGrid !== false),
      },
    }));
  }, []);

  const toggleOrtho = useCallback(() => {
    setOrthoOn((v) => {
      const next = !v;
      polarEngineRef.current.setOrtho(next);
      return next;
    });
  }, []);

  const togglePolar = useCallback(() => {
    setPolarOn((v) => {
      const next = !v;
      polarEngineRef.current.setPolar({
        enabled: next,
        incrementDeg: polarIncrement,
        extraAnglesDeg: polarIncrement >= 90 ? [45, 135, 225, 315] : [],
      });
      return next;
    });
  }, [polarIncrement]);

  const cyclePolarIncrement = useCallback(() => {
    setPolarIncrement((prev) => {
      const next = prev === 90 ? 45 : 90;
      polarEngineRef.current.setPolar({
        enabled: polarOn,
        incrementDeg: next,
        extraAnglesDeg: next >= 90 ? [45, 135, 225, 315] : [],
      });
      return next;
    });
  }, [polarOn]);

  const setUnits = useCallback((units: LengthUnit) => {
    const doc = busRef.current.getDocument();
    const gridSize = suggestedGridSize(doc.settings.worldUnit ?? 'ft', units);
    busRef.current.execute(
      new SetDrawingUnitsCommand(doc, { units, gridSize }),
    );
  }, []);

  const setPrecision = useCallback((precision: number) => {
    const doc = busRef.current.getDocument();
    busRef.current.execute(new SetDrawingUnitsCommand(doc, { precision }));
  }, []);

  const setFractionDenominator = useCallback((fractionDenominator: number) => {
    const doc = busRef.current.getDocument();
    busRef.current.execute(
      new SetDrawingUnitsCommand(doc, { fractionDenominator }),
    );
  }, []);

  const convertWorldUnit = useCallback((toUnit: LengthUnit) => {
    const doc = busRef.current.getDocument();
    if ((doc.settings.worldUnit ?? 'ft') === toUnit) return;
    const ok = window.confirm(
      `Convert all geometry from ${doc.settings.worldUnit} to ${toUnit}?\n` +
        'This scales coordinates (import-style conversion) and is undoable.',
    );
    if (!ok) return;
    busRef.current.execute(new ConvertDrawingWorldUnitCommand(doc, toUnit));
  }, []);

  const setCurrentLayer = useCallback((layerId: string) => {
    const doc = busRef.current.getDocument();
    if (doc.currentLayerId === layerId) return;
    busRef.current.execute(
      new SetCurrentLayerCommand(doc.currentLayerId, layerId),
    );
  }, []);

  const toggleLayerVisible = useCallback((layer: Layer) => {
    busRef.current.execute(
      new UpdateLayerCommand(layer.id, layer, { visible: !layer.visible }),
    );
  }, []);

  const toggleLayerLocked = useCallback((layer: Layer) => {
    busRef.current.execute(
      new UpdateLayerCommand(layer.id, layer, { locked: !layer.locked }),
    );
  }, []);

  const renameLayer = useCallback((layer: Layer, name: string) => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === layer.name) return;
    busRef.current.execute(
      new UpdateLayerCommand(layer.id, layer, { name: trimmed }),
    );
  }, []);

  const addLayer = useCallback(() => {
    const name = window.prompt('New layer name', 'New Layer');
    if (!name?.trim()) return;
    busRef.current.execute(new CreateLayerCommand(name.trim()));
  }, []);

  const deleteLayer = useCallback((layer: Layer) => {
    if (layer.id === 'layer-0') {
      setStatusExtra('Cannot delete layer 0');
      return;
    }
    try {
      busRef.current.execute(new DeleteLayerCommand(layer.id, 'layer-0'));
    } catch (err) {
      setStatusExtra(
        err instanceof Error ? err.message : 'Cannot delete layer',
      );
    }
  }, []);

  const confirmTextPrompt = useCallback(() => {
    const s = sessionRef.current;
    const layoutId = busRef.current.getDocument().activeLayoutId;
    if (
      workspaceModeRef.current === 'PAPER_SPACE' &&
      layoutId &&
      (s.activeTool === 'text' || s.activeTool === 'leader')
    ) {
      if (s.activeTool === 'text') {
        syncSession(
          commitPaperTextContent(s, busRef.current, layoutId, textPrompt),
        );
      } else {
        syncSession(
          commitPaperLeaderContent(s, busRef.current, layoutId, textPrompt),
        );
      }
      setTextPrompt('');
      return;
    }
    if (s.activeTool === 'text') {
      syncSession(commitTextContent(s, busRef.current, textPrompt));
    } else if (s.activeTool === 'leader') {
      syncSession(commitLeaderContent(s, busRef.current, textPrompt));
    }
    setTextPrompt('');
  }, [syncSession, textPrompt]);

  const cancelTextPrompt = useCallback(() => {
    syncSession(cancelTool(sessionRef.current));
    setTextPrompt('');
  }, [syncSession]);

  const editSelectedText = useCallback(() => {
    const selected = getSelectedEntities(busRef.current.getDocument());
    if (selected.length !== 1 || selected[0]?.type !== 'text') return;
    const entity = selected[0] as TextEntity;
    if (!isEntityModifiable(busRef.current.getDocument(), entity)) {
      setStatusExtra('Locked layer — cannot edit text');
      return;
    }
    const next = window.prompt('Edit text', entity.geometry.content);
    if (next == null) return;
    const trimmed = next.trim();
    if (!trimmed) return;
    busRef.current.execute(
      new UpdateTextCommand(entity, { content: trimmed }),
    );
  }, []);

  useEffect(() => {
    if (session.mode === 'text-input') {
      setTextPrompt(session.pendingText ?? '');
      requestAnimationFrame(() => textInputRef.current?.focus());
    }
  }, [session.mode, session.pendingText]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      const target = event.target as HTMLElement | null;
      const kbCtx = resolveKeyboardContextFromTarget(target);
      const tag = target?.tagName;
      const isEditable =
        (tag === 'INPUT' || tag === 'TEXTAREA') &&
        !(target as HTMLInputElement | HTMLTextAreaElement).disabled;
      const inField = !!isEditable;
      const isCadCommandField =
        target?.dataset?.cadCommand === '1' ||
        target?.dataset?.cadRectDim === '1';

      // Close-save dialog owns ESC / actions — block CAD routing behind it.
      if (closePromptOpenRef.current) {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          const prompt = closePromptRef.current;
          if (prompt) {
            prompt.resolve('cancel');
            setClosePrompt(null);
            setClosePromptBusy(false);
          }
        }
        return;
      }

      // Text editors / dialogs / property panels: never launch CAD commands
      if (
        kbCtx === 'text-editor' ||
        kbCtx === 'dialog' ||
        kbCtx === 'property-input' ||
        kbCtx === 'search' ||
        (kbCtx === 'other' && inField && !isCadCommandField)
      ) {
        if (event.key === 'Escape' && sessionRef.current.mode === 'text-input') {
          event.preventDefault();
          cancelTextPrompt();
        }
        return;
      }

      if (event.code === 'Space' && !inField && spaceConfirmsCommand(kbCtx)) {
        const eng = engineRef.current;
        if (
          eng &&
          (eng.isRunning() || commandLineRef.current.trim().length > 0)
        ) {
          event.preventDefault();
          eng.setBuffer(commandLineRef.current);
          eng.confirm('space');
          refreshEngineUi();
          return;
        }
        // Selection Mode: SPACE repeats last completed command (AutoCAD-like).
        // Do not repeat while focus is in editable non-canvas contexts.
        if (
          eng &&
          spaceRepeatsLastCommand(kbCtx) &&
          !eng.isRunning() &&
          !eng.hasPendingHandoff() &&
          eng.getLastCompletedName()
        ) {
          event.preventDefault();
          eng.confirm('space');
          refreshEngineUi();
          const name = eng.getRunningCommand()?.name ?? eng.getLastCompletedName();
          if (name) setCommandFeedback(name);
          return;
        }
        spaceDownRef.current = true;
        event.preventDefault();
        return;
      }

      if (meta && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveDrawing(event.shiftKey);
        return;
      }
      if (meta && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        void openDrawing();
        return;
      }
      if (meta && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        void newDrawing();
        return;
      }
      if (meta && event.key.toLowerCase() === 'z' && event.shiftKey) {
        event.preventDefault();
        redo();
        return;
      }
      if (meta && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        undo();
        return;
      }
      if (meta && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redo();
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        if (appMenuOpenRef.current) {
          setAppMenuOpen(false);
          return;
        }
        if (vpDragRef.current) {
          cancelViewportDrag();
          setCommandFeedback('Viewport edit cancelled');
          return;
        }
        const eng = engineRef.current;
        // 1) Cancel in-progress tool preview / grip / window without committing
        const s = sessionRef.current;
        if (s.mode === 'text-input') {
          cancelTextPrompt();
          return;
        }
        const inProgress =
          s.mode !== 'idle' ||
          !!s.anchor ||
          s.vertices.length > 0 ||
          !!s.grip ||
          !!s.previewEntities ||
          !!s.selectionRect ||
          !!s.refEntityId ||
          s.inputBuffer.length > 0;
        if (eng?.isRunning()) {
          // Cancel active engine command (preview only); keep committed geometry.
          eng.handleEscape();
          // Always return to Selection Mode — do not leave previous draw tool active.
          activateToolOnly('select');
          clearCommandLine();
          refreshEngineUi();
          setCommandFeedback('Select');
          setDoc(busRef.current.getDocument());
          return;
        }
        if (inProgress || eng?.hasPendingHandoff()) {
          // End handoff/tool session; store last command only if geometry was committed.
          eng?.handleEscape();
          activateToolOnly('select');
          clearCommandLine();
          refreshEngineUi();
          setCommandFeedback('Select');
          setDoc(busRef.current.getDocument());
          return;
        }
        // 2) Engine ESC: clear buffer → clear selection → idle pointer
        const action = eng?.handleEscape() ?? { kind: 'idle' as const };
        clearCommandLine();
        refreshEngineUi();
        activateToolOnly('select');
        setCommandFeedback(
          action.kind === 'clear-selection'
            ? 'Selection cleared'
            : action.kind === 'clear-buffer'
              ? 'Command'
              : 'Select',
        );
        setDoc(busRef.current.getDocument());
        return;
      }

      if (event.key === 'Enter' || (event.key === ' ' && !inField)) {
        if (isCadCommandField && target?.dataset?.cadCommand === '1') {
          event.preventDefault();
          submitCommandLine();
          return;
        }
        if (isCadCommandField && target?.dataset?.cadRectDim === '1') {
          event.preventDefault();
          (target as HTMLElement).blur();
          return;
        }
        if (inField) return;
        event.preventDefault();
        const s = sessionRef.current;
        if (s.mode === 'text-input') {
          confirmTextPrompt();
          return;
        }
        // Finish AREA points / polyline before idle command-engine Enter handling
        const eng = engineRef.current;
        if (!eng?.isRunning()) {
          if (s.activeTool === 'area' && s.areaMode === 'points') {
            const finished = finishAreaPoints(s, busRef.current);
            syncSession(finished);
            eng?.completeHandoff();
            refreshEngineUi();
            setCommandFeedback(finished.statusMessage);
            return;
          }
          if (
            s.activeTool === 'area' &&
            (s.areaMode === 'add' || s.areaMode === 'subtract') &&
            (s.areaSession?.entries.length ?? 0) > 0
          ) {
            const finished = finishAreaSession(s, busRef.current);
            syncSession(finished);
            eng?.completeHandoff();
            refreshEngineUi();
            setCommandFeedback(finished.statusMessage);
            return;
          }
          if (s.activeTool === 'polyline' && s.vertices.length >= 2) {
            syncSession(finishPolyline(s, busRef.current));
            return;
          }
        }
        if (eng) {
          // Prefer engine when running OR when buffer has text OR empty Enter repeat
          if (
            eng.isRunning() ||
            commandLineRef.current.trim().length > 0 ||
            event.key === 'Enter'
          ) {
            eng.setBuffer(commandLineRef.current);
            eng.confirm(event.key === ' ' ? 'space' : 'enter');
            refreshEngineUi();
            return;
          }
        }
        if (
          s.inputBuffer.length > 0 &&
          (s.activeTool === 'offset' ||
            s.activeTool === 'rotate' ||
            s.activeTool === 'scale' ||
            s.activeTool === 'wall')
        ) {
          syncSession(commitNumericInput(s, busRef.current));
        }
        return;
      }

      if (event.key === 'Tab' && !inField) {
        event.preventDefault();
        engineRef.current?.cycleSuggestion();
        refreshEngineUi();
        return;
      }
      if (event.key === 'ArrowUp' && !inField) {
        event.preventDefault();
        const eng = engineRef.current;
        const ui = eng?.getUiState();
        if (ui && ui.suggestionRows.length > 0 && !eng?.isRunning()) {
          eng?.moveSuggestion(-1);
        } else {
          eng?.historyUp();
        }
        refreshEngineUi();
        return;
      }
      if (event.key === 'ArrowDown' && !inField) {
        event.preventDefault();
        const eng = engineRef.current;
        const ui = eng?.getUiState();
        if (ui && ui.suggestionRows.length > 0 && !eng?.isRunning()) {
          eng?.moveSuggestion(1);
        } else {
          eng?.historyDown();
        }
        refreshEngineUi();
        return;
      }

      if ((event.key === 'Delete' || event.key === 'Backspace') && !inField) {
        const s = sessionRef.current;
        const numericTools =
          s.activeTool === 'offset' ||
          s.activeTool === 'rotate' ||
          s.activeTool === 'scale' ||
          s.activeTool === 'wall';
        if (event.key === 'Backspace') {
          const eng = engineRef.current;
          const buf = eng?.getBuffer() ?? commandLineRef.current;
          if (buf.length > 0 || eng?.isRunning()) {
            event.preventDefault();
            const next = buf.slice(0, -1);
            eng?.setBuffer(next);
            commandLineRef.current = next;
            setCommandLine(next);
            refreshEngineUi();
            return;
          }
          if (
            s.activeTool === 'area' &&
            s.areaMode === 'points' &&
            s.vertices.length > 0
          ) {
            event.preventDefault();
            syncSession(undoAreaPoint(s));
            return;
          }
          if (
            s.activeTool === 'area' &&
            (s.areaMode === 'add' || s.areaMode === 'subtract') &&
            (s.areaSession?.entries.length ?? 0) > 0
          ) {
            event.preventDefault();
            syncSession(undoAreaSessionEntry(s));
            return;
          }
        }
        if (
          event.key === 'Backspace' &&
          numericTools &&
          (s.inputBuffer.length > 0 ||
            s.anchor ||
            s.refEntityId ||
            s.activeTool === 'wall')
        ) {
          event.preventDefault();
          syncSession(appendInputBuffer(s, 'Backspace'));
          return;
        }
        event.preventDefault();
        deleteSelection();
        return;
      }

      if (meta && event.key === '1' && !inField) {
        event.preventDefault();
        engineRef.current?.start('properties');
        refreshEngineUi();
        setStatusExtra('Properties panel');
        return;
      }

      if (!meta && !inField) {
        if (event.key === 'F3') {
          event.preventDefault();
          toggleSnap();
          return;
        }
        if (event.key === 'F7') {
          event.preventDefault();
          toggleGrid();
          return;
        }
        if (event.key === 'F8') {
          event.preventDefault();
          toggleOrtho();
          return;
        }
        if (event.key === 'F10') {
          event.preventDefault();
          togglePolar();
          return;
        }

        const s = sessionRef.current;
        const numericTools =
          s.activeTool === 'offset' ||
          s.activeTool === 'rotate' ||
          s.activeTool === 'scale' ||
          s.activeTool === 'wall';
        if (
          !engineRef.current?.isRunning() &&
          numericTools &&
          (s.refEntityId || s.anchor || s.activeTool === 'wall') &&
          /^[0-9.\-]$/.test(event.key)
        ) {
          event.preventDefault();
          syncSession(appendInputBuffer(s, event.key));
          return;
        }

        // AREA open-boundary / result actions
        if (
          s.activeTool === 'area' &&
          !engineRef.current?.isRunning() &&
          commandLineRef.current.trim().length === 0
        ) {
          const k = event.key.toLowerCase();
          if (s.areaAwaitingOpen && k === 'c') {
            event.preventDefault();
            syncSession(closeAreaTemporarily(s, busRef.current));
            return;
          }
          if ((s.areaAwaitingOpen || s.areaLastResult) && k === 'b') {
            event.preventDefault();
            syncSession(createBoundaryFromArea(s, busRef.current));
            return;
          }
          if (s.areaLastResult && k === 'l') {
            event.preventDefault();
            syncSession(createAreaLabel(s, busRef.current));
            return;
          }
        }

        // Command / prompt entry (including @ < , for coordinates)
        if (event.key.length === 1 && !event.altKey) {
          const ch = event.key;
          if (/^[a-z0-9_\-./\\@,<°]$/i.test(ch)) {
            event.preventDefault();
            const eng = engineRef.current;
            const next = (eng?.getBuffer() ?? commandLineRef.current) + ch;
            eng?.setBuffer(next);
            commandLineRef.current = next;
            setCommandLine(next);
            setCommandFeedback(null);
            refreshEngineUi();
          }
        }
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        spaceDownRef.current = false;
        isPanningRef.current = false;
        lastPointerRef.current = null;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [
    activateToolOnly,
    cancelTextPrompt,
    cancelViewportDrag,
    clearCommandLine,
    confirmTextPrompt,
    deleteSelection,
    newDrawing,
    openDrawing,
    redo,
    refreshEngineUi,
    saveDrawing,
    submitCommandLine,
    syncSession,
    toggleSnap,
    toggleGrid,
    toggleOrtho,
    togglePolar,
    undo,
  ]);

  useEffect(() => {
    const api = window.ratecadDesktop;
    if (!api) return;
    return api.onMenuAction((action) => {
      if (action === 'new') void newDrawing();
      if (action === 'open') void openDrawing();
      if (action === 'save') void saveDrawing(false);
      if (action === 'saveAs') void saveDrawing(true);
      if (action === 'undo') undo();
      if (action === 'redo') redo();
      if (action === 'delete') deleteSelection();
    });
  }, [deleteSelection, newDrawing, openDrawing, redo, saveDrawing, undo]);

  const flushPan = useCallback(() => {
    rafPanRef.current = null;
    const pending = pendingPanRef.current;
    if (!pending) return;
    pendingPanRef.current = null;

    if (!panHistoryPushedRef.current) {
      pushViewHistory();
      panHistoryPushedRef.current = true;
    }

    // VIEWPORT_MODEL_SPACE: pan the viewport camera (not model geometry).
    if (workspaceModeRef.current === 'VIEWPORT_MODEL_SPACE') {
      const d = busRef.current.getDocument();
      const layoutId = d.activeLayoutId;
      const vpId = activeViewportIdRef.current;
      if (!layoutId || !vpId) return;
      const layout = d.layouts.find((l) => l.id === layoutId);
      const vp = layout?.viewports.find((v) => v.id === vpId);
      if (!layout || !vp || vp.locked) return;
      const view = fitPaperInCanvas(
        layout.pageSettings,
        size.width,
        size.height,
      );
      const { camera, screenRect } = cameraForViewport(vp, view);
      // Screen pan → model delta (same convention as panCamera).
      const modelDx = -pending.dx / camera.zoom;
      const modelDy = pending.dy / camera.zoom;
      void screenRect;
      const next = panViewportModel(vp, { x: modelDx, y: modelDy });
      busRef.current.updateWithoutHistory((doc) =>
        replaceViewport(doc, layoutId, next),
      );
      return;
    }

    // PAPER_SPACE: pan the paper camera (independent of model / viewport cameras).
    if (workspaceModeRef.current === 'PAPER_SPACE') {
      const d = busRef.current.getDocument();
      const layoutId = d.activeLayoutId;
      if (!layoutId) return;
      const layout = d.layouts.find((l) => l.id === layoutId);
      if (!layout) return;
      const cam = layout.paperCamera ?? defaultPaperCamera();
      const view = paperViewForLayout(layout, size.width, size.height);
      const paperUnitMm = layout.pageSettings.units === 'inch' ? 25.4 : 1;
      const px = view.pxPerMm * paperUnitMm;
      const next = {
        ...cam,
        offsetX: cam.offsetX + pending.dx / Math.max(1e-6, px),
        offsetY: cam.offsetY - pending.dy / Math.max(1e-6, px),
      };
      busRef.current.updateWithoutHistory((doc) =>
        updateLayoutSheetMeta(doc, layoutId, { paperCamera: next }),
      );
      return;
    }

    syncCamera(panCamera(cameraRef.current, pending.dx, pending.dy));
  }, [pushViewHistory, size.height, size.width, syncCamera]);

  const snapWorld = useCallback(
    (world: { x: number; y: number }) => {
      const d = busRef.current.getDocument();
      const cam = getActiveInteractionCamera();
      const snap = resolveSnap(world, d, {
        enabled: d.settings.snapToGrid,
        gridSize: d.settings.gridSize,
        tolerance: screenToleranceToWorld(cam, 10),
      });
      const eng = engineRef.current;
      // Typed angle override / absolute coords take priority — skip visual tracking.
      if (eng?.getAngleOverrideDeg() != null) {
        return snap;
      }
      const origin = eng?.getLastPoint() ?? null;
      if (!origin || (!orthoOn && !polarOn)) {
        return snap;
      }
      polarEngineRef.current.setOrtho(orthoOn);
      polarEngineRef.current.setPolar({
        enabled: polarOn,
        incrementDeg: polarIncrement,
        extraAnglesDeg: polarIncrement >= 90 ? [45, 135, 225, 315] : [],
      });
      const constrained = polarEngineRef.current.constrain(origin, snap.point);
      if (!constrained.constrained) return snap;
      return {
        ...snap,
        point: constrained.point,
        snapped: true,
        kind: snap.kind,
        label:
          constrained.kind === 'ortho'
            ? 'Ortho'
            : constrained.kind === 'polar'
              ? `Polar ${constrained.angleDeg?.toFixed(0)}°`
              : snap.label,
      };
    },
    [getActiveInteractionCamera, orthoOn, polarOn, polarIncrement],
  );

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const panMode =
      sessionRef.current.activeTool === 'pan' ||
      spaceDownRef.current ||
      event.button === 1;

    if (panMode) {
      // Locked viewport: ignore pan gesture inside VIEWPORT_MODEL_SPACE
      if (workspaceModeRef.current === 'VIEWPORT_MODEL_SPACE') {
        const d = busRef.current.getDocument();
        const layout = d.layouts.find((l) => l.id === d.activeLayoutId);
        const vp = layout?.viewports.find(
          (v) => v.id === activeViewportIdRef.current,
        );
        if (vp?.locked) {
          setStatusExtra('Viewport locked — unlock to pan/zoom');
          return;
        }
      }
      canvas.setPointerCapture(event.pointerId);
      isPanningRef.current = true;
      panHistoryPushedRef.current = false;
      lastPointerRef.current = { x: event.clientX, y: event.clientY };
      return;
    }

    if (event.button !== 0) return;

    // Paper Space: paper entities, viewport select/move/resize, or MVIEW points.
    if (workspaceModeRef.current === 'PAPER_SPACE') {
      const d = busRef.current.getDocument();
      const layout = d.layouts.find((l) => l.id === d.activeLayoutId);
      if (!layout) return;
      const screen = getScreenFromEvent(event);
      const view = paperViewForLayout(layout, size.width, size.height);
      const paper = screenToPaper(screen, view);
      const eng = engineRef.current;
      const tool = sessionRef.current.activeTool;

      if (eng?.isRunning()) {
        eng.submitPoint(paper, { shiftKey: event.shiftKey });
        refreshEngineUi();
        bumpVpDrag();
        return;
      }

      if (isPaperAnnotationTool(tool)) {
        setSelectedViewportId(null);
        setSelectedPaperEntityIds([]);
        busRef.current.updateWithoutHistory((doc) => clearSelection(doc));
        if (tool === 'text') {
          syncSession(handlePaperTextPointerDown(sessionRef.current, paper));
          setTextPrompt('');
          return;
        }
        if (tool === 'dimension') {
          syncSession(
            handlePaperDimensionPointerDown(
              sessionRef.current,
              busRef.current,
              layout.id,
              paper,
            ),
          );
          return;
        }
        if (tool === 'leader') {
          const next = handlePaperLeaderPointerDown(sessionRef.current, paper);
          syncSession(next);
          if (next.mode === 'text-input') setTextPrompt('');
          return;
        }
      }

      if (selectedViewportId && tool === 'select') {
        const selected = layout.viewports.find((v) => v.id === selectedViewportId);
        if (selected) {
          const grips = getViewportGrips(selected, view);
          const grip = hitTestViewportGrip(grips, screen, 8);
          if (grip) {
            setSelectedPaperEntityIds([]);
            vpDragRef.current = {
              kind: 'resize',
              layoutId: layout.id,
              viewportId: selected.id,
              role: grip.role,
              original: structuredClone(selected),
              preview: structuredClone(selected),
            };
            canvas.setPointerCapture(event.pointerId);
            bumpVpDrag();
            setStatusExtra(`Resize Viewport`);
            return;
          }
        }
      }

      const paperTol =
        (8 / Math.max(1e-6, view.pxPerMm)) /
        (layout.pageSettings.units === 'inch' ? 25.4 : 1);

      if (tool === 'select') {
        const paperHit = hitTestPaperSpaceEntities(
          layout,
          paper,
          Math.max(1.5, paperTol),
        );
        if (paperHit) {
          setSelectedViewportId(null);
          setSelectedPaperEntityIds([paperHit.id]);
          busRef.current.updateWithoutHistory((doc) => clearSelection(doc));
          setStatusExtra(`Paper ${paperHit.type} selected`);
          return;
        }
      }

      const boundary = hitTestViewportBoundary(
        layout,
        paper.x,
        paper.y,
        Math.max(2, paperTol),
      );
      const hit =
        tool === 'select'
          ? boundary ?? hitTestViewport(layout, paper.x, paper.y)
          : null;
      setSelectedViewportId(hit?.id ?? null);
      if (hit) {
        setSelectedPaperEntityIds([]);
        busRef.current.updateWithoutHistory((doc) => clearSelection(doc));
        const idx = layout.viewports.findIndex((v) => v.id === hit.id);
        setStatusExtra(viewportStatusLine(hit, idx >= 0 ? idx : 0));
        vpDragRef.current = {
          kind: 'move',
          layoutId: layout.id,
          viewportId: hit.id,
          startPaper: paper,
          original: structuredClone(hit),
          preview: structuredClone(hit),
        };
        canvas.setPointerCapture(event.pointerId);
        bumpVpDrag();
      } else if (tool === 'select') {
        setSelectedPaperEntityIds([]);
        setStatusExtra(`PAPER SPACE · ${layout.name}`);
      }
      return;
    }

    // VIEWPORT_MODEL_SPACE: clip interaction to active viewport screen rect.
    if (workspaceModeRef.current === 'VIEWPORT_MODEL_SPACE') {
      const d = busRef.current.getDocument();
      const layout = d.layouts.find((l) => l.id === d.activeLayoutId);
      const vp = layout?.viewports.find(
        (v) => v.id === activeViewportIdRef.current,
      );
      if (layout && vp) {
        const screen = getScreenFromEvent(event);
        const view = fitPaperInCanvas(
          layout.pageSettings,
          size.width,
          size.height,
        );
        const { screenRect } = cameraForViewport(vp, view);
        const inside =
          screen.x >= screenRect.x &&
          screen.x <= screenRect.x + screenRect.w &&
          screen.y >= screenRect.y &&
          screen.y <= screenRect.y + screenRect.h;
        if (!inside) {
          // Click outside active viewport → stay in mode but ignore (exit via dbl-click)
          return;
        }
      }
    }

    const world = getWorldFromEvent(event);
    const eng = engineRef.current;
    if (eng?.isRunning() && eng.isAwaitingSelection()) {
      const tool = eng.getRunningCommand()?.tool ?? 'select';
      const selectSession = {
        ...sessionRef.current,
        activeTool: 'select' as ToolId,
      };
      const next = handleToolPointerDown(selectSession, busRef.current, {
        world,
        camera: getActiveInteractionCamera(),
        detail: event.detail,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        pickboxPx: pickboxPxRef.current,
      });
      if (next.mode === 'grip' || next.mode === 'window') {
        canvas.setPointerCapture(event.pointerId);
      }
      syncSession({ ...next, activeTool: tool as ToolId });
      refreshEngineUi();
      return;
    }
    if (eng?.isRunning()) {
      const snap = snapWorld(world);
      eng.submitPoint(snap.point, { shiftKey: event.shiftKey });
      syncSession({
        ...sessionRef.current,
        lastSnap: snap,
        statusMessage: eng.getStatusMessage() ?? sessionRef.current.statusMessage,
      });
      refreshEngineUi();
      return;
    }

    const next = handleToolPointerDown(sessionRef.current, busRef.current, {
      world,
      camera: getActiveInteractionCamera(),
      detail: event.detail,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      pickboxPx: pickboxPxRef.current,
    });
    if (next.mode === 'grip' || next.mode === 'window') {
      canvas.setPointerCapture(event.pointerId);
    }
    syncSession(next);
    // Handoff tools (MIRROR, etc.): after a successful commit, return to Selection Mode.
    if (eng?.hasPendingHandoff() && eng.finalizeHandoffIfCommitted()) {
      activateToolOnly('select');
      refreshEngineUi();
      setCommandFeedback('Select');
    }
    // AREA measurement success (no geometry commit) → Selection Mode + SPACE repeat.
    // Do not call activateToolOnly here — it would wipe areaLastResult.
    if (
      eng?.hasPendingHandoff() &&
      next.areaLastResult &&
      next.activeTool === 'select'
    ) {
      eng.completeHandoff();
      refreshEngineUi();
      setCommandFeedback(next.statusMessage);
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const screenPos = getScreenFromEvent(event);
    setCursorScreen(screenPos);
    if (!pointerOverCanvas) setPointerOverCanvas(true);

    // Paper-space viewport drag preview
    if (
      workspaceModeRef.current === 'PAPER_SPACE' &&
      vpDragRef.current &&
      !isPanningRef.current
    ) {
      const paper = getPaperFromEvent(event);
      const drag = vpDragRef.current;
      if (drag.kind === 'move') {
        const dx = paper.x - drag.startPaper.x;
        const dy = paper.y - drag.startPaper.y;
        drag.preview = applyViewportMove(drag.original, { x: dx, y: dy });
      } else {
        drag.preview = applyViewportGripResize(
          drag.original,
          drag.role,
          paper,
        );
      }
      cursorWorldRef.current = paper;
      setCursorWorld(paper);
      bumpVpDrag();
      return;
    }

    // Paper Space cursor in paper units; MVIEW live preview
    if (workspaceModeRef.current === 'PAPER_SPACE') {
      const paper = getPaperFromEvent(event);
      cursorWorldRef.current = paper;
      setCursorWorld(paper);
      const eng = engineRef.current;
      if (eng?.isRunning()) {
        eng.onPointerMove(paper);
        refreshEngineUi();
        bumpVpDrag();
      }
      return;
    }

    const world = getWorldFromEvent(event);
    cursorWorldRef.current = world;
    setCursorWorld(world);

    if (isPanningRef.current && lastPointerRef.current) {
      const dx = event.clientX - lastPointerRef.current.x;
      const dy = event.clientY - lastPointerRef.current.y;
      lastPointerRef.current = { x: event.clientX, y: event.clientY };
      const pending = pendingPanRef.current ?? { dx: 0, dy: 0 };
      pendingPanRef.current = { dx: pending.dx + dx, dy: pending.dy + dy };
      if (rafPanRef.current == null) {
        rafPanRef.current = requestAnimationFrame(flushPan);
      }
      return;
    }

    const eng = engineRef.current;
    if (eng?.isRunning() && eng.isAwaitingSelection()) {
      const tool = eng.getRunningCommand()?.tool ?? 'select';
      const selectSession = {
        ...sessionRef.current,
        activeTool: 'select' as ToolId,
      };
      const next = handleToolPointerMove(selectSession, busRef.current, {
        world,
        camera: getActiveInteractionCamera(),
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        pickboxPx: pickboxPxRef.current,
      });
      if (next !== sessionRef.current) {
        syncSession({ ...next, activeTool: tool as ToolId });
      }
      return;
    }
    if (eng?.isRunning()) {
      const snap = snapWorld(world);
      eng.onPointerMove(snap.point);
      syncSession({
        ...sessionRef.current,
        lastSnap: snap,
        statusMessage: eng.getStatusMessage() ?? sessionRef.current.statusMessage,
      });
      refreshEngineUi();
      return;
    }

    // Hover / preselection when idle pointer (select) mode — pickbox aperture
    if (sessionRef.current.activeTool === 'select' && sessionRef.current.mode === 'idle') {
      const tol = pickboxToleranceWorld(
        getActiveInteractionCamera(),
        draftingPrefs.pickboxSize,
      );
      const sm = selectionManagerRef.current;
      const id = sm
        ? sm.updateHover(world, tol)
        : null;
      if (id !== hoveredIdRef.current) {
        hoveredIdRef.current = id;
        setHoveredId(id);
        if (documentSessionRef.current) {
          setSessionHoveredId(documentSessionRef.current, id);
        }
      }
    } else if (hoveredIdRef.current) {
      hoveredIdRef.current = null;
      setHoveredId(null);
      selectionManagerRef.current?.setHovered(null);
      if (documentSessionRef.current) {
        setSessionHoveredId(documentSessionRef.current, null);
      }
    }

    const next = handleToolPointerMove(sessionRef.current, busRef.current, {
      world,
      camera: getActiveInteractionCamera(),
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      pickboxPx: pickboxPxRef.current,
    });
    if (next !== sessionRef.current) {
      syncSession(next);
    }
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const wasPanning = isPanningRef.current;
    isPanningRef.current = false;
    panHistoryPushedRef.current = false;
    lastPointerRef.current = null;
    const canvas = canvasRef.current;
    if (canvas?.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }

    // Commit paper-space viewport move/resize
    if (vpDragRef.current) {
      const drag = vpDragRef.current;
      vpDragRef.current = null;
      const moved =
        Math.hypot(
          drag.preview.x - drag.original.x,
          drag.preview.y - drag.original.y,
        ) > 1e-6 ||
        Math.abs(drag.preview.width - drag.original.width) > 1e-6 ||
        Math.abs(drag.preview.height - drag.original.height) > 1e-6;
      if (moved) {
        if (drag.kind === 'move') {
          busRef.current.execute(
            new MoveViewportCommand(drag.layoutId, drag.original, {
              x: drag.preview.x - drag.original.x,
              y: drag.preview.y - drag.original.y,
            }),
          );
          busRef.current.execute(new SyncViewportLabelsCommand(drag.layoutId));
        } else {
          busRef.current.execute(
            new ResizeViewportCommand(drag.layoutId, drag.original, {
              x: drag.preview.x,
              y: drag.preview.y,
              width: drag.preview.width,
              height: drag.preview.height,
            }),
          );
          busRef.current.execute(new SyncViewportLabelsCommand(drag.layoutId));
        }
        const d = busRef.current.getDocument();
        const layout = d.layouts.find((l) => l.id === drag.layoutId);
        const vp = layout?.viewports.find((v) => v.id === drag.viewportId);
        if (layout && vp) {
          const idx = layout.viewports.findIndex((v) => v.id === vp.id);
          setStatusExtra(viewportStatusLine(vp, idx >= 0 ? idx : 0));
        }
      }
      bumpVpDrag();
      return;
    }

    if (wasPanning || event.button !== 0) return;
    if (workspaceModeRef.current === 'PAPER_SPACE') return;

    const world = getWorldFromEvent(event);
    const eng = engineRef.current;
    if (eng?.isRunning() && eng.isAwaitingSelection()) {
      const tool = eng.getRunningCommand()?.tool ?? 'select';
      const selectSession = {
        ...sessionRef.current,
        activeTool: 'select' as ToolId,
      };
      const next = handleToolPointerUp(selectSession, busRef.current, {
        world,
        camera: getActiveInteractionCamera(),
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        pickboxPx: pickboxPxRef.current,
      });
      syncSession({ ...next, activeTool: tool as ToolId });
      refreshEngineUi();
      return;
    }
    const next = handleToolPointerUp(sessionRef.current, busRef.current, {
      world,
      camera: getActiveInteractionCamera(),
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      pickboxPx: pickboxPxRef.current,
    });
    if (next !== sessionRef.current) {
      syncSession(next);
    }
  };

  const onWheel = (event: ReactWheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const screen = getScreenFromEvent(event);
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;

    if (wheelHistoryArmedRef.current) {
      pushViewHistory();
      wheelHistoryArmedRef.current = false;
      window.setTimeout(() => {
        wheelHistoryArmedRef.current = true;
      }, 400);
    }

    if (workspaceModeRef.current === 'PAPER_SPACE') {
      const d = busRef.current.getDocument();
      const layoutId = d.activeLayoutId;
      if (!layoutId) return;
      const layout = d.layouts.find((l) => l.id === layoutId);
      if (!layout) return;
      const cam = layout.paperCamera ?? defaultPaperCamera();
      const next = {
        ...cam,
        zoom: Math.max(0.25, Math.min(8, cam.zoom * factor)),
      };
      busRef.current.updateWithoutHistory((doc) =>
        updateLayoutSheetMeta(doc, layoutId, { paperCamera: next }),
      );
      return;
    }

    if (workspaceModeRef.current === 'VIEWPORT_MODEL_SPACE') {
      const d = busRef.current.getDocument();
      const layoutId = d.activeLayoutId;
      const vpId = activeViewportIdRef.current;
      if (!layoutId || !vpId) return;
      const layout = d.layouts.find((l) => l.id === layoutId);
      const vp = layout?.viewports.find((v) => v.id === vpId);
      if (!layout || !vp) return;
      if (vp.locked) {
        setStatusExtra('Viewport locked — unlock to pan/zoom');
        return;
      }
      const view = paperViewForLayout(layout, size.width, size.height);
      const { screenRect } = cameraForViewport(vp, view);
      const inside =
        screen.x >= screenRect.x &&
        screen.x <= screenRect.x + screenRect.w &&
        screen.y >= screenRect.y &&
        screen.y <= screenRect.y + screenRect.h;
      if (!inside) return;
      // Preserve model center; change scale only (geometry untouched).
      const next = zoomViewportScale(vp, factor);
      busRef.current.updateWithoutHistory((doc) =>
        replaceViewport(doc, layoutId, next),
      );
      const idx = layout.viewports.findIndex((v) => v.id === vpId);
      setStatusExtra(
        `${workspaceModeLabel('VIEWPORT_MODEL_SPACE', layout.name, idx)} · ${formatViewportScale(next.scale)}`,
      );
      return;
    }

    syncCamera(
      zoomAtScreenPoint(
        cameraRef.current,
        screen,
        factor,
        size.width,
        size.height,
      ),
    );
  };

  const selected = useMemo(() => getSelectedEntities(doc), [doc]);
  const selectedProps =
    selected.length === 1 && selected[0]
      ? describeEntity(selected[0], doc)
      : null;
  const multiSelectLabel =
    selected.length > 1 ? `${selected.length} objects selected` : null;
  const displayName = `${doc.meta.name}${dirty ? ' *' : ''}`;
  const documentTabs = useMemo(() => {
    const store = sessionStoreRef.current;
    const fallbackId = activeSessionId || 'session-active';
    const items = resolveDocumentTabItems(store, {
      sessionId: fallbackId,
      title: doc.meta.name || 'Untitled Drawing',
      dirty,
      filePath: filePath,
    });
    return applyLiveActiveTabState(items, store, {
      title: doc.meta.name || 'Untitled Drawing',
      dirty,
      filePath: filePath,
    });
    // sessionListVersion refreshes inactive tab dirty/titles from the store.
  }, [activeSessionId, dirty, doc.meta.name, filePath, sessionListVersion]);
  const snapLabel = session.lastSnap?.snapped ? session.lastSnap.label : null;
  const currentLayer = getLayer(doc, doc.currentLayerId) ?? doc.layers[0];
  const showTextDialog = session.mode === 'text-input';

  const draftingCursorMode = resolveDraftingCursorMode({
    activeTool: session.activeTool,
    sessionMode: session.mode,
    spacePan: spaceDownRef.current,
    isPanning: isPanningRef.current,
    pointerOverCanvas,
    engineCommandName: engineUi?.commandName,
    enginePrompt: engineUi?.prompt,
    textDialogOpen: showTextDialog,
  });
  const canvasClass = [
    'viewport-canvas',
    draftingCursorMode === 'pan' ? 'pan-ready' : '',
    isPanningRef.current ? 'panning' : '',
    draftingCursorMode === 'select' ||
    draftingCursorMode === 'draw' ||
    draftingCursorMode === 'modify' ||
    draftingCursorMode === 'zoom-window'
      ? 'drafting-cursor'
      : '',
  ]
    .filter(Boolean)
    .join(' ');
  const canvasStyle = {
    cursor: draftingCssCursor(draftingCursorMode),
  } as const;

  return (
    <div className="app-shell">
      {closePrompt ? (
        <CloseSaveDialog
          drawingName={closePrompt.title}
          title={closePrompt.dialogTitle}
          message={closePrompt.message}
          progressLabel={closePrompt.progressLabel}
          busy={closePromptBusy}
          onChoose={(choice) => {
            if (closePromptBusy && choice !== 'cancel') return;
            if (choice === 'save') setClosePromptBusy(true);
            closePrompt.resolve(choice);
            if (choice === 'cancel' || choice === 'dont-save') {
              setClosePrompt(null);
              setClosePromptBusy(false);
            }
          }}
        />
      ) : null}
      {discardPrompt ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-panel">
            <h3>Unsaved changes</h3>
            <p>Discard unsaved changes and continue?</p>
            <div className="modal-actions">
              <button
                type="button"
                onClick={() => {
                  discardPrompt.resolve(false);
                  setDiscardPrompt(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  discardPrompt.resolve(true);
                  setDiscardPrompt(null);
                }}
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {showUnitsDialog ? (
        <UnitsDialog
          initial={
            doc.settings.drawingUnits ?? {
              linearFormat: 'architectural',
              linearPrecision: 4,
              angularFormat: 'decimal-degrees',
              angularPrecision: 0,
              insertionUnit: 'ft',
            }
          }
          onApply={(next) => {
            busRef.current.execute(
              new SetDrawingUnitsSettingsCommand(busRef.current.getDocument(), next),
            );
            setDoc(busRef.current.getDocument());
            setCommandFeedback('UNITS updated');
          }}
          onClose={() => {
            showUnitsDialogRef.current = false;
            setShowUnitsDialog(false);
          }}
        />
      ) : null}
      {showDimStyleDialog ? (
        <DimStyleManager
          styles={doc.settings.dimensionStyles ?? []}
          activeName={doc.settings.activeDimensionStyleName ?? 'Standard'}
          onSetActive={(name) => {
            busRef.current.execute(
              new SetActiveDimensionStyleCommand(busRef.current.getDocument(), name),
            );
            setDoc(busRef.current.getDocument());
          }}
          onUpdate={(style) => {
            busRef.current.execute(
              new UpdateDimensionStyleCommand(busRef.current.getDocument(), style),
            );
            setDoc(busRef.current.getDocument());
          }}
          onCopy={(source, name) => {
            busRef.current.execute(
              new CopyDimensionStyleCommand(
                busRef.current.getDocument(),
                source,
                name,
              ),
            );
            setDoc(busRef.current.getDocument());
          }}
          onRename={(from, to) => {
            busRef.current.execute(
              new RenameDimensionStyleCommand(
                busRef.current.getDocument(),
                from,
                to,
              ),
            );
            setDoc(busRef.current.getDocument());
          }}
          onDelete={(name) => {
            busRef.current.execute(
              new DeleteDimensionStyleCommand(busRef.current.getDocument(), name),
            );
            setDoc(busRef.current.getDocument());
          }}
          onClose={() => {
            showDimStyleDialogRef.current = false;
            setShowDimStyleDialog(false);
          }}
        />
      ) : null}
      {showTextDialog ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" data-cad-dialog="1">
          <div className="modal-panel">
            <h3>{session.activeTool === 'leader' ? 'Leader text' : 'Text'}</h3>
            <p>Enter annotation content, then confirm.</p>
            <input
              ref={textInputRef}
              data-cad-text-editor="1"
              className="text-prompt-input"
              value={textPrompt}
              onChange={(e) => setTextPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  confirmTextPrompt();
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  cancelTextPrompt();
                }
              }}
              placeholder="Annotation…"
              aria-label="Annotation text"
            />
            <div className="modal-actions">
              <button type="button" onClick={cancelTextPrompt}>
                Cancel
              </button>
              <button type="button" className="primary" onClick={confirmTextPrompt}>
                OK
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <Ribbon
        displayName={displayName}
        documentTabs={documentTabs}
        activeSessionId={activeSessionId}
        multiDocumentActionsEnabled={MULTI_DOCUMENT_ACTIONS_ENABLED}
        closeTabActionsEnabled={CLOSE_TAB_ACTIONS_ENABLED}
        onSelectDocumentTab={switchToDocumentSession}
        onNewDocumentTab={createNewDocumentTab}
        onCloseDocumentTab={(id) => void requestCloseDocumentTab(id)}
        activeTool={session.activeTool}
        dimKind={session.dimKind}
        canUndo={canUndo}
        canRedo={canRedo}
        selectionCount={doc.selection.length}
        document={doc}
        commandBus={busRef.current}
        layers={doc.layers}
        currentLayerId={doc.currentLayerId}
        snapOn={doc.settings.snapToGrid}
        orthoOn={orthoOn}
        polarOn={polarOn}
        polarIncrement={polarIncrement}
        gridOn={doc.settings.showGrid !== false}
        areaMode={session.areaMode}
        crosshairSize={draftingPrefs.crosshairSize}
        pickboxSize={draftingPrefs.pickboxSize}
        workspaceMode={workspaceMode}
        activeLayoutId={doc.activeLayoutId}
        layouts={doc.layouts.map((l) => ({ id: l.id, name: l.name }))}
        annotationScaleLabel={formatAnnotationScale(
          doc.settings.annotationScale?.ratio ?? 50,
        )}
        onCrosshairSizeChange={(size: CrosshairSize) => {
          setDraftingPrefs(updateDraftingPrefs({ crosshairSize: size }));
        }}
        onPickboxSizeChange={(size: PickboxSize) => {
          setDraftingPrefs(updateDraftingPrefs({ pickboxSize: size }));
        }}
        onNew={() => void newDrawing()}
        onOpen={() => void openDrawing()}
        onSave={() => void saveDrawing(false)}
        onSaveAs={() => void saveDrawing(true)}
        onSaveAll={() => void saveAllDrawings()}
        onCloseAll={() => void closeAllDrawings()}
        saveAllDisabled={bulkOpBusy || !documentTabs.some((t) => t.dirty)}
        closeAllDisabled={bulkOpBusy}
        bulkFileOpBusy={bulkOpBusy}
        onUndo={undo}
        onRedo={redo}
        onDeleteSelection={deleteSelection}
        onActivateTool={activateTool}
        onRunCommand={runEngineCommand}
        onOpenUnits={() => setShowUnitsDialog(true)}
        onOpenDimStyle={() => setShowDimStyleDialog(true)}
        onSetCurrentLayer={setCurrentLayer}
        onAddLayer={addLayer}
        onToggleLayerVisible={toggleLayerVisible}
        onToggleLayerLocked={toggleLayerLocked}
        onToggleSnap={toggleSnap}
        onToggleOrtho={toggleOrtho}
        onTogglePolar={togglePolar}
        onToggleGrid={toggleGrid}
        onActivateAreaMode={activateAreaMode}
        onScrollToLayers={() => {
          const el = document.querySelector('.layers-section');
          el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }}
        onScrollToProperties={() => {
          const el =
            document.querySelector('.properties-engine') ??
            document.querySelector('.right-panel');
          el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }}
        onZoomExtents={() => {
          void runEngineCommand('ZE');
        }}
        onZoomWindow={() => {
          const eng = engineRef.current;
          if (!eng) return;
          eng.start('ZOOM');
          eng.setBuffer('W');
          eng.confirm('enter');
          refreshEngineUi();
          setCommandFeedback('ZOOM: Specify first corner:');
        }}
        onZoomPrevious={() => {
          const eng = engineRef.current;
          if (!eng) return;
          eng.start('ZOOM');
          eng.setBuffer('P');
          eng.confirm('enter');
          refreshEngineUi();
          setCommandFeedback(eng.getStatusMessage() ?? 'ZOOM Previous');
        }}
        onPanNavigation={() => {
          void runEngineCommand('PAN');
        }}
        onSwitchToModel={() => switchToModelTab()}
        onSwitchToLayout={(layoutId) => switchToLayoutTab(layoutId)}
        appMenuOpen={appMenuOpen}
        onAppMenuOpenChange={setAppMenuOpen}
        recentDrawings={recentDrawings}
        onOpenRecent={(entry) => void openRecentDrawing(entry)}
        onExit={() => void exitApp()}
      />

      {session.activeTool === 'area' ? (
        <AreaModeStrip
          areaMode={session.areaMode}
          hasResult={!!session.areaLastResult}
          onActivateAreaMode={activateAreaMode}
          onCreateBoundary={() =>
            syncSession(
              createBoundaryFromArea(sessionRef.current, busRef.current),
            )
          }
          onAreaLabel={() =>
            syncSession(createAreaLabel(sessionRef.current, busRef.current))
          }
          onAllRooms={() => {
            const lines = formatRoomAreaReport(busRef.current.getDocument());
            setCommandFeedback(lines.join(' · '));
          }}
        />
      ) : null}

      {session.areaLastResult ? (
        <div className="area-result-panel" data-testid="area-result-panel" role="status">
          <div className="area-result-title">AREA Result</div>
          {formatAreaMeasurementReport(
            session.areaLastResult,
            doc,
            session.areaLastResult.calculationMethod === 'circle'
              ? 'circle'
              : session.areaLastResult.calculationMethod === 'rectangle'
                ? 'rectangle'
                : undefined,
          ).map((line) => (
            <div key={line} className="area-result-line">
              {line}
            </div>
          ))}
          {session.areaSession && session.areaSession.entries.length > 0 ? (
            <div className="area-result-line area-result-net">
              Session entries: {session.areaSession.entries.length} · Net:{' '}
              {session.areaSession.totalArea.toFixed(doc.settings.precision ?? 2)}{' '}
              (world²)
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="workspace">
        <main className="viewport-wrap" ref={wrapRef}>
          <canvas
            ref={canvasRef}
            data-cad-canvas="1"
            data-testid="drafting-canvas"
            className={canvasClass}
            style={canvasStyle}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerEnter={(e) => {
              setPointerOverCanvas(true);
              setCursorScreen(getScreenFromEvent(e));
            }}
            onPointerLeave={() => {
              setPointerOverCanvas(false);
              setCursorScreen(null);
              if (hoveredIdRef.current) {
                hoveredIdRef.current = null;
                setHoveredId(null);
                selectionManagerRef.current?.setHovered(null);
                if (documentSessionRef.current) {
                  setSessionHoveredId(documentSessionRef.current, null);
                }
              }
            }}
            onWheel={onWheel}
            onContextMenu={(e) => e.preventDefault()}
            onDoubleClick={(e) => {
              e.preventDefault();
              // Layout Paper Space: enter / leave viewport model space
              if (
                workspaceModeRef.current === 'PAPER_SPACE' ||
                workspaceModeRef.current === 'VIEWPORT_MODEL_SPACE'
              ) {
                const layout = doc.layouts.find(
                  (l) => l.id === doc.activeLayoutId,
                );
                if (!layout) return;
                const canvas = canvasRef.current;
                if (!canvas) return;
                const rect = canvas.getBoundingClientRect();
                const screen = {
                  x: e.clientX - rect.left,
                  y: e.clientY - rect.top,
                };
                const view = fitPaperInCanvas(
                  layout.pageSettings,
                  size.width,
                  size.height,
                );
                const paper = screenToPaper(screen, view);
                const hit = hitTestViewport(layout, paper.x, paper.y);
                if (hit) {
                  workspaceModeRef.current = 'VIEWPORT_MODEL_SPACE';
                  setWorkspaceMode('VIEWPORT_MODEL_SPACE');
                  setActiveViewportId(hit.id);
                  activeViewportIdRef.current = hit.id;
                  setSelectedViewportId(hit.id);
                  const vpIndex = layout.viewports.findIndex(
                    (v) => v.id === hit.id,
                  );
                  setStatusExtra(
                    workspaceModeLabel(
                      'VIEWPORT_MODEL_SPACE',
                      layout.name,
                      vpIndex,
                    ),
                  );
                } else {
                  workspaceModeRef.current = 'PAPER_SPACE';
                  setWorkspaceMode('PAPER_SPACE');
                  setActiveViewportId(null);
                  activeViewportIdRef.current = null;
                  setStatusExtra(`PAPER SPACE · ${layout.name}`);
                }
                return;
              }
              editSelectedText();
            }}
          />
          <ViewportOverlays
            panActive={session.activeTool === 'pan'}
            zoomWindowActive={
              engineUi?.commandName === 'ZOOM' &&
              (engineUi.prompt.toLowerCase().includes('corner') ||
                engineUi.prompt.toLowerCase().includes('window'))
            }
            onPan={() => {
              void runEngineCommand('PAN');
            }}
            onZoomExtents={() => {
              void runEngineCommand('ZE');
            }}
            onZoomWindow={() => {
              const eng = engineRef.current;
              if (!eng) return;
              eng.start('ZOOM');
              eng.setBuffer('W');
              eng.confirm('enter');
              refreshEngineUi();
              setCommandFeedback('ZOOM: Specify first corner:');
            }}
            onZoomPrevious={() => {
              const eng = engineRef.current;
              if (!eng) return;
              eng.start('ZOOM');
              eng.setBuffer('P');
              eng.confirm('enter');
              refreshEngineUi();
              const ui = eng.getUiState();
              if (ui.message) setCommandFeedback(ui.message);
            }}
          />
          <div className="layout-tabs" role="tablist" aria-label="Model and layouts">
            <button
              type="button"
              role="tab"
              className={`layout-tab${workspaceMode === 'MODEL_SPACE' && doc.activeLayoutId == null ? ' active' : ''}`}
              aria-selected={doc.activeLayoutId == null}
              onClick={() => switchToModelTab()}
            >
              MODEL
            </button>
            {(doc.layouts ?? []).map((layout) => (
              <button
                key={layout.id}
                type="button"
                role="tab"
                className={`layout-tab${doc.activeLayoutId === layout.id ? ' active' : ''}`}
                aria-selected={doc.activeLayoutId === layout.id}
                onClick={() => switchToLayoutTab(layout.id)}
              >
                {layout.name}
              </button>
            ))}
            <button
              type="button"
              className="layout-tab layout-tab-add"
              title="New layout"
              aria-label="Create new layout"
              onClick={() => createNewLayoutTab()}
            >
              +
            </button>
          </div>
          {/* Dynamic Input near cursor */}
          {(engineUi?.commandName ||
            (engineUi?.suggestionRows?.length ?? 0) > 0 ||
            engineUi?.naturalLanguagePending) && (
            <div
              className="dyn-input"
              style={{
                left: Math.min(
                  size.width - 220,
                  Math.max(
                    8,
                    (() => {
                      const canvas = canvasRef.current;
                      if (!canvas) return 8;
                      // Approximate screen from last cursor — use wrap relative
                      const wrap = wrapRef.current?.getBoundingClientRect();
                      void wrap;
                      return size.width * 0.5;
                    })(),
                  ),
                ),
                top: 12,
              }}
              role="status"
              aria-live="polite"
            >
              {engineUi?.commandName ? (
                <>
                  <div className="dyn-cmd">{engineUi.commandName}</div>
                  <div className="dyn-prompt">{engineUi.prompt}</div>
                  {engineUi.optionsText ? (
                    <div className="dyn-options">{engineUi.optionsText}</div>
                  ) : null}
                </>
              ) : engineUi?.naturalLanguagePending ? (
                <div className="dyn-nl">AI natural-language — Enter to send</div>
              ) : (
                <ul className="dyn-suggest" aria-label="Command suggestions">
                  {(engineUi?.suggestionRows ?? []).map((row, i) => (
                    <li key={row.commandId}>
                      <button
                        type="button"
                        className={
                          i === engineUi?.suggestionIndex
                            ? 'cmd-suggest active'
                            : 'cmd-suggest'
                        }
                        onClick={() => {
                          engineRef.current?.selectSuggestion(i);
                          engineRef.current?.confirm('enter');
                          refreshEngineUi();
                        }}
                      >
                        <span className="cmd-alias">
                          {row.alias ?? '·'}
                        </span>
                        <span className="cmd-name">{row.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className="command-dock">
            <div className="command-row">
              <label className="command-label" htmlFor="cad-command-input">
                {engineUi?.commandName ? 'Cmd' : 'Command'}
              </label>
              <input
                id="cad-command-input"
                ref={commandInputRef}
                data-cad-command="1"
                className="command-input"
                value={commandLine}
                onChange={(e) => {
                  const next = e.target.value;
                  commandLineRef.current = next;
                  setCommandLine(next);
                  engineRef.current?.setBuffer(next);
                  setCommandFeedback(null);
                  refreshEngineUi();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    submitCommandLine();
                  } else if (e.key === 'Tab') {
                    e.preventDefault();
                    engineRef.current?.cycleSuggestion();
                    refreshEngineUi();
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    const eng = engineRef.current;
                    const ui = eng?.getUiState();
                    if (ui && ui.suggestionRows.length > 0) {
                      eng?.moveSuggestion(-1);
                    } else {
                      eng?.historyUp();
                    }
                    refreshEngineUi();
                  } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    const eng = engineRef.current;
                    const ui = eng?.getUiState();
                    if (ui && ui.suggestionRows.length > 0) {
                      eng?.moveSuggestion(1);
                    } else {
                      eng?.historyDown();
                    }
                    refreshEngineUi();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    engineRef.current?.handleEscape();
                    refreshEngineUi();
                  }
                }}
                placeholder="Type command (L, M, C, …) — Enter/Space"
                aria-label="CAD command"
                aria-autocomplete="list"
                aria-controls="cad-command-suggestions"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                className="command-go"
                onClick={() => submitCommandLine()}
              >
                Enter
              </button>
            </div>
            {engineUi?.suggestionRows?.length ? (
              <div
                id="cad-command-suggestions"
                className="command-suggestions"
                role="listbox"
                aria-label="Command suggestions"
              >
                {engineUi.suggestionRows.map((row, i) => (
                  <button
                    key={row.commandId}
                    type="button"
                    role="option"
                    aria-selected={i === engineUi.suggestionIndex}
                    className={
                      i === engineUi.suggestionIndex
                        ? 'cmd-suggest active'
                        : 'cmd-suggest'
                    }
                    onClick={() => {
                      engineRef.current?.selectSuggestion(i);
                      engineRef.current?.confirm('enter');
                      refreshEngineUi();
                      setCommandFeedback(row.name);
                    }}
                  >
                    <span className="cmd-alias">{row.alias ?? ''}</span>
                    {row.name}
                    {row.matchKind === 'typo' ? ' ?' : ''}
                  </button>
                ))}
              </div>
            ) : null}
            {engineUi?.naturalLanguagePending ? (
              <div className="command-nl-hint">
                Natural language detected — Enter routes to AI Command Engine
              </div>
            ) : null}
            {(session.activeTool === 'rectangle' ||
              engineUi?.commandName === 'RECTANGLE') && (
              <div className="command-row rect-dims">
                <label className="command-label" htmlFor="rect-length-input">
                  Length
                </label>
                <input
                  id="rect-length-input"
                  data-cad-rect-dim="1"
                  className="command-input dim"
                  value={rectLengthText}
                  onChange={(e) => {
                    const next = e.target.value;
                    setRectLengthText(next);
                    applyRectangleDimensions(next, rectWidthText);
                  }}
                  placeholder="blank = free"
                  aria-label="Rectangle length"
                  autoComplete="off"
                  spellCheck={false}
                />
                <label className="command-label" htmlFor="rect-width-input">
                  Width
                </label>
                <input
                  id="rect-width-input"
                  data-cad-rect-dim="1"
                  className="command-input dim"
                  value={rectWidthText}
                  onChange={(e) => {
                    const next = e.target.value;
                    setRectWidthText(next);
                    applyRectangleDimensions(rectLengthText, next);
                  }}
                  placeholder="blank = free"
                  aria-label="Rectangle width"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            )}
            <div className="command-feedback" aria-live="polite">
              {engineUi?.commandName ? (
                <>
                  <span className="cmd-active">{engineUi.commandName}</span>
                  {' — '}
                  {engineUi.prompt}
                  {engineUi.optionsText ? ` ${engineUi.optionsText}` : ''}
                  {engineUi.defaultText ? ` ${engineUi.defaultText}` : ''}
                  {engineUi.message ? ` · ${engineUi.message}` : ''}
                </>
              ) : commandFeedback?.startsWith('Unknown') ? (
                commandFeedback
              ) : (
                'L REC C PL M CO TR EX O MI RO SC · Tab suggest · ↑↓ history'
              )}
            </div>
          </div>
          {engineUi?.dynamic ? (
            <div className="dynamic-input" aria-hidden>
              {engineUi.dynamic.label === 'Radius' &&
              engineUi.dynamic.distance != null ? (
                <div>Radius: {formatLength(engineUi.dynamic.distance)}</div>
              ) : engineUi.dynamic.distance != null ? (
                <div>Dist: {formatLength(engineUi.dynamic.distance)}</div>
              ) : null}
              {engineUi.dynamic.angleDeg != null ? (
                <div>Ang: {engineUi.dynamic.angleDeg.toFixed(1)}°</div>
              ) : null}
              {engineUi.dynamic.length != null ? (
                <div>L: {formatLength(engineUi.dynamic.length)}</div>
              ) : null}
              {engineUi.dynamic.width != null ? (
                <div>W: {formatLength(engineUi.dynamic.width)}</div>
              ) : null}
            </div>
          ) : null}
        </main>

        <aside className="right-panel" aria-label="Properties">
          <section className="panel-section">
            <h2 className="panel-title">Document</h2>
            <div className="prop-row">
              <label>Name</label>
              <div className="value">{displayName}</div>
            </div>
            <div className="prop-row">
              <label>Units</label>
              <div className="value">
                {LINEAR_UNIT_FORMAT_LABELS[
                  doc.settings.drawingUnits?.linearFormat ?? 'architectural'
                ] ?? LENGTH_UNIT_LABELS[doc.settings.units]}
              </div>
            </div>
            <div className="prop-row">
              <label>Precision</label>
              <div className="value">
                {doc.settings.drawingUnits?.linearFormat === 'architectural' ||
                doc.settings.units === 'ft-in'
                  ? `1/${doc.settings.fractionDenominator ?? 16}"`
                  : doc.settings.precision}
              </div>
            </div>
            <div className="prop-row">
              <label>Dim style</label>
              <div className="value">
                {doc.settings.activeDimensionStyleName ?? 'Standard'}
              </div>
            </div>
            <div className="prop-row">
              <label>Layer</label>
              <div className="value">{currentLayer?.name ?? '—'}</div>
            </div>
            <div className="prop-row">
              <label>Snap</label>
              <div className="value">{doc.settings.snapToGrid ? 'ON' : 'OFF'}</div>
            </div>
            <div className="prop-row">
              <label>Ortho</label>
              <div className="value">{orthoOn ? 'ON' : 'OFF'}</div>
            </div>
            <div className="prop-row">
              <label>Polar</label>
              <div className="value">
                {polarOn ? `ON ${polarIncrement}°` : 'OFF'}
              </div>
            </div>
            <div className="prop-row">
              <label>Coords</label>
              <div className="value mono-coords">
                {cursorWorld
                  ? `${cursorWorld.x.toFixed(doc.settings.precision ?? 2)}, ${cursorWorld.y.toFixed(doc.settings.precision ?? 2)}`
                  : '—'}
              </div>
            </div>
            <div className="doc-action-row">
              <button
                type="button"
                className="mini-btn"
                onClick={() => setShowUnitsDialog(true)}
              >
                UNITS…
              </button>
              <button
                type="button"
                className="mini-btn"
                onClick={() => setShowDimStyleDialog(true)}
              >
                DIMSTYLE…
              </button>
              <button
                type="button"
                className="mini-btn"
                onClick={() => {
                  const el = document.querySelector('.layers-section');
                  el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }}
              >
                LAYERS…
              </button>
            </div>
            <div className="prop-row units-convert-row">
              <label>Convert</label>
              <select
                className="prop-select"
                defaultValue=""
                onChange={(e) => {
                  const v = e.target.value as LengthUnit | '';
                  e.target.value = '';
                  if (v) convertWorldUnit(v);
                }}
                aria-label="Convert drawing world unit"
              >
                <option value="" disabled>
                  Scale geometry…
                </option>
                {(['ft', 'in', 'm', 'cm', 'mm'] as LengthUnit[]).map((u) => (
                  <option key={u} value={u}>
                    → {LENGTH_UNIT_LABELS[u]}
                  </option>
                ))}
              </select>
            </div>
          </section>

          <section className="panel-section layers-section">
            <div className="panel-title-row">
              <h2 className="panel-title">Layers</h2>
              <button type="button" className="mini-btn" onClick={addLayer}>
                +
              </button>
            </div>
            <ul className="layer-list">
              {doc.layers.map((layer) => {
                const isCurrent = layer.id === doc.currentLayerId;
                return (
                  <li
                    key={layer.id}
                    className={`layer-row${isCurrent ? ' current' : ''}`}
                  >
                    <button
                      type="button"
                      className="layer-vis"
                      title={layer.visible ? 'Hide' : 'Show'}
                      onClick={() => toggleLayerVisible(layer)}
                    >
                      {layer.visible ? 'V' : 'H'}
                    </button>
                    <button
                      type="button"
                      className="layer-lock"
                      title={layer.locked ? 'Unlock' : 'Lock'}
                      onClick={() => toggleLayerLocked(layer)}
                    >
                      {layer.locked ? 'L' : 'U'}
                    </button>
                    <button
                      type="button"
                      className="layer-name"
                      onClick={() => setCurrentLayer(layer.id)}
                      onDoubleClick={() => {
                        const next = window.prompt('Rename layer', layer.name);
                        if (next) renameLayer(layer, next);
                      }}
                      title="Click set current · double-click rename"
                    >
                      <span
                        className="layer-swatch"
                        style={{ background: layer.color }}
                      />
                      {layer.name}
                    </button>
                    {layer.id !== 'layer-0' ? (
                      <button
                        type="button"
                        className="layer-del"
                        title="Delete layer"
                        onClick={() => deleteLayer(layer)}
                      >
                        ×
                      </button>
                    ) : (
                      <span className="layer-del spacer" />
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          {doc.activeLayoutId && workspaceMode !== 'MODEL_SPACE' ? (
            <LayoutPropertiesPanel
              doc={doc}
              bus={busRef.current}
              layoutId={doc.activeLayoutId}
              selectedViewportId={selectedViewportId}
            />
          ) : null}
          {selectedViewportId &&
          doc.activeLayoutId &&
          workspaceMode !== 'MODEL_SPACE' &&
          selected.length === 0 &&
          selectedPaperEntityIds.length === 0 ? (
            <ViewportPropertiesPanel
              doc={doc}
              bus={busRef.current}
              layoutId={doc.activeLayoutId}
              viewportId={selectedViewportId}
              viewportIndex={Math.max(
                0,
                (doc.layouts
                  .find((l) => l.id === doc.activeLayoutId)
                  ?.viewports.findIndex((v) => v.id === selectedViewportId) ??
                  0),
              )}
            />
          ) : selectedPaperEntityIds.length > 0 &&
            doc.activeLayoutId &&
            workspaceMode === 'PAPER_SPACE' ? (
            <section className="panel-section properties-engine">
              <h2 className="panel-title">Properties</h2>
              {(() => {
                const layout = doc.layouts.find(
                  (l) => l.id === doc.activeLayoutId,
                );
                const ent = layout?.paperSpaceEntities.find(
                  (e) => e.id === selectedPaperEntityIds[0],
                );
                if (!ent) return <p className="empty-props">Not found</p>;
                return (
                  <>
                    <div className="prop-row">
                      <label>Type</label>
                      <span className="value">Paper {ent.type}</span>
                    </div>
                    <div className="prop-row">
                      <label>Space</label>
                      <span className="value">Paper Space</span>
                    </div>
                    <div className="prop-row">
                      <label>Layout</label>
                      <span className="value">{layout?.name}</span>
                    </div>
                    <div className="prop-row">
                      <label>Layer</label>
                      <span className="value">
                        {doc.layers.find((l) => l.id === ent.layerId)?.name ??
                          ent.layerId}
                      </span>
                    </div>
                    {ent.type === 'text' ? (
                      <div className="prop-row">
                        <label>Content</label>
                        <span className="value">{ent.geometry.content}</span>
                      </div>
                    ) : null}
                  </>
                );
              })()}
            </section>
          ) : (
            <PropertiesPanel
              doc={doc}
              bus={busRef.current}
              fmtLen={(w) => fmtLen(doc, w)}
            />
          )}
          <section className="panel-section">
            <h2 className="panel-title">Object tools</h2>
            {selected[0]?.type === 'text' ? (
                  <button
                    type="button"
                    className="mini-btn block"
                    onClick={editSelectedText}
                  >
                    Edit text…
                  </button>
                ) : null}
                {selected[0]?.type === 'wall' ? (
                  <>
                    <button
                      type="button"
                      className="mini-btn block"
                      onClick={() => {
                        const wall = selected[0] as WallEntity;
                        if (!isEntityModifiable(doc, wall)) return;
                        const next = window.prompt(
                          `Wall thickness (${doc.settings.units})`,
                          String(wall.geometry.thickness),
                        );
                        if (next == null) return;
                        const n =
                          parseLengthInput(next, doc.settings.units, doc.settings.worldUnit ?? 'ft') ??
                          Number(next);
                        if (!(n > 0)) return;
                        busRef.current.execute(
                          new UpdateWallCommand(wall, { thickness: n }),
                        );
                      }}
                    >
                      Edit thickness…
                    </button>
                    <button
                      type="button"
                      className="mini-btn block"
                      onClick={() => {
                        const wall = selected[0] as WallEntity;
                        if (!isEntityModifiable(doc, wall)) return;
                        const next = window.prompt(
                          `Wall height (${doc.settings.units})`,
                          String(wall.geometry.height),
                        );
                        if (next == null) return;
                        const n =
                          parseLengthInput(next, doc.settings.units, doc.settings.worldUnit ?? 'ft') ??
                          Number(next);
                        if (!(n > 0)) return;
                        busRef.current.execute(
                          new UpdateWallCommand(wall, { height: n }),
                        );
                      }}
                    >
                      Edit height…
                    </button>
                    <button
                      type="button"
                      className="mini-btn block"
                      onClick={() => {
                        const wall = selected[0] as WallEntity;
                        if (!isEntityModifiable(doc, wall)) return;
                        const next = window.prompt(
                          'Wall material / type',
                          wall.properties.material ??
                            wall.properties.wallType ??
                            '',
                        );
                        if (next == null) return;
                        busRef.current.execute(
                          new UpdateWallCommand(wall, {
                            material: next.trim() || undefined,
                          }),
                        );
                      }}
                    >
                      Edit material…
                    </button>
                  </>
                ) : null}
                {selected[0]?.type === 'door' ? (
                  <>
                    <button
                      type="button"
                      className="mini-btn block"
                      onClick={() => {
                        const door = selected[0] as DoorEntity;
                        if (!isEntityModifiable(doc, door)) return;
                        const next = window.prompt(
                          `Door width (${doc.settings.units})`,
                          String(door.geometry.width),
                        );
                        if (next == null) return;
                        const n =
                          parseLengthInput(next, doc.settings.units, doc.settings.worldUnit ?? 'ft') ??
                          Number(next);
                        if (!(n > 0)) return;
                        busRef.current.execute(
                          new UpdateDoorCommand(door, { width: n }),
                        );
                      }}
                    >
                      Edit width…
                    </button>
                    <button
                      type="button"
                      className="mini-btn block"
                      onClick={() => {
                        const door = selected[0] as DoorEntity;
                        if (!isEntityModifiable(doc, door)) return;
                        const next = window.prompt(
                          'Swing (left/right)',
                          door.geometry.swing,
                        );
                        if (next == null) return;
                        const swing =
                          next.trim().toLowerCase() === 'right'
                            ? 'right'
                            : next.trim().toLowerCase() === 'left'
                              ? 'left'
                              : null;
                        if (!swing) return;
                        busRef.current.execute(
                          new UpdateDoorCommand(door, { swing }),
                        );
                      }}
                    >
                      Edit swing…
                    </button>
                  </>
                ) : null}
                {selected[0]?.type === 'window' ? (
                  <>
                    <button
                      type="button"
                      className="mini-btn block"
                      onClick={() => {
                        const win = selected[0] as WindowEntity;
                        if (!isEntityModifiable(doc, win)) return;
                        const next = window.prompt(
                          `Window width (${doc.settings.units})`,
                          String(win.geometry.width),
                        );
                        if (next == null) return;
                        const n =
                          parseLengthInput(next, doc.settings.units, doc.settings.worldUnit ?? 'ft') ??
                          Number(next);
                        if (!(n > 0)) return;
                        busRef.current.execute(
                          new UpdateWindowCommand(win, { width: n }),
                        );
                      }}
                    >
                      Edit width…
                    </button>
                    <button
                      type="button"
                      className="mini-btn block"
                      onClick={() => {
                        const win = selected[0] as WindowEntity;
                        if (!isEntityModifiable(doc, win)) return;
                        const next = window.prompt(
                          `Window height (${doc.settings.units})`,
                          String(win.geometry.height),
                        );
                        if (next == null) return;
                        const n =
                          parseLengthInput(next, doc.settings.units, doc.settings.worldUnit ?? 'ft') ??
                          Number(next);
                        if (!(n > 0)) return;
                        busRef.current.execute(
                          new UpdateWindowCommand(win, { height: n }),
                        );
                      }}
                    >
                      Edit height…
                    </button>
                  </>
                ) : null}
                {selected[0]?.type === 'room' ? (
                  <>
                    <button
                      type="button"
                      className="mini-btn block"
                      onClick={() => {
                        const room = selected[0] as RoomEntity;
                        if (!isEntityModifiable(doc, room)) return;
                        const next = window.prompt(
                          'Room name',
                          room.properties.name,
                        );
                        if (next == null) return;
                        busRef.current.execute(
                          new UpdateRoomCommand(room, { name: next }),
                        );
                      }}
                    >
                      Rename…
                    </button>
                    <button
                      type="button"
                      className="mini-btn block"
                      onClick={() => {
                        const room = selected[0] as RoomEntity;
                        if (!isEntityModifiable(doc, room)) return;
                        const next = window.prompt(
                          'Room type',
                          room.properties.roomType ?? 'general',
                        );
                        if (next == null) return;
                        busRef.current.execute(
                          new UpdateRoomCommand(room, {
                            roomType: next.trim() || 'general',
                          }),
                        );
                      }}
                    >
                      Edit type…
                    </button>
                  </>
                ) : null}
          </section>
        </aside>
      </div>

      <footer className="status-bar">
        <div className="status-left">
          <span className="workspace-mode-badge" data-mode={workspaceMode}>
            {(() => {
              if (workspaceMode === 'MODEL_SPACE') return 'MODEL SPACE';
              const layout = doc.layouts.find((l) => l.id === doc.activeLayoutId);
              if (workspaceMode === 'PAPER_SPACE') {
                return layout ? `PAPER SPACE · ${layout.name}` : 'PAPER SPACE';
              }
              const vpIndex =
                layout && activeViewportId
                  ? layout.viewports.findIndex((v) => v.id === activeViewportId)
                  : -1;
              return workspaceModeLabel(
                'VIEWPORT_MODEL_SPACE',
                layout?.name,
                vpIndex >= 0 ? vpIndex : 0,
              );
            })()}
          </span>
          {selectedViewportId && workspaceMode === 'PAPER_SPACE'
            ? (() => {
                const layout = doc.layouts.find(
                  (l) => l.id === doc.activeLayoutId,
                );
                const vp = layout?.viewports.find(
                  (v) => v.id === selectedViewportId,
                );
                const idx =
                  layout?.viewports.findIndex(
                    (v) => v.id === selectedViewportId,
                  ) ?? -1;
                return vp
                  ? ` · ${viewportStatusLine(vp, idx >= 0 ? idx : 0)}`
                  : '';
              })()
            : ''}
          {session.statusMessage ? ` · ${session.statusMessage}` : ''}
          {statusExtra &&
          !statusExtra.includes('SPACE') &&
          !statusExtra.startsWith('Viewport 1') &&
          !statusExtra.startsWith('Viewport 2') &&
          !/^Viewport \d+ ·/.test(statusExtra)
            ? ` · ${statusExtra}`
            : ''}
          {snapLabel ? ` · Snap: ${snapLabel}` : ''}
        </div>
        <div className="status-toggles" role="toolbar" aria-label="Drafting aids">
          <button
            type="button"
            className={`status-toggle${doc.settings.showGrid !== false ? ' active' : ''}`}
            data-testid="status-grid"
            aria-pressed={doc.settings.showGrid !== false}
            title="Grid display (F7) — show or hide the drafting grid"
            onClick={toggleGrid}
          >
            Grid
          </button>
          <button
            type="button"
            className={`status-toggle${doc.settings.snapToGrid ? ' active' : ''}`}
            data-testid="status-snap"
            aria-pressed={doc.settings.snapToGrid}
            title="Grid Snap (F3) — snap cursor to grid points (not object snap)"
            onClick={toggleSnap}
          >
            Snap
          </button>
          <button
            type="button"
            className={`status-toggle${orthoOn ? ' active' : ''}`}
            data-testid="status-ortho"
            aria-pressed={orthoOn}
            title="Ortho (F8) — constrain drawing to horizontal/vertical"
            onClick={toggleOrtho}
          >
            Ortho
          </button>
          <button
            type="button"
            className={`status-toggle${polarOn ? ' active' : ''}`}
            data-testid="status-polar"
            aria-pressed={polarOn}
            title={`Polar Tracking (F10) — ${polarIncrement}° increments (right-click cycles)`}
            onClick={togglePolar}
            onContextMenu={(e) => {
              e.preventDefault();
              cyclePolarIncrement();
            }}
          >
            Polar
          </button>
        </div>
        <div className="status-right">
          <span>
            X: <strong>{fmtLen(doc, cursorWorld.x)}</strong>
          </span>
          <span>
            Y: <strong>{fmtLen(doc, cursorWorld.y)}</strong>
          </span>
          <span>
            Zoom: <strong>{((camera.zoom / 40) * 100).toFixed(0)}%</strong>
          </span>
          <span>
            Units: <strong>{LENGTH_UNIT_LABELS[doc.settings.units]}</strong> · World: <strong>{doc.settings.worldUnit ?? 'ft'}</strong>
          </span>
          <span>
            Layer: <strong>{currentLayer?.name ?? '—'}</strong>
          </span>
        </div>
      </footer>
    </div>
  );
}
