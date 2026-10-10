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

export function parseWts(bytes: Uint8Array): WtsTable {
  let text = new TextDecoder('utf-8').decode(bytes).replace(/\r\n?/g, '\n');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const out: WtsTable = new Map();
  const re = /^STRING\s+(\d+)[^\n]*\n(?:\/\/[^\n]*\n)*\{\n([\s\S]*?)\n?^\}/gm;
  for (let m = re.exec(text); m; m = re.exec(text)) out.set(Number(m[1]), m[2]);
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
