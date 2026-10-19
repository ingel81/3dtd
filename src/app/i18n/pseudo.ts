import type { Messages } from './messages/en';

/**
 * The pseudo language `xx` for developers (docs/I18N_PLAN.md, 7.3): every
 * English text accented, bracketed and about 40 % longer, "[Ŝéttîñĝš ~~~~]".
 * A text that still reads plain is not in the dictionary; a layout that
 * breaks with it breaks in German too. Built from English when chosen, in a
 * chunk of its own, never in a player's language list.
 */
const ACCENTS: Readonly<Record<string, string>> = {
  a: 'á', e: 'é', i: 'î', o: 'ö', u: 'ü', c: 'ç', n: 'ñ', s: 'š', y: 'ý', g: 'ĝ',
  A: 'Á', E: 'É', I: 'Î', O: 'Ö', U: 'Ü', C: 'Ç', N: 'Ñ', S: 'Ŝ', Y: 'Ý', G: 'Ĝ',
};

/** One text in the pseudo language; placeholders like `{n}` stay readable */
export function pseudoText(text: string): string {
  if (!text) return text;
  const accented = text.replace(/[A-Za-z]/g, (c) => ACCENTS[c] ?? c);
  return `[${accented} ${'~'.repeat(Math.max(1, Math.ceil(text.length * 0.4)))}]`;
}

function pseudoValue(value: unknown): unknown {
  if (typeof value === 'string') return pseudoText(value);
  if (typeof value === 'function') return (...args: unknown[]) => pseudoValue((value as (...a: unknown[]) => unknown)(...args));
  if (Array.isArray(value)) return value.map(pseudoValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, pseudoValue(v)]));
  return value;
}

/** The whole dictionary in the pseudo language, of the same shape as English */
export function pseudo(source: Messages): Messages {
  return pseudoValue(source) as Messages;
}
