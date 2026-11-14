export type SidebarSection = 'document' | 'layers' | 'properties';

function IconExpand() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M10 3 L5 8 L10 13" />
    </svg>
  );
}

function IconMinimize() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6 3 L11 8 L6 13" />
    </svg>
  );
}

function IconDocument() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 2.5 H10 L12.5 5 V13.5 H4 Z" />
      <path d="M10 2.5 V5 H12.5" />
      <path d="M6 8 H10.5 M6 10.5 H10.5" />
    </svg>
  );
}

function IconLayers() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 6 L8 3.5 L13.5 6 L8 8.5 Z" />
      <path d="M3 8.5 L8 11 L13 8.5" />
      <path d="M3 11 L8 13.5 L13 11" />
    </svg>
  );
}

function IconProperties() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 4 H13 M3 8 H13 M3 12 H13" />
      <circle cx="6" cy="4" r="1.4" />
      <circle cx="10" cy="8" r="1.4" />
      <circle cx="7" cy="12" r="1.4" />
    </svg>
  );
}

export function PropertiesCollapseBar({
  onCollapse,
}: {
  onCollapse: () => void;
}) {
  return (
    <div className="panel-collapse-bar">
      <button
        type="button"
        className="mini-btn panel-collapse-btn"
        data-testid="props-minimize"
        title="Minimize properties"
        aria-label="Minimize properties"
        onClick={onCollapse}
      >
        <IconMinimize />
        Minimize
      </button>
    </div>
  );
}

export function PropertiesRail({
  onExpand,
  onOpenSection,
}: {
  onExpand: () => void;
  onOpenSection: (section: SidebarSection) => void;
}) {
  return (
    <nav className="props-rail" aria-label="Properties sidebar">
      <button
        type="button"
        className="props-rail-btn"
        data-testid="props-expand"
        data-tip="Expand properties"
        title="Expand properties"
        aria-label="Expand properties"
        onClick={onExpand}
      >
        <IconExpand />
      </button>
      <button
        type="button"
        className="props-rail-btn"
        data-testid="props-rail-document"
        data-tip="Document"
        title="Document"
        aria-label="Document"
        onClick={() => onOpenSection('document')}
      >
        <IconDocument />
      </button>
      <button
        type="button"
        className="props-rail-btn"
        data-testid="props-rail-layers"
        data-tip="Layers"
        title="Layers"
        aria-label="Layers"
        onClick={() => onOpenSection('layers')}
      >
        <IconLayers />
      </button>
      <button
        type="button"
        className="props-rail-btn"
        data-testid="props-rail-properties"
        data-tip="Properties"
        title="Properties"
        aria-label="Properties"
        onClick={() => onOpenSection('properties')}
      >
        <IconProperties />
      </button>
    </nav>
  );
}
