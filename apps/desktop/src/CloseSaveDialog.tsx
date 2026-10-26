/**
 * P3-B4B1/B4B2A — Save / Don't Save / Cancel confirmation before closing.
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
  /** Override dialog title (Close All uses a shorter title). */
  title?: string;
  /** Override body message. */
  message?: string;
  /** e.g. "Drawing 2 of 4" for Close All. */
  progressLabel?: string;
  onChoose: (choice: CloseSaveChoice) => void;
};

export function CloseSaveDialog(props: CloseSaveDialogProps) {
  const titleId = useId();
  const saveRef = useRef<HTMLButtonElement | null>(null);
  const submittedRef = useRef(false);

  useEffect(() => {
    submittedRef.current = false;
    saveRef.current?.focus();
  }, [props.drawingName, props.progressLabel]);

  const choose = (choice: CloseSaveChoice) => {
    if (props.busy) return;
    if (submittedRef.current) return;
    submittedRef.current = true;
    props.onChoose(choice);
  };

  const title = props.title ?? CLOSE_SAVE_DIALOG_TITLE;
  const message =
    props.message ?? closeSaveDialogMessage(props.drawingName);

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-testid="close-save-dialog"
      data-cad-dialog="1"
      onMouseDown={(e) => {
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
        <h3 id={titleId}>{title}</h3>
        {props.progressLabel ? (
          <p className="modal-progress" data-testid="close-save-dialog-progress">
            {props.progressLabel}
          </p>
        ) : null}
        <p>{message}</p>
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
