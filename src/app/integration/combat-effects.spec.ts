/**
 * Integration Test: Status Effects + EnemyManager
 *
 * Tests combat effects applied to enemies:
 *   Apply slow effect → enemy speed reduced → effect expires → speed restored
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Three.js
vi.mock('three', () => ({
  Vector3: class {
    x = 0; y = 0; z = 0;
    constructor(x?: number, y?: number, z?: number) {
      this.x = x ?? 0; this.y = y ?? 0; this.z = z ?? 0;
    }
  },
  InstancedMesh: class {},
  Mesh: class {},
  MeshBasicMaterial: class {},
  SphereGeometry: class {},
  Scene: class {},
  Object3D: class {},
}));

import {
  createTestManagers,
  TestManagers,
  TEST_PATH,
} from './test-helpers';
import { StatusEffect } from '../models/status-effects';
import { GAME_BALANCE } from '../configs/game-balance.config';

describe('Combat Effects Integration', () => {
  let m: TestManagers;
  let nowValue: number;

  beforeEach(() => {
    nowValue = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => nowValue);
    m = createTestManagers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Helpers ──────────────────────────────────────────────────────

  function advanceTime(ms: number) {
    nowValue += ms;
  }

  // ── Tests ────────────────────────────────────────────────────────

  it('should reduce enemy speed when slow effect is applied', () => {
    const enemy = m.enemyManager.spawn(TEST_PATH, 'zombie', 10, true);
    const baseSpeed = enemy.movement.effectiveSpeed;

    // Apply slow (50% speed reduction)
    const slow: StatusEffect = {
      type: 'slow',
      value: 0.5,
      duration: 3000,
      startTime: performance.now(),
      sourceId: 'tower-1',
    };
    enemy.movement.applyStatusEffect(slow);

    const slowedSpeed = enemy.movement.effectiveSpeed;
    expect(slowedSpeed).toBe(baseSpeed * 0.5);
    expect(slowedSpeed).toBeLessThan(baseSpeed);
  });

  it('should restore speed when slow effect expires', () => {
    const enemy = m.enemyManager.spawn(TEST_PATH, 'zombie', 10, true);
    const baseSpeed = enemy.movement.effectiveSpeed;

    const slow: StatusEffect = {
      type: 'slow',
      value: 0.5,
      duration: 1000,
      startTime: performance.now(),
      sourceId: 'tower-1',
    };
    enemy.movement.applyStatusEffect(slow);

    // Speed is reduced
    expect(enemy.movement.effectiveSpeed).toBe(baseSpeed * 0.5);

    // Advance time past duration
    advanceTime(1100);
    enemy.movement.removeExpiredEffects(1.0);

    // Speed should be restored
    expect(enemy.movement.effectiveSpeed).toBe(baseSpeed);
  });

  it('should use ice tower slow values from GAME_BALANCE', () => {
    const enemy = m.enemyManager.spawn(TEST_PATH, 'zombie', 10, true);
    const baseSpeed = enemy.movement.effectiveSpeed;

    const { slowAmount, duration } = GAME_BALANCE.effects.ice;
    const slow: StatusEffect = {
      type: 'slow',
      value: slowAmount,
      duration,
      startTime: performance.now(),
      sourceId: 'ice-tower-1',
    };
    enemy.movement.applyStatusEffect(slow);

    const expectedSpeed = baseSpeed * (1 - slowAmount);
    expect(enemy.movement.effectiveSpeed).toBe(expectedSpeed);

    // After duration, speed restores
    advanceTime(duration + 100);
    enemy.movement.removeExpiredEffects(1.0);
    expect(enemy.movement.effectiveSpeed).toBe(baseSpeed);
  });

  it('should not stack slow effects — new slow replaces old', () => {
    const enemy = m.enemyManager.spawn(TEST_PATH, 'zombie', 10, true);
    const baseSpeed = enemy.movement.effectiveSpeed;

    // Apply first slow
    enemy.movement.applyStatusEffect({
      type: 'slow',
      value: 0.3,
      duration: 2000,
      startTime: performance.now(),
      sourceId: 'tower-1',
    });
    expect(enemy.movement.effectiveSpeed).toBeCloseTo(baseSpeed * 0.7, 5);

    // Apply second slow (should replace, not stack)
    enemy.movement.applyStatusEffect({
      type: 'slow',
      value: 0.5,
      duration: 3000,
      startTime: performance.now(),
      sourceId: 'tower-2',
    });

    // Should use the new slow (0.5), not both (0.3 + 0.5)
    expect(enemy.movement.effectiveSpeed).toBeCloseTo(baseSpeed * 0.5, 5);

    // Should only have 1 slow effect
    const slowEffects = enemy.movement.statusEffects.filter(e => e.type === 'slow');
    expect(slowEffects).toHaveLength(1);
  });

  it('should move enemy slower while slowed', () => {
    const enemy = m.enemyManager.spawn(TEST_PATH, 'zombie', 50, false);

    // Move without slow and record distance
    const startLat1 = enemy.position.lat;
    m.enemyManager.update(500, 1.0);
    const normalDistance = enemy.position.lat - startLat1;

    // Reset — spawn new enemy with slow
    const slowEnemy = m.enemyManager.spawn(TEST_PATH, 'zombie', 50, false);
    slowEnemy.movement.applyStatusEffect({
      type: 'slow',
      value: 0.5,
      duration: 10000,
      startTime: performance.now(),
      sourceId: 'test',
    });

    const startLat2 = slowEnemy.position.lat;
    m.enemyManager.update(500, 1.0);
    const slowDistance = slowEnemy.position.lat - startLat2;

    // Slowed enemy should cover roughly half the distance
    // (tolerance for rounding and discrete segment transitions)
    expect(slowDistance).toBeGreaterThan(0);
    expect(slowDistance).toBeLessThan(normalDistance);
  });

  it('should respect timescale when checking effect expiry', () => {
    const enemy = m.enemyManager.spawn(TEST_PATH, 'zombie', 10, true);
    const baseSpeed = enemy.movement.effectiveSpeed;

    enemy.movement.applyStatusEffect({
      type: 'slow',
      value: 0.5,
      duration: 2000, // 2s game-time
      startTime: performance.now(),
      sourceId: 'tower-1',
    });

    // At 2x timescale, effective duration = 2000/2 = 1000ms real-time
    advanceTime(1100); // Past 1000ms but before 2000ms
    enemy.movement.removeExpiredEffects(2.0);

    // Effect should have expired at 2x speed
    expect(enemy.movement.effectiveSpeed).toBe(baseSpeed);
  });

  it('should keep effect active when not enough time passed', () => {
    const enemy = m.enemyManager.spawn(TEST_PATH, 'zombie', 10, true);
    const baseSpeed = enemy.movement.effectiveSpeed;

    enemy.movement.applyStatusEffect({
      type: 'slow',
      value: 0.5,
      duration: 3000,
      startTime: performance.now(),
      sourceId: 'tower-1',
    });

    // Advance only 1 second — effect has 3s duration
    advanceTime(1000);
    enemy.movement.removeExpiredEffects(1.0);

    // Still slowed
    expect(enemy.movement.effectiveSpeed).toBe(baseSpeed * 0.5);
  });

  it('should handle health damage + slow together correctly', () => {
    const enemy = m.enemyManager.spawn(TEST_PATH, 'zombie', 10, true);
    const baseSpeed = enemy.movement.effectiveSpeed;

    // Apply slow
    enemy.movement.applyStatusEffect({
      type: 'slow',
      value: 0.5,
      duration: 5000,
      startTime: performance.now(),
      sourceId: 'ice-tower',
    });

    // Take damage
    enemy.health.takeDamage(20);

    // Enemy should be alive and slowed
    expect(enemy.alive).toBe(true);
    expect(enemy.movement.effectiveSpeed).toBe(baseSpeed * 0.5);
    expect(enemy.health.hp).toBe(enemy.health.maxHp - 20);
  });
});
