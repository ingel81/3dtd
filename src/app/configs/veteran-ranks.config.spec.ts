import { describe, expect, it } from 'vitest';
import { VETERAN_RANKS, veteranLevel, veteranRank } from './veteran-ranks.config';

describe('VETERAN_RANKS', () => {
  it('climbs in level and kills, one level per entry', () => {
    VETERAN_RANKS.forEach((rank, i) => {
      expect(rank.level).toBe(i + 1);
      if (i > 0) expect(rank.minKills).toBeGreaterThan(VETERAN_RANKS[i - 1].minKills);
    });
  });

  it('gives every rank an insignia: one to three chevrons or a star', () => {
    for (const rank of VETERAN_RANKS) {
      expect(rank.star ? rank.chevrons === 0 : rank.chevrons >= 1 && rank.chevrons <= 3).toBe(true);
    }
  });

  it('turns gold only at the top and stays gold from there', () => {
    const firstGold = VETERAN_RANKS.findIndex((rank) => rank.metal === 'gold');
    expect(firstGold).toBeGreaterThan(0);
    expect(VETERAN_RANKS.slice(firstGold).every((rank) => rank.metal === 'gold')).toBe(true);
  });
});

describe('veteranLevel', () => {
  it('is 0 below the first rank', () => {
    expect(veteranLevel(0)).toBe(0);
    expect(veteranLevel(9)).toBe(0);
  });

  it('reaches a rank at its threshold, not one kill earlier', () => {
    for (const rank of VETERAN_RANKS) {
      expect(veteranLevel(rank.minKills - 1)).toBe(rank.level - 1);
      expect(veteranLevel(rank.minKills)).toBe(rank.level);
    }
  });

  it('stays at the top rank past its threshold', () => {
    expect(veteranLevel(1_000_000)).toBe(VETERAN_RANKS.length);
  });
});

describe('veteranRank', () => {
  it('returns the rank of a level and null for no rank', () => {
    expect(veteranRank(0)).toBeNull();
    expect(veteranRank(2)?.name).toBe('Veteran');
    expect(veteranRank(VETERAN_RANKS.length + 1)).toBeNull();
  });
});
