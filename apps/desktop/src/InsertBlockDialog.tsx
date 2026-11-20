import { useEffect, useId, useRef, useState } from 'react';
import type { BlockDefinition, DrawingDocument, Entity } from '@ratecad/core';
import { previewBlockReference } from '@ratecad/commands';

export interface InsertBlockDialogProps {
  document: DrawingDocument;
  onPreview: (entity: Entity | null) => void;
  onSubmit: (input: {
    definitionId: string;
    position: { x: number; y: number };
    scaleX: number;
    scaleY: number;
    rotationRadians: number;
  }) => string | null;
  onClose: () => void;
}

function finite(value: string): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function InsertBlockDialog({
  document,
  onPreview,
  onSubmit,
  onClose,
}: InsertBlockDialogProps) {
  const titleId = useId();
  const selectRef = useRef<HTMLSelectElement>(null);
  const definitions = document.blockDefinitions;
  const [definitionId, setDefinitionId] = useState(definitions[0]?.id ?? '');
  const [x, setX] = useState('0');
  const [y, setY] = useState('0');
  const [scaleX, setScaleX] = useState('1');
  const [scaleY, setScaleY] = useState('1');
  const [degrees, setDegrees] = useState('0');
  const [error, setError] = useState<string | null>(
    definitions.length === 0 ? 'Create a block before inserting one' : null,
  );

  useEffect(() => {
    selectRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  useEffect(() => {
    const positionX = finite(x);
    const positionY = finite(y);
    const sx = finite(scaleX);
    const sy = finite(scaleY);
    const angle = finite(degrees);
    if (
      !definitionId ||
      positionX == null ||
      positionY == null ||
      sx == null ||
      sy == null ||
      sx === 0 ||
      sy === 0 ||
      angle == null
    ) {
      onPreview(null);
      return;
    }
    onPreview(
      previewBlockReference(document, {
        definitionId,
        position: { x: positionX, y: positionY },
        scaleX: sx,
        scaleY: sy,
        rotation: (angle * Math.PI) / 180,
      }),
    );
  }, [definitionId, x, y, scaleX, scaleY, degrees, document, onPreview]);

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-cad-dialog="1"
      data-testid="insert-block-dialog"
    >
      <form
        className="modal-panel block-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          const positionX = finite(x);
          const positionY = finite(y);
          const sx = finite(scaleX);
          const sy = finite(scaleY);
          const angle = finite(degrees);
          if (positionX == null || positionY == null) {
            setError('Insertion point must be a finite coordinate');
            return;
          }
          if (sx == null || sx === 0) {
            setError('X scale must be a finite non-zero number');
            return;
          }
          if (sy == null || sy === 0) {
            setError('Y scale must be a finite non-zero number');
            return;
          }
          if (angle == null) {
            setError('Rotation must be a finite angle');
            return;
          }
          const message = onSubmit({
            definitionId,
            position: { x: positionX, y: positionY },
            scaleX: sx,
            scaleY: sy,
            rotationRadians: (angle * Math.PI) / 180,
          });
          setError(message);
        }}
      >
        <h3 id={titleId}>Insert Block</h3>
        <p className="dialog-hint">
          Places another reference to an existing definition. The definition
          geometry is not copied.
        </p>
        <div className="prop-row">
          <label htmlFor={`${titleId}-def`}>Block</label>
          <select
            id={`${titleId}-def`}
            ref={selectRef}
            className="prop-select"
            data-cad-property="1"
            data-testid="insert-block-definition"
            value={definitionId}
            onChange={(event) => setDefinitionId(event.target.value)}
            aria-label="Block definition"
          >
            {definitions.length === 0 ? (
              <option value="">No blocks</option>
            ) : (
              definitions.map((definition: BlockDefinition) => (
                <option key={definition.id} value={definition.id}>
                  {definition.name}
                </option>
              ))
            )}
          </select>
        </div>
        <div className="prop-row">
          <label htmlFor={`${titleId}-x`}>Insertion X</label>
          <input
            id={`${titleId}-x`}
            className="prop-input"
            data-cad-property="1"
            data-testid="insert-block-x"
            value={x}
            onChange={(event) => setX(event.target.value)}
            aria-label="Insertion X"
          />
        </div>
        <div className="prop-row">
          <label htmlFor={`${titleId}-y`}>Insertion Y</label>
          <input
            id={`${titleId}-y`}
            className="prop-input"
            data-cad-property="1"
            data-testid="insert-block-y"
            value={y}
            onChange={(event) => setY(event.target.value)}
            aria-label="Insertion Y"
          />
        </div>
        <div className="prop-row">
          <label htmlFor={`${titleId}-sx`}>X scale</label>
          <input
            id={`${titleId}-sx`}
            className="prop-input"
            data-cad-property="1"
            data-testid="insert-block-sx"
            value={scaleX}
            onChange={(event) => setScaleX(event.target.value)}
            aria-label="X scale"
          />
        </div>
        <div className="prop-row">
          <label htmlFor={`${titleId}-sy`}>Y scale</label>
          <input
            id={`${titleId}-sy`}
            className="prop-input"
            data-cad-property="1"
            data-testid="insert-block-sy"
            value={scaleY}
            onChange={(event) => setScaleY(event.target.value)}
            aria-label="Y scale"
          />
        </div>
        <div className="prop-row">
          <label htmlFor={`${titleId}-rot`}>Rotation °</label>
          <input
            id={`${titleId}-rot`}
            className="prop-input"
            data-cad-property="1"
            data-testid="insert-block-rotation"
            value={degrees}
            onChange={(event) => setDegrees(event.target.value)}
            aria-label="Rotation degrees"
          />
        </div>
        {error ? (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="primary"
            data-testid="insert-block-ok"
            disabled={definitions.length === 0}
          >
            Insert
          </button>
        </div>
      </form>
    </div>
  );
}
