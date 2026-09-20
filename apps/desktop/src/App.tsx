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
  CreateLayerCommand,
  DeleteEntitiesCommand,
  DeleteLayerCommand,
  SetCurrentLayerCommand,
  UpdateLayerCommand,
  UpdateTextCommand,
} from '@ratecad/commands';
import {
  createEmptyDocument,
  getLayer,
  getSelectedEntities,
  isEntityModifiable,
  type DimensionKind,
  type DrawingDocument,
  type Entity,
  type Layer,
  type LengthUnit,
  type TextEntity,
} from '@ratecad/core';
import { formatLength, formatLengthInUnits, measuredLength } from '@ratecad/geometry';
import { serializeDocument, tryParseDocument } from '@ratecad/io';
import {
  appendInputBuffer,
  cancelTool,
  commitLeaderContent,
  commitNumericInput,
  commitTextContent,
  createToolSession,
  finishPolyline,
  handleToolPointerDown,
  handleToolPointerMove,
  handleToolPointerUp,
  setActiveTool,
  type ToolId,
  type ToolSession,
} from '@ratecad/tools';
import {
  createCamera,
  panCamera,
  renderDocument,
  screenToWorld,
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
  { id: 'text', label: 'Text', glyph: 'T' },
  { id: 'leader', label: 'Leader', glyph: '⤷' },
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

const COMMAND_ALIASES: Record<string, ToolId> = {
  tr: 'trim',
  ex: 'extend',
  o: 'offset',
  mi: 'mirror',
  ro: 'rotate',
  sc: 'scale',
  di: 'dimension',
  le: 'leader',
};

const UNIT_OPTIONS: LengthUnit[] = ['ft', 'in', 'm', 'mm'];

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
          label: 'Start',
          value: `${formatLength(entity.geometry.start.x)}, ${formatLength(entity.geometry.start.y)}`,
        },
        {
          label: 'End',
          value: `${formatLength(entity.geometry.end.x)}, ${formatLength(entity.geometry.end.y)}`,
        },
      ];
    case 'rectangle':
      return [
        ...common,
        {
          label: 'Corner1',
          value: `${formatLength(entity.geometry.corner1.x)}, ${formatLength(entity.geometry.corner1.y)}`,
        },
        {
          label: 'Corner2',
          value: `${formatLength(entity.geometry.corner2.x)}, ${formatLength(entity.geometry.corner2.y)}`,
        },
      ];
    case 'circle':
      return [
        ...common,
        {
          label: 'Center',
          value: `${formatLength(entity.geometry.center.x)}, ${formatLength(entity.geometry.center.y)}`,
        },
        { label: 'Radius', value: formatLength(entity.geometry.radius) },
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
  const commandAliasRef = useRef('');
  const commandAliasTimerRef = useRef<number | null>(null);

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

  const syncSession = useCallback((next: ToolSession) => {
    sessionRef.current = next;
    setSession(next);
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
    renderDocument(ctx, {
      width: size.width,
      height: size.height,
      camera: cameraRef.current,
      document: doc,
      preview: sess.preview,
      previewEntities: sess.previewEntities,
      selectionRect: sess.selectionRect,
      hideEntityIds: sess.hideEntityIds,
      cursorWorld,
      snap: sess.lastSnap,
    });
  }, [doc, session, camera, size, cursorWorld]);

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

  const activateTool = useCallback(
    (tool: ToolId, dimKind?: DimensionKind) => {
      isPanningRef.current = false;
      lastPointerRef.current = null;
      syncSession(
        setActiveTool(sessionRef.current, tool, dimKind ? { dimKind } : undefined),
      );
    },
    [syncSession],
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

  const setUnits = useCallback((units: LengthUnit) => {
    busRef.current.updateWithoutHistory((d) => ({
      ...d,
      settings: { ...d.settings, units },
    }));
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

      if (event.code === 'Space' && !inField) {
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
      if ((event.key === 'Delete' || event.key === 'Backspace') && !inField) {
        const s = sessionRef.current;
        const numericTools =
          s.activeTool === 'offset' ||
          s.activeTool === 'rotate' ||
          s.activeTool === 'scale';
        if (
          event.key === 'Backspace' &&
          numericTools &&
          (s.inputBuffer.length > 0 || s.anchor || s.refEntityId)
        ) {
          event.preventDefault();
          syncSession(appendInputBuffer(s, 'Backspace'));
          return;
        }
        event.preventDefault();
        if (target && (tag === 'INPUT' || tag === 'TEXTAREA')) {
          (target as HTMLElement).blur();
        }
        deleteSelection();
        return;
      }
      if (event.key === 'Escape') {
        commandAliasRef.current = '';
        if (commandAliasTimerRef.current != null) {
          window.clearTimeout(commandAliasTimerRef.current);
          commandAliasTimerRef.current = null;
        }
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
        } else if (s.activeTool !== 'select') {
          activateTool('select');
        } else {
          syncSession(cancelTool(s));
        }
        return;
      }
      if (event.key === 'Enter' && !inField) {
        event.preventDefault();
        const s = sessionRef.current;
        if (s.mode === 'text-input') {
          confirmTextPrompt();
          return;
        }
        if (s.activeTool === 'polyline') {
          syncSession(finishPolyline(s, busRef.current));
          return;
        }
        if (
          s.inputBuffer.length > 0 &&
          (s.activeTool === 'offset' ||
            s.activeTool === 'rotate' ||
            s.activeTool === 'scale')
        ) {
          syncSession(commitNumericInput(s, busRef.current));
          return;
        }
        // Resolve pending command alias on Enter
        const alias = COMMAND_ALIASES[commandAliasRef.current];
        if (alias) {
          commandAliasRef.current = '';
          activateTool(alias);
        }
        return;
      }
      if (!meta && !inField) {
        if (event.key === 'F3') {
          event.preventDefault();
          toggleSnap();
          return;
        }

        // Numeric entry for offset / rotate / scale
        const s = sessionRef.current;
        const numericTools =
          s.activeTool === 'offset' ||
          s.activeTool === 'rotate' ||
          s.activeTool === 'scale';
        if (
          numericTools &&
          (s.refEntityId || s.anchor) &&
          /^[0-9.\-]$/.test(event.key)
        ) {
          event.preventDefault();
          syncSession(appendInputBuffer(s, event.key));
          return;
        }

        const key = event.key.toLowerCase();
        const singleMap: Record<string, ToolId> = {
          v: 'select',
          l: 'line',
          c: 'circle',
          p: 'polyline',
          h: 'pan',
          o: 'offset',
          d: 'dimension',
          a: 'text',
        };

        // Delayed single-key tools that are also alias prefixes: t→copy/TR, m→move/MI, r→rect/RO
        const delayedSingles: Record<string, ToolId> = {
          t: 'copy',
          m: 'move',
          r: 'rectangle',
        };

        // If we already started an alias prefix, append and resolve (e.g. T+R → Trim)
        if (commandAliasRef.current.length > 0 && /^[a-z]$/.test(key)) {
          const nextAlias = (commandAliasRef.current + key).slice(-2);
          const alias = COMMAND_ALIASES[nextAlias];
          if (alias) {
            event.preventDefault();
            commandAliasRef.current = '';
            if (commandAliasTimerRef.current != null) {
              window.clearTimeout(commandAliasTimerRef.current);
              commandAliasTimerRef.current = null;
            }
            activateTool(alias);
            return;
          }
        }

        if (delayedSingles[key]) {
          event.preventDefault();
          commandAliasRef.current = key;
          if (commandAliasTimerRef.current != null) {
            window.clearTimeout(commandAliasTimerRef.current);
          }
          commandAliasTimerRef.current = window.setTimeout(() => {
            if (commandAliasRef.current === key) {
              commandAliasRef.current = '';
              activateTool(delayedSingles[key]!);
            }
            commandAliasTimerRef.current = null;
          }, 350);
          return;
        }

        // Multi-character CAD aliases: EX, SC (and any non-delayed prefixes)
        if (/^[a-z]$/.test(key)) {
          const nextAlias = (commandAliasRef.current + key).slice(-2);
          commandAliasRef.current = nextAlias;
          const alias = COMMAND_ALIASES[nextAlias];
          if (alias) {
            event.preventDefault();
            commandAliasRef.current = '';
            if (commandAliasTimerRef.current != null) {
              window.clearTimeout(commandAliasTimerRef.current);
              commandAliasTimerRef.current = null;
            }
            activateTool(alias);
            return;
          }
          if (commandAliasTimerRef.current != null) {
            window.clearTimeout(commandAliasTimerRef.current);
          }
          commandAliasTimerRef.current = window.setTimeout(() => {
            commandAliasRef.current = '';
            commandAliasTimerRef.current = null;
          }, 800);
        }

        const tool = singleMap[key];
        if (tool) {
          event.preventDefault();
          commandAliasRef.current = '';
          if (target && (tag === 'INPUT' || tag === 'TEXTAREA')) {
            (target as HTMLElement).blur();
          }
          activateTool(tool);
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
    activateTool,
    cancelTextPrompt,
    confirmTextPrompt,
    deleteSelection,
    newDrawing,
    openDrawing,
    redo,
    saveDrawing,
    syncSession,
    toggleSnap,
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
    const next = handleToolPointerDown(sessionRef.current, busRef.current, {
      world,
      camera: cameraRef.current,
      detail: event.detail,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
    });
    // Capture for grip drag / window select so pointerUp always arrives
    if (next.mode === 'grip' || next.mode === 'window') {
      canvas.setPointerCapture(event.pointerId);
    }
    syncSession(next);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const world = getWorldFromEvent(event);
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
          <div className="ai-dock">
            <span className="hint">AI Command (coming later)</span>
            <input
              placeholder="Describe a drawing command… (AI not active)"
              aria-label="AI prompt"
              disabled
              tabIndex={-1}
            />
            <button type="button" disabled>
              Run
            </button>
          </div>
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
              <label>Units</label>
              <select
                className="prop-select"
                value={doc.settings.units}
                onChange={(e) => setUnits(e.target.value as LengthUnit)}
                aria-label="Drawing units"
              >
                {UNIT_OPTIONS.map((u) => (
                  <option key={u} value={u}>
                    {u}
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
            X: <strong>{formatLengthInUnits(cursorWorld.x, doc.settings.units, doc.settings.precision)}</strong>
          </span>
          <span>
            Y: <strong>{formatLengthInUnits(cursorWorld.y, doc.settings.units, doc.settings.precision)}</strong>
          </span>
          <span>
            Zoom: <strong>{((camera.zoom / 40) * 100).toFixed(0)}%</strong>
          </span>
          <span>
            Units: <strong>{doc.settings.units}</strong>
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
