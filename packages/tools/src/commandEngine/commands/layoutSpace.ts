/**
 * Real LAYOUT / MSPACE / PSPACE commands (Part 4).
 * UI layout tabs remain the primary workflow; these mirror AutoCAD command-line options.
 */

import type { CommandBus } from '@ratecad/commands';
import {
  CreateLayoutCommand,
  RenameLayoutCommand,
  SetActiveLayoutCommand,
} from '@ratecad/commands';
import type { WorkspaceMode } from '@ratecad/core';
import type {
  CadCommandOption,
  CadEngineCommand,
  CadPromptDefinition,
} from '../types.js';

export interface LayoutSpaceHost {
  getWorkspaceMode(): WorkspaceMode;
  enterMspace(): { ok: boolean; message: string };
  enterPspace(): { ok: boolean; message: string };
  onLayoutChanged?(layoutId: string | null, message: string): void;
}

function asLayoutHost(host: unknown): LayoutSpaceHost | null {
  if (!host || typeof host !== 'object') return null;
  const h = host as Record<string, unknown>;
  if (typeof h.getWorkspaceMode !== 'function') return null;
  if (typeof h.enterMspace !== 'function') return null;
  if (typeof h.enterPspace !== 'function') return null;
  return host as LayoutSpaceHost;
}

type LayoutState = {
  bus: CommandBus;
  host: LayoutSpaceHost | null;
  phase: 'menu' | 'create-name' | 'set-name' | 'rename-name';
};

const LAYOUT_OPTIONS: CadCommandOption[] = [
  { id: 'create', label: 'Create', aliases: ['C', 'CREATE', 'NEW'] },
  { id: 'set', label: 'Set', aliases: ['S', 'SET', 'ACTIVE'] },
  { id: 'rename', label: 'Rename', aliases: ['R', 'RENAME', 'REN'] },
  { id: 'list', label: '?', aliases: ['?', 'LIST', 'L'] },
];

function menuPrompt(): CadPromptDefinition {
  return {
    id: 'menu',
    message: 'LAYOUT [Create/Set/Rename/?]:',
    inputType: 'option',
    options: LAYOUT_OPTIONS,
  };
}

function listLayouts(bus: CommandBus): string {
  const doc = bus.getDocument();
  const lines = doc.layouts.map((l) => {
    const mark = l.id === doc.activeLayoutId ? '*' : ' ';
    return `${mark} ${l.name}`;
  });
  return `Layouts:\n${lines.join('\n')}`;
}

function findLayoutByNameOrId(bus: CommandBus, raw: string) {
  const q = raw.trim().toLowerCase();
  const doc = bus.getDocument();
  return (
    doc.layouts.find((l) => l.id.toLowerCase() === q) ??
    doc.layouts.find((l) => l.name.toLowerCase() === q) ??
    null
  );
}

export const layoutCommand: CadEngineCommand = {
  id: 'layout',
  name: 'LAYOUT',
  aliases: ['LAYOUT'],
  description: 'Create, set, or rename Paper Space layouts',
  tool: 'select',
  category: 'Other',
  keywords: ['layout', 'paper', 'sheet', 'tab'],
  bootstrap: (bus, host) => ({
    state: {
      bus,
      host: asLayoutHost(host),
      phase: 'menu',
    } satisfies LayoutState,
  }),
  start: () => ({
    prompt: menuPrompt(),
    status: 'LAYOUT: Create / Set / Rename / ?',
  }),
  onPoint: (_p, prompt) => ({
    kind: 'reject',
    message: 'Enter an option',
    prompt,
  }),
  onText: (text, prompt, _ctx, state) => {
    const s = state as LayoutState;
    const raw = text.trim();

    if (prompt.id === 'menu' || s.phase === 'menu') {
      const opt = LAYOUT_OPTIONS.find(
        (o) =>
          o.id === raw.toLowerCase() ||
          o.aliases.some((a) => a.toLowerCase() === raw.toLowerCase()),
      );
      if (!opt) {
        return {
          kind: 'reject',
          message: 'Enter Create, Set, Rename, or ?',
          prompt: menuPrompt(),
        };
      }
      if (opt.id === 'list') {
        const listing = listLayouts(s.bus);
        return {
          kind: 'complete',
          status: listing,
          message: listing,
        };
      }
      if (opt.id === 'create') {
        s.phase = 'create-name';
        return {
          kind: 'continue',
          prompt: {
            id: 'create-name',
            message: 'Enter new layout name <LayoutN>:',
            inputType: 'string',
            optional: true,
          },
          status: 'LAYOUT CREATE: Enter name (Enter for default)',
        };
      }
      if (opt.id === 'set') {
        s.phase = 'set-name';
        return {
          kind: 'continue',
          prompt: {
            id: 'set-name',
            message: 'Enter layout name to make current:',
            inputType: 'string',
          },
          status: 'LAYOUT SET: Enter layout name',
        };
      }
      s.phase = 'rename-name';
      return {
        kind: 'continue',
        prompt: {
          id: 'rename-name',
          message: 'Enter new name for current layout:',
          inputType: 'string',
        },
        status: 'LAYOUT RENAME: Enter new name',
      };
    }

    if (prompt.id === 'create-name' || s.phase === 'create-name') {
      const name = raw.length ? raw : undefined;
      try {
        s.bus.execute(new CreateLayoutCommand(name));
        const doc = s.bus.getDocument();
        const layout = doc.layouts.find((l) => l.id === doc.activeLayoutId);
        const msg = `LAYOUT created: ${layout?.name ?? 'Layout'}`;
        s.host?.onLayoutChanged?.(doc.activeLayoutId, msg);
        return { kind: 'complete', status: msg };
      } catch (e) {
        return {
          kind: 'reject',
          message: e instanceof Error ? e.message : 'Create failed',
          prompt,
        };
      }
    }

    if (prompt.id === 'set-name' || s.phase === 'set-name') {
      const layout = findLayoutByNameOrId(s.bus, raw);
      if (!layout) {
        return {
          kind: 'reject',
          message: `Layout not found: ${raw}`,
          prompt,
        };
      }
      s.bus.execute(new SetActiveLayoutCommand(layout.id));
      const msg = `LAYOUT set: ${layout.name}`;
      s.host?.onLayoutChanged?.(layout.id, msg);
      return { kind: 'complete', status: msg };
    }

    if (prompt.id === 'rename-name' || s.phase === 'rename-name') {
      const doc = s.bus.getDocument();
      const layoutId = doc.activeLayoutId;
      if (!layoutId) {
        return {
          kind: 'complete',
          status: 'LAYOUT RENAME: Switch to a layout tab first',
        };
      }
      if (!raw) {
        return {
          kind: 'reject',
          message: 'Name required',
          prompt,
        };
      }
      try {
        s.bus.execute(new RenameLayoutCommand(layoutId, raw));
        const msg = `LAYOUT renamed: ${raw}`;
        s.host?.onLayoutChanged?.(layoutId, msg);
        return { kind: 'complete', status: msg };
      } catch (e) {
        return {
          kind: 'reject',
          message: e instanceof Error ? e.message : 'Rename failed',
          prompt,
        };
      }
    }

    return { kind: 'reject', message: 'Unexpected input', prompt };
  },
};

function idleDonePrompt(message: string): CadPromptDefinition {
  return {
    id: 'done',
    message,
    inputType: 'string',
    optional: true,
  };
}

export const mspaceCommand: CadEngineCommand = {
  id: 'mspace',
  name: 'MSPACE',
  aliases: ['MSPACE', 'MS'],
  description: 'Enter Model Space through the active layout viewport',
  tool: 'select',
  category: 'Other',
  keywords: ['mspace', 'model', 'viewport'],
  bootstrap: (_bus, host) => {
    const h = asLayoutHost(host);
    if (!h) {
      return {
        complete: true,
        status: 'MSPACE: Host not available',
        prompt: idleDonePrompt('MSPACE: Host not available'),
      };
    }
    const mode = h.getWorkspaceMode();
    if (mode === 'MODEL_SPACE') {
      return {
        complete: true,
        status: 'MSPACE: Switch to a layout tab first',
        prompt: idleDonePrompt('MSPACE: Switch to a layout tab first'),
      };
    }
    if (mode === 'VIEWPORT_MODEL_SPACE') {
      return {
        complete: true,
        status: 'MSPACE: Already in viewport Model Space',
        prompt: idleDonePrompt('Already in viewport Model Space'),
      };
    }
    const result = h.enterMspace();
    return {
      complete: true,
      status: result.message,
      prompt: idleDonePrompt(result.message),
    };
  },
  start: () => ({
    prompt: idleDonePrompt('MSPACE'),
    status: 'MSPACE',
  }),
  onPoint: () => ({ kind: 'complete', status: 'MSPACE' }),
  onText: () => ({ kind: 'complete', status: 'MSPACE' }),
};

export const pspaceCommand: CadEngineCommand = {
  id: 'pspace',
  name: 'PSPACE',
  description: 'Return to Paper Space from a layout viewport',
  aliases: ['PSPACE', 'PS'],
  tool: 'select',
  category: 'Other',
  keywords: ['pspace', 'paper', 'layout'],
  bootstrap: (_bus, host) => {
    const h = asLayoutHost(host);
    if (!h) {
      return {
        complete: true,
        status: 'PSPACE: Host not available',
        prompt: idleDonePrompt('PSPACE: Host not available'),
      };
    }
    const mode = h.getWorkspaceMode();
    if (mode === 'MODEL_SPACE') {
      return {
        complete: true,
        status: 'PSPACE: Already on Model tab',
        prompt: idleDonePrompt('PSPACE: Already on Model tab'),
      };
    }
    if (mode === 'PAPER_SPACE') {
      return {
        complete: true,
        status: 'PSPACE: Already in Paper Space',
        prompt: idleDonePrompt('Already in Paper Space'),
      };
    }
    const result = h.enterPspace();
    return {
      complete: true,
      status: result.message,
      prompt: idleDonePrompt(result.message),
    };
  },
  start: () => ({
    prompt: idleDonePrompt('PSPACE'),
    status: 'PSPACE',
  }),
  onPoint: () => ({ kind: 'complete', status: 'PSPACE' }),
  onText: () => ({ kind: 'complete', status: 'PSPACE' }),
};
