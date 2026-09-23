/**
 * Command usage tracker — recent + frequency for suggestion ranking.
 * Deterministic; never involves AI.
 */

export class CommandUsageTracker {
  private readonly recent: string[] = [];
  private readonly frequency = new Map<string, number>();
  private readonly maxRecent: number;

  constructor(maxRecent = 40) {
    this.maxRecent = maxRecent;
  }

  record(commandId: string): void {
    if (!commandId) return;
    this.frequency.set(commandId, (this.frequency.get(commandId) ?? 0) + 1);
    this.recent.push(commandId);
    if (this.recent.length > this.maxRecent) this.recent.shift();
  }

  getFrequency(commandId: string): number {
    return this.frequency.get(commandId) ?? 0;
  }

  /** Lower index = more recent; -1 if never. */
  recentIndex(commandId: string): number {
    for (let i = this.recent.length - 1; i >= 0; i -= 1) {
      if (this.recent[i] === commandId) return this.recent.length - 1 - i;
    }
    return -1;
  }

  listRecent(limit = 10): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (let i = this.recent.length - 1; i >= 0 && out.length < limit; i -= 1) {
      const id = this.recent[i]!;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  }

  /** Test / persistence helpers */
  snapshot(): { recent: string[]; frequency: Record<string, number> } {
    return {
      recent: [...this.recent],
      frequency: Object.fromEntries(this.frequency),
    };
  }

  restore(data: { recent?: string[]; frequency?: Record<string, number> }): void {
    this.recent.length = 0;
    this.frequency.clear();
    for (const id of data.recent ?? []) this.recent.push(id);
    for (const [k, v] of Object.entries(data.frequency ?? {})) {
      this.frequency.set(k, v);
    }
  }
}
