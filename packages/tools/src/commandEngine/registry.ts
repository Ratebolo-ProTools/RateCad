import type { CadEngineCommand } from './types.js';
import { normalizeCommandInput } from '../cadCommands.js';

export type EngineResolveOk = { ok: true; command: CadEngineCommand };
export type EngineResolveErr = {
  ok: false;
  reason: 'empty' | 'unknown';
  input: string;
};
export type EngineResolveResult = EngineResolveOk | EngineResolveErr;

export class CadEngineRegistry {
  private readonly byId = new Map<string, CadEngineCommand>();
  private readonly byAlias = new Map<string, string>();

  register(command: CadEngineCommand): void {
    if (this.byId.has(command.id)) {
      throw new Error(`Command already registered: ${command.id}`);
    }
    this.byId.set(command.id, command);
    const aliases = [command.name, ...command.aliases];
    for (const alias of aliases) {
      const key = normalizeCommandInput(alias);
      if (!key) continue;
      const existing = this.byAlias.get(key);
      if (existing && existing !== command.id) {
        throw new Error(`Alias conflict: ${key}`);
      }
      this.byAlias.set(key, command.id);
    }
  }

  get(id: string): CadEngineCommand | undefined {
    return this.byId.get(id);
  }

  getByTool(tool: string): CadEngineCommand | undefined {
    return [...this.byId.values()].find((c) => c.tool === tool);
  }

  list(): CadEngineCommand[] {
    return [...this.byId.values()];
  }

  resolve(raw: string): EngineResolveResult {
    const input = normalizeCommandInput(raw);
    if (!input) return { ok: false, reason: 'empty', input: raw };
    const id = this.byAlias.get(input) ?? (this.byId.has(input) ? input : undefined);
    if (!id) return { ok: false, reason: 'unknown', input: raw.trim() };
    const command = this.byId.get(id);
    if (!command) return { ok: false, reason: 'unknown', input: raw.trim() };
    return { ok: true, command };
  }

  /** Autocomplete suggestions for a partial token. */
  suggest(raw: string, limit = 8): string[] {
    const input = normalizeCommandInput(raw);
    if (!input) {
      return this.list()
        .flatMap((c) => [c.name, ...c.aliases])
        .slice(0, limit);
    }
    const aliases = [...this.byAlias.keys()].sort();
    const hits = aliases.filter((a) => a.startsWith(input));
    // Prefer shorter / alias forms first
    hits.sort((a, b) => a.length - b.length || a.localeCompare(b));
    const seen = new Set<string>();
    const out: string[] = [];
    for (const h of hits) {
      if (seen.has(h)) continue;
      seen.add(h);
      out.push(h);
      if (out.length >= limit) break;
    }
    return out;
  }
}
