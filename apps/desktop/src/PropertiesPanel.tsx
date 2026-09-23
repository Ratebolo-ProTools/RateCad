import {
  ChangeEntitiesAppearanceCommand,
  SetCurrentAppearanceCommand,
  SetCurrentLayerCommand,
  SetShowLineweightsCommand,
  UpdateEntityGeometryPropertyCommand,
} from '@ratecad/commands';
import type { CommandBus } from '@ratecad/commands';
import {
  LINEWEIGHT_REGISTRY_MM,
  LINETYPE_REGISTRY,
  NAMED_COLORS,
  parseColorInput,
  rgbToHex,
  type ColorProperty,
  type DrawingDocument,
  type Entity,
  type LayerId,
  type LinetypeProperty,
  type LineweightProperty,
  type TransparencyProperty,
} from '@ratecad/core';
import {
  canEditEntityProperties,
  colorEqual,
  commonValue,
  formatColorLabel,
  formatLinetypeLabel,
  formatLineweightLabel,
  formatTransparencyLabel,
  getCurrentAppearance,
  getGeometryPropertyValue,
  getPropertyDescriptors,
  getStoredAppearance,
  parseLength,
  resolveEffectiveAppearance,
  type AppearancePatch,
} from '@ratecad/geometry';

const VARIES = '*VARIES*';

function formatStoredColor(c: ColorProperty): string {
  return formatColorLabel(c);
}

type Props = {
  doc: DrawingDocument;
  bus: CommandBus;
  compact?: boolean;
  fmtLen: (world: number) => string;
};

export function PropertiesPanel({ doc, bus, compact, fmtLen }: Props) {
  const selected = doc.selection
    .map((id) => doc.entities.find((e) => e.id === id))
    .filter((e): e is Entity => !!e);

  const current = getCurrentAppearance(doc);
  const lockedNote =
    selected.length === 1 && !canEditEntityProperties(selected[0]!, doc)
      ? ` (${doc.layers.find((l) => l.id === selected[0]!.layerId)?.locked ? 'Locked' : 'Locked object'})`
      : '';

  const applyToSelection = (patch: AppearancePatch) => {
    if (selected.length === 0) return;
    const ids = selected
      .filter((e) => canEditEntityProperties(e, doc))
      .map((e) => e.id);
    if (!ids.length) return;
    bus.execute(new ChangeEntitiesAppearanceCommand(ids, patch));
  };

  const applyCurrent = (patch: Partial<typeof current>) => {
    bus.execute(new SetCurrentAppearanceCommand(patch));
  };

  const title =
    selected.length === 0
      ? 'Current Properties'
      : selected.length === 1
        ? `${selected[0]!.type}${lockedNote}`
        : `${selected.length} objects`;

  const layerCommon =
    selected.length === 0
      ? doc.currentLayerId
      : commonValue(selected.map((e) => e.layerId));

  const colorCommon =
    selected.length === 0
      ? current.color
      : commonValue(
          selected.map((e) => getStoredAppearance(e).color),
          colorEqual,
        );

  const ltCommon =
    selected.length === 0
      ? current.linetype
      : commonValue(
          selected.map((e) => getStoredAppearance(e).linetype),
          (a, b) =>
            a.mode === b.mode &&
            (a.mode !== 'EXPLICIT' ||
              b.mode !== 'EXPLICIT' ||
              a.value === b.value),
        );

  const lwCommon =
    selected.length === 0
      ? current.lineweight
      : commonValue(
          selected.map((e) => getStoredAppearance(e).lineweight),
          (a, b) =>
            a.mode === b.mode &&
            (a.mode !== 'EXPLICIT' ||
              b.mode !== 'EXPLICIT' ||
              a.value === b.value),
        );

  const trCommon =
    selected.length === 0
      ? current.transparency
      : commonValue(
          selected.map((e) => getStoredAppearance(e).transparency),
          (a, b) =>
            a.mode === b.mode &&
            (a.mode !== 'EXPLICIT' ||
              b.mode !== 'EXPLICIT' ||
              a.value === b.value),
        );

  const ltsCommon =
    selected.length === 0
      ? current.linetypeScale
      : commonValue(selected.map((e) => getStoredAppearance(e).linetypeScale));

  const effectivePreview =
    selected.length === 1
      ? resolveEffectiveAppearance(selected[0]!, doc)
      : null;

  const onColorChange = (raw: string) => {
    if (raw === VARIES) return;
    let color: ColorProperty;
    if (raw === 'BY_LAYER') color = { mode: 'BY_LAYER' };
    else if (NAMED_COLORS[raw]) {
      color = { mode: 'EXPLICIT', value: { ...NAMED_COLORS[raw]! } };
    } else {
      const parsed = parseColorInput(raw);
      if (!parsed) return;
      color = parsed;
    }
    if (selected.length === 0) applyCurrent({ color });
    else applyToSelection({ color });
  };

  const onLinetypeChange = (raw: string) => {
    const linetype: LinetypeProperty =
      raw === 'BY_LAYER'
        ? { mode: 'BY_LAYER' }
        : { mode: 'EXPLICIT', value: raw };
    if (selected.length === 0) applyCurrent({ linetype });
    else applyToSelection({ linetype });
  };

  const onLineweightChange = (raw: string) => {
    const lineweight: LineweightProperty =
      raw === 'BY_LAYER'
        ? { mode: 'BY_LAYER' }
        : { mode: 'EXPLICIT', value: Number(raw) };
    if (selected.length === 0) applyCurrent({ lineweight });
    else applyToSelection({ lineweight });
  };

  const onTransparencyChange = (raw: string) => {
    const transparency: TransparencyProperty =
      raw === 'BY_LAYER'
        ? { mode: 'BY_LAYER' }
        : { mode: 'EXPLICIT', value: Number(raw) };
    if (selected.length === 0) applyCurrent({ transparency });
    else applyToSelection({ transparency });
  };

  const colorSelectValue =
    colorCommon === null
      ? VARIES
      : colorCommon === undefined
        ? 'BY_LAYER'
        : colorCommon.mode === 'BY_LAYER'
          ? 'BY_LAYER'
          : colorCommon.mode === 'EXPLICIT'
            ? rgbToHex(colorCommon.value).toUpperCase()
            : 'BY_LAYER';

  return (
    <section className={`panel-section properties-engine${compact ? ' compact' : ''}`}>
      <h2 className="panel-title">{title}</h2>

      <div className="prop-row">
        <label>Layer</label>
        <select
          className="prop-select"
          data-cad-property="1"
          value={layerCommon === null ? VARIES : (layerCommon ?? doc.currentLayerId)}
          disabled={selected.length > 0 && selected.every((e) => !canEditEntityProperties(e, doc))}
          onChange={(e) => {
            const layerId = e.target.value as LayerId;
            if (layerId === VARIES) return;
            if (selected.length === 0) {
              bus.execute(
                new SetCurrentLayerCommand(doc.currentLayerId, layerId),
              );
            } else {
              applyToSelection({ layerId });
            }
          }}
          aria-label="Layer"
        >
          {layerCommon === null ? (
            <option value={VARIES}>{VARIES}</option>
          ) : null}
          {doc.layers.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
              {l.locked ? ' (Locked)' : ''}
            </option>
          ))}
        </select>
      </div>

      <div className="prop-row">
        <label>Color</label>
        <select
          className="prop-select"
          data-cad-property="1"
          value={
            colorSelectValue === VARIES
              ? VARIES
              : colorSelectValue === 'BY_LAYER'
                ? 'BY_LAYER'
                : Object.entries(NAMED_COLORS).find(
                    ([, rgb]) => rgbToHex(rgb).toUpperCase() === colorSelectValue,
                  )?.[0] ?? 'CUSTOM'
          }
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'CUSTOM') {
              const hex = window.prompt('Custom color (#RRGGBB or rgb)', '#FF0000');
              if (hex) onColorChange(hex);
              return;
            }
            onColorChange(v === 'BY_LAYER' ? 'BY_LAYER' : v);
          }}
          aria-label="Color"
        >
          {colorCommon === null ? <option value={VARIES}>{VARIES}</option> : null}
          <option value="BY_LAYER">ByLayer</option>
          {Object.keys(NAMED_COLORS).map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
          <option value="CUSTOM">Custom Color…</option>
        </select>
      </div>

      {effectivePreview ? (
        <div className="prop-row">
          <label>Effective</label>
          <div className="value" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                width: 12,
                height: 12,
                background: effectivePreview.colorHex,
                border: '1px solid #555',
                display: 'inline-block',
              }}
            />
            {effectivePreview.colorHex.toUpperCase()}
          </div>
        </div>
      ) : colorCommon && colorCommon !== null && colorCommon.mode === 'BY_LAYER' ? (
        <div className="prop-row">
          <label>Stored</label>
          <div className="value">{formatStoredColor(colorCommon)}</div>
        </div>
      ) : null}

      <div className="prop-row">
        <label>Linetype</label>
        <select
          className="prop-select"
          data-cad-property="1"
          value={
            ltCommon === null
              ? VARIES
              : ltCommon?.mode === 'EXPLICIT'
                ? ltCommon.value
                : 'BY_LAYER'
          }
          onChange={(e) => onLinetypeChange(e.target.value)}
          aria-label="Linetype"
        >
          {ltCommon === null ? <option value={VARIES}>{VARIES}</option> : null}
          <option value="BY_LAYER">ByLayer</option>
          {LINETYPE_REGISTRY.map((lt) => (
            <option key={lt.id} value={lt.id}>
              {lt.name}
            </option>
          ))}
        </select>
      </div>

      {!compact ? (
        <div className="prop-row">
          <label>LT Scale</label>
          <input
            className="prop-input"
            data-cad-property="1"
            type="number"
            step="0.1"
            min="0.01"
            value={ltsCommon === null ? '' : (ltsCommon ?? 1)}
            placeholder={ltsCommon === null ? VARIES : undefined}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (!Number.isFinite(n) || n <= 0) return;
              if (selected.length === 0) applyCurrent({ linetypeScale: n });
              else applyToSelection({ linetypeScale: n });
            }}
            aria-label="Linetype scale"
          />
        </div>
      ) : null}

      <div className="prop-row">
        <label>Lineweight</label>
        <select
          className="prop-select"
          data-cad-property="1"
          value={
            lwCommon === null
              ? VARIES
              : lwCommon?.mode === 'EXPLICIT'
                ? String(lwCommon.value)
                : 'BY_LAYER'
          }
          onChange={(e) => onLineweightChange(e.target.value)}
          aria-label="Lineweight"
        >
          {lwCommon === null ? <option value={VARIES}>{VARIES}</option> : null}
          <option value="BY_LAYER">ByLayer</option>
          {LINEWEIGHT_REGISTRY_MM.map((mm) => (
            <option key={mm} value={String(mm)}>
              {mm.toFixed(2)} mm
            </option>
          ))}
        </select>
      </div>

      <div className="prop-row">
        <label>Transparency</label>
        <select
          className="prop-select"
          data-cad-property="1"
          value={
            trCommon === null
              ? VARIES
              : trCommon?.mode === 'EXPLICIT'
                ? String(trCommon.value)
                : 'BY_LAYER'
          }
          onChange={(e) => onTransparencyChange(e.target.value)}
          aria-label="Transparency"
        >
          {trCommon === null ? <option value={VARIES}>{VARIES}</option> : null}
          <option value="BY_LAYER">ByLayer</option>
          {[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((p) => (
            <option key={p} value={String(p)}>
              {p}%
            </option>
          ))}
        </select>
      </div>

      {!compact ? (
        <div className="prop-row">
          <label>Show LW</label>
          <select
            className="prop-select"
            data-cad-property="1"
            value={doc.settings.showLineweights ? 'on' : 'off'}
            onChange={(e) => {
              bus.execute(new SetShowLineweightsCommand(e.target.value === 'on'));
            }}
            aria-label="Show lineweights"
          >
            <option value="on">ON</option>
            <option value="off">OFF</option>
          </select>
        </div>
      ) : null}

      {selected.length === 1 && !compact
        ? getPropertyDescriptors(selected[0]!)
            .filter((d) => d.category === 'geometry')
            .map((d) => {
              const raw = getGeometryPropertyValue(selected[0]!, d.key);
              const display =
                typeof raw === 'number'
                  ? d.dataType === 'angle'
                    ? `${raw.toFixed(2)}°`
                    : d.dataType === 'area'
                      ? String(raw)
                      : fmtLen(raw)
                  : raw == null
                    ? '—'
                    : String(raw);
              return (
                <div className="prop-row" key={d.key}>
                  <label>{d.label}</label>
                  {d.editable && typeof raw === 'number' ? (
                    <input
                      className="prop-input"
                      data-cad-property="1"
                      defaultValue={
                        d.dataType === 'angle' ? String(raw) : undefined
                      }
                      key={`${selected[0]!.id}-${d.key}-${raw}`}
                      placeholder={display}
                      disabled={!canEditEntityProperties(selected[0]!, doc)}
                      onBlur={(e) => {
                        const text = e.target.value.trim();
                        if (!text) return;
                        let value: number;
                        if (d.dataType === 'angle') {
                          value = Number(text.replace(/°/g, ''));
                        } else {
                          const parsed = parseLength(
                            text,
                            doc.settings.worldUnit ?? 'ft',
                            doc.settings.units,
                          );
                          if (!parsed) return;
                          value = parsed.worldValue;
                        }
                        if (!Number.isFinite(value)) return;
                        bus.execute(
                          new UpdateEntityGeometryPropertyCommand(
                            selected[0]!.id,
                            d.key,
                            value,
                          ),
                        );
                      }}
                      aria-label={d.label}
                    />
                  ) : (
                    <div className="value">{display}</div>
                  )}
                </div>
              );
            })
        : null}

      {selected.length === 1 && compact && selected[0]!.type === 'line' ? (
        <>
          <div className="prop-row">
            <label>Length</label>
            <div className="value">
              {fmtLen(Number(getGeometryPropertyValue(selected[0]!, 'length') ?? 0))}
            </div>
          </div>
          <div className="prop-row">
            <label>Angle</label>
            <div className="value">
              {Number(getGeometryPropertyValue(selected[0]!, 'angle') ?? 0).toFixed(2)}°
            </div>
          </div>
        </>
      ) : null}

      {selected.length === 1 ? (
        <div className="prop-row">
          <label>Summary</label>
          <div className="value" style={{ fontSize: 11, opacity: 0.85 }}>
            {[
              formatColorLabel(getStoredAppearance(selected[0]!).color),
              formatLinetypeLabel(getStoredAppearance(selected[0]!).linetype),
              formatLineweightLabel(getStoredAppearance(selected[0]!).lineweight),
              formatTransparencyLabel(getStoredAppearance(selected[0]!).transparency),
            ].join(' · ')}
          </div>
        </div>
      ) : null}
    </section>
  );
}
