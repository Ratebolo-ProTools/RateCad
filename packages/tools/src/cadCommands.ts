import type { DimensionKind } from '@ratecad/core';
import type { ToolId } from './session.js';

/** Parameter schema for future typed CAD commands. */
export interface CadCommandParameter {
  id: string;
  label: string;
  type: 'length' | 'number' | 'text';
  optional?: boolean;
}

/**
 * Declarative CAD command registration.
 * Aliases resolve to an existing RateCAD tool — never a second implementation.
 */
export interface CadCommandDefinition {
  id: string;
  name: string;
  aliases: string[];
  description: string;
  tool: ToolId;
  dimKind?: DimensionKind;
  parameters?: CadCommandParameter[];
}

export type CadCommandResolveOk = {
  ok: true;
  command: CadCommandDefinition;
};

export type CadCommandResolveErr = {
  ok: false;
  reason: 'empty' | 'unknown';
  input: string;
};

export type CadCommandResolveResult = CadCommandResolveOk | CadCommandResolveErr;

/** Normalize typed input for alias lookup (case-insensitive, trimmed). */
export function normalizeCommandInput(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

/**
 * Registry / resolver for keyboard CAD commands.
 * Future commands register here; UI and tools stay the single activation path.
 */
export class CadCommandRegistry {
  private readonly byId = new Map<string, CadCommandDefinition>();
  private readonly byAlias = new Map<string, string>();

  register(definition: CadCommandDefinition): void {
    const id = definition.id;
    if (this.byId.has(id)) {
      throw new Error(`CAD command already registered: ${id}`);
    }
    this.byId.set(id, definition);
    for (const alias of definition.aliases) {
      const key = normalizeCommandInput(alias);
      if (!key) continue;
      if (this.byAlias.has(key)) {
        throw new Error(`CAD command alias conflict: ${key}`);
      }
      this.byAlias.set(key, id);
    }
  }

  get(id: string): CadCommandDefinition | undefined {
    return this.byId.get(id);
  }

  list(): CadCommandDefinition[] {
    return [...this.byId.values()];
  }

  resolve(raw: string): CadCommandResolveResult {
    const input = normalizeCommandInput(raw);
    if (!input) {
      return { ok: false, reason: 'empty', input: raw };
    }
    const id = this.byAlias.get(input) ?? (this.byId.has(input) ? input : undefined);
    if (!id) {
      return { ok: false, reason: 'unknown', input: raw.trim() };
    }
    const command = this.byId.get(id);
    if (!command) {
      return { ok: false, reason: 'unknown', input: raw.trim() };
    }
    return { ok: true, command };
  }
}

/** Built-in aliases for existing tools (AutoCAD-style where applicable). */
export function createDefaultCadCommandRegistry(): CadCommandRegistry {
  const registry = new CadCommandRegistry();
  const defs: CadCommandDefinition[] = [
    {
      id: 'line',
      name: 'Line',
      aliases: ['L', 'LINE'],
      description: 'Draw a line',
      tool: 'line',
    },
    {
      id: 'rectangle',
      name: 'Rectangle',
      aliases: ['REC', 'RECT', 'RECTANGLE'],
      description: 'Draw a rectangle',
      tool: 'rectangle',
      parameters: [
        { id: 'length', label: 'Length', type: 'length', optional: true },
        { id: 'width', label: 'Width', type: 'length', optional: true },
      ],
    },
    {
      id: 'circle',
      name: 'Circle',
      aliases: ['C', 'CIRCLE'],
      description: 'Draw a circle',
      tool: 'circle',
    },
    {
      id: 'polyline',
      name: 'Polyline',
      aliases: ['PL', 'PLINE', 'POLYLINE'],
      description: 'Draw a polyline',
      tool: 'polyline',
    },
    {
      id: 'move',
      name: 'Move',
      aliases: ['M', 'MOVE'],
      description: 'Move objects',
      tool: 'move',
    },
    {
      id: 'copy',
      name: 'Copy',
      aliases: ['CO', 'COPY'],
      description: 'Copy objects',
      tool: 'copy',
    },
    {
      id: 'trim',
      name: 'Trim',
      aliases: ['TR', 'TRIM'],
      description: 'Trim objects',
      tool: 'trim',
    },
    {
      id: 'fillet',
      name: 'Fillet',
      aliases: ['F', 'FILLET'],
      description: 'Fillet objects with a tangent arc',
      tool: 'fillet',
    },
    {
      id: 'extend',
      name: 'Extend',
      aliases: ['EX', 'EXTEND'],
      description: 'Extend objects',
      tool: 'extend',
    },
    {
      id: 'offset',
      name: 'Offset',
      aliases: ['O', 'OFFSET'],
      description: 'Offset objects',
      tool: 'offset',
    },
    {
      id: 'mirror',
      name: 'Mirror',
      aliases: ['MI', 'MIRROR'],
      description: 'Mirror objects',
      tool: 'mirror',
    },
    {
      id: 'rotate',
      name: 'Rotate',
      aliases: ['RO', 'ROTATE'],
      description: 'Rotate objects',
      tool: 'rotate',
    },
    {
      id: 'scale',
      name: 'Scale',
      aliases: ['SC', 'SCALE'],
      description: 'Scale objects',
      tool: 'scale',
    },
  ];
  for (const def of defs) {
    registry.register(def);
  }
  return registry;
}

/** Shared default registry instance for the desktop app and tests. */
export const defaultCadCommandRegistry = createDefaultCadCommandRegistry();
