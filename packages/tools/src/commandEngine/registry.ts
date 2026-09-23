import type {
  CadCommandCategory,
  CadEngineCommand,
  CommandSuggestion,
} from './types.js';
import { normalizeCommandInput } from '../cadCommands.js';
import { editDistance } from './inputClassifier.js';
import type { CommandUsageTracker } from './usage.js';

export type EngineResolveOk = { ok: true; command: CadEngineCommand };
export type EngineResolveErr = {
  ok: false;
  reason: 'empty' | 'unknown';
  input: string;
};
export type EngineResolveResult = EngineResolveOk | EngineResolveErr;

const MATCH_SCORE: Record<CommandSuggestion['matchKind'], number> = {
  'exact-alias': 1000,
  'exact-name': 950,
  'name-prefix': 800,
  'alias-prefix': 750,
  'keyword-prefix': 650,
  'name-contains': 500,
  'keyword-contains': 400,
  typo: 250,
  recent: 100,
};

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

  /**
   * Ranked command suggestions.
   * Priority: exact alias → exact name → prefixes → contains → typo → usage.
   * Does NOT auto-execute; caller must confirm a selected row.
   */
  suggestRanked(
    raw: string,
    options: {
      limit?: number;
      usage?: CommandUsageTracker;
      allowTypo?: boolean;
    } = {},
  ): CommandSuggestion[] {
    const limit = options.limit ?? 8;
    const input = normalizeCommandInput(raw);
    const usage = options.usage;
    const rows: CommandSuggestion[] = [];

    if (!input) {
      // Idle: recent / frequent first, then alphabetical
      const recent = usage?.listRecent(limit) ?? [];
      for (const id of recent) {
        const c = this.byId.get(id);
        if (!c) continue;
        rows.push(this.toSuggestion(c, 'recent', MATCH_SCORE.recent));
      }
      if (rows.length < limit) {
        for (const c of this.list().sort((a, b) => a.name.localeCompare(b.name))) {
          if (rows.some((r) => r.commandId === c.id)) continue;
          rows.push(this.toSuggestion(c, 'name-prefix', 50));
          if (rows.length >= limit) break;
        }
      }
      return rows.slice(0, limit);
    }

    for (const c of this.list()) {
      const nameKey = normalizeCommandInput(c.name);
      const aliases = c.aliases.map((a) => normalizeCommandInput(a)).filter(Boolean);
      const keywords = (c.keywords ?? []).map((k) =>
        normalizeCommandInput(k),
      );

      let kind: CommandSuggestion['matchKind'] | null = null;
      let score = 0;

      if (aliases.includes(input)) {
        kind = 'exact-alias';
        score = MATCH_SCORE['exact-alias'];
      } else if (nameKey === input) {
        kind = 'exact-name';
        score = MATCH_SCORE['exact-name'];
      } else if (nameKey.startsWith(input)) {
        kind = 'name-prefix';
        score = MATCH_SCORE['name-prefix'] - Math.min(40, nameKey.length - input.length);
      } else if (aliases.some((a) => a.startsWith(input))) {
        kind = 'alias-prefix';
        score = MATCH_SCORE['alias-prefix'];
      } else if (keywords.some((k) => k.startsWith(input))) {
        kind = 'keyword-prefix';
        score = MATCH_SCORE['keyword-prefix'];
      } else if (nameKey.includes(input)) {
        kind = 'name-contains';
        score = MATCH_SCORE['name-contains'];
      } else if (keywords.some((k) => k.includes(input))) {
        kind = 'keyword-contains';
        score = MATCH_SCORE['keyword-contains'];
      } else if (options.allowTypo !== false && input.length >= 3) {
        const dist = editDistance(input, nameKey);
        if (dist > 0 && dist <= 2) {
          kind = 'typo';
          score = MATCH_SCORE.typo - dist * 20;
        } else {
          for (const a of aliases) {
            const d = editDistance(input, a);
            if (d > 0 && d <= 1) {
              kind = 'typo';
              score = MATCH_SCORE.typo - d * 20;
              break;
            }
          }
        }
      }

      if (!kind) continue;

      // Usage boost (deterministic, secondary)
      if (usage) {
        const freq = usage.getFrequency(c.id);
        const recentIdx = usage.recentIndex(c.id);
        score += Math.min(40, freq * 2);
        if (recentIdx >= 0) score += Math.max(0, 30 - recentIdx);
      }

      rows.push(this.toSuggestion(c, kind, score));
    }

    rows.sort(
      (a, b) =>
        b.score - a.score ||
        a.name.length - b.name.length ||
        a.name.localeCompare(b.name),
    );

    // Deduplicate by command id
    const seen = new Set<string>();
    const out: CommandSuggestion[] = [];
    for (const r of rows) {
      if (seen.has(r.commandId)) continue;
      seen.add(r.commandId);
      out.push(r);
      if (out.length >= limit) break;
    }
    return out;
  }

  /** Autocomplete suggestions for a partial token (legacy string list). */
  suggest(raw: string, limit = 8, usage?: CommandUsageTracker): string[] {
    return this.suggestRanked(raw, { limit, usage }).map((r) => {
      // Prefer showing primary short alias when input matches alias prefix
      const input = normalizeCommandInput(raw);
      if (input) {
        const alias = r.alias && normalizeCommandInput(r.alias);
        if (alias && alias.startsWith(input) && alias.length <= input.length + 2) {
          return alias;
        }
      }
      return r.name;
    });
  }

  private toSuggestion(
    c: CadEngineCommand,
    matchKind: CommandSuggestion['matchKind'],
    score: number,
  ): CommandSuggestion {
    return {
      commandId: c.id,
      name: c.name,
      alias: c.aliases[0],
      description: c.description,
      category: (c.category ?? 'Other') as CadCommandCategory,
      score,
      matchKind,
    };
  }
}
