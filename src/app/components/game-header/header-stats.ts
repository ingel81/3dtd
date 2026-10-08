/**
 * Figures of the header stat bar. The bar has a fixed width and three equal
 * cells, so every figure has to fit its cell at any size, cheats included.
 * Pure, the component feeds in the store values.
 */
import { formatCompact } from '../../utils/format-compact';

// Below its threshold a figure stays exact; from there on it reads short ("101k", "1.2M")
/** Buying depends on the exact credits, and six digits fit the cell */
export const CREDITS_EXACT_BELOW = 1_000_000;
/** Wave number and enemies alive */
export const COUNT_EXACT_BELOW = 100_000;
/** HQ health past 9999 only comes from the +HP cheat */
export const HQ_EXACT_BELOW = 10_000;

export interface StatReadout {
  /** What the cell shows: exact below the cell's threshold, compact above ("101k", "1.2M") */
  text: string;
  /** The exact figure for screen readers: "101,100" */
  exact: string;
  /** The exact figure when the cell shows less than that, else '' (no tooltip) */
  tooltip: string;
}

export interface HqReadout extends StatReadout {
  /** The max next to the value ("100"); null once health is past it, which only the +HP cheat does */
  max: string | null;
  /** Fill of the HQ bar, 0-100; full once health is past the max */
  percent: number;
}

function whole(n: number): number {
  return Math.max(0, Math.floor(n));
}

function exactNumber(n: number): string {
  return whole(n).toLocaleString('en-US');
}

function shortNumber(n: number, exactBelow: number): string {
  const v = whole(n);
  return v < exactBelow ? String(v) : formatCompact(v);
}

export function statReadout(n: number, exactBelow: number): StatReadout {
  const exact = exactNumber(n);
  return {
    text: shortNumber(n, exactBelow),
    exact,
    tooltip: whole(n) < exactBelow ? '' : exact,
  };
}

/**
 * HQ cell: "72/100" in play. Past the max (the +HP cheat) only the value
 * and a full bar, since "101100/100" says nothing the bar does not and does
 * not fit the cell; the tooltip keeps the max.
 */
export function hqReadout(health: number, maxHealth: number): HqReadout {
  const overMax = health > maxHealth;
  const exact = `${exactNumber(health)} / ${exactNumber(maxHealth)}`;
  return {
    text: shortNumber(health, HQ_EXACT_BELOW),
    exact,
    tooltip: overMax || whole(health) >= HQ_EXACT_BELOW ? exact : '',
    max: overMax ? null : shortNumber(maxHealth, HQ_EXACT_BELOW),
    percent: maxHealth > 0 ? Math.max(0, Math.min(100, (health / maxHealth) * 100)) : 0,
  };
}

/** How the HQ plate looks: full colour, warm from LOW_BELOW, the hazard stripe from CRITICAL_BELOW */
export type HqLevel = 'ok' | 'low' | 'critical';
/** HQ share in percent below which the plate turns warm and pulses */
export const HQ_LOW_BELOW = 30;
/** HQ share in percent below which the hazard stripe shows */
export const HQ_CRITICAL_BELOW = 10;
/** Segments of the HQ bar, one per tenth of the start health */
export const HQ_SEGMENTS = 10;

export function hqLevel(percent: number): HqLevel {
  if (percent < HQ_CRITICAL_BELOW) return 'critical';
  if (percent < HQ_LOW_BELOW) return 'low';
  return 'ok';
}

/** Lit segments: a started tenth lights its segment, so the last one goes out only at 0 */
export function hqSegmentsLit(percent: number): number {
  return Math.max(0, Math.min(HQ_SEGMENTS, Math.ceil(percent / (100 / HQ_SEGMENTS))));
}

/**
 * Fill of the wave bar, 0-100: the share of the running wave's enemies
 * that are gone (killed or through to the HQ). 0 between waves and for a
 * wave of unknown size (manual debug waves).
 */
export function waveProgressPercent(running: boolean, total: number, left: number): number {
  if (!running || total <= 0) return 0;
  return Math.max(0, Math.min(100, ((total - left) / total) * 100));
}

/** Credit changes this close to the last one add up into one "+75" */
export const CREDITS_DELTA_SUM_MS = 250;
/** How long a "+25" stays and rises */
export const CREDITS_DELTA_SHOW_MS = 900;

export interface CreditsDelta {
  /** Same id while changes add up, so the rising text is not restarted */
  id: number;
  amount: number;
  /** "+25", "−150" (a real minus) */
  text: string;
  kind: 'gain' | 'loss';
}

function creditsDelta(id: number, amount: number): CreditsDelta {
  const size = Math.abs(Math.round(amount)).toLocaleString('en-US');
  return amount > 0
    ? { id, amount, text: `+${size}`, kind: 'gain' }
    : { id, amount, text: `\u2212${size}`, kind: 'loss' };
}

/**
 * The "+25" over the credits plate. Every change of the credits goes in;
 * changes within CREDITS_DELTA_SUM_MS of the last one add up (a burst of
 * bounties reads as one sum), a later one starts a new text. A sum that
 * comes back to 0 shows nothing. The header clears the text
 * CREDITS_DELTA_SHOW_MS after the last change. Wall clock, it is what the
 * player sees.
 */
export class CreditsDeltaTracker {
  private current: CreditsDelta | null = null;
  private lastAt = Number.NEGATIVE_INFINITY;
  private nextId = 1;

  /** The text to show after a change of `diff` at `nowMs`, null for none */
  change(diff: number, nowMs: number): CreditsDelta | null {
    if (diff === 0) return this.current;
    const adds = this.current !== null && nowMs - this.lastAt <= CREDITS_DELTA_SUM_MS;
    const amount = adds ? this.current!.amount + diff : diff;
    this.lastAt = nowMs;
    this.current = amount === 0 ? null : creditsDelta(adds ? this.current!.id : this.nextId++, amount);
    return this.current;
  }

  /** Forget the running sum: the credits were set without play */
  reset(): void {
    this.current = null;
    this.lastAt = Number.NEGATIVE_INFINITY;
  }
}

/** The credits figure counts to a new value over this long */
export const CREDITS_COUNT_MS = 250;

/**
 * The figure the credits plate shows `elapsedMs` into counting from `from`
 * to `to`: whole numbers on an ease-out curve, `to` once the time is up.
 */
export function countedValue(from: number, to: number, elapsedMs: number, durationMs = CREDITS_COUNT_MS): number {
  if (elapsedMs >= durationMs || durationMs <= 0) return to;
  const t = Math.max(0, elapsedMs) / durationMs;
  const eased = 1 - (1 - t) * (1 - t);
  return Math.round(from + (to - from) * eased);
}
