/**
 * Playtest 357 (docs/archive/REVIEW_SPRINT_2026-09-14.md), the gold of a worm
 * wave (then W35 of the boss rotation, now the run plan's W60) through the
 * real WaveManager and EnemyManager,
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
import { waveRules } from '../../director/wave-rules';
import { EconomyService, waveGoldTotal } from '../../services/economy.service';

describe('Gold of a worm wave past the campaign (W60), playtest 357 replayed', () => {
  let m: TestManagers;

  beforeEach(() => {
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    m = createTestManagers();
    m.waveManager.initialize(TEST_SPAWN_POINTS, createTestCachedPaths());
    m.enemyManager.setWaveNumberProvider(() => m.waveManager.waveNumber());
    m.enemyManager.setWaveWeightProvider(() => m.waveManager.getExpectedBodyWeight());
  });

  afterEach(() => {
    m.enemyManager.clear();
    vi.restoreAllMocks();
  });

  it('killed whole it pays the kill gold of its wave, plus the base completion bonus', () => {
    expect(waveRules().enemyMix(60)?.some(([type]) => type === 'worm')).toBe(true);
    const credits: number[] = [];
    m.eventBus.on('enemy:died', (e) => credits.push(e.credits));

    // After the jump: the counter at 59, the next start is W60
    m.waveManager.jumpTo(59);
    m.waveManager.startWave({
      schedule: { entries: [{ enemyType: 'worm', speed: ENEMY_TYPES['worm'].baseSpeed }], baseDelay: 100 },
    });
    expect(m.waveManager.waveNumber()).toBe(60);

    for (let t = 0; t < 300_000 && !m.waveManager.checkWaveComplete(); t += 16) {
      tickEngine(m, 16);
      for (const e of m.enemyManager.getAlive()) m.enemyManager.kill(e);
    }
    expect(m.waveManager.checkWaveComplete()).toBe(true);

    const kill = credits.reduce((sum, c) => sum + c, 0);
    expect(credits.length).toBeGreaterThan(1);
    expect(kill).toBe(waveRules().gold(60).kill);
    // Every segment its share, the last one takes the rounding remainder
    expect(Math.max(...credits.slice(0, -1)) - Math.min(...credits)).toBeLessThanOrEqual(1);

    // No perfect, close call, combo or comeback: those are the skill bonuses on top
    const bonus = waveGoldTotal(
      new EconomyService().computeWaveCompletionBonus({ wave: 60, perfect: false, closeCall: false, hpLost: 0 }),
    );
    expect(bonus).toBe(waveRules().gold(60).complete);
  });
});
