/**
 * Boss bar at the top centre: which boss the big bar shows, and the small
 * bars for the others. Pure, the component feeds in samples of the living
 * bosses.
 */

/** Thin bars for further bosses, beyond the one on the big bar */
export const MAX_SMALL_BARS = 4;

export interface BossSample {
  name: string;
  hp: number;
  maxHp: number;
}

export interface BossBarView {
  name: string;
  /** Fill of the big bar, 0-100, one decimal */
  percent: number;
  /** "12,340 / 40,000" */
  hpText: string;
  /** Fills of the other bosses, most HP left first */
  others: number[];
  /** Bosses beyond the small bars */
  more: number;
}

/**
 * A worm's sample: the HP left over all its parts, the segments still in the
 * portal at full HP, against the whole worm's. Split into several worms it
 * says how many ("Chitin Worm ×3").
 */
export function wormBossSample(name: string, parts: number, hp: number, maxHp: number): BossSample {
  return { name: parts > 1 ? `${name} ×${parts}` : name, hp, maxHp };
}

function percentOf(boss: BossSample): number {
  if (boss.maxHp <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((boss.hp / boss.maxHp) * 1000) / 10));
}

function hpNumber(hp: number): string {
  return Math.ceil(Math.max(0, hp)).toLocaleString('en-US');
}

/**
 * The big bar shows the boss with the most HP left, the one that will take
 * longest; the rest follow as small bars. Null without a living boss.
 */
export function bossBarView(bosses: readonly BossSample[]): BossBarView | null {
  if (bosses.length === 0) return null;
  const [main, ...rest] = [...bosses].sort((a, b) => b.hp - a.hp);
  return {
    name: main.name,
    percent: percentOf(main),
    hpText: `${hpNumber(main.hp)} / ${hpNumber(main.maxHp)}`,
    others: rest.slice(0, MAX_SMALL_BARS).map(percentOf),
    more: Math.max(0, rest.length - MAX_SMALL_BARS),
  };
}

/** Same bar, so the view need not change. */
export function sameBossBar(a: BossBarView | null, b: BossBarView | null): boolean {
  if (a === null || b === null) return a === b;
  return a.name === b.name
    && a.percent === b.percent
    && a.hpText === b.hpText
    && a.more === b.more
    && a.others.length === b.others.length
    && a.others.every((p, i) => p === b.others[i]);
}
