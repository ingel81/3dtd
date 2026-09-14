import { describe, it, expect } from 'vitest';
import { bossBarView, MAX_SMALL_BARS, sameBossBar, wormBossSample } from './boss-bar';

describe('wormBossSample', () => {
  it('is one bar for the whole worm, saying how many parts it is in', () => {
    expect(wormBossSample('Skarnax', 1, 6000, 8000)).toEqual({ name: 'Skarnax', hp: 6000, maxHp: 8000 });
    expect(wormBossSample('Skarnax', 3, 4500, 8000).name).toBe('Skarnax ×3');
    expect(bossBarView([wormBossSample('Skarnax', 2, 2000, 8000)])).toMatchObject({
      name: 'Skarnax ×2',
      percent: 25,
      hpText: '2,000 / 8,000',
    });
  });
});

describe('bossBarView', () => {
  it('shows nothing without a boss', () => {
    expect(bossBarView([])).toBeNull();
  });

  it('puts a single boss on the big bar', () => {
    expect(bossBarView([{ name: 'Herbert', hp: 1250, maxHp: 4000 }])).toEqual({
      name: 'Herbert',
      percent: 31.3,
      hpText: '1,250 / 4,000',
      others: [],
      more: 0,
    });
  });

  it('shows the boss with most HP left big and the others small, strongest first', () => {
    const view = bossBarView([
      { name: 'Herbert', hp: 100, maxHp: 1000 },
      { name: 'Herbert', hp: 900, maxHp: 1000 },
      { name: 'Herbert', hp: 500, maxHp: 1000 },
    ]);
    expect(view).toMatchObject({ percent: 90, others: [50, 10], more: 0 });
  });

  it('counts the bosses beyond the small bars', () => {
    const bosses = Array.from({ length: MAX_SMALL_BARS + 3 }, () => ({ name: 'Herbert', hp: 10, maxHp: 10 }));
    const view = bossBarView(bosses)!;
    expect(view.others).toHaveLength(MAX_SMALL_BARS);
    expect(view.more).toBe(2);
  });

  it('keeps the fill between 0 and 100 and rounds the HP up', () => {
    expect(bossBarView([{ name: 'X', hp: -5, maxHp: 100 }])).toMatchObject({ percent: 0, hpText: '0 / 100' });
    expect(bossBarView([{ name: 'X', hp: 150, maxHp: 100 }])!.percent).toBe(100);
    expect(bossBarView([{ name: 'X', hp: 0.2, maxHp: 0 }])).toMatchObject({ percent: 0, hpText: '1 / 0' });
  });
});

describe('sameBossBar', () => {
  const view = bossBarView([{ name: 'Herbert', hp: 500, maxHp: 1000 }, { name: 'Herbert', hp: 200, maxHp: 1000 }]);

  it('compares what the bar shows', () => {
    expect(sameBossBar(view, bossBarView([{ name: 'Herbert', hp: 500, maxHp: 1000 }, { name: 'Herbert', hp: 200, maxHp: 1000 }]))).toBe(true);
    expect(sameBossBar(view, bossBarView([{ name: 'Herbert', hp: 499, maxHp: 1000 }, { name: 'Herbert', hp: 200, maxHp: 1000 }]))).toBe(false);
    expect(sameBossBar(view, null)).toBe(false);
    expect(sameBossBar(null, null)).toBe(true);
  });
});
