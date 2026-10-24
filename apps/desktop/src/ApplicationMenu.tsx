import { useEffect, useId, useRef, useState } from 'react';

export type RecentDrawing = {
  path: string;
  name: string;
  at: number;
  /** Cached drawing JSON when re-open by path is unavailable (browser). */
  contents?: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recent: RecentDrawing[];
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onOpenRecent: (entry: RecentDrawing) => void;
  onExit: () => void;
};

export function ApplicationMenuButton(props: Props) {
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [recentOpen, setRecentOpen] = useState(false);

  useEffect(() => {
    if (!props.open) {
      setRecentOpen(false);
      return;
    }
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        props.onOpenChange(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        props.onOpenChange(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [props.open, props.onOpenChange]);

  const run = (fn: () => void) => {
    props.onOpenChange(false);
    fn();
  };

  return (
    <div className="app-menu-root" ref={rootRef}>
      <button
        type="button"
        className={`app-menu-btn${props.open ? ' open' : ''}`}
        data-testid="app-menu-button"
        aria-haspopup="menu"
        aria-expanded={props.open}
        aria-controls={menuId}
        title="RateCAD Application Menu"
        onClick={() => props.onOpenChange(!props.open)}
      >
        <span className="app-menu-mark" aria-hidden>
          R
        </span>
      </button>
      {props.open ? (
        <div
          id={menuId}
          className="app-menu-panel"
          role="menu"
          aria-label="Application Menu"
        >
          <div className="app-menu-heading">RateCAD</div>
          <button
            type="button"
            role="menuitem"
            data-testid="app-menu-new"
            onClick={() => run(props.onNew)}
          >
            <span>New</span>
            <kbd>Ctrl+N</kbd>
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="app-menu-open"
            onClick={() => run(props.onOpen)}
          >
            <span>Open…</span>
            <kbd>Ctrl+O</kbd>
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="app-menu-save"
            onClick={() => run(props.onSave)}
          >
            <span>Save</span>
            <kbd>Ctrl+S</kbd>
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="app-menu-save-as"
            onClick={() => run(props.onSaveAs)}
          >
            <span>Save As…</span>
            <kbd>Ctrl+Shift+S</kbd>
          </button>
          <div className="app-menu-sep" />
          <div className={`app-menu-submenu${recentOpen ? ' open' : ''}`}>
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={recentOpen}
              data-testid="app-menu-recent"
              onClick={() => setRecentOpen((v) => !v)}
            >
              <span>Recent Drawings</span>
              <span className="app-menu-caret">▸</span>
            </button>
            {recentOpen ? (
              <div className="app-menu-flyout" role="menu">
                {props.recent.length === 0 ? (
                  <div className="app-menu-empty">No recent drawings</div>
                ) : (
                  props.recent.map((entry) => (
                    <button
                      key={`${entry.path}-${entry.at}`}
                      type="button"
                      role="menuitem"
                      title={entry.path}
                      onClick={() => run(() => props.onOpenRecent(entry))}
                    >
                      <span className="app-menu-recent-name">{entry.name}</span>
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </div>
          <div className="app-menu-sep" />
          <button
            type="button"
            role="menuitem"
            disabled
            title="Print / Plot — not yet implemented"
          >
            <span>Print / Plot</span>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled
            title="Options — not yet implemented"
          >
            <span>Options</span>
          </button>
          <div className="app-menu-sep" />
          <button
            type="button"
            role="menuitem"
            data-testid="app-menu-exit"
            onClick={() => run(props.onExit)}
          >
            <span>Exit</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
