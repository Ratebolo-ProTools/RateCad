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
  MoveViewportCommand,
  ResizeViewportCommand,
  SetCurrentLayerCommand,
  SetDrawingUnitsCommand,
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
  ensureLayouts,
  formatViewportScale,
  getEntity,
  getHostedByWall,
  getLayer,
  getSelectedEntities,
  getWall,
  hitTestViewport,
  hitTestViewportBoundary,
  isEntityModifiable,
  replaceViewport,
  setActiveLayout,
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
import { serializeDocument, tryParseDocument } from '@ratecad/io';
import {
  appendInputBuffer,
  CadCommandEngine,
  cancelTool,
  closeAreaTemporarily,
  commitLeaderContent,
  commitNumericInput,
  commitTextContent,
  createAreaLabel,
  createBoundaryFromArea,
  createDefaultEngineRegistry,
  createToolSession,
  finishAreaPoints,
  finishPolyline,
  formatRoomAreaReport,
  handleToolPointerDown,
  handleToolPointerMove,
  handleToolPointerUp,
  resolveKeyboardContextFromTarget,
  SelectionManager,
  setActiveTool,
  setAreaToolMode,
  setRectangleConstraints,
  spaceConfirmsCommand,
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
  createCamera,
  fitPaperInCanvas,
  getViewportGrips,
  hitTestViewportGrip,
  panCamera,
  panViewportModel,
  renderDocument,
  screenToPaper,
  screenToWorld,
  screenToleranceToWorld,
  zoomAtScreenPoint,
  zoomViewportScale,
  type Camera,
  type ViewportGripRole,
} from '@ratecad/viewport';
import './styles/app.css';

const DRAW_TOOLS: Array<{
  id: ToolId;
  label: string;
  glyph: string;
  dimKind?: DimensionKind;
}> = [
  { id: 'select', label: 'Select', glyph: '⌖' },
  { id: 'line', label: 'Line', glyph: '/' },
  { id: 'rectangle', label: 'Rect', glyph: '▭' },
  { id: 'circle', label: 'Circle', glyph: '○' },
  { id: 'polyline', label: 'PLine', glyph: '⌇' },
  { id: 'dimension', label: 'DimH', glyph: '↔', dimKind: 'horizontal' },
  { id: 'dimension', label: 'DimV', glyph: '↕', dimKind: 'vertical' },
  { id: 'dimension', label: 'DimA', glyph: '⤡', dimKind: 'aligned' },
  { id: 'dimension', label: 'DimR', glyph: '⌒', dimKind: 'radius' },
  { id: 'dimension', label: 'DimØ', glyph: '⌀', dimKind: 'diameter' },
  { id: 'dimension', label: 'Dim∠', glyph: '∠', dimKind: 'angular' },
  { id: 'text', label: 'Text', glyph: 'T' },
  { id: 'leader', label: 'Leader', glyph: '⤷' },
  { id: 'wall', label: 'Wall', glyph: '▮' },
  { id: 'door', label: 'Door', glyph: '⊓' },
  { id: 'window', label: 'Window', glyph: '▤' },
  { id: 'room', label: 'Room', glyph: '⌂' },
  { id: 'area', label: 'Area', glyph: '◻' },
  { id: 'move', label: 'Move', glyph: '↔' },
  { id: 'copy', label: 'Copy', glyph: '⧉' },
  { id: 'trim', label: 'Trim', glyph: '✂' },
  { id: 'fillet', label: 'Fillet', glyph: '◠' },
  { id: 'extend', label: 'Extend', glyph: '⟶' },
  { id: 'offset', label: 'Offset', glyph: '∥' },
  { id: 'mirror', label: 'Mirror', glyph: '⊳⊲' },
  { id: 'rotate', label: 'Rotate', glyph: '↻' },
  { id: 'scale', label: 'Scale', glyph: '⤢' },
  { id: 'pan', label: 'Pan', glyph: '✥' },
];

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

function createBus(): CommandBus {
  return new CommandBus(
    ensureLayouts(createEmptyDocument('Untitled Drawing')),
  );
}

function basename(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || filePath;
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
      return [
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
      ];
    }
    case 'text':
      return [
        ...common,
        { label: 'Content', value: entity.geometry.content },
        { label: 'Size', value: formatLength(entity.geometry.height) },
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
  const sessionRef = useRef<ToolSession>(createToolSession('select'));
  const workspaceModeRef = useRef<WorkspaceMode>('MODEL_SPACE');
  const activeViewportIdRef = useRef<ViewportId | null>(null);
  const isPanningRef = useRef(false);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const spaceDownRef = useRef(false);
  const filePathRef = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  const suppressDirtyRef = useRef(false);
  const rafPanRef = useRef<number | null>(null);
  const pendingPanRef = useRef<{ dx: number; dy: number } | null>(null);
  const commandLineRef = useRef('');
  const commandInputRef = useRef<HTMLInputElement | null>(null);
  const cursorWorldRef = useRef({ x: 0, y: 0 });
  const engineRef = useRef<CadCommandEngine | null>(null);
  const selectionManagerRef = useRef<SelectionManager | null>(null);
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
  const [polarOn, setPolarOn] = useState(false);
  const [polarIncrement, setPolarIncrement] = useState(90);

  const syncSession = useCallback((next: ToolSession) => {
    sessionRef.current = next;
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
    setCamera(next);
  }, []);

  const markDirty = useCallback((value: boolean) => {
    dirtyRef.current = value;
    setDirty(value);
  }, []);

  const setProjectPath = useCallback((path: string | null) => {
    filePathRef.current = path;
    setFilePath(path);
  }, []);

  useEffect(() => {
    return busRef.current.subscribe((next) => {
      setDoc(next);
      setCanUndo(busRef.current.canUndo());
      setCanRedo(busRef.current.canRedo());
      if (!suppressDirtyRef.current) {
        markDirty(true);
      }
    });
  }, [markDirty]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize({
        width: Math.max(1, Math.floor(width)),
        height: Math.max(1, Math.floor(height)),
      });
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
      snap: inPaper ? null : sess.lastSnap,
      hoveredEntityId: hoveredId,
      paperSpaceLayout: inPaper ? activeLayout : null,
      workspaceMode,
      activeViewportId,
      selectedViewportId,
      paperPreviewRect: paperPreviewFromEngine,
      viewportPreviewOverride: drag?.preview ?? null,
    });
  }, [
    doc,
    session,
    camera,
    size,
    cursorWorld,
    engineUi,
    hoveredId,
    workspaceMode,
    activeViewportId,
    selectedViewportId,
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
    const layout = next.layouts.find((l) => l.id === layoutId);
    setStatusExtra(layout ? `PAPER SPACE · ${layout.name}` : 'PAPER SPACE');
    setDirty(true);
    dirtyRef.current = true;
  }, []);

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
      const view = fitPaperInCanvas(
        layout.pageSettings,
        size.width,
        size.height,
      );
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

  // Create command engine once (host uses refs for live document/cursor).
  useEffect(() => {
    selectionManagerRef.current = new SelectionManager(busRef.current);
    const host = {
      getUnits: () => busRef.current.getDocument().settings.units,
      getWorldUnit: () =>
        busRef.current.getDocument().settings.worldUnit ?? 'ft',
      getSelectedIds: () => busRef.current.getDocument().selection,
      getCursor: () => cursorWorldRef.current,
      activateTool: (tool: string) => {
        activateToolOnly(tool as ToolId);
      },
      activateSelect: () => {
        activateToolOnly('select');
      },
      clearSelection: () => {
        busRef.current.updateWithoutHistory((d) => clearSelection(d));
        setDoc(busRef.current.getDocument());
        hoveredIdRef.current = null;
        setHoveredId(null);
      },
      onNaturalLanguage: (text: string) => {
        setCommandFeedback(`AI (NL): ${text}`);
      },
    };
    engineRef.current = new CadCommandEngine(
      createDefaultEngineRegistry(),
      busRef.current,
      host,
    );
    refreshEngineUi();
  }, [activateToolOnly, refreshEngineUi]);

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
    if (!dirtyRef.current) return Promise.resolve(true);
    return new Promise((resolve) => {
      setDiscardPrompt({ resolve });
    });
  }, []);

  const newDrawing = useCallback(async () => {
    if (!(await confirmDiscardIfNeeded())) return;
    suppressDirtyRef.current = true;
    busRef.current.reset(
      ensureLayouts(createEmptyDocument('Untitled Drawing')),
    );
    workspaceModeRef.current = 'MODEL_SPACE';
    setWorkspaceMode('MODEL_SPACE');
    setActiveViewportId(null);
    setSelectedViewportId(null);
    markDirty(false);
    suppressDirtyRef.current = false;
    setProjectPath(null);
    syncSession(createToolSession('select'));
    syncCamera(createCamera());
    setStatusExtra(null);
  }, [confirmDiscardIfNeeded, markDirty, setProjectPath, syncCamera, syncSession]);

  const saveDrawing = useCallback(
    async (forceDialog = false) => {
      const api = window.ratecadDesktop;
      const contents = serializeDocument(busRef.current.getDocument());
      const defaultName = `${busRef.current.getDocument().meta.name || 'Untitled'}.ratecad`;
      setStatusExtra('Saving…');

      const finishLocalSave = (savedPath: string) => {
        setProjectPath(savedPath);
        const name = basename(savedPath).replace(/\.ratecad$/i, '');
        suppressDirtyRef.current = true;
        busRef.current.updateWithoutHistory((d) => ({
          ...d,
          meta: { ...d.meta, name, updatedAt: new Date().toISOString() },
        }));
        markDirty(false);
        suppressDirtyRef.current = false;
        setStatusExtra(`Saved ${basename(savedPath)}`);
      };

      // Fast path: existing path and not Save As
      if (api?.quickSave && (!filePathRef.current || forceDialog === false) && filePathRef.current) {
        const result = await api.saveDrawing({
          contents,
          filePath: filePathRef.current,
          forceDialog: false,
        });
        if (result.filePath) {
          finishLocalSave(result.filePath);
          return;
        }
      }

      if (!api?.saveDrawing && !api?.quickSave) {
        const blob = new Blob([contents], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = defaultName;
        a.click();
        URL.revokeObjectURL(url);
        finishLocalSave(defaultName);
        return;
      }

      try {
        // Prefer native dialog (with main-process timeout → Documents fallback)
        if (api?.saveDrawing) {
          const result = await api.saveDrawing({
            contents,
            filePath: forceDialog ? null : filePathRef.current,
            defaultPath: defaultName,
            forceDialog: forceDialog || !filePathRef.current,
          });
          if (result.canceled) {
            setStatusExtra('Save canceled');
            return;
          }
          if (result.error) {
            // Fall through to quickSave
            setStatusExtra(`Dialog: ${result.error}`);
          } else if (result.filePath) {
            finishLocalSave(result.filePath);
            return;
          }
        }

        if (api?.quickSave) {
          const quick = await api.quickSave({
            contents,
            preferredName: defaultName,
          });
          if (quick.filePath) {
            finishLocalSave(quick.filePath);
            return;
          }
          setStatusExtra(`Save failed: ${quick.error ?? 'unknown'}`);
        }
      } catch (err) {
        setStatusExtra(
          `Save failed: ${err instanceof Error ? err.message : 'unknown'}`,
        );
      }
    },
    [markDirty, setProjectPath],
  );

  const openDrawing = useCallback(async () => {
    if (!(await confirmDiscardIfNeeded())) return;
    const api = window.ratecadDesktop;

    const applyOpened = (contents: string, path?: string) => {
      const parsed = tryParseDocument(contents);
      if (!parsed.ok) {
        setStatusExtra(`Invalid file: ${parsed.error}`);
        return;
      }
      suppressDirtyRef.current = true;
      const opened = ensureLayouts(parsed.document);
      busRef.current.reset(opened);
      setProjectPath(path ?? null);
      markDirty(false);
      suppressDirtyRef.current = false;
      syncSession(createToolSession('select'));
      syncCamera(createCamera());
      modelCameraRef.current = createCamera();
      workspaceModeRef.current =
        opened.activeLayoutId == null ? 'MODEL_SPACE' : 'PAPER_SPACE';
      setWorkspaceMode(workspaceModeRef.current);
      setActiveViewportId(null);
      setSelectedViewportId(null);
      setStatusExtra(path ? `Opened ${basename(path)}` : 'Opened drawing');
    };

    const fileInputFallback = () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.ratecad,application/json';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
          const text = await file.text();
          applyOpened(text, file.name);
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
      applyOpened(result.contents, result.filePath);
    } catch (err) {
      setStatusExtra(
        `Open failed: ${err instanceof Error ? err.message : 'unknown'} — file picker`,
      );
      fileInputFallback();
    }
  }, [
    confirmDiscardIfNeeded,
    markDirty,
    setProjectPath,
    syncCamera,
    syncSession,
  ]);

  const deleteSelection = useCallback(() => {
    const doc = busRef.current.getDocument();
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
  }, []);

  const undo = useCallback(() => busRef.current.undo(), []);
  const redo = useCallback(() => busRef.current.redo(), []);

  const toggleSnap = useCallback(() => {
    busRef.current.updateWithoutHistory((d) => ({
      ...d,
      settings: { ...d.settings, snapToGrid: !d.settings.snapToGrid },
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
          eng.cancel(true);
          if (inProgress) syncSession(cancelTool(s));
          refreshEngineUi();
          setCommandFeedback('Select');
          return;
        }
        if (inProgress) {
          syncSession(cancelTool(s));
          activateToolOnly('select');
          setCommandFeedback('Select');
          return;
        }
        // 2) Engine ESC: clear buffer → clear selection → idle pointer
        const action = eng?.handleEscape() ?? { kind: 'idle' as const };
        clearCommandLine();
        refreshEngineUi();
        if (action.kind === 'clear-selection' || action.kind === 'idle') {
          activateToolOnly('select');
        }
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
            syncSession(finishAreaPoints(s, busRef.current));
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

    // PAPER_SPACE: do not pan the global model camera (sheet is fitted).
    if (workspaceModeRef.current === 'PAPER_SPACE') {
      return;
    }

    syncCamera(panCamera(cameraRef.current, pending.dx, pending.dy));
  }, [size.height, size.width, syncCamera]);

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
      if (workspaceModeRef.current === 'PAPER_SPACE') {
        // Paper sheet is fitted — no free pan of the desk (viewport move is separate).
        return;
      }
      canvas.setPointerCapture(event.pointerId);
      isPanningRef.current = true;
      lastPointerRef.current = { x: event.clientX, y: event.clientY };
      return;
    }

    if (event.button !== 0) return;

    // Paper Space: viewport select / move / resize, or MVIEW points.
    if (workspaceModeRef.current === 'PAPER_SPACE') {
      const d = busRef.current.getDocument();
      const layout = d.layouts.find((l) => l.id === d.activeLayoutId);
      if (!layout) return;
      const screen = getScreenFromEvent(event);
      const view = fitPaperInCanvas(
        layout.pageSettings,
        size.width,
        size.height,
      );
      const paper = screenToPaper(screen, view);
      const eng = engineRef.current;

      // MVIEW (and any running paper command) — feed paper coordinates.
      if (eng?.isRunning()) {
        eng.submitPoint(paper, { shiftKey: event.shiftKey });
        refreshEngineUi();
        bumpVpDrag();
        return;
      }

      // Resize grips on selected viewport
      if (selectedViewportId) {
        const selected = layout.viewports.find((v) => v.id === selectedViewportId);
        if (selected) {
          const grips = getViewportGrips(selected, view);
          const grip = hitTestViewportGrip(grips, screen, 8);
          if (grip) {
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

      // Prefer boundary hit, then interior (paper space never selects model ents).
      const boundaryTol =
        (8 / Math.max(1e-6, view.pxPerMm)) /
        (layout.pageSettings.units === 'inch' ? 25.4 : 1);
      const boundary = hitTestViewportBoundary(
        layout,
        paper.x,
        paper.y,
        Math.max(2, boundaryTol),
      );
      const hit = boundary ?? hitTestViewport(layout, paper.x, paper.y);
      setSelectedViewportId(hit?.id ?? null);
      if (hit) {
        // Clear model selection so properties show viewport
        busRef.current.updateWithoutHistory((doc) => clearSelection(doc));
        const idx = layout.viewports.findIndex((v) => v.id === hit.id);
        setStatusExtra(viewportStatusLine(hit, idx >= 0 ? idx : 0));
        // Start move drag from interior / boundary
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
      } else {
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
    });
    if (next.mode === 'grip' || next.mode === 'window') {
      canvas.setPointerCapture(event.pointerId);
    }
    syncSession(next);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
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

    // Hover / preselection when idle pointer (select) mode
    if (sessionRef.current.activeTool === 'select' && sessionRef.current.mode === 'idle') {
      const tol = screenToleranceToWorld(getActiveInteractionCamera(), 8);
      const sm = selectionManagerRef.current;
      const id = sm
        ? sm.updateHover(world, tol)
        : null;
      if (id !== hoveredIdRef.current) {
        hoveredIdRef.current = id;
        setHoveredId(id);
      }
    } else if (hoveredIdRef.current) {
      hoveredIdRef.current = null;
      setHoveredId(null);
      selectionManagerRef.current?.setHovered(null);
    }

    const next = handleToolPointerMove(sessionRef.current, busRef.current, {
      world,
      camera: getActiveInteractionCamera(),
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
    });
    if (next !== sessionRef.current) {
      syncSession(next);
    }
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const wasPanning = isPanningRef.current;
    isPanningRef.current = false;
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
        } else {
          busRef.current.execute(
            new ResizeViewportCommand(drag.layoutId, drag.original, {
              x: drag.preview.x,
              y: drag.preview.y,
              width: drag.preview.width,
              height: drag.preview.height,
            }),
          );
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

    if (workspaceModeRef.current === 'PAPER_SPACE') {
      // Sheet is fitted — wheel does not zoom paper (viewport scale is explicit).
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
  const snapLabel = session.lastSnap?.snapped ? session.lastSnap.label : null;
  const currentLayer = getLayer(doc, doc.currentLayerId) ?? doc.layers[0];
  const showTextDialog = session.mode === 'text-input';

  const isToolActive = (tool: (typeof DRAW_TOOLS)[number]) => {
    if (tool.id !== session.activeTool) return false;
    if (tool.id === 'dimension' && tool.dimKind) {
      return session.dimKind === tool.dimKind;
    }
    return true;
  };

  const canvasClass = [
    'viewport-canvas',
    session.activeTool === 'pan' || spaceDownRef.current ? 'pan-ready' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="app-shell">
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
      <header className="menu-bar">
        <div className="brand">
          <span className="brand-name">RateCAD</span>
          <span className="brand-tag">2D Drafting</span>
        </div>
        <div className="doc-title" title={filePath ?? undefined}>
          {displayName}
        </div>
        <div className="menu-actions">
          <button type="button" data-testid="btn-new" onClick={() => void newDrawing()}>
            New
          </button>
          <button type="button" data-testid="btn-open" onClick={() => void openDrawing()}>
            Open
          </button>
          <button type="button" data-testid="btn-save" onClick={() => void saveDrawing(false)}>
            Save
          </button>
          <button type="button" data-testid="btn-save-as" onClick={() => void saveDrawing(true)}>
            Save As
          </button>
          <button type="button" onClick={undo} disabled={!canUndo}>
            Undo
          </button>
          <button type="button" onClick={redo} disabled={!canRedo}>
            Redo
          </button>
          <button
            type="button"
            onClick={deleteSelection}
            disabled={doc.selection.length === 0}
          >
            Delete
          </button>
          <button
            type="button"
            className={doc.settings.snapToGrid ? 'active-toggle' : ''}
            onClick={toggleSnap}
            title="Toggle snap (F3)"
          >
            Snap
          </button>
          <button
            type="button"
            className={orthoOn ? 'active-toggle' : ''}
            onClick={toggleOrtho}
            title="Toggle Ortho (F8)"
          >
            Ortho
          </button>
          <button
            type="button"
            className={polarOn ? 'active-toggle' : ''}
            onClick={togglePolar}
            onContextMenu={(e) => {
              e.preventDefault();
              cyclePolarIncrement();
            }}
            title={`Toggle Polar (F10) · increment ${polarIncrement}° (right-click to cycle)`}
          >
            Polar {polarIncrement}°
          </button>
        </div>
      </header>

      <div className="tool-ribbon">
        <div className="tool-group">
          {DRAW_TOOLS.map((tool) => (
            <button
              key={`${tool.id}-${tool.dimKind ?? tool.label}`}
              type="button"
              data-testid={`tool-${tool.id}${tool.dimKind ? `-${tool.dimKind}` : ''}`}
              className={`tool-btn${isToolActive(tool) ? ' active' : ''}`}
              onClick={(event) => {
                event.stopPropagation();
                activateTool(tool.id, tool.dimKind);
              }}
            >
              {tool.label}
            </button>
          ))}
        </div>
        <div className="tool-group measure-group" aria-label="Measure">
          <span className="tool-group-label">Measure</span>
          <button
            type="button"
            data-testid="measure-area"
            className={`tool-btn${session.activeTool === 'area' ? ' active' : ''}`}
            onClick={() => activateAreaMode('object')}
            title="AREA"
          >
            Area
          </button>
          {session.activeTool === 'area' ? (
            <>
              {(
                [
                  ['object', 'Object'],
                  ['points', 'Points'],
                  ['pick-inside', 'Pick Inside'],
                  ['add', 'Add'],
                  ['subtract', 'Subtract'],
                  ['room', 'Room'],
                ] as Array<[AreaToolMode, string]>
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  data-testid={`area-mode-${mode}`}
                  className={`tool-btn${session.areaMode === mode ? ' active' : ''}`}
                  onClick={() => activateAreaMode(mode)}
                >
                  {label}
                </button>
              ))}
              {session.areaLastResult ? (
                <>
                  <button
                    type="button"
                    className="tool-btn"
                    onClick={() =>
                      syncSession(
                        createBoundaryFromArea(sessionRef.current, busRef.current),
                      )
                    }
                  >
                    Create Boundary
                  </button>
                  <button
                    type="button"
                    className="tool-btn"
                    onClick={() =>
                      syncSession(
                        createAreaLabel(sessionRef.current, busRef.current),
                      )
                    }
                  >
                    Area Label
                  </button>
                </>
              ) : null}
              <button
                type="button"
                className="tool-btn"
                onClick={() => {
                  const lines = formatRoomAreaReport(busRef.current.getDocument());
                  setCommandFeedback(lines.join(' · '));
                }}
                title="Report all room areas"
              >
                All Rooms
              </button>
            </>
          ) : null}
        </div>
      </div>

      <div className="workspace">
        <aside className="left-rail" aria-label="Tools">
          {DRAW_TOOLS.map((tool) => (
            <button
              key={`rail-${tool.id}-${tool.dimKind ?? tool.label}`}
              type="button"
              className={`rail-btn${isToolActive(tool) ? ' active' : ''}`}
              onClick={(event) => {
                event.stopPropagation();
                activateTool(tool.id, tool.dimKind);
              }}
              title={tool.label}
            >
              <span className="glyph">{tool.glyph}</span>
              <span>{tool.label}</span>
            </button>
          ))}
        </aside>

        <main className="viewport-wrap" ref={wrapRef}>
          <canvas
            ref={canvasRef}
            data-cad-canvas="1"
            className={canvasClass}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
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
              <label>File</label>
              <div className="value">
                {filePath ? basename(filePath) : '(unsaved)'}
              </div>
            </div>
            <div className="prop-row">
              <label>Entities</label>
              <div className="value">{doc.entities.length}</div>
            </div>
            <div className="prop-row">
              <label>TRIM Mode</label>
              <select
                className="prop-select"
                value={doc.settings.trimMode ?? 'quick'}
                onChange={(e) => {
                  const trimMode = e.target.value === 'standard' ? 'standard' : 'quick';
                  busRef.current.updateWithoutHistory((d) => ({
                    ...d,
                    settings: { ...d.settings, trimMode },
                    meta: { ...d.meta, updatedAt: new Date().toISOString() },
                  }));
                }}
                aria-label="TRIM mode Quick or Standard"
              >
                <option value="quick">Quick</option>
                <option value="standard">Standard</option>
              </select>
            </div>
            <div className="prop-row">
              <label>Edge Mode</label>
              <select
                className="prop-select"
                value={doc.settings.edgeMode ?? 'no-extend'}
                onChange={(e) => {
                  const edgeMode =
                    e.target.value === 'extend' ? 'extend' : 'no-extend';
                  busRef.current.updateWithoutHistory((d) => ({
                    ...d,
                    settings: { ...d.settings, edgeMode },
                    meta: { ...d.meta, updatedAt: new Date().toISOString() },
                  }));
                }}
                aria-label="TRIM edge mode"
              >
                <option value="no-extend">No Extend</option>
                <option value="extend">Extend</option>
              </select>
            </div>
            <div className="prop-row">
              <label>Fillet Trim</label>
              <select
                className="prop-select"
                value={doc.settings.filletTrim === false ? 'off' : 'on'}
                onChange={(e) => {
                  const filletTrim = e.target.value !== 'off';
                  busRef.current.updateWithoutHistory((d) => ({
                    ...d,
                    settings: { ...d.settings, filletTrim },
                    meta: { ...d.meta, updatedAt: new Date().toISOString() },
                  }));
                }}
                aria-label="FILLET trim mode"
              >
                <option value="on">ON</option>
                <option value="off">OFF</option>
              </select>
            </div>
            <div className="prop-row">
              <label>Linear Unit</label>
              <select
                className="prop-select"
                value={doc.settings.units}
                onChange={(e) => setUnits(e.target.value as LengthUnit)}
                aria-label="Drawing display units"
              >
                {UNIT_OPTIONS.map((u) => (
                  <option key={u} value={u}>
                    {LENGTH_UNIT_LABELS[u]}
                  </option>
                ))}
              </select>
            </div>
            <div className="prop-row">
              <label>Precision</label>
              {doc.settings.units === 'ft-in' ? (
                <select
                  className="prop-select"
                  value={String(doc.settings.fractionDenominator ?? 16)}
                  onChange={(e) =>
                    setFractionDenominator(Number(e.target.value))
                  }
                  aria-label="Architectural fraction precision"
                >
                  {[1, 2, 4, 8, 16, 32].map((d) => (
                    <option key={d} value={d}>
                      {d === 1 ? `1"` : `1/${d}"`}
                    </option>
                  ))}
                </select>
              ) : (
                <select
                  className="prop-select"
                  value={String(doc.settings.precision)}
                  onChange={(e) => setPrecision(Number(e.target.value))}
                  aria-label="Decimal precision"
                >
                  {[0, 1, 2, 3, 4].map((d) => (
                    <option key={d} value={d}>
                      {d === 0 ? '0' : `0.${'0'.repeat(d)}`}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="prop-row">
              <label>World</label>
              <div className="value">{doc.settings.worldUnit ?? 'ft'}</div>
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
            <div className="prop-row">
              <label>Grid</label>
              <div className="value">{doc.settings.gridSize}</div>
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
              <label>Current</label>
              <div className="value">{currentLayer?.name ?? '—'}</div>
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

          {selectedViewportId &&
          doc.activeLayoutId &&
          workspaceMode !== 'MODEL_SPACE' &&
          selected.length === 0 ? (
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
          !statusExtra.startsWith('Viewport')
            ? ` · ${statusExtra}`
            : ''}
          {snapLabel ? ` · Snap: ${snapLabel}` : ''}
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
          <span>
            Snap: <strong>{doc.settings.snapToGrid ? 'ON' : 'OFF'}</strong>
          </span>
        </div>
      </footer>
    </div>
  );
}
