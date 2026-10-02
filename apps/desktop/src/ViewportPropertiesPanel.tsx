import {
  SetViewportLayerOverrideCommand,
  SetViewportLockedCommand,
  SetViewportScaleCommand,
  type CommandBus,
} from '@ratecad/commands';
import {
  VIEWPORT_SCALE_PRESETS,
  countViewportLayerOverrides,
  formatViewportScale,
  ratioFromScale,
  scaleFromRatio,
  type DrawingDocument,
  type LayoutId,
  type LayoutViewport,
  type ViewportId,
} from '@ratecad/core';

type Props = {
  doc: DrawingDocument;
  bus: CommandBus;
  layoutId: LayoutId;
  viewportId: ViewportId;
  viewportIndex: number;
};

export function ViewportPropertiesPanel({
  doc,
  bus,
  layoutId,
  viewportId,
  viewportIndex,
}: Props) {
  const layout = doc.layouts.find((l) => l.id === layoutId);
  const vp = layout?.viewports.find((v) => v.id === viewportId);
  if (!layout || !vp) {
    return (
      <section className="panel-section properties-engine">
        <h2 className="panel-title">Properties</h2>
        <p className="empty-props">Viewport not found.</p>
      </section>
    );
  }

  const applyScale = (scale: number) => {
    if (!(scale > 0) || !Number.isFinite(scale)) return;
    if (Math.abs(scale - vp.scale) < 1e-12) return;
    bus.execute(new SetViewportScaleCommand(layoutId, vp, scale));
  };

  const applyLocked = (locked: boolean) => {
    if (locked === vp.locked) return;
    bus.execute(new SetViewportLockedCommand(layoutId, vp, locked));
  };

  const applyLayerOverride = (layerId: string, visible: boolean) => {
    const current = vp.layerVisibilityOverrides[layerId];
    // If no override and setting visible (default), skip
    if (current === undefined && visible) return;
    if (current === visible) return;
    // Setting to match global default (visible) clears override when layer is globally visible
    const layer = doc.layers.find((l) => l.id === layerId);
    const clear =
      visible && layer?.visible !== false
        ? null
        : visible;
    bus.execute(
      new SetViewportLayerOverrideCommand(
        layoutId,
        vp,
        layerId,
        clear === null ? null : visible,
      ),
    );
  };

  const preset = VIEWPORT_SCALE_PRESETS.find(
    (n) => Math.abs(scaleFromRatio(n) - vp.scale) < 1e-9,
  );
  const selectValue = preset != null ? String(preset) : 'custom';
  const overrideCount = countViewportLayerOverrides(vp);

  return (
    <section className="panel-section properties-engine">
      <h2 className="panel-title">Properties</h2>
      <div className="prop-row">
        <label>Type</label>
        <span className="value">Viewport</span>
      </div>
      <div className="prop-row">
        <label>Name</label>
        <span className="value">Viewport {viewportIndex + 1}</span>
      </div>
      <div className="prop-row">
        <label>Layout</label>
        <span className="value">{layout.name}</span>
      </div>
      <div className="prop-row">
        <label>Width</label>
        <span className="value">
          {vp.width.toFixed(2)} {layout.pageSettings.units}
        </span>
      </div>
      <div className="prop-row">
        <label>Height</label>
        <span className="value">
          {vp.height.toFixed(2)} {layout.pageSettings.units}
        </span>
      </div>
      <div className="prop-row">
        <label>Scale</label>
        <span className="value">{formatViewportScale(vp.scale)}</span>
      </div>
      <div className="prop-row">
        <label>Set scale</label>
        <select
          className="prop-select"
          value={selectValue}
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'custom') {
              const raw = window.prompt(
                'Custom scale ratio N for 1:N',
                String(Math.round(ratioFromScale(vp.scale)) || 100),
              );
              if (raw == null) return;
              const n = Number(raw);
              if (!(n > 0)) return;
              applyScale(scaleFromRatio(n));
              return;
            }
            applyScale(scaleFromRatio(Number(v)));
          }}
        >
          {VIEWPORT_SCALE_PRESETS.map((n) => (
            <option key={n} value={String(n)}>
              1:{n}
            </option>
          ))}
          <option value="custom">Custom…</option>
        </select>
      </div>
      <div className="prop-row">
        <label>Locked</label>
        <select
          className="prop-select"
          value={vp.locked ? '1' : '0'}
          onChange={(e) => applyLocked(e.target.value === '1')}
        >
          <option value="0">Unlocked</option>
          <option value="1">Locked</option>
        </select>
      </div>
      <div className="prop-row">
        <label>Center X</label>
        <span className="value">{vp.modelCenterX.toFixed(4)}</span>
      </div>
      <div className="prop-row">
        <label>Center Y</label>
        <span className="value">{vp.modelCenterY.toFixed(4)}</span>
      </div>
      <div className="prop-row">
        <label>Rotation</label>
        <span className="value">{((vp.rotation * 180) / Math.PI).toFixed(2)}°</span>
      </div>
      <div className="prop-row">
        <label>Visible</label>
        <span className="value">{vp.visible ? 'Yes' : 'No'}</span>
      </div>
      <div className="prop-row">
        <label>Layer overrides</label>
        <span className="value">{overrideCount}</span>
      </div>

      <h3 className="panel-subtitle" style={{ marginTop: 12 }}>
        Viewport Layers
      </h3>
      <p className="empty-props" style={{ marginTop: 0 }}>
        Hide a layer in this viewport only. Global layer visibility still applies.
      </p>
      {doc.layers.map((layer) => {
        const ov = vp.layerVisibilityOverrides[layer.id];
        const effective =
          !layer.visible ? false : ov === false ? false : true;
        return (
          <div className="prop-row" key={layer.id}>
            <label title={layer.name}>{layer.name}</label>
            <select
              className="prop-select"
              value={effective ? '1' : '0'}
              disabled={!layer.visible}
              onChange={(e) =>
                applyLayerOverride(layer.id, e.target.value === '1')
              }
            >
              <option value="1">Visible</option>
              <option value="0">Hidden</option>
            </select>
          </div>
        );
      })}

      <p className="empty-props" style={{ marginTop: 8 }}>
        Scale changes the viewport model view only — model geometry is never
        duplicated or moved.
      </p>
    </section>
  );
}

/** Status line helper when a viewport is selected in Paper Space. */
export function viewportStatusLine(
  vp: LayoutViewport,
  index: number,
): string {
  return `Viewport ${index + 1} · Scale ${formatViewportScale(vp.scale)} · ${
    vp.locked ? 'Locked' : 'Unlocked'
  }`;
}
