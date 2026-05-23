/**
 * Integration Test: EnemyManager + Movement along path
 *
 * Tests that enemies move along a path and emit events when reaching the base.
 *   Start wave → enemies spawn → walk path → reach HQ → emit enemy:reached-base
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Three.js
vi.mock('three', async () => {
  const mod = await import('@/test/mocks/three.mock');
  return { ...mod };
});

import {
  createTestManagers,
  TestManagers,
  TEST_PATH,
} from './test-helpers';
import { GAME_BALANCE } from '../configs/game-balance.config';

describe('Enemy Movement Path Integration', () => {
  let m: TestManagers;

  beforeEach(() => {
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    m = createTestManagers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should spawn enemy at path start position', () => {
    const enemy = m.enemyManager.spawn(TEST_PATH, 'zombie', 5, false);

    expect(enemy.position.lat).toBe(TEST_PATH[0].lat);
    expect(enemy.position.lon).toBe(TEST_PATH[0].lon);
    expect(enemy.alive).toBe(true);
    expect(m.enemyManager.getAliveCount()).toBe(1);
  });

  it('should move enemy along path over time', () => {
    const enemy = m.enemyManager.spawn(TEST_PATH, 'zombie', 50, false); // 50 m/s

    const startLat = enemy.position.lat;

    // Simulate several frames — enemy should move north (increasing lat)
    for (let i = 0; i < 10; i++) {
      m.enemyManager.update(100, 1.0); // 100ms per frame
    }

    expect(enemy.position.lat).toBeGreaterThan(startLat);
  });

  it('should emit enemy:reached-base when enemy reaches end of path', () => {
    // High speed → quickly reaches end
    const _enemy = m.enemyManager.spawn(TEST_PATH, 'zombie', 500, false);

    const reachedBaseHandler = vi.fn();
    m.eventBus.on('enemy:reached-base', reachedBaseHandler);

    // Simulate frames until enemy reaches end or max iterations
    for (let i = 0; i < 200; i++) {
      m.enemyManager.update(50, 1.0);
      if (m.enemyManager.getAll().length === 0) break;
    }

    expect(reachedBaseHandler).toHaveBeenCalledOnce();
    expect(reachedBaseHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'enemy:reached-base',
        damage: GAME_BALANCE.combat.enemyBaseDamage,
      })
    );
  });

  it('should remove enemy from manager after reaching base', () => {
    const _enemy = m.enemyManager.spawn(TEST_PATH, 'zombie', 500, false);

    // Run until enemy reaches end
    for (let i = 0; i < 200; i++) {
      m.enemyManager.update(50, 1.0);
      if (m.enemyManager.getAll().length === 0) break;
    }

    expect(m.enemyManager.getAll()).toHaveLength(0);
    expect(m.enemyManager.getAliveCount()).toBe(0);
  });

  it('should handle multiple enemies reaching base', () => {
    m.enemyManager.spawn(TEST_PATH, 'zombie', 500, false);
    m.enemyManager.spawn(TEST_PATH, 'zombie', 400, false);

    const reachedBaseHandler = vi.fn();
    m.eventBus.on('enemy:reached-base', reachedBaseHandler);

    for (let i = 0; i < 300; i++) {
      m.enemyManager.update(50, 1.0);
      if (m.enemyManager.getAll().length === 0) break;
    }

    expect(reachedBaseHandler).toHaveBeenCalledTimes(2);
    expect(m.enemyManager.getAll()).toHaveLength(0);
  });

  it('should not move paused enemies', () => {
    const enemy = m.enemyManager.spawn(TEST_PATH, 'zombie', 50, true); // paused=true

    const startLat = enemy.position.lat;

    for (let i = 0; i < 10; i++) {
      m.enemyManager.update(100, 1.0);
    }

    // Should not have moved
    expect(enemy.position.lat).toBe(startLat);
  });

  it('should resume paused enemies and they start moving', () => {
    const enemy = m.enemyManager.spawn(TEST_PATH, 'zombie', 50, true);
    const startLat = enemy.position.lat;

    // Start moving
    enemy.startMoving();

    for (let i = 0; i < 10; i++) {
      m.enemyManager.update(100, 1.0);
    }

    expect(enemy.position.lat).toBeGreaterThan(startLat);
  });

  it('should emit enemy:died and provide credits when enemy is killed', () => {
    const enemy = m.enemyManager.spawn(TEST_PATH, 'zombie', 5, true);

    const diedHandler = vi.fn();
    m.eventBus.on('enemy:died', diedHandler);

    m.enemyManager.setWaveNumberProvider(() => 1);
    m.enemyManager.kill(enemy, 1.0);

    expect(diedHandler).toHaveBeenCalledOnce();
    expect(diedHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'enemy:died',
        enemy,
      })
    );
    // Should have positive credits
    expect(diedHandler.mock.calls[0][0].credits).toBeGreaterThan(0);
  });

  it('should track alive count correctly across spawn and kill', () => {
    expect(m.enemyManager.getAliveCount()).toBe(0);

    const e1 = m.enemyManager.spawn(TEST_PATH, 'zombie', 5, true);
    expect(m.enemyManager.getAliveCount()).toBe(1);

    const e2 = m.enemyManager.spawn(TEST_PATH, 'zombie', 5, true);
    expect(m.enemyManager.getAliveCount()).toBe(2);

    m.enemyManager.kill(e1, 1.0);
    expect(m.enemyManager.getAliveCount()).toBe(1);

    m.enemyManager.kill(e2, 1.0);
    expect(m.enemyManager.getAliveCount()).toBe(0);
  });

  it('should clear all enemies', () => {
    m.enemyManager.spawn(TEST_PATH, 'zombie', 5, true);
    m.enemyManager.spawn(TEST_PATH, 'zombie', 5, true);
    m.enemyManager.spawn(TEST_PATH, 'zombie', 5, true);

    expect(m.enemyManager.getAll()).toHaveLength(3);

    m.enemyManager.clear();

    expect(m.enemyManager.getAll()).toHaveLength(0);
    expect(m.enemyManager.getAliveCount()).toBe(0);
  });
});
