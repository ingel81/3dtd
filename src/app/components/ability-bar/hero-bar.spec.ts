import { describe, it, expect } from 'vitest';
import { heroBarView } from './hero-bar';
import { HERO, heroStatus, initialHeroStatus } from '../../configs/hero.config';

const UNLOCKED = { ...initialHeroStatus(), unlocked: true };

describe('heroBarView', () => {
  it('leaves the bar without a hero button until the research is done', () => {
    expect(heroBarView(initialHeroStatus(), false, 99_999)).toBeNull();
  });

  it('offers the hire with the price once the research is done, without a key', () => {
    const view = heroBarView(UNLOCKED, false, HERO.cost);
    expect(view).toMatchObject({ action: 'hire', icon: 'coin', name: 'Hire Mercenary', hotkey: null, selected: false });
    expect(view!.detail).toContain('1,000 credits, once.');
  });

  it('says how many credits are missing', () => {
    expect(heroBarView(UNLOCKED, false, 400)!.detail).toBe('1,000 credits, 600 short.');
  });

  it('shows the hero with G, his level and his ammo after the hire', () => {
    const hired = heroStatus(true, true, 30, 'explosive', 'hold');
    expect(heroBarView(hired, true, 0)).toMatchObject({
      action: 'summon',
      icon: 'user',
      name: 'Mercenary',
      hotkey: 'G',
      selected: true,
    });
    expect(heroBarView(hired, false, 0)!.detail).toMatch(/^Level 2, explosive rounds\. /);
  });
});
