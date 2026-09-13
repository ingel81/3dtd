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
