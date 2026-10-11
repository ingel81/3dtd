/**
 * The command palette's list (Ctrl+K): everything the editor can do by
 * name, found by typing a few letters of it. Ranking prefers matches at
 * word starts and close together, then the shorter label.
 */
export interface EditorCommand {
  id: string;
  label: string;
  /** Shown beside the label: Tools, View, Map … */
  group: string;
  /** The key that does the same, if any */
  keys?: string;
  run(): void;
}

/**
 * How well `query` matches `text` as a subsequence, higher is better; null
 * when it does not match. Letters at word starts and runs of letters count
 * more, gaps cost a little.
 */
export function matchScore(query: string, text: string): number | null {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = text.toLowerCase();
  let score = 0;
  let at = 0;
  let last = -2;
  for (const ch of q) {
    if (ch === ' ') continue;
    const i = t.indexOf(ch, at);
    if (i < 0) return null;
    const wordStart = i === 0 || /[\s:/(-]/.test(t[i - 1]);
    score += wordStart ? 8 : 1;
    if (i === last + 1) score += 5;
    score -= Math.min(4, i - at) * 0.5;
    last = i;
    at = i + 1;
  }
  return score;
}

/** Every word of the query must match on its own, in any order ("sel bush" finds "Bush (12) Select") */
function wordsScore(query: string, text: string): number | null {
  let total = 0;
  for (const word of query.trim().split(/\s+/)) {
    const s = matchScore(word, text);
    if (s === null) return null;
    total += s;
  }
  return total;
}

/** The commands matching `query`, best first; all of them in their order for an empty query */
export function rankCommands(query: string, commands: readonly EditorCommand[], limit = 60): EditorCommand[] {
  if (!query.trim()) return commands.slice(0, limit);
  const scored: { c: EditorCommand; s: number }[] = [];
  for (const c of commands) {
    const s = wordsScore(query, `${c.label} ${c.group}`);
    if (s !== null) scored.push({ c, s: s - c.label.length * 0.05 });
  }
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, limit).map((x) => x.c);
}
