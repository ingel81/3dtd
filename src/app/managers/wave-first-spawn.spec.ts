/**
 * The first enemy of a wave comes at once, also with scattered spawn gaps
 * (delayVariation): its delay is drawn once and set as both the spent and
 * the next gap. Drawn twice, the two values differed and the first enemy
 * waited for their difference (review 2026-10-01).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('three', async () => {
  const mod = await import('@/test/mocks/three.mock');
  return { ...mod };
});

import { createTestManagers, createTestCachedPaths, TestManagers, tickEngine, TEST_SPAWN_POINTS } from '../integration/test-helpers';
import { ENEMY_TYPES } from '../configs/enemy-types.config';

describe('The first spawn of a wave', () => {
  let m: TestManagers;

  beforeEach(() => {
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    m = createTestManagers();
    m.waveManager.initialize(TEST_SPAWN_POINTS, createTestCachedPaths());
    // Draws far apart: 0 gives the shortest gap, 1 the longest
    let draw = 0;
    m.waveManager.setRandom(() => (draw++ % 2 === 0 ? 0 : 0.999));
  });

  afterEach(() => {
    m.enemyManager.clear();
    vi.restoreAllMocks();
  });

  it('comes with the first sub-step, however the spawn gaps scatter', () => {
    m.waveManager.startWave({
      schedule: {
        entries: [{ enemyType: 'zombie', speed: ENEMY_TYPES['zombie'].baseSpeed }, { enemyType: 'zombie', speed: ENEMY_TYPES['zombie'].baseSpeed }],
        baseDelay: 2000,
        delayVariation: 0.5,
      },
    });
    tickEngine(m, 16);
    expect(m.enemyManager.getAlive()).toHaveLength(1);
  });
});
