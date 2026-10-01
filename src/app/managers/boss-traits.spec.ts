import { describe, expect, it } from 'vitest';
import { Enemy } from '../entities/enemy.entity';
import { ENEMY_TYPES } from '../configs/enemy-types.config';
import { tickBossTraits, type BossTraits } from './boss-traits';

const PATH = [
  { lat: 48, lon: 9 },
  { lat: 48.001, lon: 9 },
];

describe('boss traits', () => {
  it('give Herbert, the golem king and the dragon matriarch a rage, the Ooze its regeneration', () => {
    expect(ENEMY_TYPES['herbert'].traits?.rage).toBeDefined();
    expect(ENEMY_TYPES['golem-king'].traits?.rage).toBeDefined();
    expect(ENEMY_TYPES['dragon-matriarch'].traits?.rage).toBeDefined();
    expect(ENEMY_TYPES['ooze'].traits?.regen).toBeDefined();
    expect(new Enemy('zombie', PATH).traits).toBeNull();
  });

  describe('rage', () => {
    const traits: BossTraits = { rage: { belowHp: 0.5, speed: 1.4, damageTaken: 0.7 } };

    it('begins once below its share of the HP: faster, takes less, once', () => {
      const boss = new Enemy('herbert', PATH);
      boss.health.resetMaxHp(1000);
      const speed = boss.movement.speedMps;
      boss.health.takeDamage(400);
      expect(tickBossTraits(boss, traits, 16, false)).toBeNull();
      expect(boss.enraged).toBe(false);

      boss.health.takeDamage(200);
      expect(tickBossTraits(boss, traits, 16, false)).toBe('enraged');
      expect(boss.enraged).toBe(true);
      expect(boss.damageTaken).toBe(0.7);
      expect(boss.movement.speedMps).toBeCloseTo(speed * 1.4, 9);

      // Once: neither speed nor the event again
      expect(tickBossTraits(boss, traits, 16, false)).toBeNull();
      expect(boss.movement.speedMps).toBeCloseTo(speed * 1.4, 9);
    });
  });

  describe('regeneration', () => {
    const traits: BossTraits = { regen: { perSecond: 0.1, quietMs: 1000 } };

    function hurt(): Enemy {
      const boss = new Enemy('ooze', PATH);
      boss.health.resetMaxHp(1000);
      boss.health.takeDamage(500);
      tickBossTraits(boss, traits, 0, false);
      return boss;
    }

    it('heals its share a second after the quiet time without losing HP', () => {
      const boss = hurt();
      for (let t = 0; t < 900; t += 100) tickBossTraits(boss, traits, 100, false);
      expect(boss.health.hp).toBe(500);
      // From the sub-step that completes the quiet second: 10 % of 1000 a second
      for (let t = 0; t < 1000; t += 100) tickBossTraits(boss, traits, 100, false);
      expect(boss.health.hp).toBeCloseTo(600, 6);
    });

    it('starts the quiet time again with every hit', () => {
      const boss = hurt();
      for (let t = 0; t < 900; t += 100) tickBossTraits(boss, traits, 100, false);
      boss.health.takeDamage(1);
      for (let t = 0; t < 900; t += 100) tickBossTraits(boss, traits, 100, false);
      expect(boss.health.hp).toBe(499);
    });

    it('waits while it is frozen or stunned, and never heals past its max', () => {
      const boss = hurt();
      for (let t = 0; t < 5000; t += 100) tickBossTraits(boss, traits, 100, true);
      expect(boss.health.hp).toBe(500);
      for (let t = 0; t < 20000; t += 100) tickBossTraits(boss, traits, 100, false);
      expect(boss.health.hp).toBe(1000);
    });
  });
});
