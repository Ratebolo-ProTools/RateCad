/**
 * Phase P2 user preferences for drafting cursor chrome.
 * Stored in localStorage — never written into DrawingDocument geometry.
 */

import {
  DEFAULT_CROSSHAIR_COLOR,
  DEFAULT_CROSSHAIR_SIZE,
  DEFAULT_PICKBOX_SIZE,
  DEFAULT_SHOW_SNAP_TOOLTIP,
  DEFAULT_SNAP_APERTURE_PX,
  DEFAULT_SNAP_MARKER_PX,
  normalizeCrosshairColor,
  normalizeCrosshairSize,
  normalizePickboxSize,
  normalizeShowSnapTooltip,
  normalizeSnapAperturePx,
  normalizeSnapMarkerPx,
  type CrosshairSize,
  type PickboxSize,
} from '@ratecad/viewport';

const STORAGE_KEY = 'ratecad.draftingPrefs';

export type DraftingPrefs = {
  crosshairSize: CrosshairSize;
  pickboxSize: PickboxSize;
  crosshairColor: string;
  snapAperturePx: number;
  snapMarkerPx: number;
  showSnapTooltip: boolean;
  /** Right Document / Layers / Properties sidebar. Default is minimized. */
  propertiesSidebarExpanded: boolean;
};

export const DEFAULT_DRAFTING_PREFS: DraftingPrefs = {
  crosshairSize: DEFAULT_CROSSHAIR_SIZE,
  pickboxSize: DEFAULT_PICKBOX_SIZE,
  crosshairColor: DEFAULT_CROSSHAIR_COLOR,
  snapAperturePx: DEFAULT_SNAP_APERTURE_PX,
  snapMarkerPx: DEFAULT_SNAP_MARKER_PX,
  showSnapTooltip: DEFAULT_SHOW_SNAP_TOOLTIP,
  propertiesSidebarExpanded: false,
};

function readSidebarExpanded(value: unknown): boolean {
  return value === true;
}

export function loadDraftingPrefs(): DraftingPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_DRAFTING_PREFS };
    const parsed = JSON.parse(raw) as Partial<DraftingPrefs>;
    return {
      crosshairSize: normalizeCrosshairSize(parsed.crosshairSize),
      pickboxSize: normalizePickboxSize(parsed.pickboxSize),
      crosshairColor: normalizeCrosshairColor(parsed.crosshairColor),
      snapAperturePx: normalizeSnapAperturePx(parsed.snapAperturePx),
      snapMarkerPx: normalizeSnapMarkerPx(parsed.snapMarkerPx),
      showSnapTooltip: normalizeShowSnapTooltip(parsed.showSnapTooltip),
      propertiesSidebarExpanded: readSidebarExpanded(
        parsed.propertiesSidebarExpanded,
      ),
    };
  } catch {
    return { ...DEFAULT_DRAFTING_PREFS };
  }
}

export function saveDraftingPrefs(prefs: DraftingPrefs): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        crosshairSize: normalizeCrosshairSize(prefs.crosshairSize),
        pickboxSize: normalizePickboxSize(prefs.pickboxSize),
        crosshairColor: normalizeCrosshairColor(prefs.crosshairColor),
        snapAperturePx: normalizeSnapAperturePx(prefs.snapAperturePx),
        snapMarkerPx: normalizeSnapMarkerPx(prefs.snapMarkerPx),
        showSnapTooltip: prefs.showSnapTooltip === true,
        propertiesSidebarExpanded: prefs.propertiesSidebarExpanded === true,
      }),
    );
  } catch {
    // Ignore quota / private-mode failures — prefs stay in-memory.
  }
}

export function updateDraftingPrefs(
  patch: Partial<DraftingPrefs>,
): DraftingPrefs {
  const cur = loadDraftingPrefs();
  const next: DraftingPrefs = {
    crosshairSize: normalizeCrosshairSize(
      patch.crosshairSize ?? cur.crosshairSize,
    ),
    pickboxSize: normalizePickboxSize(patch.pickboxSize ?? cur.pickboxSize),
    crosshairColor: normalizeCrosshairColor(
      patch.crosshairColor ?? cur.crosshairColor,
    ),
    snapAperturePx: normalizeSnapAperturePx(
      patch.snapAperturePx ?? cur.snapAperturePx,
    ),
    snapMarkerPx: normalizeSnapMarkerPx(patch.snapMarkerPx ?? cur.snapMarkerPx),
    showSnapTooltip: normalizeShowSnapTooltip(
      patch.showSnapTooltip ?? cur.showSnapTooltip,
    ),
    propertiesSidebarExpanded:
      patch.propertiesSidebarExpanded ?? cur.propertiesSidebarExpanded,
  };
  saveDraftingPrefs(next);
  return next;
}
