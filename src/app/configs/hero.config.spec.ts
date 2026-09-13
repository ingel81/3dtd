import { describe, expect, it } from 'vitest';
import {
  HERO,
  HERO_AMMO,
  HERO_AMMO_ORDER,
  HERO_LEVELS,
  heroLevelFor,
  heroStatus,
  initialHeroStatus,
} from './hero.config';
import { getResearch } from './research/research-tree.config';
import { PROJECTILE_SOUNDS, PROJECTILE_TYPES } from './projectile-types.config';

describe('hero config', () => {
  it('is unlocked by a global-perk research whose prerequisites exist', () => {
    const research = getResearch(HERO.researchId)!;
    expect(research).toBeDefined();
    expect(research.category).toBe('global-perk');
    expect(research.effects).toContainEqual(expect.objectContaining({ kind: 'global-perk', perkId: HERO.perkId }));
    for (const prerequisite of research.prerequisites) {
      expect(getResearch(prerequisite)).toBeDefined();
    }
  });

  it('fights at 15 to 20 m, chases about 20 m and counts half in the gate', () => {
    expect(HERO.rangeM).toBeGreaterThanOrEqual(15);
    expect(HERO.rangeM).toBeLessThanOrEqual(20);
    expect(HERO.leashM).toBe(20);
    expect(HERO.gatePresence).toBe(0.5);
  });

  it('fires a projectile type with a sound for every ammo', () => {
    for (const id of HERO_AMMO_ORDER) {
      const ammo = HERO_AMMO[id];
      expect(ammo.id).toBe(id);
      expect(PROJECTILE_TYPES[ammo.projectileType]).toBeDefined();
      expect(PROJECTILE_SOUNDS[ammo.projectileType]).toBeDefined();
    }
  });

  it('levels up at rising kill counts with rising damage', () => {
    for (let i = 1; i < HERO_LEVELS.length; i++) {
      expect(HERO_LEVELS[i].level).toBe(HERO_LEVELS[i - 1].level + 1);
      expect(HERO_LEVELS[i].kills).toBeGreaterThan(HERO_LEVELS[i - 1].kills);
      expect(HERO_LEVELS[i].damageMultiplier).toBeGreaterThan(HERO_LEVELS[i - 1].damageMultiplier);
    }
    expect(heroLevelFor(0).level).toBe(1);
    expect(heroLevelFor(29).level).toBe(1);
    expect(heroLevelFor(30).level).toBe(2);
    expect(heroLevelFor(10_000).level).toBe(5);
  });

  it('reports the experience within the level', () => {
    expect(heroStatus(true, true, 130, 'standard', 'hold')).toMatchObject({
      level: 3, kills: 130, xp: 30, xpToNext: 150, maxLevel: 5,
    });
    expect(heroStatus(true, true, 600, 'standard', 'hold')).toMatchObject({ level: 5, xpToNext: null });
    expect(initialHeroStatus()).toMatchObject({ unlocked: false, hired: false, level: 1, kills: 0 });
  });
});
