import { describe, it, expect } from 'vitest';
import { MUZZLE_FLASH_PROFILES } from './visual-effects.config';
import { TOWER_TYPES, TowerTypeId } from './tower-types.config';

describe('MUZZLE_FLASH_PROFILES', () => {
  const entries = Object.entries(MUZZLE_FLASH_PROFILES) as [TowerTypeId, NonNullable<(typeof MUZZLE_FLASH_PROFILES)[TowerTypeId]>][];

  it('flashes only on Archer, Gatling, Cannon and Rocket', () => {
    expect(entries.map(([id]) => id).sort()).toEqual(['archer', 'cannon', 'dual-gatling', 'rocket']);
  });

  it('only lists towers that fire projectiles', () => {
    entries.forEach(([id]) => {
      expect(TOWER_TYPES[id].attackType ?? 'projectile').toBe('projectile');
    });
  });

  it('has valid ranges', () => {
    entries.forEach(([, p]) => {
      expect(p.countMin).toBeGreaterThanOrEqual(1);
      expect(p.countMin).toBeLessThanOrEqual(p.countMax);
      expect(p.sizeMin).toBeGreaterThan(0);
      expect(p.sizeMin).toBeLessThanOrEqual(p.sizeMax);
      expect(p.lifeMin).toBeGreaterThan(0);
      expect(p.lifeMin).toBeLessThanOrEqual(p.lifeMax);
      expect(p.lightIntensity).toBeGreaterThanOrEqual(0);
    });
  });

  it('sizes the flash to the gun instead of one flash for every tower', () => {
    const { archer, cannon, rocket } = MUZZLE_FLASH_PROFILES;
    const gatling = MUZZLE_FLASH_PROFILES['dual-gatling'];
    expect(cannon!.sizeMax).toBeGreaterThan(rocket!.sizeMax);
    expect(rocket!.sizeMax).toBeGreaterThan(gatling!.sizeMax);
    expect(gatling!.sizeMax).toBeGreaterThan(archer!.sizeMax);
    expect(archer!.lightIntensity).toBe(0); // a bow does not light up its surroundings
  });
});
