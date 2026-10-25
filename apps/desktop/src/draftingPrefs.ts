/**
 * Phase P2 user preferences for drafting cursor chrome.
 * Stored in localStorage — never written into DrawingDocument geometry.
 */

import {
  DEFAULT_CROSSHAIR_SIZE,
  DEFAULT_PICKBOX_SIZE,
  normalizeCrosshairSize,
  normalizePickboxSize,
  type CrosshairSize,
  type PickboxSize,
} from '@ratecad/viewport';

const STORAGE_KEY = 'ratecad.draftingPrefs';

export type DraftingPrefs = {
  crosshairSize: CrosshairSize;
  pickboxSize: PickboxSize;
};

export const DEFAULT_DRAFTING_PREFS: DraftingPrefs = {
  crosshairSize: DEFAULT_CROSSHAIR_SIZE,
  pickboxSize: DEFAULT_PICKBOX_SIZE,
};

export function loadDraftingPrefs(): DraftingPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_DRAFTING_PREFS };
    const parsed = JSON.parse(raw) as Partial<DraftingPrefs>;
    return {
      crosshairSize: normalizeCrosshairSize(parsed.crosshairSize),
      pickboxSize: normalizePickboxSize(parsed.pickboxSize),
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
  };
  saveDraftingPrefs(next);
  return next;
}
