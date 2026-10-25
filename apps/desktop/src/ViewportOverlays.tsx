/**
 * Phase P1 canvas chrome: viewport controls, navigation bar, WCS indicator.
 * Pure overlays — not drawing entities; pointer-events managed per control.
 */

import type { ReactNode } from 'react';

type NavAction = 'pan' | 'extents' | 'window' | 'previous';

type Props = {
  panActive: boolean;
  zoomWindowActive: boolean;
  onPan: () => void;
  onZoomExtents: () => void;
  onZoomWindow: () => void;
  onZoomPrevious: () => void;
};

export function ViewportOverlays(props: Props) {
  return (
    <>
      <div
        className="vp-controls"
        data-testid="viewport-controls"
        aria-label="Viewport controls"
      >
        <button
          type="button"
          className="vp-control-btn"
          title="Viewport controls"
          data-testid="vp-control-minus"
          tabIndex={-1}
          disabled
        >
          −
        </button>
        <label className="vp-control-select-wrap" title="View orientation (TOP)">
          <span className="sr-only">View orientation</span>
          <select
            className="vp-control-select"
            data-testid="vp-orientation"
            value="TOP"
            disabled
            aria-label="View orientation"
          >
            <option value="TOP">Top</option>
            <option value="FRONT" disabled>
              Front
            </option>
            <option value="SW" disabled>
              SW Isometric
            </option>
          </select>
        </label>
        <label className="vp-control-select-wrap" title="Visual style (2D Wireframe)">
          <span className="sr-only">Visual style</span>
          <select
            className="vp-control-select"
            data-testid="vp-visual-style"
            value="2D"
            disabled
            aria-label="Visual style"
          >
            <option value="2D">2D Wireframe</option>
            <option value="3D" disabled>
              Realistic
            </option>
          </select>
        </label>
      </div>

      <div
        className="nav-bar"
        data-testid="navigation-bar"
        role="toolbar"
        aria-label="Navigation"
      >
        <NavButton
          id="pan"
          label="Pan"
          title="Pan (P) — drag to move the view"
          active={props.panActive}
          onClick={props.onPan}
        >
          <svg viewBox="0 0 24 24" aria-hidden>
            <path d="M12 3v18M3 12h18M8 7l4-4 4 4M8 17l4 4 4-4M7 8l-4 4 4 4M17 8l4 4-4 4" />
          </svg>
        </NavButton>
        <NavButton
          id="extents"
          label="Extents"
          title="Zoom Extents (Z → E) — fit all visible objects"
          active={false}
          onClick={props.onZoomExtents}
        >
          <svg viewBox="0 0 24 24" aria-hidden>
            <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
            <rect x="8" y="8" width="8" height="8" />
          </svg>
        </NavButton>
        <NavButton
          id="window"
          label="Window"
          title="Zoom Window (Z → W) — zoom to a rectangle"
          active={props.zoomWindowActive}
          onClick={props.onZoomWindow}
        >
          <svg viewBox="0 0 24 24" aria-hidden>
            <rect x="5" y="5" width="14" height="14" />
            <path d="M9 15l6-6M15 15V9H9" />
          </svg>
        </NavButton>
        <NavButton
          id="previous"
          label="Previous"
          title="Zoom Previous (Z → P) — restore last view"
          active={false}
          onClick={props.onZoomPrevious}
        >
          <svg viewBox="0 0 24 24" aria-hidden>
            <path d="M8 8H4V4" />
            <path d="M4 8a8 8 0 1 1 2 6" />
          </svg>
        </NavButton>
      </div>

      <div
        className="wcs-indicator"
        data-testid="wcs-indicator"
        aria-hidden
      >
        <svg viewBox="0 0 72 72" className="wcs-svg">
          <line x1="16" y1="56" x2="16" y2="14" />
          <polygon points="16,10 12,18 20,18" />
          <line x1="16" y1="56" x2="58" y2="56" />
          <polygon points="62,56 54,52 54,60" />
          <circle cx="16" cy="56" r="2.5" className="wcs-origin" />
          <text x="20" y="14" className="wcs-label">
            Y
          </text>
          <text x="60" y="52" className="wcs-label">
            X
          </text>
          <text x="22" y="68" className="wcs-caption">
            WCS
          </text>
        </svg>
      </div>
    </>
  );
}

function NavButton(props: {
  id: NavAction;
  label: string;
  title: string;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`nav-bar-btn${props.active ? ' active' : ''}`}
      data-testid={`nav-${props.id}`}
      title={props.title}
      aria-label={props.label}
      aria-pressed={props.active}
      onClick={(e) => {
        e.stopPropagation();
        props.onClick();
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {props.children}
    </button>
  );
}
