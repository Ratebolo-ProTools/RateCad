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
  createEmptyDocument,
  getEntity,
  getHostedByWall,
  getLayer,
  getSelectedEntities,
  getWall,
  isEntityModifiable,
  type DimensionKind,
  type DoorEntity,
  type DrawingDocument,
  type Entity,
  type Layer,
  type LengthUnit,
  type RoomEntity,
  type TextEntity,
  type WallEntity,
  type WindowEntity,
} from '@ratecad/core';
import {
  findDoorsForRoom,
  findWallsForRoom,
  findWindowsForRoom,
  formatAreaInUnits,
  formatLength,
  formatLengthInUnits,
  LENGTH_UNIT_LABELS,
  measuredLength,
  parseLengthInput,
  PolarTrackingEngine,
  resolveSnap,
  SUPPORTED_LENGTH_UNITS,
  suggestedGridSize,
  toMillimeters,
  wallLength,
} from '@ratecad/geometry';
import { serializeDocument, tryParseDocument } from '@ratecad/io';
import {
  appendInputBuffer,
  CadCommandEngine,
  cancelTool,
  commitLeaderContent,
  commitNumericInput,
  commitTextContent,
  createDefaultEngineRegistry,
  createToolSession,
  finishPolyline,
  handleToolPointerDown,
  handleToolPointerMove,
  handleToolPointerUp,
  setActiveTool,
  setRectangleConstraints,
  type CadCommandUiState,
  type ToolId,
  type ToolSession,
} from '@ratecad/tools';
import {
  createCamera,
  panCamera,
  renderDocument,
  screenToWorld,
  screenToleranceToWorld,
  zoomAtScreenPoint,
  type Camera,
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
  { id: 'move', label: 'Move', glyph: '↔' },
  { id: 'copy', label: 'Copy', glyph: '⧉' },
  { id: 'trim', label: 'Trim', glyph: '✂' },
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
  return new CommandBus(createEmptyDocument('Untitled Drawing'));
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
  const sessionRef = useRef<ToolSession>(createToolSession('line'));
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

  const [doc, setDoc] = useState<DrawingDocument>(() => busRef.current.getDocument());
  const [session, setSession] = useState<ToolSession>(() => sessionRef.current);
  const [camera, setCamera] = useState<Camera>(() => cameraRef.current);
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
    renderDocument(ctx, {
      width: size.width,
      height: size.height,
      camera: cameraRef.current,
      document: doc,
      preview: engUi?.preview ?? sess.preview,
      previewEntities: engUi?.previewEntities ?? sess.previewEntities,
      selectionRect: sess.selectionRect,
      hideEntityIds: engUi?.hideEntityIds?.length
        ? engUi.hideEntityIds
        : sess.hideEntityIds,
      cursorWorld,
      snap: sess.lastSnap,
    });
  }, [doc, session, camera, size, cursorWorld, engineUi]);

  useEffect(() => {
    const name = doc.meta.name + (dirty ? ' *' : '');
    document.title = `${name} — RateCAD`;
  }, [doc.meta.name, dirty]);

  const getWorldFromEvent = useCallback(
    (event: { clientX: number; clientY: number }) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      const screen = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      return screenToWorld(screen, cameraRef.current, size.width, size.height);
    },
    [size.height, size.width],
  );

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
        'extend',
        'offset',
        'mirror',
        'rotate',
        'scale',
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
    },
    [activateToolOnly, refreshEngineUi],
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
    busRef.current.reset(createEmptyDocument('Untitled Drawing'));
    markDirty(false);
    suppressDirtyRef.current = false;
    setProjectPath(null);
    syncSession(createToolSession('line'));
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
      busRef.current.reset(parsed.document);
      setProjectPath(path ?? null);
      markDirty(false);
      suppressDirtyRef.current = false;
      syncSession(createToolSession('select'));
      syncCamera(createCamera());
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
      const tag = target?.tagName;
      const isEditable =
        (tag === 'INPUT' || tag === 'TEXTAREA') &&
        !(target as HTMLInputElement | HTMLTextAreaElement).disabled;
      const inField = !!isEditable;
      const isCadCommandField =
        target?.dataset?.cadCommand === '1' ||
        target?.dataset?.cadRectDim === '1';

      if (event.code === 'Space' && !inField) {
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
        const eng = engineRef.current;
        if (eng?.isRunning()) {
          eng.cancel(true);
          refreshEngineUi();
          setCommandFeedback('Select');
          return;
        }
        clearCommandLine();
        setCommandFeedback(null);
        if (sessionRef.current.mode === 'text-input') {
          cancelTextPrompt();
          return;
        }
        const s = sessionRef.current;
        const inProgress =
          s.mode !== 'idle' ||
          !!s.anchor ||
          s.vertices.length > 0 ||
          !!s.grip ||
          !!s.previewEntities ||
          !!s.selectionRect ||
          !!s.refEntityId ||
          s.inputBuffer.length > 0;
        if (inProgress) {
          syncSession(cancelTool(s));
        }
        activateToolOnly('select');
        setCommandFeedback('Select');
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
        const eng = engineRef.current;
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
        if (s.activeTool === 'polyline') {
          syncSession(finishPolyline(s, busRef.current));
          return;
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
        engineRef.current?.historyUp();
        refreshEngineUi();
        return;
      }
      if (event.key === 'ArrowDown' && !inField) {
        event.preventDefault();
        engineRef.current?.historyDown();
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
    syncCamera(panCamera(cameraRef.current, pending.dx, pending.dy));
  }, [syncCamera]);

  const snapWorld = useCallback(
    (world: { x: number; y: number }) => {
      const d = busRef.current.getDocument();
      const snap = resolveSnap(world, d, {
        enabled: d.settings.snapToGrid,
        gridSize: d.settings.gridSize,
        tolerance: screenToleranceToWorld(cameraRef.current, 10),
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
    [orthoOn, polarOn, polarIncrement],
  );

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const panMode =
      sessionRef.current.activeTool === 'pan' ||
      spaceDownRef.current ||
      event.button === 1;

    if (panMode) {
      canvas.setPointerCapture(event.pointerId);
      isPanningRef.current = true;
      lastPointerRef.current = { x: event.clientX, y: event.clientY };
      return;
    }

    if (event.button !== 0) return;

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
        camera: cameraRef.current,
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
      eng.submitPoint(snap.point);
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
      camera: cameraRef.current,
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
        camera: cameraRef.current,
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

    const next = handleToolPointerMove(sessionRef.current, busRef.current, {
      world,
      camera: cameraRef.current,
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
    if (wasPanning || event.button !== 0) return;

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
        camera: cameraRef.current,
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
      camera: cameraRef.current,
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
    const rect = canvas.getBoundingClientRect();
    const screen = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
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
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-panel">
            <h3>{session.activeTool === 'leader' ? 'Leader text' : 'Text'}</h3>
            <p>Enter annotation content, then confirm.</p>
            <input
              ref={textInputRef}
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
            className={canvasClass}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onWheel={onWheel}
            onContextMenu={(e) => e.preventDefault()}
            onDoubleClick={(e) => {
              e.preventDefault();
              editSelectedText();
            }}
          />
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
                    engineRef.current?.historyUp();
                    refreshEngineUi();
                  } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    engineRef.current?.historyDown();
                    refreshEngineUi();
                  }
                }}
                placeholder="Type command (REC, L, …) — Enter/Space"
                aria-label="CAD command"
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
            {engineUi?.suggestions?.length ? (
              <div className="command-suggestions">
                {engineUi.suggestions.map((s, i) => (
                  <button
                    key={s}
                    type="button"
                    className={
                      i === engineUi.suggestionIndex
                        ? 'cmd-suggest active'
                        : 'cmd-suggest'
                    }
                    onClick={() => {
                      engineRef.current?.setBuffer(s);
                      refreshEngineUi();
                    }}
                  >
                    {s}
                  </button>
                ))}
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

          <section className="panel-section">
            <h2 className="panel-title">Properties</h2>
            {multiSelectLabel ? (
              <p className="empty-props">{multiSelectLabel}</p>
            ) : selectedProps ? (
              <>
                {selectedProps.map((row) => (
                  <div className="prop-row" key={row.label}>
                    <label>{row.label}</label>
                    <div className="value">{row.value}</div>
                  </div>
                ))}
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
              </>
            ) : (
              <p className="empty-props">
                Select an object to inspect its properties. Drag grips to edit;
                use Move / Copy for transforms.
              </p>
            )}
          </section>
        </aside>
      </div>

      <footer className="status-bar">
        <div className="status-left">
          {session.statusMessage}
          {statusExtra ? ` · ${statusExtra}` : ''}
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
