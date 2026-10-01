import { describe, expect, it } from 'vitest';
import { Enemy } from '../entities/enemy.entity';
import { ENEMY_TYPES } from '../configs/enemy-types.config';
import { tickBossTraits, type BossTraits } from './boss-traits';

const PATH = [
  { lat: 48, lon: 9 },
  { lat: 48.001, lon: 9 },
];

describe('boss traits', () => {
  it('give Herbert, the golem king and the dragon matriarch a rage', () => {
    expect(ENEMY_TYPES['herbert'].traits?.rage).toBeDefined();
    expect(ENEMY_TYPES['golem-king'].traits?.rage).toBeDefined();
    expect(ENEMY_TYPES['dragon-matriarch'].traits?.rage).toBeDefined();
    expect(new Enemy('zombie', PATH).traits).toBeNull();
  });

  describe('rage', () => {
    const traits: BossTraits = { rage: { belowHp: 0.5, speed: 1.4, damageTaken: 0.7 } };

    it('begins once below its share of the HP: faster, takes less, once', () => {
      const boss = new Enemy('herbert', PATH);
      boss.health.resetMaxHp(1000);
      const speed = boss.movement.speedMps;
      boss.health.takeDamage(400);
      expect(tickBossTraits(boss, traits)).toBeNull();
      expect(boss.enraged).toBe(false);

      boss.health.takeDamage(200);
      expect(tickBossTraits(boss, traits)).toBe('enraged');
      expect(boss.enraged).toBe(true);
      expect(boss.damageTaken).toBe(0.7);
      expect(boss.movement.speedMps).toBeCloseTo(speed * 1.4, 9);

      // Once: neither speed nor the event again
      expect(tickBossTraits(boss, traits)).toBeNull();
      expect(boss.movement.speedMps).toBeCloseTo(speed * 1.4, 9);
    });
  });
});
