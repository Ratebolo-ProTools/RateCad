/**
 * Input classifier — routes keyboard text to CAD vs natural-language AI.
 * Single letters / aliases stay local and deterministic.
 */

import { normalizeCommandInput } from '../cadCommands.js';

export type CadInputClass =
  | { kind: 'empty' }
  | { kind: 'cad-token'; token: string }
  | { kind: 'numeric'; raw: string }
  | { kind: 'natural-language'; text: string }
  | { kind: 'option-candidate'; token: string };

const NL_HINT =
  /\s|make\s|change\s|set\s|create\s|draw\s|add\s|remove\s|calculate\s|show\s|convert\s|how\s|please\s|this\s|that\s|wall\s+to|into\s+/i;

/**
 * Classify idle command-line text (no active command).
 * Natural language is only when the string looks like a sentence / phrase.
 */
export function classifyIdleCommandInput(raw: string): CadInputClass {
  const text = raw.trim();
  if (!text) return { kind: 'empty' };

  // Multi-word or sentence → AI path
  if (/\s/.test(text) || NL_HINT.test(text) || text.length > 24) {
    // Still allow coordinate-like "10,20" and "@5,0"
    if (/^[@#]?-?\d/.test(text) && !/\s{2,}/.test(text) && text.length < 40) {
      return { kind: 'cad-token', token: normalizeCommandInput(text) || text };
    }
    if (NL_HINT.test(text) || (/\s/.test(text) && text.split(/\s+/).length >= 3)) {
      return { kind: 'natural-language', text };
    }
  }

  // Pure / unit-tagged numbers while idle are still CAD tokens (won't resolve → message)
  if (/^-?\d/.test(text) || /^-?\d.*["'mMcCfFiI]/.test(text)) {
    return { kind: 'numeric', raw: text };
  }

  const token = normalizeCommandInput(text);
  if (!token) return { kind: 'empty' };
  return { kind: 'cad-token', token };
}

/**
 * While a command is active, single-letter tokens prefer command options
 * over global command search.
 */
export function classifyActiveCommandInput(
  raw: string,
  hasOptions: boolean,
): CadInputClass {
  const text = raw.trim();
  if (!text) return { kind: 'empty' };
  if (hasOptions && /^[a-zA-Z]{1,8}$/.test(text)) {
    return { kind: 'option-candidate', token: normalizeCommandInput(text) || text };
  }
  if (/^-?\d/.test(text) || /^-?\d.*["'°mMcCfFiI]/.test(text) || text.startsWith('@')) {
    return { kind: 'numeric', raw: text };
  }
  return { kind: 'cad-token', token: normalizeCommandInput(text) || text };
}

/** Levenshtein distance for light typo suggestions (short tokens only). */
export function editDistance(a: string, b: string): number {
  const s = a.toLowerCase();
  const t = b.toLowerCase();
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;
  const row = Array.from({ length: t.length + 1 }, (_, i) => i);
  for (let i = 0; i < s.length; i += 1) {
    let prev = i + 1;
    for (let j = 0; j < t.length; j += 1) {
      const cur =
        s[i] === t[j]
          ? row[j]!
          : 1 + Math.min(row[j]!, row[j + 1]!, prev);
      row[j] = prev;
      prev = cur;
    }
    row[t.length] = prev;
  }
  return row[t.length]!;
}
