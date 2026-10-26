import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import {
  ChangeEntitiesAppearanceCommand,
  SetCurrentAppearanceCommand,
  type CommandBus,
} from '@ratecad/commands';
import {
  LINEWEIGHT_REGISTRY_MM,
  LINETYPE_REGISTRY,
  NAMED_COLORS,
  parseColorInput,
  rgbToHex,
  type ColorProperty,
  type DimensionKind,
  type DrawingDocument,
  type Entity,
  type Layer,
  type LayoutId,
  type LinetypeProperty,
  type LineweightProperty,
  type WorkspaceMode,
} from '@ratecad/core';
import {
  canEditEntityProperties,
  colorEqual,
  commonValue,
  getCurrentAppearance,
  getStoredAppearance,
  type AppearancePatch,
} from '@ratecad/geometry';
import type { AreaToolMode, ToolId } from '@ratecad/tools';
import type { CrosshairSize, PickboxSize } from '@ratecad/viewport';
import {
  ApplicationMenuButton,
  type RecentDrawing,
} from './ApplicationMenu';
import {
  DEFAULT_RIBBON_TAB,
  RIBBON_TAB_DEFS,
  SUPPORTED_DIMENSION_KINDS,
  type RibbonTabId,
} from './ribbonTabs';
import { DocumentTabs } from './DocumentTabs';
import type { DocumentTabItem } from './documentTabsModel';
import './styles/ribbon.css';

const MIXED = 'Mixed';

export type RibbonLayoutInfo = {
  id: LayoutId;
  name: string;
};

export type RibbonProps = {
  displayName: string;
  /** P3-B2 session-aware drawing tabs (single active session until P3-B3). */
  documentTabs: DocumentTabItem[];
  activeSessionId: string | null;
  multiDocumentActionsEnabled?: boolean;
  activeTool: ToolId;
  dimKind: DimensionKind;
  canUndo: boolean;
  canRedo: boolean;
  selectionCount: number;
  document: DrawingDocument;
  commandBus: CommandBus;
  layers: Layer[];
  currentLayerId: string;
  snapOn: boolean;
  orthoOn: boolean;
  polarOn: boolean;
  polarIncrement: number;
  gridOn: boolean;
  areaMode: AreaToolMode;
  crosshairSize: CrosshairSize;
  pickboxSize: PickboxSize;
  workspaceMode: WorkspaceMode;
  activeLayoutId: LayoutId | null;
  layouts: RibbonLayoutInfo[];
  annotationScaleLabel: string;
  onCrosshairSizeChange: (size: CrosshairSize) => void;
  onPickboxSizeChange: (size: PickboxSize) => void;
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onDeleteSelection: () => void;
  onActivateTool: (tool: ToolId, dimKind?: DimensionKind) => void;
  onRunCommand: (alias: string) => void;
  onOpenUnits: () => void;
  onOpenDimStyle: () => void;
  onSetCurrentLayer: (layerId: string) => void;
  onAddLayer: () => void;
  onToggleLayerVisible: (layer: Layer) => void;
  onToggleLayerLocked: (layer: Layer) => void;
  onToggleSnap: () => void;
  onToggleOrtho: () => void;
  onTogglePolar: () => void;
  onToggleGrid: () => void;
  onActivateAreaMode: (mode: AreaToolMode) => void;
  onScrollToLayers: () => void;
  onScrollToProperties: () => void;
  onZoomExtents: () => void;
  onZoomWindow: () => void;
  onZoomPrevious: () => void;
  onPanNavigation: () => void;
  onSwitchToModel: () => void;
  onSwitchToLayout: (layoutId: LayoutId) => void;
  appMenuOpen: boolean;
  onAppMenuOpenChange: (open: boolean) => void;
  recentDrawings: RecentDrawing[];
  onOpenRecent: (entry: RecentDrawing) => void;
  onExit: () => void;
};

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {children}
    </svg>
  );
}

const Icons = {
  newDoc: (
    <Icon>
      <path d="M7 3h7l4 4v14H7z" />
      <path d="M14 3v5h5" />
    </Icon>
  ),
  open: (
    <Icon>
      <path d="M3 7h6l2 2h10v10H3z" />
    </Icon>
  ),
  save: (
    <Icon>
      <path d="M5 4h12l3 3v13H5z" />
      <path d="M8 4v6h8V4" />
      <path d="M8 18h8" />
    </Icon>
  ),
  saveAs: (
    <Icon>
      <path d="M5 4h12l3 3v13H5z" />
      <path d="M8 4v6h8V4" />
      <path d="M9 15h3m0 0v3m0-3h3" />
    </Icon>
  ),
  undo: (
    <Icon>
      <path d="M8 8H4V4" />
      <path d="M4 8a8 8 0 1 1 2 6" />
    </Icon>
  ),
  redo: (
    <Icon>
      <path d="M16 8h4V4" />
      <path d="M20 8a8 8 0 1 0-2 6" />
    </Icon>
  ),
  line: (
    <Icon>
      <path d="M5 19L19 5" />
    </Icon>
  ),
  polyline: (
    <Icon>
      <path d="M4 18L9 8l5 6 6-10" />
      <circle cx="9" cy="8" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="14" cy="14" r="1.2" fill="currentColor" stroke="none" />
    </Icon>
  ),
  circle: (
    <Icon>
      <circle cx="12" cy="12" r="7" />
      <path d="M12 12h7" />
    </Icon>
  ),
  arc: (
    <Icon>
      <path d="M5 17a8 8 0 0 1 14-2" />
      <circle cx="5" cy="17" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="19" cy="15" r="1.1" fill="currentColor" stroke="none" />
    </Icon>
  ),
  rectangle: (
    <Icon>
      <rect x="5" y="7" width="14" height="10" />
    </Icon>
  ),
  polygon: (
    <Icon>
      <path d="M12 4l7 5-2.5 8h-9L5 9z" />
    </Icon>
  ),
  hatch: (
    <Icon>
      <rect x="5" y="6" width="14" height="12" />
      <path d="M7 18L17 6M10 18L17 10M7 14L13 6" />
    </Icon>
  ),
  move: (
    <Icon>
      <path d="M12 4v16M4 12h16M8 8l4-4 4 4M8 16l4 4 4-4" />
    </Icon>
  ),
  copy: (
    <Icon>
      <rect x="8" y="8" width="10" height="10" />
      <path d="M6 16V6h10" />
    </Icon>
  ),
  rotate: (
    <Icon>
      <path d="M20 8a8 8 0 1 0 0 8" />
      <path d="M20 4v5h-5" />
    </Icon>
  ),
  mirror: (
    <Icon>
      <path d="M12 3v18" />
      <path d="M9 8L4 12l5 4M15 8l5 4-5 4" />
    </Icon>
  ),
  stretch: (
    <Icon>
      <rect x="4" y="7" width="9" height="10" />
      <path d="M13 10h7v7H10" />
    </Icon>
  ),
  scale: (
    <Icon>
      <rect x="5" y="11" width="7" height="7" />
      <rect x="10" y="5" width="9" height="9" />
    </Icon>
  ),
  trim: (
    <Icon>
      <path d="M4 8h10M14 8l4 8M8 16h12" />
    </Icon>
  ),
  extend: (
    <Icon>
      <path d="M4 12h12M14 8l4 4-4 4M4 6v12" />
    </Icon>
  ),
  offset: (
    <Icon>
      <path d="M6 7h12M6 12h12M6 17h12" />
    </Icon>
  ),
  fillet: (
    <Icon>
      <path d="M5 19V10a5 5 0 0 1 5-5h9" />
    </Icon>
  ),
  erase: (
    <Icon>
      <path d="M6 7h12M9 7V5h6v2M8 7l1 12h6l1-12" />
    </Icon>
  ),
  text: (
    <Icon>
      <path d="M6 6h12M12 6v12M8 18h8" />
    </Icon>
  ),
  dimension: (
    <Icon>
      <path d="M4 16h16M6 16l2-3M18 16l-2-3M6 8h12" />
    </Icon>
  ),
  leader: (
    <Icon>
      <path d="M5 19L14 8h5" />
      <path d="M14 8h5v4" />
    </Icon>
  ),
  dimstyle: (
    <Icon>
      <path d="M5 7h14M5 12h10M5 17h7" />
    </Icon>
  ),
  layers: (
    <Icon>
      <path d="M12 4l9 5-9 5-9-5z" />
      <path d="M3 13l9 5 9-5" />
    </Icon>
  ),
  eye: (
    <Icon>
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z" />
      <circle cx="12" cy="12" r="2.5" />
    </Icon>
  ),
  lock: (
    <Icon>
      <rect x="7" y="11" width="10" height="8" />
      <path d="M9 11V8a3 3 0 0 1 6 0v3" />
    </Icon>
  ),
  block: (
    <Icon>
      <rect x="5" y="5" width="14" height="14" />
      <path d="M5 12h14M12 5v14" />
    </Icon>
  ),
  match: (
    <Icon>
      <path d="M8 8h5v5H8zM13 13h5v5h-5z" />
      <path d="M10 13l5-5" />
    </Icon>
  ),
  measure: (
    <Icon>
      <path d="M4 18L18 4" />
      <path d="M7 18h-3v-3M17 4h3v3" />
    </Icon>
  ),
  area: (
    <Icon>
      <path d="M5 7h14v10H5z" />
      <path d="M5 12h14" />
    </Icon>
  ),
  group: (
    <Icon>
      <rect x="4" y="6" width="7" height="7" />
      <rect x="13" y="11" width="7" height="7" />
    </Icon>
  ),
  clipboard: (
    <Icon>
      <rect x="8" y="5" width="10" height="14" />
      <path d="M10 5V3h6v2" />
    </Icon>
  ),
  pan: (
    <Icon>
      <path d="M12 3v18M3 12h18M8 7l4-4 4 4M8 17l4 4 4-4M7 8l-4 4 4 4M17 8l4 4-4 4" />
    </Icon>
  ),
  select: (
    <Icon>
      <path d="M6 4l4 14 3-5 5-2z" />
    </Icon>
  ),
  zoomExtents: (
    <Icon>
      <rect x="4" y="4" width="16" height="16" />
      <path d="M8 12h8M12 8v8" />
    </Icon>
  ),
  zoomWindow: (
    <Icon>
      <rect x="5" y="5" width="10" height="10" />
      <path d="M14 14l5 5" />
      <circle cx="12" cy="12" r="0.5" fill="currentColor" stroke="none" />
    </Icon>
  ),
  zoomPrevious: (
    <Icon>
      <path d="M8 12h11" />
      <path d="M11 8l-4 4 4 4" />
      <path d="M5 6v12" />
    </Icon>
  ),
};

function RibbonBodyShell({
  testId,
  children,
}: {
  testId: string;
  children: ReactNode;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScroll = () => {
    const el = bodyRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  };

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    updateScroll();
    const onScroll = () => updateScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(() => updateScroll());
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      ro.disconnect();
    };
  }, []);

  const scrollByDir = (dir: -1 | 1) => {
    const el = bodyRef.current;
    if (!el) return;
    el.scrollBy({
      left: dir * Math.max(160, el.clientWidth * 0.45),
      behavior: 'smooth',
    });
  };

  return (
    <div className="ribbon-body-wrap" data-testid={`${testId}-wrap`}>
      <button
        type="button"
        className={`ribbon-scroll-btn left${canScrollLeft ? '' : ' hidden'}`}
        data-testid={`${testId}-scroll-left`}
        aria-label="Scroll ribbon left"
        title="Scroll left"
        onClick={() => scrollByDir(-1)}
      >
        ‹
      </button>
      <div className="ribbon-body" data-testid={testId} ref={bodyRef}>
        {children}
      </div>
      <button
        type="button"
        className={`ribbon-scroll-btn right${canScrollRight ? '' : ' hidden'}`}
        data-testid={`${testId}-scroll-right`}
        aria-label="Scroll ribbon right"
        title="Scroll right"
        onClick={() => scrollByDir(1)}
      >
        ›
      </button>
    </div>
  );
}

function tip(name: string, aliases?: string[], extra?: string): string {
  const alias = aliases?.length ? ` (${aliases.join(', ')})` : '';
  return extra ? `${name}${alias} — ${extra}` : `${name}${alias}`;
}

function Flyout({
  open,
  onOpenChange,
  trigger,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onOpenChange(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, onOpenChange]);
  return (
    <div className={`ribbon-flyout${open ? ' open' : ''}`} ref={ref}>
      {trigger}
      <div className="ribbon-flyout-menu" role="menu">
        {children}
      </div>
    </div>
  );
}

export function Ribbon(props: RibbonProps) {
  const [tab, setTab] = useState<RibbonTabId>(DEFAULT_RIBBON_TAB);
  const [dimOpen, setDimOpen] = useState(false);
  const [annotateDimOpen, setAnnotateDimOpen] = useState(false);
  const [circleOpen, setCircleOpen] = useState(false);
  const [measureOpen, setMeasureOpen] = useState(false);
  const layerSelectId = useId();
  const manageLayerSelectId = useId();
  const currentLayer =
    props.layers.find((l) => l.id === props.currentLayerId) ?? props.layers[0];

  const isActive = (tool: ToolId, dimKind?: DimensionKind) => {
    if (props.activeTool !== tool) return false;
    if (tool === 'dimension' && dimKind) return props.dimKind === dimKind;
    return true;
  };

  const selectedEntities = props.document.selection
    .map((id) => props.document.entities.find((e) => e.id === id))
    .filter((e): e is Entity => !!e);
  const currentAppearance = getCurrentAppearance(props.document);

  const applyAppearance = (patch: AppearancePatch) => {
    if (selectedEntities.length === 0) {
      props.commandBus.execute(new SetCurrentAppearanceCommand(patch));
      return;
    }
    const ids = selectedEntities
      .filter((e) => canEditEntityProperties(e, props.document))
      .map((e) => e.id);
    if (!ids.length) return;
    props.commandBus.execute(new ChangeEntitiesAppearanceCommand(ids, patch));
  };

  const colorCommon =
    selectedEntities.length === 0
      ? currentAppearance.color
      : commonValue(
          selectedEntities.map((e) => getStoredAppearance(e).color),
          colorEqual,
        );
  const ltCommon =
    selectedEntities.length === 0
      ? currentAppearance.linetype
      : commonValue(
          selectedEntities.map((e) => getStoredAppearance(e).linetype),
          (a, b) =>
            a.mode === b.mode &&
            (a.mode !== 'EXPLICIT' ||
              b.mode !== 'EXPLICIT' ||
              a.value === b.value),
        );
  const lwCommon =
    selectedEntities.length === 0
      ? currentAppearance.lineweight
      : commonValue(
          selectedEntities.map((e) => getStoredAppearance(e).lineweight),
          (a, b) =>
            a.mode === b.mode &&
            (a.mode !== 'EXPLICIT' ||
              b.mode !== 'EXPLICIT' ||
              a.value === b.value),
        );

  const colorSelectValue = (() => {
    if (colorCommon === null) return MIXED;
    if (!colorCommon || colorCommon.mode === 'BY_LAYER') return 'BY_LAYER';
    if (colorCommon.mode === 'EXPLICIT') {
      const hex = rgbToHex(colorCommon.value).toUpperCase();
      return (
        Object.entries(NAMED_COLORS).find(
          ([, rgb]) => rgbToHex(rgb).toUpperCase() === hex,
        )?.[0] ?? 'CUSTOM'
      );
    }
    return 'BY_LAYER';
  })();

  const ltSelectValue = (() => {
    if (ltCommon === null) return MIXED;
    if (ltCommon?.mode === 'EXPLICIT') return ltCommon.value;
    return 'BY_LAYER';
  })();

  const lwSelectValue = (() => {
    if (lwCommon === null) return MIXED;
    if (lwCommon?.mode === 'EXPLICIT') return String(lwCommon.value);
    return 'BY_LAYER';
  })();

  const onRibbonColor = (raw: string) => {
    if (raw === MIXED) return;
    let color: ColorProperty;
    if (raw === 'BY_LAYER') color = { mode: 'BY_LAYER' };
    else if (NAMED_COLORS[raw]) {
      color = { mode: 'EXPLICIT', value: { ...NAMED_COLORS[raw]! } };
    } else if (raw === 'CUSTOM') {
      const hex = window.prompt('True Color (#RRGGBB or rgb)', '#FF0000');
      if (!hex) return;
      const parsed = parseColorInput(hex);
      if (!parsed || parsed.mode !== 'EXPLICIT') return;
      color = parsed;
    } else {
      const parsed = parseColorInput(raw);
      if (!parsed) return;
      color = parsed;
    }
    applyAppearance({ color });
  };

  const onRibbonLinetype = (raw: string) => {
    if (raw === MIXED) return;
    const linetype: LinetypeProperty =
      raw === 'BY_LAYER'
        ? { mode: 'BY_LAYER' }
        : { mode: 'EXPLICIT', value: raw };
    applyAppearance({ linetype });
  };

  const onRibbonLineweight = (raw: string) => {
    if (raw === MIXED) return;
    const lineweight: LineweightProperty =
      raw === 'BY_LAYER'
        ? { mode: 'BY_LAYER' }
        : { mode: 'EXPLICIT', value: Number(raw) };
    applyAppearance({ lineweight });
  };

  return (
    <>
      <div className="ribbon-chrome" data-testid="ribbon-chrome">
        <div className="qat" aria-label="Quick Access Toolbar">
          <ApplicationMenuButton
            open={props.appMenuOpen}
            onOpenChange={props.onAppMenuOpenChange}
            recent={props.recentDrawings}
            onNew={props.onNew}
            onOpen={props.onOpen}
            onSave={props.onSave}
            onSaveAs={props.onSaveAs}
            onOpenRecent={props.onOpenRecent}
            onExit={props.onExit}
          />
          <div className="qat-brand">
            <span className="qat-brand-name">RateCAD</span>
            <span className="qat-brand-tag">2D Drafting</span>
          </div>
          <button
            type="button"
            className="qat-btn"
            data-testid="btn-new"
            title={tip('New', ['CTRL+N'])}
            onClick={props.onNew}
          >
            {Icons.newDoc}
          </button>
          <button
            type="button"
            className="qat-btn"
            data-testid="btn-open"
            title={tip('Open', ['CTRL+O'])}
            onClick={props.onOpen}
          >
            {Icons.open}
          </button>
          <button
            type="button"
            className="qat-btn"
            data-testid="btn-save"
            title={tip('Save', ['CTRL+S'])}
            onClick={props.onSave}
          >
            {Icons.save}
          </button>
          <button
            type="button"
            className="qat-btn"
            data-testid="btn-save-as"
            title={tip('Save As', ['CTRL+SHIFT+S'])}
            onClick={props.onSaveAs}
          >
            {Icons.saveAs}
          </button>
          <span className="qat-sep" />
          <button
            type="button"
            className="qat-btn"
            title={tip('Undo', ['CTRL+Z'])}
            disabled={!props.canUndo}
            onClick={props.onUndo}
          >
            {Icons.undo}
          </button>
          <button
            type="button"
            className="qat-btn"
            title={tip('Redo', ['CTRL+Y'])}
            disabled={!props.canRedo}
            onClick={props.onRedo}
          >
            {Icons.redo}
          </button>
        </div>

        <div className="ribbon-tabs" role="tablist" aria-label="Ribbon tabs">
          {RIBBON_TAB_DEFS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              data-testid={`ribbon-tab-${t.id}`}
              aria-selected={tab === t.id}
              className={`ribbon-tab${tab === t.id ? ' active' : ''}`}
              disabled={!t.enabled}
              title={
                t.enabled
                  ? t.label
                  : `${t.label} — not yet implemented`
              }
              onClick={() => t.enabled && setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'home' ? (
          <RibbonBodyShell testId="home-ribbon">
            {/* DRAW — large Line/PLine/Circle/Arc; small Rect/Polygon/Hatch */}
            <section className="ribbon-panel" aria-label="Draw">
              <div className="ribbon-panel-body">
                <div className="ribbon-row-large">
                  <button
                    type="button"
                    className={`ribbon-large${isActive('line') ? ' active' : ''}`}
                    data-testid="tool-line"
                    title={tip('Line', ['L', 'LINE'])}
                    onClick={() => props.onActivateTool('line')}
                  >
                    {Icons.line}
                    <span>Line</span>
                  </button>
                  <button
                    type="button"
                    className={`ribbon-large${isActive('polyline') ? ' active' : ''}`}
                    data-testid="tool-polyline"
                    title={tip('Polyline', ['PL', 'PLINE'])}
                    onClick={() => props.onActivateTool('polyline')}
                  >
                    {Icons.polyline}
                    <span>Polyline</span>
                  </button>
                  <Flyout
                    open={circleOpen}
                    onOpenChange={setCircleOpen}
                    trigger={
                      <button
                        type="button"
                        className={`ribbon-large${isActive('circle') ? ' active' : ''}`}
                        data-testid="tool-circle"
                        title={tip('Circle', ['C', 'CIRCLE'])}
                        onClick={() => props.onActivateTool('circle')}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setCircleOpen((v) => !v);
                        }}
                      >
                        {Icons.circle}
                        <span>
                          Circle <span className="caret">▾</span>
                        </span>
                      </button>
                    }
                  >
                    <button
                      type="button"
                      onClick={() => {
                        props.onActivateTool('circle');
                        setCircleOpen(false);
                      }}
                    >
                      {Icons.circle} Circle (C)
                    </button>
                    <button type="button" disabled title="Arc — not yet implemented">
                      {Icons.arc} Arc (not implemented)
                    </button>
                  </Flyout>
                  <button
                    type="button"
                    className="ribbon-large"
                    disabled
                    title="Arc — not yet implemented"
                  >
                    {Icons.arc}
                    <span>
                      Arc <span className="caret">▾</span>
                    </span>
                  </button>
                </div>
                <div className="ribbon-stack">
                  <button
                    type="button"
                    className={`ribbon-small${isActive('rectangle') ? ' active' : ''}`}
                    data-testid="tool-rectangle"
                    title={tip('Rectangle', ['REC', 'RECT'])}
                    onClick={() => props.onActivateTool('rectangle')}
                  >
                    {Icons.rectangle} Rectangle
                  </button>
                  <button
                    type="button"
                    className="ribbon-small"
                    disabled
                    title="Polygon — not yet implemented"
                  >
                    {Icons.polygon} Polygon
                  </button>
                  <button
                    type="button"
                    className="ribbon-small"
                    disabled
                    title="Ellipse — not yet implemented"
                  >
                    Ellipse
                  </button>
                  <button
                    type="button"
                    className="ribbon-small"
                    disabled
                    title="Hatch — not yet implemented"
                  >
                    {Icons.hatch} Hatch
                  </button>
                </div>
              </div>
              <div className="ribbon-panel-title">Draw</div>
            </section>

            {/* MODIFY — large Move/Copy/Stretch/Rotate/Mirror/Scale */}
            <section className="ribbon-panel" aria-label="Modify">
              <div className="ribbon-panel-body">
                <div className="ribbon-row-large">
                  <button
                    type="button"
                    className={`ribbon-large${isActive('move') ? ' active' : ''}`}
                    data-testid="tool-move"
                    title={tip('Move', ['M', 'MOVE'])}
                    onClick={() => props.onActivateTool('move')}
                  >
                    {Icons.move}
                    <span>Move</span>
                  </button>
                  <button
                    type="button"
                    className={`ribbon-large${isActive('copy') ? ' active' : ''}`}
                    data-testid="tool-copy"
                    title={tip('Copy', ['CO', 'COPY'])}
                    onClick={() => props.onActivateTool('copy')}
                  >
                    {Icons.copy}
                    <span>Copy</span>
                  </button>
                  <button
                    type="button"
                    className="ribbon-large"
                    disabled
                    title="Stretch — not yet implemented"
                  >
                    {Icons.stretch}
                    <span>Stretch</span>
                  </button>
                  <button
                    type="button"
                    className={`ribbon-large${isActive('rotate') ? ' active' : ''}`}
                    data-testid="tool-rotate"
                    title={tip('Rotate', ['RO', 'ROTATE'])}
                    onClick={() => props.onActivateTool('rotate')}
                  >
                    {Icons.rotate}
                    <span>Rotate</span>
                  </button>
                  <button
                    type="button"
                    className={`ribbon-large${isActive('mirror') ? ' active' : ''}`}
                    data-testid="tool-mirror"
                    title={tip('Mirror', ['MI', 'MIRROR'])}
                    onClick={() => props.onActivateTool('mirror')}
                  >
                    {Icons.mirror}
                    <span>Mirror</span>
                  </button>
                  <button
                    type="button"
                    className={`ribbon-large${isActive('scale') ? ' active' : ''}`}
                    data-testid="tool-scale"
                    title={tip('Scale', ['SC', 'SCALE'])}
                    onClick={() => props.onActivateTool('scale')}
                  >
                    {Icons.scale}
                    <span>Scale</span>
                  </button>
                </div>
                <div className="ribbon-stack">
                  <button
                    type="button"
                    className={`ribbon-small${isActive('trim') ? ' active' : ''}`}
                    data-testid="tool-trim"
                    title={tip('Trim', ['TR', 'TRIM'])}
                    onClick={() => props.onActivateTool('trim')}
                  >
                    {Icons.trim} Trim
                  </button>
                  <button
                    type="button"
                    className={`ribbon-small${isActive('extend') ? ' active' : ''}`}
                    data-testid="tool-extend"
                    title={tip('Extend', ['EX', 'EXTEND'])}
                    onClick={() => props.onActivateTool('extend')}
                  >
                    {Icons.extend} Extend
                  </button>
                  <button
                    type="button"
                    className={`ribbon-small${isActive('fillet') ? ' active' : ''}`}
                    data-testid="tool-fillet"
                    title={tip('Fillet', ['F', 'FILLET'])}
                    onClick={() => props.onActivateTool('fillet')}
                  >
                    {Icons.fillet} Fillet
                  </button>
                  <button
                    type="button"
                    className={`ribbon-small${isActive('offset') ? ' active' : ''}`}
                    data-testid="tool-offset"
                    title={tip('Offset', ['O', 'OFFSET'])}
                    onClick={() => props.onActivateTool('offset')}
                  >
                    {Icons.offset} Offset
                  </button>
                  <button
                    type="button"
                    className="ribbon-small"
                    title={tip('Erase', ['E', 'ERASE'])}
                    disabled={props.selectionCount === 0}
                    onClick={props.onDeleteSelection}
                  >
                    {Icons.erase} Erase
                  </button>
                  <button
                    type="button"
                    className="ribbon-small"
                    disabled
                    title="Explode — not yet implemented"
                  >
                    Explode
                  </button>
                </div>
              </div>
              <div className="ribbon-panel-title">Modify</div>
            </section>

            {/* ANNOTATION */}
            <section className="ribbon-panel" aria-label="Annotation">
              <div className="ribbon-panel-body">
                <button
                  type="button"
                  className={`ribbon-large${isActive('text') ? ' active' : ''}`}
                  data-testid="tool-text"
                  title={tip('Text', ['TEXT', 'T'])}
                  onClick={() => props.onActivateTool('text')}
                >
                  {Icons.text}
                  <span>Text</span>
                </button>
                <Flyout
                  open={dimOpen}
                  onOpenChange={setDimOpen}
                  trigger={
                    <button
                      type="button"
                      className={`ribbon-large${props.activeTool === 'dimension' ? ' active' : ''}`}
                      data-testid="tool-dimension-aligned"
                      title={tip('Dimension', ['DIM'])}
                      onClick={() => {
                        props.onActivateTool('dimension', 'aligned');
                        setDimOpen((v) => !v);
                      }}
                    >
                      {Icons.dimension}
                      <span>
                        Dimension <span className="caret">▾</span>
                      </span>
                    </button>
                  }
                >
                  {(
                    [
                      ['aligned', 'Aligned', 'tool-dimension-aligned'],
                      ['horizontal', 'Horizontal', 'tool-dimension-horizontal'],
                      ['vertical', 'Vertical', 'tool-dimension-vertical'],
                      ['radius', 'Radius', 'tool-dimension-radius'],
                      ['diameter', 'Diameter', 'tool-dimension-diameter'],
                      ['angular', 'Angular', 'tool-dimension-angular'],
                    ] as Array<[DimensionKind, string, string]>
                  ).map(([kind, label, testId]) => (
                    <button
                      key={kind}
                      type="button"
                      data-testid={testId}
                      onClick={() => {
                        props.onActivateTool('dimension', kind);
                        setDimOpen(false);
                      }}
                    >
                      {Icons.dimension} {label}
                    </button>
                  ))}
                </Flyout>
                <div className="ribbon-stack">
                  <button
                    type="button"
                    className={`ribbon-small${isActive('leader') ? ' active' : ''}`}
                    data-testid="tool-leader"
                    title={tip('Leader', ['LEADER'])}
                    onClick={() => props.onActivateTool('leader')}
                  >
                    {Icons.leader} Leader
                  </button>
                  <button
                    type="button"
                    className="ribbon-small"
                    title={tip('Dimension Style', ['DIMSTYLE', 'D'])}
                    onClick={props.onOpenDimStyle}
                  >
                    {Icons.dimstyle} Dim Style…
                  </button>
                  <button
                    type="button"
                    className="ribbon-small"
                    title={tip('Units / annotation settings', ['UNITS'])}
                    onClick={props.onOpenUnits}
                  >
                    Units…
                  </button>
                  <button
                    type="button"
                    className="ribbon-small"
                    disabled
                    title="Table — not yet implemented"
                  >
                    Table
                  </button>
                </div>
              </div>
              <div className="ribbon-panel-title">Annotation</div>
            </section>

            {/* LAYERS */}
            <section className="ribbon-panel" aria-label="Layers">
              <div className="ribbon-panel-body">
                <button
                  type="button"
                  className="ribbon-large"
                  title="Layer Properties — open layers list"
                  onClick={props.onScrollToLayers}
                >
                  {Icons.layers}
                  <span>Layer Props</span>
                </button>
                <div className="ribbon-layer-main">
                  <div className="ribbon-layer-row">
                    <label className="sr-only" htmlFor={layerSelectId}>
                      Current layer
                    </label>
                    <span
                      className="ribbon-swatch"
                      style={{ background: currentLayer?.color ?? '#fff' }}
                    />
                    <select
                      id={layerSelectId}
                      className="ribbon-select"
                      value={props.currentLayerId}
                      title="Current layer"
                      onChange={(e) => props.onSetCurrentLayer(e.target.value)}
                    >
                      {props.layers.map((layer) => (
                        <option key={layer.id} value={layer.id}>
                          {layer.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="ribbon-icon-btn"
                      title="New layer"
                      onClick={props.onAddLayer}
                    >
                      +
                    </button>
                  </div>
                  <div className="ribbon-layer-row">
                    <button
                      type="button"
                      className={`ribbon-icon-btn${currentLayer?.visible ? ' active' : ''}`}
                      title={
                        currentLayer?.visible
                          ? 'Hide current layer'
                          : 'Show current layer'
                      }
                      disabled={!currentLayer}
                      onClick={() =>
                        currentLayer && props.onToggleLayerVisible(currentLayer)
                      }
                    >
                      {Icons.eye}
                    </button>
                    <button
                      type="button"
                      className={`ribbon-icon-btn${currentLayer?.locked ? ' active' : ''}`}
                      title={
                        currentLayer?.locked
                          ? 'Unlock current layer'
                          : 'Lock current layer'
                      }
                      disabled={!currentLayer}
                      onClick={() =>
                        currentLayer && props.onToggleLayerLocked(currentLayer)
                      }
                    >
                      {Icons.lock}
                    </button>
                    <span
                      className="ribbon-swatch"
                      title={`Layer color: ${currentLayer?.color ?? '—'}`}
                      style={{
                        background: currentLayer?.color ?? '#888',
                        width: 22,
                        height: 22,
                      }}
                    />
                  </div>
                </div>
              </div>
              <div className="ribbon-panel-title">Layers</div>
            </section>

            {/* BLOCK */}
            <section className="ribbon-panel" aria-label="Block">
              <div className="ribbon-panel-body">
                <button
                  type="button"
                  className="ribbon-large"
                  disabled
                  title="Insert block — not yet implemented"
                >
                  {Icons.block}
                  <span>Insert</span>
                </button>
                <div className="ribbon-stack">
                  <button
                    type="button"
                    className="ribbon-small"
                    disabled
                    title="Create block — not yet implemented"
                  >
                    Create
                  </button>
                  <button
                    type="button"
                    className="ribbon-small"
                    disabled
                    title="Edit block — not yet implemented"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="ribbon-small"
                    disabled
                    title="Edit attributes — not yet implemented"
                  >
                    Edit Attributes
                  </button>
                </div>
              </div>
              <div className="ribbon-panel-title">Block</div>
            </section>

            {/* PROPERTIES */}
            <section className="ribbon-panel" aria-label="Properties">
              <div className="ribbon-panel-body">
                <button
                  type="button"
                  className="ribbon-large"
                  title={tip('Match Properties', ['MATCHPROP', 'MA'])}
                  onClick={() => props.onRunCommand('MATCHPROP')}
                >
                  {Icons.match}
                  <span>Match Prop</span>
                </button>
                <div className="ribbon-prop-stack" data-testid="ribbon-properties">
                  <label className="ribbon-prop-label" title="Color">
                    <span>Color</span>
                    <select
                      className="ribbon-select"
                      data-testid="ribbon-color"
                      aria-label="Color"
                      value={colorSelectValue}
                      onChange={(e) => onRibbonColor(e.target.value)}
                    >
                      {colorCommon === null ? (
                        <option value={MIXED}>{MIXED}</option>
                      ) : null}
                      <option value="BY_LAYER">ByLayer</option>
                      {Object.keys(NAMED_COLORS).map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                      <option value="CUSTOM">True Color…</option>
                    </select>
                  </label>
                  <label className="ribbon-prop-label" title="Linetype">
                    <span>Linetype</span>
                    <select
                      className="ribbon-select"
                      data-testid="ribbon-linetype"
                      aria-label="Linetype"
                      value={ltSelectValue}
                      onChange={(e) => onRibbonLinetype(e.target.value)}
                    >
                      {ltCommon === null ? (
                        <option value={MIXED}>{MIXED}</option>
                      ) : null}
                      <option value="BY_LAYER">ByLayer</option>
                      {LINETYPE_REGISTRY.map((lt) => (
                        <option key={lt.id} value={lt.id}>
                          {lt.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="ribbon-prop-label" title="Lineweight">
                    <span>Lineweight</span>
                    <select
                      className="ribbon-select"
                      data-testid="ribbon-lineweight"
                      aria-label="Lineweight"
                      value={lwSelectValue}
                      onChange={(e) => onRibbonLineweight(e.target.value)}
                    >
                      {lwCommon === null ? (
                        <option value={MIXED}>{MIXED}</option>
                      ) : null}
                      <option value="BY_LAYER">ByLayer</option>
                      {LINEWEIGHT_REGISTRY_MM.map((mm) => (
                        <option key={mm} value={String(mm)}>
                          {mm === 0 ? '0.00 mm (Default)' : `${mm.toFixed(2)} mm`}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
              <div className="ribbon-panel-title">Properties</div>
            </section>

            {/* GROUPS */}
            <section className="ribbon-panel" aria-label="Groups">
              <div className="ribbon-panel-body">
                <div className="ribbon-stack">
                  <button
                    type="button"
                    className="ribbon-small"
                    disabled
                    title="Group — not yet implemented"
                  >
                    {Icons.group} Group
                  </button>
                  <button
                    type="button"
                    className="ribbon-small"
                    disabled
                    title="Ungroup — not yet implemented"
                  >
                    Ungroup
                  </button>
                  <button
                    type="button"
                    className="ribbon-small"
                    disabled
                    title="Edit group — not yet implemented"
                  >
                    Edit Group
                  </button>
                </div>
              </div>
              <div className="ribbon-panel-title">Groups</div>
            </section>

            {/* UTILITIES */}
            <section className="ribbon-panel" aria-label="Utilities">
              <div className="ribbon-panel-body">
                <Flyout
                  open={measureOpen}
                  onOpenChange={setMeasureOpen}
                  trigger={
                    <button
                      type="button"
                      className="ribbon-large"
                      title={tip('Measure', ['DIST', 'AREA'])}
                      onClick={() => setMeasureOpen((v) => !v)}
                    >
                      {Icons.measure}
                      <span>
                        Measure <span className="caret">▾</span>
                      </span>
                    </button>
                  }
                >
                  <button
                    type="button"
                    title={tip('Distance', ['DI', 'DIST'])}
                    onClick={() => {
                      props.onRunCommand('DIST');
                      setMeasureOpen(false);
                    }}
                  >
                    {Icons.measure} Distance (DIST)
                  </button>
                  <button
                    type="button"
                    data-testid="measure-area"
                    title={tip('Area', ['AA', 'AREA'])}
                    onClick={() => {
                      props.onActivateAreaMode('object');
                      setMeasureOpen(false);
                    }}
                  >
                    {Icons.area} Area (AREA)
                  </button>
                </Flyout>
                <div className="ribbon-stack">
                  <button
                    type="button"
                    className={`ribbon-small${isActive('area') ? ' active' : ''}`}
                    title={tip('Area', ['AA', 'AREA'])}
                    onClick={() => props.onActivateAreaMode('object')}
                  >
                    {Icons.area} Area
                  </button>
                  <button
                    type="button"
                    className="ribbon-small"
                    title={tip('Distance', ['DI', 'DIST'])}
                    onClick={() => props.onRunCommand('DIST')}
                  >
                    {Icons.measure} Distance
                  </button>
                </div>
              </div>
              <div className="ribbon-panel-title">Utilities</div>
            </section>

            {/* CLIPBOARD */}
            <section className="ribbon-panel" aria-label="Clipboard">
              <div className="ribbon-panel-body">
                <button
                  type="button"
                  className="ribbon-large"
                  disabled
                  title="Paste — not yet implemented"
                >
                  {Icons.clipboard}
                  <span>Paste</span>
                </button>
                <div className="ribbon-stack">
                  <button
                    type="button"
                    className="ribbon-small"
                    disabled
                    title="Cut — not yet implemented as clipboard"
                  >
                    Cut
                  </button>
                  <button
                    type="button"
                    className={`ribbon-small${isActive('copy') ? ' active' : ''}`}
                    title={tip('Copy objects', ['CO', 'COPY'])}
                    onClick={() => props.onActivateTool('copy')}
                  >
                    {Icons.copy} Copy
                  </button>
                </div>
              </div>
              <div className="ribbon-panel-title">Clipboard</div>
            </section>

            {/* VIEW */}
            <section className="ribbon-panel" aria-label="View">
              <div className="ribbon-panel-body">
                <button
                  type="button"
                  className={`ribbon-large${isActive('pan') ? ' active' : ''}`}
                  data-testid="tool-pan"
                  title={tip('Pan', ['P', 'PAN'])}
                  onClick={() => props.onActivateTool('pan')}
                >
                  {Icons.pan}
                  <span>Pan</span>
                </button>
                <div className="ribbon-stack">
                  <button
                    type="button"
                    className={`ribbon-small${props.snapOn ? ' active' : ''}`}
                    title="Toggle snap (F3)"
                    onClick={props.onToggleSnap}
                  >
                    Snap
                  </button>
                  <button
                    type="button"
                    className={`ribbon-small${props.orthoOn ? ' active' : ''}`}
                    title="Toggle Ortho (F8)"
                    onClick={props.onToggleOrtho}
                  >
                    Ortho
                  </button>
                  <button
                    type="button"
                    className={`ribbon-small${props.polarOn ? ' active' : ''}`}
                    title={`Toggle Polar (F10) · ${props.polarIncrement}°`}
                    onClick={props.onTogglePolar}
                  >
                    Polar {props.polarIncrement}°
                  </button>
                </div>
                <div className="ribbon-prop-stack ribbon-cursor-prefs">
                  <label className="ribbon-prop-label" title="Crosshair size (user preference)">
                    <span>Crosshair</span>
                    <select
                      className="ribbon-select"
                      data-testid="ribbon-crosshair-size"
                      aria-label="Crosshair size"
                      value={props.crosshairSize}
                      onChange={(e) =>
                        props.onCrosshairSizeChange(
                          e.target.value as CrosshairSize,
                        )
                      }
                    >
                      <option value="small">Small</option>
                      <option value="medium">Medium</option>
                      <option value="large">Large</option>
                      <option value="fullscreen">Full Screen</option>
                    </select>
                  </label>
                  <label className="ribbon-prop-label" title="Pickbox size (selection aperture)">
                    <span>Pickbox</span>
                    <select
                      className="ribbon-select"
                      data-testid="ribbon-pickbox-size"
                      aria-label="Pickbox size"
                      value={props.pickboxSize}
                      onChange={(e) =>
                        props.onPickboxSizeChange(e.target.value as PickboxSize)
                      }
                    >
                      <option value="small">Small</option>
                      <option value="medium">Medium</option>
                      <option value="large">Large</option>
                    </select>
                  </label>
                </div>
              </div>
              <div className="ribbon-panel-title">View</div>
            </section>

            {/* TOUCH / SELECT MODE */}
            <section className="ribbon-panel" aria-label="Select Mode">
              <div className="ribbon-panel-body">
                <button
                  type="button"
                  className={`ribbon-large${isActive('select') ? ' active' : ''}`}
                  data-testid="tool-select"
                  title={tip('Selection Mode', ['ESC'])}
                  onClick={() => props.onActivateTool('select')}
                >
                  {Icons.select}
                  <span>Select</span>
                </button>
                <div className="ribbon-stack">
                  <button
                    type="button"
                    className={`ribbon-small${isActive('wall') ? ' active' : ''}`}
                    data-testid="tool-wall"
                    title="Wall"
                    onClick={() => props.onActivateTool('wall')}
                  >
                    Wall
                  </button>
                  <button
                    type="button"
                    className={`ribbon-small${isActive('door') ? ' active' : ''}`}
                    data-testid="tool-door"
                    title="Door"
                    onClick={() => props.onActivateTool('door')}
                  >
                    Door
                  </button>
                  <button
                    type="button"
                    className={`ribbon-small${isActive('window') ? ' active' : ''}`}
                    data-testid="tool-window"
                    title="Window"
                    onClick={() => props.onActivateTool('window')}
                  >
                    Window
                  </button>
                  <button
                    type="button"
                    className={`ribbon-small${isActive('room') ? ' active' : ''}`}
                    data-testid="tool-room"
                    title="Room"
                    onClick={() => props.onActivateTool('room')}
                  >
                    Room
                  </button>
                </div>
              </div>
              <div className="ribbon-panel-title">Select Mode</div>
            </section>
          </RibbonBodyShell>
        ) : null}

        {tab === 'annotate' ? (
          <RibbonBodyShell testId="annotate-ribbon">
            <section className="ribbon-panel" aria-label="Text">
              <div className="ribbon-panel-body">
                <button
                  type="button"
                  className={`ribbon-large${isActive('text') ? ' active' : ''}`}
                  data-testid="annotate-tool-text"
                  title={tip('Text', ['TEXT', 'DT'])}
                  onClick={() => props.onActivateTool('text')}
                >
                  {Icons.text}
                  <span>Text</span>
                </button>
                <div className="ribbon-stack">
                  <button
                    type="button"
                    className="ribbon-small"
                    disabled
                    title="Multiline Text (MTEXT) — not yet implemented"
                    data-testid="annotate-tool-mtext"
                  >
                    Multiline Text
                  </button>
                  <button
                    type="button"
                    className="ribbon-small"
                    title="Edit selected text — Properties panel"
                    onClick={props.onScrollToProperties}
                  >
                    Edit Text…
                  </button>
                </div>
              </div>
              <div className="ribbon-panel-title">Text</div>
            </section>

            <section className="ribbon-panel" aria-label="Dimensions">
              <div className="ribbon-panel-body">
                <Flyout
                  open={annotateDimOpen}
                  onOpenChange={setAnnotateDimOpen}
                  trigger={
                    <button
                      type="button"
                      className={`ribbon-large${props.activeTool === 'dimension' ? ' active' : ''}`}
                      data-testid="annotate-tool-dimension"
                      title={tip('Dimension', ['DIM'])}
                      onClick={() => {
                        props.onActivateTool('dimension', 'aligned');
                        setAnnotateDimOpen((v) => !v);
                      }}
                    >
                      {Icons.dimension}
                      <span>
                        Dimension <span className="caret">▾</span>
                      </span>
                    </button>
                  }
                >
                  {(
                    [
                      ['aligned', 'Aligned'],
                      ['horizontal', 'Linear (Horizontal)'],
                      ['vertical', 'Linear (Vertical)'],
                      ['angular', 'Angular'],
                      ['radius', 'Radius'],
                      ['diameter', 'Diameter'],
                    ] as Array<[DimensionKind, string]>
                  )
                    .filter(([kind]) =>
                      (SUPPORTED_DIMENSION_KINDS as readonly string[]).includes(
                        kind,
                      ),
                    )
                    .map(([kind, label]) => (
                      <button
                        key={kind}
                        type="button"
                        data-testid={`annotate-dim-${kind}`}
                        onClick={() => {
                          props.onActivateTool('dimension', kind);
                          setAnnotateDimOpen(false);
                        }}
                      >
                        {Icons.dimension} {label}
                      </button>
                    ))}
                </Flyout>
                <div className="ribbon-stack">
                  <button
                    type="button"
                    className={`ribbon-small${isActive('dimension', 'aligned') ? ' active' : ''}`}
                    title={tip('Aligned Dimension', ['DIM'])}
                    onClick={() => props.onActivateTool('dimension', 'aligned')}
                  >
                    Aligned
                  </button>
                  <button
                    type="button"
                    className={`ribbon-small${isActive('dimension', 'horizontal') ? ' active' : ''}`}
                    title="Linear horizontal dimension"
                    onClick={() =>
                      props.onActivateTool('dimension', 'horizontal')
                    }
                  >
                    Linear
                  </button>
                  <button
                    type="button"
                    className={`ribbon-small${isActive('dimension', 'angular') ? ' active' : ''}`}
                    title="Angular dimension"
                    onClick={() => props.onActivateTool('dimension', 'angular')}
                  >
                    Angular
                  </button>
                  <button
                    type="button"
                    className={`ribbon-small${isActive('dimension', 'radius') ? ' active' : ''}`}
                    title="Radius dimension"
                    onClick={() => props.onActivateTool('dimension', 'radius')}
                  >
                    Radius
                  </button>
                </div>
              </div>
              <div className="ribbon-panel-title">Dimensions</div>
            </section>

            <section className="ribbon-panel" aria-label="Leaders">
              <div className="ribbon-panel-body">
                <button
                  type="button"
                  className={`ribbon-large${isActive('leader') ? ' active' : ''}`}
                  data-testid="annotate-tool-leader"
                  title={tip('Leader', ['LEADER', 'LE'])}
                  onClick={() => props.onActivateTool('leader')}
                >
                  {Icons.leader}
                  <span>Leader</span>
                </button>
                <div className="ribbon-stack">
                  <button
                    type="button"
                    className="ribbon-small"
                    disabled
                    title="Multileader — not yet implemented"
                  >
                    Multileader
                  </button>
                  <button
                    type="button"
                    className="ribbon-small"
                    title="Edit selected leader text — Properties panel"
                    onClick={props.onScrollToProperties}
                  >
                    Edit Leader…
                  </button>
                </div>
              </div>
              <div className="ribbon-panel-title">Leaders</div>
            </section>

            <section className="ribbon-panel" aria-label="Annotation Settings">
              <div className="ribbon-panel-body">
                <button
                  type="button"
                  className="ribbon-large"
                  data-testid="annotate-dimstyle"
                  title={tip('Dimension Style Manager', ['DIMSTYLE', 'D'])}
                  onClick={props.onOpenDimStyle}
                >
                  {Icons.dimstyle}
                  <span>Dim Style</span>
                </button>
                <div className="ribbon-stack">
                  <button
                    type="button"
                    className="ribbon-small"
                    data-testid="annotate-units"
                    title={tip('Drawing Units', ['UNITS'])}
                    onClick={props.onOpenUnits}
                  >
                    Units…
                  </button>
                  <button
                    type="button"
                    className="ribbon-small"
                    disabled
                    data-testid="annotate-scale"
                    title={`Annotation scale (${props.annotationScaleLabel}) — UI editor not yet implemented`}
                  >
                    Ann. Scale
                  </button>
                  <button
                    type="button"
                    className="ribbon-small"
                    disabled
                    title="Table — not yet implemented"
                  >
                    Table
                  </button>
                </div>
              </div>
              <div className="ribbon-panel-title">Annotation Settings</div>
            </section>

            <section className="ribbon-panel" aria-label="Select Mode">
              <div className="ribbon-panel-body">
                <button
                  type="button"
                  className={`ribbon-large${isActive('select') ? ' active' : ''}`}
                  data-testid="annotate-tool-select"
                  title={tip('Selection Mode', ['ESC'])}
                  onClick={() => props.onActivateTool('select')}
                >
                  {Icons.select}
                  <span>Select</span>
                </button>
              </div>
              <div className="ribbon-panel-title">Select Mode</div>
            </section>
          </RibbonBodyShell>
        ) : null}

        {tab === 'view' ? (
          <RibbonBodyShell testId="view-ribbon">
            <section className="ribbon-panel" aria-label="Navigation">
              <div className="ribbon-panel-body">
                <button
                  type="button"
                  className={`ribbon-large${isActive('pan') ? ' active' : ''}`}
                  data-testid="view-tool-pan"
                  title={tip('Pan', ['P', 'PAN'])}
                  onClick={props.onPanNavigation}
                >
                  {Icons.pan}
                  <span>Pan</span>
                </button>
                <div className="ribbon-row-large">
                  <button
                    type="button"
                    className="ribbon-large"
                    data-testid="view-zoom-extents"
                    title={tip('Zoom Extents', ['ZE', 'ZOOM E'])}
                    onClick={props.onZoomExtents}
                  >
                    {Icons.zoomExtents}
                    <span>Extents</span>
                  </button>
                  <button
                    type="button"
                    className="ribbon-large"
                    data-testid="view-zoom-window"
                    title={tip('Zoom Window', ['ZOOM W'])}
                    onClick={props.onZoomWindow}
                  >
                    {Icons.zoomWindow}
                    <span>Window</span>
                  </button>
                  <button
                    type="button"
                    className="ribbon-large"
                    data-testid="view-zoom-previous"
                    title={tip('Previous View', ['ZOOM P'])}
                    onClick={props.onZoomPrevious}
                  >
                    {Icons.zoomPrevious}
                    <span>Previous</span>
                  </button>
                </div>
              </div>
              <div className="ribbon-panel-title">Navigation</div>
            </section>

            <section className="ribbon-panel" aria-label="Viewport">
              <div className="ribbon-panel-body">
                <div className="ribbon-prop-stack">
                  <label className="ribbon-prop-label" title="View orientation (2D)">
                    <span>Orientation</span>
                    <select
                      className="ribbon-select"
                      data-testid="view-orientation"
                      value="TOP"
                      disabled
                      aria-label="View orientation"
                    >
                      <option value="TOP">Top</option>
                    </select>
                  </label>
                  <label className="ribbon-prop-label" title="Visual style (2D Wireframe)">
                    <span>Visual Style</span>
                    <select
                      className="ribbon-select"
                      data-testid="view-visual-style"
                      value="2D"
                      disabled
                      aria-label="Visual style"
                    >
                      <option value="2D">2D Wireframe</option>
                    </select>
                  </label>
                </div>
                <div className="ribbon-stack">
                  <button
                    type="button"
                    className="ribbon-small"
                    disabled
                    title="Orbit / 3D navigation — not implemented"
                  >
                    Orbit
                  </button>
                  <button
                    type="button"
                    className="ribbon-small"
                    disabled
                    title="ViewCube — not implemented"
                  >
                    ViewCube
                  </button>
                </div>
              </div>
              <div className="ribbon-panel-title">Viewport</div>
            </section>

            <section className="ribbon-panel" aria-label="Display">
              <div className="ribbon-panel-body">
                <div className="ribbon-stack">
                  <button
                    type="button"
                    className={`ribbon-small${props.gridOn ? ' active' : ''}`}
                    data-testid="view-toggle-grid"
                    title="Toggle Grid display (F7)"
                    onClick={props.onToggleGrid}
                  >
                    Grid
                  </button>
                  <button
                    type="button"
                    className={`ribbon-small${props.snapOn ? ' active' : ''}`}
                    data-testid="view-toggle-snap"
                    title="Toggle Grid Snap (F3)"
                    onClick={props.onToggleSnap}
                  >
                    Snap
                  </button>
                  <button
                    type="button"
                    className={`ribbon-small${props.orthoOn ? ' active' : ''}`}
                    data-testid="view-toggle-ortho"
                    title="Toggle Ortho (F8)"
                    onClick={props.onToggleOrtho}
                  >
                    Ortho
                  </button>
                  <button
                    type="button"
                    className={`ribbon-small${props.polarOn ? ' active' : ''}`}
                    data-testid="view-toggle-polar"
                    title={`Toggle Polar (F10) · ${props.polarIncrement}°`}
                    onClick={props.onTogglePolar}
                  >
                    Polar {props.polarIncrement}°
                  </button>
                </div>
                <div className="ribbon-prop-stack ribbon-cursor-prefs">
                  <label className="ribbon-prop-label" title="Crosshair size">
                    <span>Crosshair</span>
                    <select
                      className="ribbon-select"
                      data-testid="view-crosshair-size"
                      aria-label="Crosshair size"
                      value={props.crosshairSize}
                      onChange={(e) =>
                        props.onCrosshairSizeChange(
                          e.target.value as CrosshairSize,
                        )
                      }
                    >
                      <option value="small">Small</option>
                      <option value="medium">Medium</option>
                      <option value="large">Large</option>
                      <option value="fullscreen">Full Screen</option>
                    </select>
                  </label>
                  <label className="ribbon-prop-label" title="Pickbox size">
                    <span>Pickbox</span>
                    <select
                      className="ribbon-select"
                      data-testid="view-pickbox-size"
                      aria-label="Pickbox size"
                      value={props.pickboxSize}
                      onChange={(e) =>
                        props.onPickboxSizeChange(e.target.value as PickboxSize)
                      }
                    >
                      <option value="small">Small</option>
                      <option value="medium">Medium</option>
                      <option value="large">Large</option>
                    </select>
                  </label>
                </div>
              </div>
              <div className="ribbon-panel-title">Display</div>
            </section>

            <section className="ribbon-panel" aria-label="Model / Layout">
              <div className="ribbon-panel-body">
                <button
                  type="button"
                  className={`ribbon-large${props.workspaceMode === 'MODEL_SPACE' ? ' active' : ''}`}
                  data-testid="view-switch-model"
                  title="Switch to Model Space"
                  onClick={props.onSwitchToModel}
                >
                  <span>Model</span>
                </button>
                <div className="ribbon-prop-stack">
                  <label className="ribbon-prop-label" title="Active layout">
                    <span>Layout</span>
                    <select
                      className="ribbon-select"
                      data-testid="view-layout-select"
                      aria-label="Layout"
                      value={props.activeLayoutId ?? ''}
                      onChange={(e) => {
                        const id = e.target.value;
                        if (!id) props.onSwitchToModel();
                        else props.onSwitchToLayout(id as LayoutId);
                      }}
                    >
                      <option value="">Model</option>
                      {props.layouts.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="ribbon-prop-label">
                    <span>Mode</span>
                    <div className="ribbon-mode-readout" data-testid="view-workspace-mode">
                      {props.workspaceMode === 'MODEL_SPACE'
                        ? 'Model Space'
                        : props.workspaceMode === 'PAPER_SPACE'
                          ? 'Paper Space'
                          : 'Viewport Model'}
                    </div>
                  </div>
                </div>
              </div>
              <div className="ribbon-panel-title">Model / Layout</div>
            </section>

            <section className="ribbon-panel" aria-label="Select Mode">
              <div className="ribbon-panel-body">
                <button
                  type="button"
                  className={`ribbon-large${isActive('select') ? ' active' : ''}`}
                  data-testid="view-tool-select"
                  title={tip('Selection Mode', ['ESC'])}
                  onClick={() => props.onActivateTool('select')}
                >
                  {Icons.select}
                  <span>Select</span>
                </button>
              </div>
              <div className="ribbon-panel-title">Select Mode</div>
            </section>
          </RibbonBodyShell>
        ) : null}

        {tab === 'manage' ? (
          <RibbonBodyShell testId="manage-ribbon">
            <section className="ribbon-panel" aria-label="Drawing Settings">
              <div className="ribbon-panel-body">
                <button
                  type="button"
                  className="ribbon-large"
                  data-testid="manage-units"
                  title={tip('Drawing Units', ['UNITS'])}
                  onClick={props.onOpenUnits}
                >
                  <span>Units</span>
                </button>
                <div className="ribbon-stack">
                  <button
                    type="button"
                    className="ribbon-small"
                    data-testid="manage-dimstyle"
                    title={tip('Dimension Style', ['DIMSTYLE'])}
                    onClick={props.onOpenDimStyle}
                  >
                    Dim Style…
                  </button>
                  <button
                    type="button"
                    className="ribbon-small"
                    title="Open Properties panel"
                    onClick={props.onScrollToProperties}
                  >
                    Properties…
                  </button>
                </div>
              </div>
              <div className="ribbon-panel-title">Drawing Settings</div>
            </section>

            <section className="ribbon-panel" aria-label="Layers">
              <div className="ribbon-panel-body">
                <button
                  type="button"
                  className="ribbon-large"
                  data-testid="manage-layer-props"
                  title="Layer Properties — open layers list"
                  onClick={props.onScrollToLayers}
                >
                  {Icons.layers}
                  <span>Layer Props</span>
                </button>
                <div className="ribbon-layer-main">
                  <div className="ribbon-layer-row">
                    <label className="sr-only" htmlFor={manageLayerSelectId}>
                      Current layer
                    </label>
                    <span
                      className="ribbon-swatch"
                      style={{ background: currentLayer?.color ?? '#ccc' }}
                    />
                    <select
                      id={manageLayerSelectId}
                      className="ribbon-select"
                      data-testid="manage-layer-select"
                      value={props.currentLayerId}
                      onChange={(e) => props.onSetCurrentLayer(e.target.value)}
                    >
                      {props.layers.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="ribbon-layer-actions">
                    <button
                      type="button"
                      className="ribbon-icon-btn"
                      title="Toggle current layer visibility"
                      disabled={!currentLayer}
                      onClick={() =>
                        currentLayer && props.onToggleLayerVisible(currentLayer)
                      }
                    >
                      {currentLayer?.visible === false ? 'Show' : 'Hide'}
                    </button>
                    <button
                      type="button"
                      className="ribbon-icon-btn"
                      title="Toggle current layer lock"
                      disabled={!currentLayer}
                      onClick={() =>
                        currentLayer && props.onToggleLayerLocked(currentLayer)
                      }
                    >
                      {currentLayer?.locked ? 'Unlock' : 'Lock'}
                    </button>
                    <button
                      type="button"
                      className="ribbon-icon-btn"
                      title="Add layer"
                      onClick={props.onAddLayer}
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>
              <div className="ribbon-panel-title">Layers</div>
            </section>

            <section className="ribbon-panel" aria-label="Drawing Utilities">
              <div className="ribbon-panel-body">
                <button
                  type="button"
                  className={`ribbon-large${isActive('area') ? ' active' : ''}`}
                  data-testid="manage-area"
                  title={tip('Area', ['AREA'])}
                  onClick={() => props.onActivateAreaMode('object')}
                >
                  <span>Area</span>
                </button>
                <div className="ribbon-stack">
                  <button
                    type="button"
                    className="ribbon-small"
                    data-testid="manage-distance"
                    title={tip('Distance', ['DIST', 'DI'])}
                    onClick={() => props.onRunCommand('DIST')}
                  >
                    Distance
                  </button>
                  <button
                    type="button"
                    className="ribbon-small"
                    disabled
                    title="Drawing audit — not yet implemented"
                  >
                    Audit
                  </button>
                </div>
              </div>
              <div className="ribbon-panel-title">Drawing Utilities</div>
            </section>

            <section className="ribbon-panel" aria-label="Document Management">
              <div className="ribbon-panel-body">
                <button
                  type="button"
                  className="ribbon-large"
                  data-testid="manage-new"
                  title={tip('New', ['CTRL+N'])}
                  onClick={props.onNew}
                >
                  {Icons.newDoc}
                  <span>New</span>
                </button>
                <div className="ribbon-stack">
                  <button
                    type="button"
                    className="ribbon-small"
                    data-testid="manage-open"
                    title={tip('Open', ['CTRL+O'])}
                    onClick={props.onOpen}
                  >
                    {Icons.open} Open
                  </button>
                  <button
                    type="button"
                    className="ribbon-small"
                    data-testid="manage-save"
                    title={tip('Save', ['CTRL+S'])}
                    onClick={props.onSave}
                  >
                    {Icons.save} Save
                  </button>
                  <button
                    type="button"
                    className="ribbon-small"
                    data-testid="manage-save-as"
                    title={tip('Save As', ['CTRL+SHIFT+S'])}
                    onClick={props.onSaveAs}
                  >
                    {Icons.saveAs} Save As
                  </button>
                  <button
                    type="button"
                    className="ribbon-small"
                    disabled
                    title="Multiple drawing sessions — not yet implemented (P3-B)"
                  >
                    Multi-Doc
                  </button>
                </div>
              </div>
              <div className="ribbon-panel-title">Document Management</div>
            </section>

            <section className="ribbon-panel" aria-label="Select Mode">
              <div className="ribbon-panel-body">
                <button
                  type="button"
                  className={`ribbon-large${isActive('select') ? ' active' : ''}`}
                  data-testid="manage-tool-select"
                  title={tip('Selection Mode', ['ESC'])}
                  onClick={() => props.onActivateTool('select')}
                >
                  {Icons.select}
                  <span>Select</span>
                </button>
              </div>
              <div className="ribbon-panel-title">Select Mode</div>
            </section>
          </RibbonBodyShell>
        ) : null}
      </div>

      <DocumentTabs
        tabs={props.documentTabs}
        activeSessionId={props.activeSessionId}
        multiDocumentActionsEnabled={props.multiDocumentActionsEnabled}
      />
    </>
  );
}

export function AreaModeStrip(props: {
  areaMode: AreaToolMode;
  hasResult: boolean;
  onActivateAreaMode: (mode: AreaToolMode) => void;
  onCreateBoundary: () => void;
  onAreaLabel: () => void;
  onAllRooms: () => void;
}) {
  return (
    <div className="area-mode-strip" aria-label="AREA modes">
      <span className="tool-group-label">AREA</span>
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
          className={`tool-btn${props.areaMode === mode ? ' active' : ''}`}
          onClick={() => props.onActivateAreaMode(mode)}
        >
          {label}
        </button>
      ))}
      {props.hasResult ? (
        <>
          <button type="button" className="tool-btn" onClick={props.onCreateBoundary}>
            Create Boundary
          </button>
          <button type="button" className="tool-btn" onClick={props.onAreaLabel}>
            Area Label
          </button>
        </>
      ) : null}
      <button
        type="button"
        className="tool-btn"
        onClick={props.onAllRooms}
        title="Report all room areas"
      >
        All Rooms
      </button>
    </div>
  );
}
