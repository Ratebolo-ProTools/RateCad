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
import {
  cancelTool,
  createToolSession,
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
  { id: 'pan', label: 'Pan', glyph: '✥' },
];

function createBus(): CommandBus {
  return new CommandBus(createEmptyDocument('Untitled Drawing'));
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

  const [doc, setDoc] = useState<DrawingDocument>(() => busRef.current.getDocument());
  const [session, setSession] = useState<ToolSession>(() => sessionRef.current);
  const [camera, setCamera] = useState<Camera>(() => cameraRef.current);
  const [cursorWorld, setCursorWorld] = useState({ x: 0, y: 0 });
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [aiPrompt, setAiPrompt] = useState('');
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const syncSession = useCallback((next: ToolSession) => {
    sessionRef.current = next;
    setSession(next);
  }, []);

  const syncCamera = useCallback((next: Camera) => {
    cameraRef.current = next;
    setCamera(next);
  }, []);

  useEffect(() => {
    return busRef.current.subscribe((next) => {
      setDoc(next);
      setCanUndo(busRef.current.canUndo());
      setCanRedo(busRef.current.canRedo());
    });
  }, []);

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
    });
  }, [doc, session, camera, size, cursorWorld]);

  const getWorldFromEvent = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
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

  const newDrawing = useCallback(() => {
    busRef.current.reset(createEmptyDocument('Untitled Drawing'));
    syncSession(createToolSession('line'));
    syncCamera(createCamera());
  }, [syncCamera, syncSession]);

  const deleteSelection = useCallback(() => {
    const selected = busRef.current.getDocument().selection;
    if (selected.length === 0) return;
    busRef.current.execute(new DeleteEntitiesCommand(selected));
  }, []);

  const undo = useCallback(() => busRef.current.undo(), []);
  const redo = useCallback(() => busRef.current.redo(), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (event.code === 'Space') {
        spaceDownRef.current = true;
        event.preventDefault();
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
      if (meta && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        newDrawing();
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        const tag = (event.target as HTMLElement | null)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        event.preventDefault();
        deleteSelection();
        return;
      }
      if (event.key === 'Escape') {
        // Cancel in-progress tool gesture; second Escape returns to Select.
        if (sessionRef.current.anchor) {
          syncSession(cancelTool(sessionRef.current));
        } else if (sessionRef.current.activeTool !== 'select') {
          activateTool('select');
        } else {
          syncSession(cancelTool(sessionRef.current));
        }
        return;
      }
      if (!meta) {
        const map: Record<string, ToolId> = {
          v: 'select',
          l: 'line',
          r: 'rectangle',
          c: 'circle',
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
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [activateTool, deleteSelection, newDrawing, redo, syncSession, undo]);

  useEffect(() => {
    const api = window.ratecadDesktop;
    if (!api) return;
    return api.onMenuAction((action) => {
      if (action === 'new') newDrawing();
      if (action === 'undo') undo();
      if (action === 'redo') redo();
      if (action === 'delete') deleteSelection();
    });
  }, [deleteSelection, newDrawing, redo, undo]);

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const panMode =
      sessionRef.current.activeTool === 'pan' ||
      spaceDownRef.current ||
      event.button === 1;

    if (panMode) {
      // Capture only while panning so toolbar clicks are never stolen.
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
      syncCamera(panCamera(cameraRef.current, dx, dy));
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

  const canvasClass = [
    'viewport-canvas',
    session.activeTool === 'pan' ? 'pan-ready' : '',
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
        <div className="menu-actions">
          <button type="button" onClick={newDrawing}>
            New
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
        <div className="tool-group">
          <button type="button" className="tool-btn" onClick={undo}>
            Undo
          </button>
          <button type="button" className="tool-btn" onClick={redo}>
            Redo
          </button>
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
              title={`${tool.label}`}
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
          />
          <div className="ai-dock">
            <span className="hint">AI Command (coming later)</span>
            <input
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder="Describe a drawing command… (AI not active in Milestone 1)"
              aria-label="AI prompt"
              disabled
            />
            <button type="button" disabled title="AI engine lands in later milestones">
              Run
            </button>
          </div>
        </main>

        <aside className="right-panel" aria-label="Properties">
          <section className="panel-section">
            <h2 className="panel-title">Document</h2>
            <div className="prop-row">
              <label>Name</label>
              <div className="value">{doc.meta.name}</div>
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
                Select an object to inspect its properties.
              </p>
            )}
          </section>
        </aside>
      </div>

      <footer className="status-bar">
        <div className="status-left">{session.statusMessage}</div>
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
