/**
 * P3-B4B1 — Save / Don't Save / Cancel confirmation before closing a dirty tab.
 */

import { useEffect, useId, useRef } from 'react';
import {
  CLOSE_SAVE_DIALOG_TITLE,
  closeSaveDialogMessage,
  type CloseSaveChoice,
} from './documentSessionClose.js';

export type CloseSaveDialogProps = {
  drawingName: string;
  busy?: boolean;
  onChoose: (choice: CloseSaveChoice) => void;
};

export function CloseSaveDialog(props: CloseSaveDialogProps) {
  const titleId = useId();
  const saveRef = useRef<HTMLButtonElement | null>(null);
  const submittedRef = useRef(false);

  useEffect(() => {
    saveRef.current?.focus();
  }, []);

  const choose = (choice: CloseSaveChoice) => {
    if (props.busy) return;
    if (submittedRef.current) return;
    submittedRef.current = true;
    props.onChoose(choice);
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-testid="close-save-dialog"
      data-cad-dialog="1"
      onMouseDown={(e) => {
        // Backdrop click → Cancel
        if (e.target === e.currentTarget) choose('cancel');
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          choose('cancel');
        }
      }}
    >
      <div className="modal-panel">
        <h3 id={titleId}>{CLOSE_SAVE_DIALOG_TITLE}</h3>
        <p>{closeSaveDialogMessage(props.drawingName)}</p>
        <div className="modal-actions">
          <button
            ref={saveRef}
            type="button"
            className="primary"
            data-testid="close-save-dialog-save"
            disabled={props.busy}
            onClick={() => choose('save')}
          >
            Save
          </button>
          <button
            type="button"
            className="danger"
            data-testid="close-save-dialog-dont-save"
            disabled={props.busy}
            onClick={() => choose('dont-save')}
          >
            Don&apos;t Save
          </button>
          <button
            type="button"
            data-testid="close-save-dialog-cancel"
            disabled={props.busy}
            onClick={() => choose('cancel')}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
