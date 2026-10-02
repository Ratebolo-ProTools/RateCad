/**
 * Drawing Units dialog (UNITS command) — AutoCAD-style LUNITS / AUNITS / INSUNITS.
 * Changes display formatting only; does not rewrite geometry.
 */

import type { DrawingUnitsSettings } from '@ratecad/core';
import {
  ANGULAR_UNIT_FORMATS,
  ANGULAR_UNIT_FORMAT_LABELS,
  ARCH_PRECISION_DENOMINATORS,
  INSERTION_UNITS,
  INSERTION_UNIT_LABELS,
  LINEAR_UNIT_FORMATS,
  LINEAR_UNIT_FORMAT_LABELS,
  type AngularUnitFormat,
  type InsertionUnit,
  type LinearUnitFormat,
} from '@ratecad/core';
import { useState } from 'react';

export interface UnitsDialogProps {
  initial: DrawingUnitsSettings;
  onApply: (next: DrawingUnitsSettings) => void;
  onClose: () => void;
}

function precisionOptions(format: LinearUnitFormat): Array<{ value: number; label: string }> {
  if (format === 'architectural' || format === 'fractional') {
    return [0, 1, 2, 3, 4, 5, 6, 7, 8].map((p) => {
      const d = ARCH_PRECISION_DENOMINATORS[p] ?? 16;
      return { value: p, label: d === 1 ? '0"' : `0.${'0'.repeat(Math.min(p, 4))} → 1/${d}"` };
    });
  }
  return [0, 1, 2, 3, 4, 5, 6, 7, 8].map((p) => ({
    value: p,
    label: p === 0 ? '0' : `0.${'0'.repeat(p)}`,
  }));
}

export function UnitsDialog({ initial, onApply, onClose }: UnitsDialogProps) {
  const [draft, setDraft] = useState<DrawingUnitsSettings>({ ...initial });

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" data-cad-dialog="1">
      <div className="modal-panel units-dialog">
        <h3>Drawing Units</h3>
        <p className="dialog-hint">
          Controls coordinate and distance display. Dimension text uses DIMSTYLE
          (not LUNITS).
        </p>

        <fieldset className="dialog-fieldset">
          <legend>Length</legend>
          <div className="prop-row">
            <label htmlFor="units-length-type">Type</label>
            <select
              id="units-length-type"
              className="prop-select"
              data-cad-property="1"
              value={draft.linearFormat}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  linearFormat: e.target.value as LinearUnitFormat,
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
            <label htmlFor="units-length-prec">Precision</label>
            <select
              id="units-length-prec"
              className="prop-select"
              data-cad-property="1"
              value={String(draft.linearPrecision)}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  linearPrecision: Number(e.target.value),
                }))
              }
            >
              {precisionOptions(draft.linearFormat).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </fieldset>

        <fieldset className="dialog-fieldset">
          <legend>Angle</legend>
          <div className="prop-row">
            <label htmlFor="units-angle-type">Type</label>
            <select
              id="units-angle-type"
              className="prop-select"
              data-cad-property="1"
              value={draft.angularFormat}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  angularFormat: e.target.value as AngularUnitFormat,
                }))
              }
            >
              {ANGULAR_UNIT_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {ANGULAR_UNIT_FORMAT_LABELS[f]}
                </option>
              ))}
            </select>
          </div>
          <div className="prop-row">
            <label htmlFor="units-angle-prec">Precision</label>
            <select
              id="units-angle-prec"
              className="prop-select"
              data-cad-property="1"
              value={String(draft.angularPrecision)}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  angularPrecision: Number(e.target.value),
                }))
              }
            >
              {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((p) => (
                <option key={p} value={p}>
                  {p === 0 ? '0' : `0.${'0'.repeat(p)}`}
                </option>
              ))}
            </select>
          </div>
        </fieldset>

        <fieldset className="dialog-fieldset">
          <legend>Insertion scale</legend>
          <div className="prop-row">
            <label htmlFor="units-insunits">Units to scale</label>
            <select
              id="units-insunits"
              className="prop-select"
              data-cad-property="1"
              value={draft.insertionUnit}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  insertionUnit: e.target.value as InsertionUnit,
                }))
              }
            >
              {INSERTION_UNITS.map((u) => (
                <option key={u} value={u}>
                  {INSERTION_UNIT_LABELS[u]}
                </option>
              ))}
            </select>
          </div>
        </fieldset>

        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => {
              onApply(draft);
              onClose();
            }}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
