/**
 * Integration Test: the ooze boss across WaveManager + EnemyManager. Its body
 * grows along the route from the portal, flows into the base metre by metre
 * and leaks once, the same at 1 and at 10 sub-steps per frame.
 */
import { describe, it, expect, vi } from 'vitest';

// Mock Three.js before any imports
vi.mock('three', async () => {
  const mod = await import('@/test/mocks/three.mock');
  return { ...mod };
});

import {
  createTestManagers,
  TEST_SPAWN_POINTS,
  createTestCachedPaths,
  makeSingleTypeWaveConfig,
} from './test-helpers';

describe('Ooze integration', () => {
  function run(stepsPerFrame: number) {
    const m = createTestManagers(); // resets the id counter
    m.waveManager.initialize(TEST_SPAWN_POINTS, createTestCachedPaths());
    m.enemyManager.setWaveNumberProvider(() => m.waveManager.waveNumber());
    m.enemyManager.setWaveSizeProvider(() => m.waveManager.getExpectedBodyCount());
    const log: string[] = [];
    m.eventBus.on('enemy:leaking', (e) => log.push(`leaking ${e.damage}`));
    m.eventBus.on('enemy:reached-base', (e) => log.push(`reached ${e.damage}`));

    m.waveManager.startWave(makeSingleTypeWaveConfig({ count: 1, type: 'ooze' }));
    const STEP = 16.667;
    let now = 0;
    let steps = 0;
    const samples: number[][] = [];
    for (let frame = 0; frame < 4200 / stepsPerFrame; frame++) {
      for (let s = 0; s < stepsPerFrame; s++) {
        now += STEP;
        steps++;
        m.waveManager.tickSpawn(STEP);
        m.enemyManager.update(STEP, now);
      }
      // Every 10 s of game time, the same sub-step in both runs
      const ooze = m.enemyManager.getAlive()[0];
      if (steps % 600 === 0 && ooze) {
        samples.push([ooze.body!.tailM, ooze.body!.tipM, ooze.health.hp]);
      }
    }
    return { log, samples, done: m.waveManager.checkWaveComplete() };
  }

  it('grows from the portal, flows into the base and leaks, the same at timescale 1 and 10', () => {
    const one = run(1);
    const ten = run(10);
    expect(ten).toEqual(one);

    // The 111 m route at 3 m/s: the tip arrives after 37 s, the body is
    // 80 m long by then and flows in for 27 s: ten leaks of wave 1
    expect(one.samples[0]).toEqual([0, expect.any(Number), expect.any(Number)]);
    const total = one.log.reduce((sum, entry) => sum + Number(entry.split(' ')[1]), 0);
    expect(total).toBe(10);
    expect(one.log.at(-1)).toMatch(/^reached /);
    expect(one.log.filter((e) => e.startsWith('reached'))).toHaveLength(1);
    expect(one.done).toBe(true);
  });
});
