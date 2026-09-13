import { describe, expect, it } from 'vitest';
import { bestArmorsFor, heroPanelView } from './hero-panel';
import { HERO, heroStatus } from '../../../configs/hero.config';

describe('heroPanelView', () => {
  it('shows level, kills and the way to the next level', () => {
    const view = heroPanelView(heroStatus(true, true, 45, 'standard', 'hold'));
    expect(view).toMatchObject({
      name: HERO.name,
      level: 2,
      maxLevel: 5,
      kills: 45,
      xpLabel: '15 / 70 kills',
      rangeM: HERO.rangeM,
      status: 'Holding his post',
    });
    expect(view.xpPercent).toBeCloseTo((15 / 70) * 100);
  });

  it('fills the bar at the top level', () => {
    const view = heroPanelView(heroStatus(true, true, 900, 'rune', 'travel'));
    expect(view).toMatchObject({ level: 5, xpLabel: 'Top level', xpPercent: 100, status: 'On his way' });
  });

  it('counts his level into the damage per second of the loaded ammo', () => {
    expect(heroPanelView(heroStatus(true, true, 0, 'standard', 'hold')).dps).toBe(48);
    expect(heroPanelView(heroStatus(true, true, 30, 'explosive', 'hold')).dps).toBe(Math.round(48 * 1.15));
  });

  it('offers the three ammo types, the loaded one active, with what each is best against', () => {
    const { ammo } = heroPanelView(heroStatus(true, true, 0, 'explosive', 'hold'));
    expect(ammo.map((a) => [a.label, a.damageLabel, a.active])).toEqual([
      ['Standard', 'Physical', false],
      ['Explosive', 'Siege', true],
      ['Rune', 'Magic', false],
    ]);
    expect(ammo[1].tooltip).toBe('Explosive rounds: Siege damage, his best against Heavy, Fortified');
  });

  it('reads what each ammo is best against off the damage matrix', () => {
    expect(bestArmorsFor('standard')).toEqual(['unarmored', 'light']);
    expect(bestArmorsFor('explosive')).toEqual(['heavy', 'fortified']);
    expect(bestArmorsFor('rune')).toEqual(['ethereal']);
  });
});
