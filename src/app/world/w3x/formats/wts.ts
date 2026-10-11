/**
 * war3map.wts: the map's string table. Other files refer to entries as
 * `TRIGSTR_007`; the table holds them as
 *
 * ```
 * STRING 7
 * // optional comment
 * {
 * text, possibly over several lines
 * }
 * ```
 */

export type WtsTable = Map<number, string>;

/**
 * Line by line in one pass: `STRING n`, comment lines, `{`, the text up to
 * a line that is `}`. A regular expression over the whole text took
 * quadratic time on a table without closing braces (minutes for 5 MB).
 */
export function parseWts(bytes: Uint8Array): WtsTable {
  let text = new TextDecoder('utf-8').decode(bytes);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines = text.split(/\r\n?|\n/);
  const out: WtsTable = new Map();
  let i = 0;
  while (i < lines.length) {
    const head = /^STRING\s+(\d+)/.exec(lines[i++]);
    if (!head) continue;
    while (i < lines.length && lines[i].startsWith('//')) i++;
    if (lines[i] !== '{') continue;
    const start = ++i;
    while (i < lines.length && !lines[i].startsWith('}')) i++;
    // A string without its closing brace is left out
    if (i < lines.length) out.set(Number(head[1]), lines.slice(start, i).join('\n'));
    i++;
  }
  return out;
}

/** Resolves `TRIGSTR_n` references; other strings pass through */
export function resolveTrigStr(s: string, table: WtsTable | null): string {
  const m = /^TRIGSTR_(-?\d+)$/.exec(s.trim());
  if (!m || !table) return s;
  return table.get(Number(m[1])) ?? s;
}

/** Strips Warcraft colour codes (|cAARRGGBB ... |r) and line breaks (|n) */
export function plainText(s: string): string {
  return s
    .replace(/\|c[0-9a-fA-F]{8}/g, '')
    .replace(/\|r/g, '')
    .replace(/\|n/g, '\n')
    .trim();
}
