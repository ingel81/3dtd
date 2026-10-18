import type { Locale } from './locale';

/**
 * Plurals and numbers for one language, made once per language: the
 * dictionaries call them, the game never builds Intl objects per text.
 */
export interface Formatters {
  /** `one` or `other` by the language's plural rule */
  plural(n: number, one: string, other: string): string;
  /** A count or amount: digit groups as the language writes them ("1,234" / "1.234") */
  int(n: number): string;
  /** A number with exactly `digits` decimals ("2.5" / "2,5") */
  fixed(n: number, digits: number): string;
  /** A number with as many decimals as it has, up to `digits` ("2.8", "3" / "2,8", "3") */
  num(n: number, digits?: number): string;
}

const made = new Map<Locale, Formatters>();

export function formatters(locale: Locale): Formatters {
  let f = made.get(locale);
  if (f) return f;
  const rules = new Intl.PluralRules(locale);
  const ints = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const fixed = new Map<number, Intl.NumberFormat>();
  const upTo = new Map<number, Intl.NumberFormat>();
  f = {
    plural: (n, one, other) => (rules.select(n) === 'one' ? one : other),
    // Below a thousand no language groups digits: the HUD's counts skip Intl
    int: (n) => (Number.isInteger(n) && n > -1000 && n < 1000 ? String(n) : ints.format(n)),
    fixed: (n, digits) => {
      let nf = fixed.get(digits);
      if (!nf) {
        nf = new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
        fixed.set(digits, nf);
      }
      return nf.format(n);
    },
    num: (n, digits = 2) => {
      let nf = upTo.get(digits);
      if (!nf) {
        nf = new Intl.NumberFormat(locale, { maximumFractionDigits: digits });
        upTo.set(digits, nf);
      }
      return nf.format(n);
    },
  };
  made.set(locale, f);
  return f;
}
