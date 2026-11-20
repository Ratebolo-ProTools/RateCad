import { useEffect, useId, useRef, useState } from 'react';
import type { Vec2 } from '@ratecad/core';

export interface CreateBlockDialogProps {
  initialBase: Vec2;
  onSubmit: (input: { name: string; basePoint: Vec2 }) => string | null;
  onClose: () => void;
}

function finite(value: string): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function CreateBlockDialog({
  initialBase,
  onSubmit,
  onClose,
}: CreateBlockDialogProps) {
  const nameId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [x, setX] = useState(String(initialBase.x));
  const [y, setY] = useState(String(initialBase.y));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    nameRef.current?.focus();
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

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-block-title"
      data-cad-dialog="1"
      data-testid="create-block-dialog"
    >
      <form
        className="modal-panel block-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          const baseX = finite(x);
          const baseY = finite(y);
          if (baseX == null || baseY == null) {
            setError('Base point must be a finite coordinate');
            return;
          }
          const message = onSubmit({
            name,
            basePoint: { x: baseX, y: baseY },
          });
          setError(message);
        }}
      >
        <h3 id="create-block-title">Create Block</h3>
        <p className="dialog-hint">
          Selected objects become one block definition. Their geometry is stored
          relative to the base point, and the selection is replaced by a reference.
        </p>
        <div className="prop-row">
          <label htmlFor={nameId}>Name</label>
          <input
            id={nameId}
            ref={nameRef}
            className="prop-input"
            data-cad-property="1"
            data-testid="create-block-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-label="Block name"
          />
        </div>
        <div className="prop-row">
          <label htmlFor={`${nameId}-x`}>Base X</label>
          <input
            id={`${nameId}-x`}
            className="prop-input"
            data-cad-property="1"
            data-testid="create-block-x"
            value={x}
            onChange={(event) => setX(event.target.value)}
            aria-label="Base point X"
          />
        </div>
        <div className="prop-row">
          <label htmlFor={`${nameId}-y`}>Base Y</label>
          <input
            id={`${nameId}-y`}
            className="prop-input"
            data-cad-property="1"
            data-testid="create-block-y"
            value={y}
            onChange={(event) => setY(event.target.value)}
            aria-label="Base point Y"
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
          <button type="submit" className="primary" data-testid="create-block-ok">
            Create
          </button>
        </div>
      </form>
    </div>
  );
}
