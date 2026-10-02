/**
 * Dimension Style Manager (DIMSTYLE command).
 * Primary/alternate units are independent of drawing LUNITS.
 */

import type { DimensionStyleDefinition, LengthUnit } from '@ratecad/core';
import {
  LINEAR_UNIT_FORMATS,
  LINEAR_UNIT_FORMAT_LABELS,
  type LinearUnitFormat,
} from '@ratecad/core';
import { useMemo, useState } from 'react';

export interface DimStyleManagerProps {
  styles: DimensionStyleDefinition[];
  activeName: string;
  onSetActive: (name: string) => void;
  onUpdate: (style: DimensionStyleDefinition) => void;
  onCopy: (sourceName: string, newName: string) => void;
  onRename: (from: string, to: string) => void;
  onDelete: (name: string) => void;
  onClose: () => void;
}

type TabId =
  | 'primary'
  | 'alternate'
  | 'text'
  | 'lines'
  | 'symbols'
  | 'fit'
  | 'tolerances';

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'primary', label: 'Primary Units' },
  { id: 'alternate', label: 'Alternate Units' },
  { id: 'text', label: 'Text' },
  { id: 'lines', label: 'Lines' },
  { id: 'symbols', label: 'Symbols' },
  { id: 'fit', label: 'Fit' },
  { id: 'tolerances', label: 'Tolerances' },
];

const LENGTH_UNITS: LengthUnit[] = ['ft-in', 'ft', 'in', 'm', 'cm', 'mm'];

export function DimStyleManager({
  styles,
  activeName,
  onSetActive,
  onUpdate,
  onCopy,
  onRename,
  onDelete,
  onClose,
}: DimStyleManagerProps) {
  const [selectedName, setSelectedName] = useState(activeName);
  const [tab, setTab] = useState<TabId>('primary');
  const selected = useMemo(
    () => styles.find((s) => s.name === selectedName) ?? styles[0] ?? null,
    [styles, selectedName],
  );

  if (!selected) {
    return (
      <div className="modal-backdrop" role="dialog" aria-modal="true" data-cad-dialog="1">
        <div className="modal-panel">
          <h3>Dimension Style Manager</h3>
          <p>No dimension styles available.</p>
          <div className="modal-actions">
            <button type="button" className="primary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  const patch = (mutator: (s: DimensionStyleDefinition) => DimensionStyleDefinition) => {
    onUpdate(mutator(structuredClone(selected)));
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" data-cad-dialog="1">
      <div className="modal-panel dimstyle-dialog">
        <h3>Dimension Style Manager</h3>
        <p className="dialog-hint">
          Dimension formatting uses the active style — not Drawing Units (LUNITS).
        </p>

        <div className="dimstyle-layout">
          <div className="dimstyle-list-col">
            <div className="prop-row">
              <label>Styles</label>
            </div>
            <ul className="dimstyle-list" role="listbox" aria-label="Dimension styles">
              {styles.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className={
                      s.name === selectedName
                        ? 'dimstyle-item active'
                        : 'dimstyle-item'
                    }
                    onClick={() => setSelectedName(s.name)}
                  >
                    {s.name}
                    {s.name === activeName ? ' •' : ''}
                  </button>
                </li>
              ))}
            </ul>
            <div className="dimstyle-list-actions">
              <button
                type="button"
                className="mini-btn"
                onClick={() => {
                  const name = window.prompt('New style name', `${selected.name} Copy`);
                  if (name?.trim()) onCopy(selected.name, name.trim());
                }}
              >
                New / Copy
              </button>
              <button
                type="button"
                className="mini-btn"
                onClick={() => {
                  const name = window.prompt('Rename style', selected.name);
                  if (name?.trim() && name.trim() !== selected.name) {
                    onRename(selected.name, name.trim());
                    setSelectedName(name.trim());
                  }
                }}
              >
                Rename
              </button>
              <button
                type="button"
                className="mini-btn"
                disabled={selected.name === activeName}
                title={
                  selected.name === activeName
                    ? 'Cannot delete the active style'
                    : 'Delete style'
                }
                onClick={() => {
                  if (selected.name === activeName) return;
                  if (window.confirm(`Delete style "${selected.name}"?`)) {
                    onDelete(selected.name);
                    setSelectedName(activeName);
                  }
                }}
              >
                Delete
              </button>
              <button
                type="button"
                className="mini-btn primary"
                onClick={() => onSetActive(selected.name)}
              >
                Set Current
              </button>
            </div>
          </div>

          <div className="dimstyle-editor-col">
            <div className="dimstyle-tabs" role="tablist">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  className={tab === t.id ? 'dimstyle-tab active' : 'dimstyle-tab'}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="dimstyle-tab-body">
              {tab === 'primary' ? (
                <>
                  <div className="prop-row">
                    <label>Unit format</label>
                    <select
                      className="prop-select"
                      data-cad-property="1"
                      value={selected.primary.unitFormat}
                      onChange={(e) =>
                        patch((s) => ({
                          ...s,
                          primary: {
                            ...s.primary,
                            unitFormat: e.target.value as LinearUnitFormat,
                          },
                        }))
                      }
                    >
                      {LINEAR_UNIT_FORMATS.map((f) => (
                        <option key={f} value={f}>
                          {LINEAR_UNIT_FORMAT_LABELS[f]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="prop-row">
                    <label>Length unit</label>
                    <select
                      className="prop-select"
                      data-cad-property="1"
                      value={selected.primary.lengthUnit}
                      onChange={(e) =>
                        patch((s) => ({
                          ...s,
                          primary: {
                            ...s.primary,
                            lengthUnit: e.target.value as LengthUnit,
                          },
                        }))
                      }
                    >
                      {LENGTH_UNITS.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="prop-row">
                    <label>Precision</label>
                    <input
                      className="prop-select"
                      data-cad-property="1"
                      type="number"
                      min={0}
                      max={8}
                      value={selected.primary.precision}
                      onChange={(e) =>
                        patch((s) => ({
                          ...s,
                          primary: {
                            ...s.primary,
                            precision: Number(e.target.value),
                          },
                        }))
                      }
                    />
                  </div>
                  <div className="prop-row">
                    <label>Round off</label>
                    <input
                      className="prop-select"
                      data-cad-property="1"
                      type="number"
                      min={0}
                      step="any"
                      value={selected.primary.roundOff}
                      onChange={(e) =>
                        patch((s) => ({
                          ...s,
                          primary: {
                            ...s.primary,
                            roundOff: Number(e.target.value) || 0,
                          },
                        }))
                      }
                    />
                  </div>
                  <div className="prop-row">
                    <label>Prefix</label>
                    <input
                      className="prop-select"
                      data-cad-property="1"
                      value={selected.primary.prefix}
                      onChange={(e) =>
                        patch((s) => ({
                          ...s,
                          primary: { ...s.primary, prefix: e.target.value },
                        }))
                      }
                    />
                  </div>
                  <div className="prop-row">
                    <label>Suffix</label>
                    <input
                      className="prop-select"
                      data-cad-property="1"
                      value={selected.primary.suffix}
                      onChange={(e) =>
                        patch((s) => ({
                          ...s,
                          primary: { ...s.primary, suffix: e.target.value },
                        }))
                      }
                    />
                  </div>
                  <div className="prop-row">
                    <label>Decimal sep.</label>
                    <select
                      className="prop-select"
                      data-cad-property="1"
                      value={selected.primary.decimalSeparator}
                      onChange={(e) =>
                        patch((s) => ({
                          ...s,
                          primary: {
                            ...s.primary,
                            decimalSeparator: e.target.value === ',' ? ',' : '.',
                          },
                        }))
                      }
                    >
                      <option value=".">.</option>
                      <option value=",">,</option>
                    </select>
                  </div>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={selected.primary.suppressLeadingZeros}
                      onChange={(e) =>
                        patch((s) => ({
                          ...s,
                          primary: {
                            ...s.primary,
                            suppressLeadingZeros: e.target.checked,
                          },
                        }))
                      }
                    />
                    Leading zero suppression
                  </label>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={selected.primary.suppressTrailingZeros}
                      onChange={(e) =>
                        patch((s) => ({
                          ...s,
                          primary: {
                            ...s.primary,
                            suppressTrailingZeros: e.target.checked,
                          },
                        }))
                      }
                    />
                    Trailing zero suppression
                  </label>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={selected.primary.suppressZeroFeet}
                      onChange={(e) =>
                        patch((s) => ({
                          ...s,
                          primary: {
                            ...s.primary,
                            suppressZeroFeet: e.target.checked,
                          },
                        }))
                      }
                    />
                    0 feet suppression
                  </label>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={selected.primary.suppressZeroInches}
                      onChange={(e) =>
                        patch((s) => ({
                          ...s,
                          primary: {
                            ...s.primary,
                            suppressZeroInches: e.target.checked,
                          },
                        }))
                      }
                    />
                    0 inches suppression
                  </label>
                  <div className="prop-row">
                    <label>Fraction fmt</label>
                    <select
                      className="prop-select"
                      data-cad-property="1"
                      value={selected.primary.fractionFormat}
                      onChange={(e) =>
                        patch((s) => ({
                          ...s,
                          primary: {
                            ...s.primary,
                            fractionFormat: e.target.value as
                              | 'horizontal'
                              | 'diagonal'
                              | 'not-stacked',
                          },
                        }))
                      }
                    >
                      <option value="horizontal">Horizontal</option>
                      <option value="diagonal">Diagonal</option>
                      <option value="not-stacked">Not stacked</option>
                    </select>
                  </div>
                </>
              ) : null}

              {tab === 'alternate' ? (
                <>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={selected.alternate.enabled}
                      onChange={(e) =>
                        patch((s) => ({
                          ...s,
                          alternate: {
                            ...s.alternate,
                            enabled: e.target.checked,
                          },
                        }))
                      }
                    />
                    Display alternate units
                  </label>
                  <div className="prop-row">
                    <label>Unit format</label>
                    <select
                      className="prop-select"
                      data-cad-property="1"
                      value={selected.alternate.unitFormat}
                      onChange={(e) =>
                        patch((s) => ({
                          ...s,
                          alternate: {
                            ...s.alternate,
                            unitFormat: e.target.value as LinearUnitFormat,
                          },
                        }))
                      }
                    >
                      {LINEAR_UNIT_FORMATS.map((f) => (
                        <option key={f} value={f}>
                          {LINEAR_UNIT_FORMAT_LABELS[f]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="prop-row">
                    <label>Precision</label>
                    <input
                      className="prop-select"
                      data-cad-property="1"
                      type="number"
                      min={0}
                      max={8}
                      value={selected.alternate.precision}
                      onChange={(e) =>
                        patch((s) => ({
                          ...s,
                          alternate: {
                            ...s.alternate,
                            precision: Number(e.target.value),
                          },
                        }))
                      }
                    />
                  </div>
                  <div className="prop-row">
                    <label>Multiplier</label>
                    <input
                      className="prop-select"
                      data-cad-property="1"
                      type="number"
                      step="any"
                      value={selected.alternate.multiplier}
                      onChange={(e) =>
                        patch((s) => ({
                          ...s,
                          alternate: {
                            ...s.alternate,
                            multiplier: Number(e.target.value) || 1,
                          },
                        }))
                      }
                    />
                  </div>
                  <div className="prop-row">
                    <label>Round off</label>
                    <input
                      className="prop-select"
                      data-cad-property="1"
                      type="number"
                      min={0}
                      step="any"
                      value={selected.alternate.roundOff}
                      onChange={(e) =>
                        patch((s) => ({
                          ...s,
                          alternate: {
                            ...s.alternate,
                            roundOff: Number(e.target.value) || 0,
                          },
                        }))
                      }
                    />
                  </div>
                  <div className="prop-row">
                    <label>Prefix</label>
                    <input
                      className="prop-select"
                      data-cad-property="1"
                      value={selected.alternate.prefix}
                      onChange={(e) =>
                        patch((s) => ({
                          ...s,
                          alternate: { ...s.alternate, prefix: e.target.value },
                        }))
                      }
                    />
                  </div>
                  <div className="prop-row">
                    <label>Suffix</label>
                    <input
                      className="prop-select"
                      data-cad-property="1"
                      value={selected.alternate.suffix}
                      onChange={(e) =>
                        patch((s) => ({
                          ...s,
                          alternate: { ...s.alternate, suffix: e.target.value },
                        }))
                      }
                    />
                  </div>
                  <div className="prop-row">
                    <label>Placement</label>
                    <select
                      className="prop-select"
                      data-cad-property="1"
                      value={selected.alternate.placement}
                      onChange={(e) =>
                        patch((s) => ({
                          ...s,
                          alternate: {
                            ...s.alternate,
                            placement:
                              e.target.value === 'below' ? 'below' : 'after',
                          },
                        }))
                      }
                    >
                      <option value="after">After primary</option>
                      <option value="below">Below primary</option>
                    </select>
                  </div>
                </>
              ) : null}

              {tab === 'text' ? (
                <>
                  <div className="prop-row">
                    <label>Text style</label>
                    <input
                      className="prop-select"
                      data-cad-property="1"
                      value={selected.text.styleName}
                      onChange={(e) =>
                        patch((s) => ({
                          ...s,
                          text: { ...s.text, styleName: e.target.value },
                        }))
                      }
                    />
                  </div>
                  <div className="prop-row">
                    <label>Text height</label>
                    <input
                      className="prop-select"
                      data-cad-property="1"
                      type="number"
                      step="any"
                      value={selected.text.height}
                      onChange={(e) =>
                        patch((s) => ({
                          ...s,
                          text: {
                            ...s.text,
                            height: Number(e.target.value) || 0.35,
                          },
                        }))
                      }
                    />
                  </div>
                  <div className="prop-row">
                    <label>Text color</label>
                    <input
                      className="prop-select"
                      data-cad-property="1"
                      value={selected.text.color}
                      onChange={(e) =>
                        patch((s) => ({
                          ...s,
                          text: { ...s.text, color: e.target.value },
                        }))
                      }
                    />
                  </div>
                  <div className="prop-row">
                    <label>Placement</label>
                    <select
                      className="prop-select"
                      data-cad-property="1"
                      value={selected.text.placement}
                      onChange={(e) =>
                        patch((s) => ({
                          ...s,
                          text: {
                            ...s.text,
                            placement: e.target.value as
                              | 'above'
                              | 'centered'
                              | 'outside',
                          },
                        }))
                      }
                    >
                      <option value="above">Above</option>
                      <option value="centered">Centered</option>
                      <option value="outside">Outside</option>
                    </select>
                  </div>
                  <div className="prop-row">
                    <label>Offset from dim line</label>
                    <input
                      className="prop-select"
                      data-cad-property="1"
                      type="number"
                      step="any"
                      value={selected.text.offsetFromDimLine}
                      onChange={(e) =>
                        patch((s) => ({
                          ...s,
                          text: {
                            ...s.text,
                            offsetFromDimLine: Number(e.target.value) || 0,
                          },
                        }))
                      }
                    />
                  </div>
                </>
              ) : null}

              {tab === 'lines' ? (
                <>
                  <div className="prop-row">
                    <label>Dim line color</label>
                    <input
                      className="prop-select"
                      data-cad-property="1"
                      value={selected.lines.dimensionLineColor}
                      onChange={(e) =>
                        patch((s) => ({
                          ...s,
                          lines: {
                            ...s.lines,
                            dimensionLineColor: e.target.value,
                          },
                        }))
                      }
                    />
                  </div>
                  <div className="prop-row">
                    <label>Ext line color</label>
                    <input
                      className="prop-select"
                      data-cad-property="1"
                      value={selected.lines.extensionLineColor}
                      onChange={(e) =>
                        patch((s) => ({
                          ...s,
                          lines: {
                            ...s.lines,
                            extensionLineColor: e.target.value,
                          },
                        }))
                      }
                    />
                  </div>
                  <div className="prop-row">
                    <label>Lineweight</label>
                    <input
                      className="prop-select"
                      data-cad-property="1"
                      type="number"
                      step="any"
                      value={selected.lines.lineweight}
                      onChange={(e) =>
                        patch((s) => ({
                          ...s,
                          lines: {
                            ...s.lines,
                            lineweight: Number(e.target.value) || 0,
                          },
                        }))
                      }
                    />
                  </div>
                  <div className="prop-row">
                    <label>Extend beyond</label>
                    <input
                      className="prop-select"
                      data-cad-property="1"
                      type="number"
                      step="any"
                      value={selected.lines.extendBeyond}
                      onChange={(e) =>
                        patch((s) => ({
                          ...s,
                          lines: {
                            ...s.lines,
                            extendBeyond: Number(e.target.value) || 0,
                          },
                        }))
                      }
                    />
                  </div>
                  <div className="prop-row">
                    <label>Offset from origin</label>
                    <input
                      className="prop-select"
                      data-cad-property="1"
                      type="number"
                      step="any"
                      value={selected.lines.offsetFromOrigin}
                      onChange={(e) =>
                        patch((s) => ({
                          ...s,
                          lines: {
                            ...s.lines,
                            offsetFromOrigin: Number(e.target.value) || 0,
                          },
                        }))
                      }
                    />
                  </div>
                </>
              ) : null}

              {tab === 'symbols' ? (
                <>
                  <div className="prop-row">
                    <label>Arrowhead</label>
                    <select
                      className="prop-select"
                      data-cad-property="1"
                      value={selected.symbols.arrowhead}
                      onChange={(e) =>
                        patch((s) => ({
                          ...s,
                          symbols: {
                            ...s.symbols,
                            arrowhead: e.target.value as
                              | 'closed'
                              | 'open'
                              | 'architectural'
                              | 'dot'
                              | 'none',
                          },
                        }))
                      }
                    >
                      <option value="closed">Closed filled</option>
                      <option value="open">Open</option>
                      <option value="architectural">Architectural tick</option>
                      <option value="dot">Dot</option>
                      <option value="none">None</option>
                    </select>
                  </div>
                  <div className="prop-row">
                    <label>Arrow size</label>
                    <input
                      className="prop-select"
                      data-cad-property="1"
                      type="number"
                      step="any"
                      value={selected.symbols.arrowSize}
                      onChange={(e) =>
                        patch((s) => ({
                          ...s,
                          symbols: {
                            ...s.symbols,
                            arrowSize: Number(e.target.value) || 0.25,
                          },
                        }))
                      }
                    />
                  </div>
                  <div className="prop-row">
                    <label>Center mark</label>
                    <select
                      className="prop-select"
                      data-cad-property="1"
                      value={selected.symbols.centerMark}
                      onChange={(e) =>
                        patch((s) => ({
                          ...s,
                          symbols: {
                            ...s.symbols,
                            centerMark: e.target.value as
                              | 'none'
                              | 'mark'
                              | 'line',
                          },
                        }))
                      }
                    >
                      <option value="none">None</option>
                      <option value="mark">Mark</option>
                      <option value="line">Line</option>
                    </select>
                  </div>
                  <div className="prop-row">
                    <label>Center mark size</label>
                    <input
                      className="prop-select"
                      data-cad-property="1"
                      type="number"
                      step="any"
                      value={selected.symbols.centerMarkSize}
                      onChange={(e) =>
                        patch((s) => ({
                          ...s,
                          symbols: {
                            ...s.symbols,
                            centerMarkSize: Number(e.target.value) || 0,
                          },
                        }))
                      }
                    />
                  </div>
                </>
              ) : null}

              {tab === 'fit' ? (
                <>
                  <div className="prop-row">
                    <label>Text/arrows fit</label>
                    <select
                      className="prop-select"
                      data-cad-property="1"
                      value={selected.fit.textArrowFit}
                      onChange={(e) =>
                        patch((s) => ({
                          ...s,
                          fit: {
                            ...s.fit,
                            textArrowFit: e.target.value as
                              | 'best-fit'
                              | 'arrows-first'
                              | 'text-first'
                              | 'both'
                              | 'always-keep',
                          },
                        }))
                      }
                    >
                      <option value="best-fit">Best fit</option>
                      <option value="arrows-first">Arrows first</option>
                      <option value="text-first">Text first</option>
                      <option value="both">Both text and arrows</option>
                      <option value="always-keep">Always keep between</option>
                    </select>
                  </div>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={selected.fit.keepTextBetween}
                      onChange={(e) =>
                        patch((s) => ({
                          ...s,
                          fit: {
                            ...s.fit,
                            keepTextBetween: e.target.checked,
                          },
                        }))
                      }
                    />
                    Keep text between extension lines
                  </label>
                  <div className="prop-row">
                    <label>Move text</label>
                    <select
                      className="prop-select"
                      data-cad-property="1"
                      value={selected.fit.moveText}
                      onChange={(e) =>
                        patch((s) => ({
                          ...s,
                          fit: {
                            ...s.fit,
                            moveText: e.target.value as
                              | 'beside'
                              | 'over-dimline-with-leader'
                              | 'over-dimline-no-leader',
                          },
                        }))
                      }
                    >
                      <option value="beside">Beside the dimension line</option>
                      <option value="over-dimline-with-leader">
                        Over dim line with leader
                      </option>
                      <option value="over-dimline-no-leader">
                        Over dim line without leader
                      </option>
                    </select>
                  </div>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={selected.fit.suppressArrowsIfDontFit}
                      onChange={(e) =>
                        patch((s) => ({
                          ...s,
                          fit: {
                            ...s.fit,
                            suppressArrowsIfDontFit: e.target.checked,
                          },
                        }))
                      }
                    />
                    Suppress arrows if they do not fit
                  </label>
                </>
              ) : null}

              {tab === 'tolerances' ? (
                <>
                  <p className="dialog-hint">
                    Tolerance data model and UI. Full stacked tolerance rendering
                    may be incomplete in this milestone.
                  </p>
                  <div className="prop-row">
                    <label>Method</label>
                    <select
                      className="prop-select"
                      data-cad-property="1"
                      value={selected.tolerances.method}
                      onChange={(e) =>
                        patch((s) => ({
                          ...s,
                          tolerances: {
                            ...s.tolerances,
                            method: e.target.value as
                              | 'none'
                              | 'symmetrical'
                              | 'deviation'
                              | 'limits'
                              | 'basic',
                          },
                        }))
                      }
                    >
                      <option value="none">None</option>
                      <option value="symmetrical">Symmetrical</option>
                      <option value="deviation">Deviation</option>
                      <option value="limits">Limits</option>
                      <option value="basic">Basic</option>
                    </select>
                  </div>
                  <div className="prop-row">
                    <label>Precision</label>
                    <input
                      className="prop-select"
                      data-cad-property="1"
                      type="number"
                      min={0}
                      max={8}
                      value={selected.tolerances.precision}
                      onChange={(e) =>
                        patch((s) => ({
                          ...s,
                          tolerances: {
                            ...s.tolerances,
                            precision: Number(e.target.value),
                          },
                        }))
                      }
                    />
                  </div>
                  <div className="prop-row">
                    <label>Upper value</label>
                    <input
                      className="prop-select"
                      data-cad-property="1"
                      type="number"
                      step="any"
                      value={selected.tolerances.upperValue}
                      onChange={(e) =>
                        patch((s) => ({
                          ...s,
                          tolerances: {
                            ...s.tolerances,
                            upperValue: Number(e.target.value) || 0,
                          },
                        }))
                      }
                    />
                  </div>
                  <div className="prop-row">
                    <label>Lower value</label>
                    <input
                      className="prop-select"
                      data-cad-property="1"
                      type="number"
                      step="any"
                      value={selected.tolerances.lowerValue}
                      onChange={(e) =>
                        patch((s) => ({
                          ...s,
                          tolerances: {
                            ...s.tolerances,
                            lowerValue: Number(e.target.value) || 0,
                          },
                        }))
                      }
                    />
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>

        <div className="modal-actions">
          <button type="button" className="primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
