/**
 * P3-B2/B3B/B4B1 — session-aware document tab strip.
 *
 * P3-B3B: + and inactive-tab switch.
 * P3-B4B1: individual × close with App-owned Save/Don't Save/Cancel.
 */

import { useEffect, useId, useRef } from 'react';
import {
  CLOSE_TAB_DISABLED_TOOLTIP,
  NEW_TAB_DISABLED_TOOLTIP,
  NEW_TAB_ENABLED_TOOLTIP,
  START_TAB_TOOLTIP,
  areCloseTabActionsEnabled,
  areMultiDocumentActionsEnabled,
  truncateTabTitle,
  type DocumentTabItem,
} from './documentTabsModel.js';

export type DocumentTabsProps = {
  tabs: DocumentTabItem[];
  activeSessionId: string | null;
  /** When false, + / switch stay non-interactive. */
  multiDocumentActionsEnabled?: boolean;
  /** When false (P3-B3B default), close × stays non-interactive. */
  closeTabActionsEnabled?: boolean;
  /** Start tab is a preserved placeholder unless onSelectStart is provided. */
  startInteractive?: boolean;
  onSelectStart?: () => void;
  onSelectTab?: (sessionId: string) => void;
  onCloseTab?: (sessionId: string) => void;
  onNewTab?: () => void;
};

export function DocumentTabs(props: DocumentTabsProps) {
  const multiEnabled = areMultiDocumentActionsEnabled(
    props.multiDocumentActionsEnabled,
  );
  const closeEnabled = areCloseTabActionsEnabled(props.closeTabActionsEnabled);
  const startInteractive = props.startInteractive === true;
  const listId = useId();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const el = activeRef.current;
    const scroller = scrollRef.current;
    if (!el || !scroller) return;
    const left = el.offsetLeft;
    const right = left + el.offsetWidth;
    if (left < scroller.scrollLeft) {
      scroller.scrollLeft = Math.max(0, left - 8);
    } else if (right > scroller.scrollLeft + scroller.clientWidth) {
      scroller.scrollLeft = right - scroller.clientWidth + 8;
    }
  }, [props.activeSessionId, props.tabs]);

  const handleSelectTab = (sessionId: string, isActive: boolean) => {
    if (isActive) return;
    if (!multiEnabled) return;
    props.onSelectTab?.(sessionId);
  };

  const handleClose = (sessionId: string) => {
    if (!closeEnabled) return;
    props.onCloseTab?.(sessionId);
  };

  const handleNew = () => {
    if (!multiEnabled) return;
    props.onNewTab?.();
  };

  return (
    <div className="document-tabs" data-testid="document-tabs">
      <div
        className="document-tabs-scroll"
        ref={scrollRef}
        role="tablist"
        aria-label="Drawings"
        id={listId}
      >
        <button
          type="button"
          className="doc-tab doc-tab-start"
          role="tab"
          aria-selected={false}
          aria-disabled={!startInteractive}
          disabled={!startInteractive}
          title={START_TAB_TOOLTIP}
          data-testid="doc-tab-start"
          onClick={() => {
            if (!startInteractive) return;
            props.onSelectStart?.();
          }}
        >
          <span className="doc-tab-label">Start</span>
        </button>

        {props.tabs.map((tab) => {
          const isActive = tab.active || tab.sessionId === props.activeSessionId;
          const label = truncateTabTitle(tab.displayName);
          const tip = tab.filePath
            ? `${tab.displayName}\n${tab.filePath}`
            : tab.displayName;
          return (
            <button
              key={tab.sessionId}
              type="button"
              className={`doc-tab${isActive ? ' active' : ''}`}
              role="tab"
              aria-selected={isActive}
              aria-controls={`drawing-session-${tab.sessionId}`}
              data-session-id={tab.sessionId}
              data-testid={`doc-tab-${tab.sessionId}`}
              data-active={isActive ? 'true' : 'false'}
              data-dirty={tab.dirty ? 'true' : 'false'}
              title={tip}
              ref={isActive ? activeRef : undefined}
              onClick={() => handleSelectTab(tab.sessionId, isActive)}
            >
              <span className="doc-tab-label">{label}</span>
              {tab.dirty ? (
                <span className="sr-only"> (unsaved changes)</span>
              ) : null}
              <span
                className={`doc-tab-close${closeEnabled ? '' : ' is-disabled'}`}
                role="button"
                tabIndex={closeEnabled ? 0 : -1}
                aria-disabled={!closeEnabled}
                aria-label={
                  closeEnabled
                    ? `Close ${tab.title}`
                    : CLOSE_TAB_DISABLED_TOOLTIP
                }
                title={
                  closeEnabled
                    ? `Close ${tab.title}`
                    : CLOSE_TAB_DISABLED_TOOLTIP
                }
                data-testid={`doc-tab-close-${tab.sessionId}`}
                onClick={(e) => {
                  e.stopPropagation();
                  handleClose(tab.sessionId);
                }}
                onKeyDown={(e) => {
                  if (!closeEnabled) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    handleClose(tab.sessionId);
                  }
                }}
              >
                ×
              </span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        className={`doc-tab-add${multiEnabled ? '' : ' is-disabled'}`}
        title={
          multiEnabled ? NEW_TAB_ENABLED_TOOLTIP : NEW_TAB_DISABLED_TOOLTIP
        }
        aria-label={
          multiEnabled ? 'New drawing' : NEW_TAB_DISABLED_TOOLTIP
        }
        aria-disabled={!multiEnabled}
        disabled={!multiEnabled}
        data-testid="doc-tab-add"
        onClick={handleNew}
      >
        +
      </button>
    </div>
  );
}
