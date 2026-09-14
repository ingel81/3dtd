/**
 * Playtest 357 (docs/REVIEW_SPRINT_2026-09-14.md), the gold of W35: the worm
 * the boss rotation sends through the real WaveManager and EnemyManager,
 * wired as GameStateManager wires them for the kill budget, every segment
 * killed. The completion bonus is EconomyService's, which GameStateManager
 * books at wave:completed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('three', async () => {
  const mod = await import('@/test/mocks/three.mock');
  return { ...mod };
});

import {
  createTestManagers,
  createTestCachedPaths,
  TestManagers,
  tickEngine,
  TEST_SPAWN_POINTS,
} from '../../integration/test-helpers';
import { ENEMY_TYPES } from '../../configs/enemy-types.config';
import { goldBudgetForWave } from '../../configs/wave-curriculum.config';
import { bossVariantForWave } from '../../configs/boss-variants.config';
import { EconomyService } from '../../services/economy.service';

describe('Gold of the worm wave W35, playtest 357 replayed', () => {
  let m: TestManagers;

  beforeEach(() => {
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    m = createTestManagers();
    m.waveManager.initialize(TEST_SPAWN_POINTS, createTestCachedPaths());
    m.enemyManager.setWaveNumberProvider(() => m.waveManager.waveNumber());
    m.enemyManager.setWaveSizeProvider(() => m.waveManager.getExpectedBodyCount());
  });

  afterEach(() => {
    m.enemyManager.clear();
    vi.restoreAllMocks();
  });

  it('killed whole it pays 12 000 kill gold, 18 000 with the base completion bonus', () => {
    expect(bossVariantForWave(35)?.enemyType).toBe('worm');
    const credits: number[] = [];
    m.eventBus.on('enemy:died', (e) => credits.push(e.credits));

    // After the jump: the counter at 34, the next start is W35
    m.waveManager.jumpTo(34);
    m.waveManager.startWave({
      schedule: { entries: [{ enemyType: 'worm', speed: ENEMY_TYPES['worm'].baseSpeed }], baseDelay: 100 },
    });
    expect(m.waveManager.waveNumber()).toBe(35);

    for (let t = 0; t < 300_000 && !m.waveManager.checkWaveComplete(); t += 16) {
      tickEngine(m, 16);
      for (const e of m.enemyManager.getAlive()) m.enemyManager.kill(e);
    }
    expect(m.waveManager.checkWaveComplete()).toBe(true);

    const kill = credits.reduce((sum, c) => sum + c, 0);
    expect(credits.length).toBeGreaterThan(1);
    expect(goldBudgetForWave(35).kill).toBe(12_000);
    expect(kill).toBe(12_000);
    // Every segment its share, no segment much more than another
    expect(Math.max(...credits) - Math.min(...credits)).toBeLessThanOrEqual(1);

    // No perfect, close call, combo or comeback: those are the skill bonuses on top
    const bonus = new EconomyService().computeWaveCompletionBonus({ wave: 35, perfect: false, closeCall: false, hpLost: 0 });
    expect(bonus).toBe(6_000);
    expect(kill + bonus).toBe(18_000);
  });
});
