import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_DRAFTING_PREFS,
  loadDraftingPrefs,
  updateDraftingPrefs,
} from './draftingPrefs';

const mem = new Map<string, string>();

beforeEach(() => {
  mem.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => mem.get(key) ?? null,
    setItem: (key: string, value: string) => {
      mem.set(key, value);
    },
    removeItem: (key: string) => {
      mem.delete(key);
    },
  });
});

describe('properties sidebar preference', () => {
  it('starts minimized when no preference is stored', () => {
    expect(DEFAULT_DRAFTING_PREFS.propertiesSidebarExpanded).toBe(false);
    expect(loadDraftingPrefs().propertiesSidebarExpanded).toBe(false);
  });

  it('keeps older drafting prefs minimized until the user expands', () => {
    mem.set(
      'ratecad.draftingPrefs',
      JSON.stringify({ crosshairSize: 'large', pickboxSize: 'small' }),
    );
    const loaded = loadDraftingPrefs();
    expect(loaded.crosshairSize).toBe('large');
    expect(loaded.pickboxSize).toBe('small');
    expect(loaded.propertiesSidebarExpanded).toBe(false);
  });

  it('persists expanded and minimized across reloads', () => {
    updateDraftingPrefs({ propertiesSidebarExpanded: true });
    expect(loadDraftingPrefs().propertiesSidebarExpanded).toBe(true);
    updateDraftingPrefs({ propertiesSidebarExpanded: false });
    expect(loadDraftingPrefs().propertiesSidebarExpanded).toBe(false);
  });

  it('keeps the sidebar flag when another drafting pref changes', () => {
    updateDraftingPrefs({ propertiesSidebarExpanded: true });
    updateDraftingPrefs({ crosshairSize: 'small' });
    const loaded = loadDraftingPrefs();
    expect(loaded.crosshairSize).toBe('small');
    expect(loaded.propertiesSidebarExpanded).toBe(true);
  });
});
