/**
 * EXTEND — CadCommandEngine command (P4-B3).
 *
 * Standard boundary-selection workflow:
 *   Select boundary edge(s) → Enter → select objects to extend (near endpoint)
 *   → continue until Enter finishes / ESC cancels.
 *
 * Quick mode, Fence/Crossing, and Edge-mode UI options are deferred to P4-B4
 * unless already shared via document settings.edgeMode.
 */
import type { CommandBus } from '@ratecad/commands';
import { ExtendEntityCommand } from '@ratecad/commands';
import {
  getEntity,
  isEntityModifiable,
  setSelection,
  type Entity,
  type EntityId,
  type Vec2,
} from '@ratecad/core';
import {
  canExtendEntity,
  extendPreviewMulti,
  type EdgeMode,
  type ProjectMode,
} from '@ratecad/geometry';
import { hitTestDocument } from '@ratecad/viewport';
import type {
  CadCommandOption,
  CadEngineCommand,
  CadPromptDefinition,
} from '../types.js';

type ExtendPhase = 'boundaries' | 'targets';

type ExtendState = {
  bus: CommandBus;
  edgeMode: EdgeMode;
  projectMode: ProjectMode;
  boundaryIds: EntityId[];
  /** Enter with empty selection → all visible boundaries. */
  useAllBoundaries: boolean;
  phase: ExtendPhase;
  sessionExtendCount: number;
};

const EXTEND_TARGET_OPTIONS: CadCommandOption[] = [
  { id: 'undo', label: 'Undo', aliases: ['U', 'UNDO'] },
  { id: 'boundary', label: 'Boundary edges', aliases: ['B', 'BOUNDARY'] },
];

function boundaryPrompt(): CadPromptDefinition {
  return {
    id: 'boundaries',
    message: 'Select boundary edges:',
    inputType: 'entities',
    optional: true,
  };
}

function targetPrompt(): CadPromptDefinition {
  return {
    id: 'targets',
    message: 'Select object to extend or [Undo/Boundary]:',
    inputType: 'point',
    options: EXTEND_TARGET_OPTIONS,
    optional: true,
  };
}

function statusPrefix(): string {
  return 'EXTEND';
}

function readSettings(bus: CommandBus): {
  edgeMode: EdgeMode;
  projectMode: ProjectMode;
} {
  const settings = bus.getDocument().settings;
  return {
    // Preserve ExtendEntityCommand default ('extend') unless document says no-extend.
    edgeMode: settings.edgeMode === 'no-extend' ? 'no-extend' : 'extend',
    projectMode:
      settings.projectMode === 'ucs' || settings.projectMode === 'view'
        ? settings.projectMode
        : 'none',
  };
}

function isBoundaryEntity(e: Entity): boolean {
  return (
    e.visible &&
    (e.type === 'line' ||
      e.type === 'polyline' ||
      e.type === 'rectangle' ||
      e.type === 'circle' ||
      e.type === 'wall')
  );
}

function allVisibleBoundaries(bus: CommandBus): Entity[] {
  const doc = bus.getDocument();
  return doc.entities.filter((e) => {
    if (!isBoundaryEntity(e)) return false;
    const layer = doc.layers.find((l) => l.id === e.layerId);
    if (layer && !layer.visible) return false;
    return true;
  });
}

function resolveBoundaries(s: ExtendState): Entity[] {
  if (s.useAllBoundaries) {
    return allVisibleBoundaries(s.bus);
  }
  const doc = s.bus.getDocument();
  const seen = new Set<EntityId>();
  const out: Entity[] = [];
  for (const id of s.boundaryIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const e = getEntity(doc, id);
    if (e && isBoundaryEntity(e)) out.push(e);
  }
  return out;
}

function pickEntityAt(bus: CommandBus, point: Vec2): Entity | null {
  const grid = bus.getDocument().settings.gridSize || 1;
  const tol = Math.max(grid * 0.35, 0.05);
  const id = hitTestDocument(bus.getDocument(), point, tol);
  if (!id) return null;
  return getEntity(bus.getDocument(), id) ?? null;
}

function beginTargets(
  s: ExtendState,
  message?: string,
): ReturnType<CadEngineCommand['onText']> {
  s.phase = 'targets';
  const n = resolveBoundaries(s).length;
  return {
    kind: 'continue',
    prompt: targetPrompt(),
    status: `${statusPrefix()}: Select object to extend (${n} boundary edge(s)):`,
    message: message ?? undefined,
    preview: null,
    dynamic: { label: statusPrefix() },
  };
}

function ensureState(state: unknown, bus?: CommandBus): ExtendState {
  const s = state as Partial<ExtendState>;
  if (s.bus && s.phase && s.boundaryIds) {
    return s as ExtendState;
  }
  const b = s.bus ?? bus;
  if (!b) {
    throw new Error('EXTEND state missing CommandBus');
  }
  const cfg = readSettings(b);
  return {
    bus: b,
    edgeMode: s.edgeMode ?? cfg.edgeMode,
    projectMode: s.projectMode ?? cfg.projectMode,
    boundaryIds: s.boundaryIds ?? [],
    useAllBoundaries: s.useAllBoundaries ?? false,
    phase: s.phase ?? 'boundaries',
    sessionExtendCount: s.sessionExtendCount ?? 0,
  };
}

function runExtend(
  s: ExtendState,
  target: Entity,
  pickPoint: Vec2,
): ReturnType<CadEngineCommand['onPoint']> {
  if (!canExtendEntity(target)) {
    return {
      kind: 'reject',
      message:
        target.type === 'polyline' && target.geometry.closed
          ? 'Closed polyline cannot be extended'
          : `Cannot extend ${target.type}`,
      prompt: targetPrompt(),
    };
  }
  if (!isEntityModifiable(s.bus.getDocument(), target)) {
    return {
      kind: 'reject',
      message: 'Locked layer — cannot extend',
      prompt: targetPrompt(),
    };
  }

  const boundaries = resolveBoundaries(s).filter((b) => b.id !== target.id);
  if (!boundaries.length) {
    return {
      kind: 'reject',
      message: 'No boundary edges available',
      prompt: targetPrompt(),
    };
  }

  try {
    s.bus.execute(
      new ExtendEntityCommand(target, boundaries, pickPoint, {
        edgeMode: s.edgeMode,
      }),
    );
    s.sessionExtendCount += 1;
    // Keep boundary highlight selection
    s.bus.updateWithoutHistory((d) =>
      setSelection(d, s.useAllBoundaries ? [] : [...s.boundaryIds]),
    );
    return {
      kind: 'continue',
      prompt: targetPrompt(),
      status: `${statusPrefix()}: Extended — select next (Enter to finish):`,
      message: 'Extended',
      preview: null,
      dynamic: { label: statusPrefix() },
    };
  } catch (err) {
    return {
      kind: 'reject',
      message: err instanceof Error ? err.message : 'Extend failed',
      prompt: targetPrompt(),
    };
  }
}

export function initExtendCommandState(bus: CommandBus): Partial<ExtendState> {
  const cfg = readSettings(bus);
  return {
    bus,
    ...cfg,
    boundaryIds: [],
    useAllBoundaries: false,
    phase: 'boundaries',
    sessionExtendCount: 0,
  };
}

/** EXTEND — Standard boundary workflow via CadCommandEngine. */
export const extendCommand: CadEngineCommand = {
  id: 'extend',
  name: 'EXTEND',
  aliases: ['EX'],
  description: 'Extend objects to meet boundary edges',
  tool: 'extend',
  category: 'Modify',
  keywords: ['extend', 'lengthen'],
  bootstrap: (bus) => {
    const init = initExtendCommandState(bus);
    return {
      state: init,
      prompt: boundaryPrompt(),
      status: 'EXTEND: Select boundary edges:',
    };
  },
  start: () => ({
    prompt: boundaryPrompt(),
    status: 'EXTEND: Select boundary edges:',
  }),
  onPoint: (point, prompt, _ctx, state) => {
    const s = ensureState(state);

    if (prompt.id === 'boundaries' || s.phase === 'boundaries') {
      const ent = pickEntityAt(s.bus, point);
      if (!ent || !isBoundaryEntity(ent)) {
        return {
          kind: 'reject',
          message: 'Select a supported boundary edge',
          prompt: boundaryPrompt(),
        };
      }
      if (!s.boundaryIds.includes(ent.id)) {
        s.boundaryIds.push(ent.id);
      }
      s.useAllBoundaries = false;
      s.bus.updateWithoutHistory((d) => setSelection(d, [...s.boundaryIds]));
      return {
        kind: 'continue',
        prompt: boundaryPrompt(),
        status: `${statusPrefix()}: ${s.boundaryIds.length} boundary edge(s) — Enter when done:`,
        message: 'Added boundary edge',
      };
    }

    // Targets phase
    const target = pickEntityAt(s.bus, point);
    if (!target) {
      return {
        kind: 'reject',
        message: 'Select object to extend',
        prompt: targetPrompt(),
      };
    }
    return runExtend(s, target, point);
  },
  onText: (text, prompt, _ctx, state) => {
    const s = ensureState(state);
    const trimmed = text.trim();
    const upper = trimmed.toUpperCase();

    if (trimmed === 'undo' || upper === 'U') {
      if (s.sessionExtendCount <= 0 || !s.bus.canUndo()) {
        return {
          kind: 'reject',
          message: 'Nothing to undo in this EXTEND session',
          prompt: prompt.id === 'boundaries' ? boundaryPrompt() : targetPrompt(),
        };
      }
      s.bus.undo();
      s.sessionExtendCount -= 1;
      return {
        kind: 'continue',
        prompt: targetPrompt(),
        status: `${statusPrefix()}: Undone — select object to extend:`,
        message: 'Undo',
      };
    }

    if (trimmed === 'boundary' || upper === 'B') {
      s.phase = 'boundaries';
      s.useAllBoundaries = false;
      return {
        kind: 'continue',
        prompt: boundaryPrompt(),
        status: `${statusPrefix()}: Select boundary edges:`,
        message: 'Select boundary edges',
      };
    }

    if (prompt.id === 'boundaries' || s.phase === 'boundaries') {
      if (!trimmed) {
        const sel = s.bus.getDocument().selection;
        if (sel.length) {
          // Deduplicate while preserving order
          const seen = new Set<EntityId>();
          s.boundaryIds = [];
          for (const id of sel) {
            if (seen.has(id)) continue;
            const e = getEntity(s.bus.getDocument(), id);
            if (e && isBoundaryEntity(e)) {
              seen.add(id);
              s.boundaryIds.push(id);
            }
          }
        }
        if (s.boundaryIds.length === 0) {
          s.useAllBoundaries = true;
          return beginTargets(s, 'All objects used as boundary edges');
        }
        s.useAllBoundaries = false;
        return beginTargets(s, `${s.boundaryIds.length} boundary edge(s)`);
      }
      return {
        kind: 'reject',
        message: 'Select boundary edges, then press Enter',
        prompt: boundaryPrompt(),
      };
    }

    if (prompt.id === 'targets' || s.phase === 'targets') {
      if (!trimmed) {
        return {
          kind: 'complete',
          status: `EXTEND complete (${s.sessionExtendCount} operation(s))`,
        };
      }
      return {
        kind: 'reject',
        message: 'Select object to extend, or Undo / Boundary',
        prompt: targetPrompt(),
      };
    }

    return { kind: 'reject', message: 'Invalid input', prompt };
  },
  onMove: (point, prompt, _ctx, state) => {
    const s = ensureState(state);

    if (prompt.id === 'boundaries' || s.phase === 'boundaries') {
      return {
        preview: null,
        previewEntities: null,
        hideEntityIds: [],
        dynamic: { label: statusPrefix() },
        status: `${statusPrefix()}: Select boundary edges`,
      };
    }

    const target = pickEntityAt(s.bus, point);
    if (!target || !canExtendEntity(target)) {
      return {
        preview: null,
        previewEntities: null,
        hideEntityIds: [],
        dynamic: { label: statusPrefix() },
        status: `${statusPrefix()}: Select object to extend`,
      };
    }

    const boundaries = resolveBoundaries(s).filter((b) => b.id !== target.id);
    const preview = extendPreviewMulti(target, boundaries, point, {
      edgeMode: s.edgeMode,
      projectMode: s.projectMode,
    });

    if (!preview) {
      // Try a dry-run reason via ExtendEntityCommand would throw — use preview null.
      return {
        preview: null,
        previewEntities: null,
        hideEntityIds: [],
        dynamic: { label: statusPrefix() },
        status: `${statusPrefix()}: No valid extension`,
      };
    }

    return {
      preview: null,
      previewEntities: [preview],
      hideEntityIds: [target.id],
      dynamic: { label: `${statusPrefix()} · Click to extend` },
      status: `${statusPrefix()}: Click to extend`,
    };
  },
  onCancel: (state) => {
    const s = state as Partial<ExtendState>;
    if (s.bus) {
      s.bus.updateWithoutHistory((d) => setSelection(d, []));
    }
  },
};
