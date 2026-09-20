import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { CommandBus, DeleteEntitiesCommand } from '@ratecad/commands';
import {
  createEmptyDocument,
  getSelectedEntities,
  type DrawingDocument,
  type Entity,
} from '@ratecad/core';
import { formatLength } from '@ratecad/geometry';
import { serializeDocument, tryParseDocument } from '@ratecad/io';
import {
  cancelTool,
  createToolSession,
  finishPolyline,
  handleToolPointerDown,
  handleToolPointerMove,
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

const DRAW_TOOLS: Array<{ id: ToolId; label: string; glyph: string }> = [
  { id: 'select', label: 'Select', glyph: '⌖' },
  { id: 'line', label: 'Line', glyph: '/' },
  { id: 'rectangle', label: 'Rect', glyph: '▭' },
  { id: 'circle', label: 'Circle', glyph: '○' },
  { id: 'polyline', label: 'PLine', glyph: '⌇' },
  { id: 'pan', label: 'Pan', glyph: '✥' },
];

function createBus(): CommandBus {
  return new CommandBus(createEmptyDocument('Untitled Drawing'));
}

function basename(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || filePath;
}

function describeEntity(entity: Entity): Array<{ label: string; value: string }> {
  const common = [
    { label: 'ID', value: entity.id },
    { label: 'Type', value: entity.type },
    { label: 'Layer', value: entity.layerId },
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
    renderDocument(ctx, {
      width: size.width,
      height: size.height,
      camera: cameraRef.current,
      document: doc,
      preview: sessionRef.current.preview,
      cursorWorld,
      snap: sessionRef.current.lastSnap,
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
    (tool: ToolId) => {
      isPanningRef.current = false;
      lastPointerRef.current = null;
      syncSession(setActiveTool(sessionRef.current, tool));
    },
    [syncSession],
  );

  const confirmDiscardIfNeeded = useCallback(async (): Promise<boolean> => {
    if (!dirtyRef.current) return true;
    const api = window.ratecadDesktop;
    if (!api?.confirmDiscard) {
      return window.confirm('Discard unsaved changes?');
    }
    return api.confirmDiscard('You have unsaved changes. Discard them?');
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

      if (!api?.saveDrawing) {
        // Browser fallback for non-Electron preview
        const blob = new Blob([contents], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = defaultName;
        a.click();
        URL.revokeObjectURL(url);
        markDirty(false);
        setStatusExtra('Saved (download)');
        return;
      }

      const result = await api.saveDrawing({
        contents,
        filePath: forceDialog ? null : filePathRef.current,
        defaultPath: filePathRef.current ? basename(filePathRef.current) : defaultName,
        forceDialog,
      });

      if (result.canceled) return;
      if (result.error) {
        setStatusExtra(`Save failed: ${result.error}`);
        return;
      }
      if (result.filePath) {
        setProjectPath(result.filePath);
        const name = basename(result.filePath).replace(/\.ratecad$/i, '');
        suppressDirtyRef.current = true;
        busRef.current.updateWithoutHistory((d) => ({
          ...d,
          meta: { ...d.meta, name, updatedAt: new Date().toISOString() },
        }));
        markDirty(false);
        suppressDirtyRef.current = false;
        setStatusExtra(`Saved ${basename(result.filePath)}`);
      }
    },
    [markDirty, setProjectPath],
  );

  const openDrawing = useCallback(async () => {
    if (!(await confirmDiscardIfNeeded())) return;
    const api = window.ratecadDesktop;
    if (!api?.openDrawing) {
      setStatusExtra('Open requires the Electron desktop shell');
      return;
    }
    const result = await api.openDrawing();
    if (result.canceled) return;
    if (result.error) {
      setStatusExtra(`Open failed: ${result.error}`);
      return;
    }
    if (!result.contents) {
      setStatusExtra('Open failed: empty file');
      return;
    }
    const parsed = tryParseDocument(result.contents);
    if (!parsed.ok) {
      setStatusExtra(`Invalid file: ${parsed.error}`);
      return;
    }
    suppressDirtyRef.current = true;
    busRef.current.reset(parsed.document);
    setProjectPath(result.filePath ?? null);
    markDirty(false);
    suppressDirtyRef.current = false;
    syncSession(createToolSession('select'));
    syncCamera(createCamera());
    setStatusExtra(
      result.filePath ? `Opened ${basename(result.filePath)}` : 'Opened drawing',
    );
  }, [
    confirmDiscardIfNeeded,
    markDirty,
    setProjectPath,
    syncCamera,
    syncSession,
  ]);

  const deleteSelection = useCallback(() => {
    const selected = busRef.current.getDocument().selection;
    if (selected.length === 0) return;
    busRef.current.execute(new DeleteEntitiesCommand(selected));
  }, []);

  const undo = useCallback(() => busRef.current.undo(), []);
  const redo = useCallback(() => busRef.current.redo(), []);

  const toggleSnap = useCallback(() => {
    busRef.current.updateWithoutHistory((d) => ({
      ...d,
      settings: { ...d.settings, snapToGrid: !d.settings.snapToGrid },
    }));
    // Don't mark dirty for snap toggle? It is a document setting — keep dirty via subscribe.
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      const tag = (event.target as HTMLElement | null)?.tagName;
      const inField = tag === 'INPUT' || tag === 'TEXTAREA';

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
        event.preventDefault();
        deleteSelection();
        return;
      }
      if (event.key === 'Escape') {
        if (sessionRef.current.vertices.length > 0 || sessionRef.current.anchor) {
          syncSession(cancelTool(sessionRef.current));
        } else if (sessionRef.current.activeTool !== 'select') {
          activateTool('select');
        } else {
          syncSession(cancelTool(sessionRef.current));
        }
        return;
      }
      if (event.key === 'Enter' && sessionRef.current.activeTool === 'polyline') {
        event.preventDefault();
        syncSession(finishPolyline(sessionRef.current, busRef.current));
        return;
      }
      if (!meta && !inField) {
        if (event.key === 'F3') {
          event.preventDefault();
          toggleSnap();
          return;
        }
        const map: Record<string, ToolId> = {
          v: 'select',
          l: 'line',
          r: 'rectangle',
          c: 'circle',
          p: 'polyline',
          h: 'pan',
        };
        const tool = map[event.key.toLowerCase()];
        if (tool) {
          event.preventDefault();
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
    });
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
    });
    if (next !== sessionRef.current) {
      syncSession(next);
    }
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    isPanningRef.current = false;
    lastPointerRef.current = null;
    const canvas = canvasRef.current;
    if (canvas?.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
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
  const selectedProps = selected[0] ? describeEntity(selected[0]) : null;
  const displayName = `${doc.meta.name}${dirty ? ' *' : ''}`;
  const snapLabel = session.lastSnap?.snapped ? session.lastSnap.label : null;

  const canvasClass = [
    'viewport-canvas',
    session.activeTool === 'pan' || spaceDownRef.current ? 'pan-ready' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="app-shell">
      <header className="menu-bar">
        <div className="brand">
          <span className="brand-name">RateCAD</span>
          <span className="brand-tag">2D Drafting</span>
        </div>
        <div className="doc-title" title={filePath ?? undefined}>
          {displayName}
        </div>
        <div className="menu-actions">
          <button type="button" onClick={() => void newDrawing()}>
            New
          </button>
          <button type="button" onClick={() => void openDrawing()}>
            Open
          </button>
          <button type="button" onClick={() => void saveDrawing(false)}>
            Save
          </button>
          <button type="button" onClick={() => void saveDrawing(true)}>
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
              key={tool.id}
              type="button"
              className={`tool-btn${session.activeTool === tool.id ? ' active' : ''}`}
              onClick={(event) => {
                event.stopPropagation();
                activateTool(tool.id);
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
              key={tool.id}
              type="button"
              className={`rail-btn${session.activeTool === tool.id ? ' active' : ''}`}
              onClick={(event) => {
                event.stopPropagation();
                activateTool(tool.id);
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
            onDoubleClick={(e) => e.preventDefault()}
          />
          <div className="ai-dock">
            <span className="hint">AI Command (coming later)</span>
            <input
              placeholder="Describe a drawing command… (AI not active)"
              aria-label="AI prompt"
              disabled
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
              <div className="value">{doc.settings.units}</div>
            </div>
            <div className="prop-row">
              <label>Grid</label>
              <div className="value">{doc.settings.gridSize}</div>
            </div>
            <div className="prop-row">
              <label>Snap</label>
              <div className="value">{doc.settings.snapToGrid ? 'ON' : 'OFF'}</div>
            </div>
          </section>

          <section className="panel-section">
            <h2 className="panel-title">Properties</h2>
            {selectedProps ? (
              selectedProps.map((row) => (
                <div className="prop-row" key={row.label}>
                  <label>{row.label}</label>
                  <div className="value">{row.value}</div>
                </div>
              ))
            ) : (
              <p className="empty-props">
                Select an object to inspect its properties. Grips show on
                selection (visual only in M2).
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
            X: <strong>{formatLength(cursorWorld.x)}</strong>
          </span>
          <span>
            Y: <strong>{formatLength(cursorWorld.y)}</strong>
          </span>
          <span>
            Zoom: <strong>{((camera.zoom / 40) * 100).toFixed(0)}%</strong>
          </span>
          <span>
            Units: <strong>{doc.settings.units}</strong>
          </span>
          <span>
            Snap: <strong>{doc.settings.snapToGrid ? 'ON' : 'OFF'}</strong>
          </span>
        </div>
      </footer>
    </div>
  );
}
