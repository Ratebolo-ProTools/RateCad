/** Session-level command history (names / typed command lines). */
export class CadCommandHistory {
  private readonly items: string[] = [];
  private index = -1;
  private readonly max: number;

  constructor(max = 50) {
    this.max = max;
  }

  push(entry: string): void {
    const text = entry.trim();
    if (!text) return;
    if (this.items[this.items.length - 1] === text) {
      this.index = this.items.length;
      return;
    }
    this.items.push(text);
    if (this.items.length > this.max) this.items.shift();
    this.index = this.items.length;
  }

  /** Start browsing from just past the latest entry. */
  beginBrowse(): void {
    this.index = this.items.length;
  }

  up(): string | null {
    if (this.items.length === 0) return null;
    this.index = Math.max(0, this.index - 1);
    return this.items[this.index] ?? null;
  }

  down(): string | null {
    if (this.items.length === 0) return null;
    this.index = Math.min(this.items.length, this.index + 1);
    if (this.index >= this.items.length) return '';
    return this.items[this.index] ?? '';
  }

  list(): string[] {
    return [...this.items];
  }

  last(): string | null {
    return this.items[this.items.length - 1] ?? null;
  }
}
