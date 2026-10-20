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
  /** A moment as date and time, short ("Oct 19, 2026, 2:41 PM" / "19.10.2026, 14:41") */
  dateTime(at: string | number | Date): string;
  /** A time of day, hours and minutes ("2:41 PM" / "14:41") */
  time(at: string | number | Date): string;
  /** A time of day without a leading zero ("9:05 AM" / "9:05") */
  clock(at: string | number | Date): string;
  /** A date in the dictionary's own fields ("Oct 18" / "18.10."); one Intl format per set of fields */
  date(at: string | number | Date, fields: Intl.DateTimeFormatOptions): string;
}

/** How many calendar days `at` lies before `now` in local time (0 today, 1 yesterday; a moment ahead counts as today) and whether in the same year */
export function calendarAge(at: string | number | Date, now: Date = new Date()): { days: number; sameYear: boolean } {
  const then = new Date(at);
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000;
  return { days: Math.max(0, day(now) - day(then)), sameYear: then.getFullYear() === now.getFullYear() };
}

/** Where a text's bold part begins and ends: private-use characters no name or word carries */
const BOLD_OPEN = '';
const BOLD_CLOSE = '';

/** Marks `text` as the bold part of a line: `Waiting for ${bold(name)} to ready up` */
export function bold(text: string): string {
  return BOLD_OPEN + String(text).replaceAll(BOLD_OPEN, '').replaceAll(BOLD_CLOSE, '') + BOLD_CLOSE;
}

/** A line with a bold part taken apart for a template: before it, the bold part, after it */
export function splitBold(line: string): { lead: string; bold: string; text: string } {
  const open = line.indexOf(BOLD_OPEN);
  const close = line.indexOf(BOLD_CLOSE, open + 1);
  if (open < 0 || close < 0) return { lead: '', bold: '', text: line };
  return { lead: line.slice(0, open), bold: line.slice(open + 1, close), text: line.slice(close + 1) };
}

const made = new Map<Locale, Formatters>();

export function formatters(locale: Locale): Formatters {
  let f = made.get(locale);
  if (f) return f;
  const rules = new Intl.PluralRules(locale);
  const ints = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const fixed = new Map<number, Intl.NumberFormat>();
  const upTo = new Map<number, Intl.NumberFormat>();
  let moments: Intl.DateTimeFormat | null = null;
  let times: Intl.DateTimeFormat | null = null;
  let clocks: Intl.DateTimeFormat | null = null;
  const dates = new Map<string, Intl.DateTimeFormat>();
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
    time: (at) => (times ??= new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' })).format(new Date(at)),
    clock: (at) => (clocks ??= new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' })).format(new Date(at)),
    date: (at, fields) => {
      const key = JSON.stringify(fields);
      let df = dates.get(key);
      if (!df) {
        df = new Intl.DateTimeFormat(locale, fields);
        dates.set(key, df);
      }
      return df.format(new Date(at));
    },
    dateTime: (at) => (moments ??= new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' })).format(new Date(at)),
  };
  made.set(locale, f);
  return f;
}
