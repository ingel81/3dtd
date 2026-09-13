/**
 * Integration Test: the ooze boss across WaveManager + EnemyManager. Its body
 * grows along the route from the portal, flows into the base metre by metre
 * and leaks once, the same at 1 and at 10 sub-steps per frame. A kill pays
 * the wave's kill budget over the ooze and the clumps it breaks into.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Three.js before any imports
vi.mock('three', async () => {
  const mod = await import('@/test/mocks/three.mock');
  return { ...mod };
});

import {
  createTestManagers,
  TestManagers,
  TEST_SPAWN_POINTS,
  createTestCachedPaths,
  makeSingleTypeWaveConfig,
  tickEngine,
} from './test-helpers';
import { goldBudgetForWave, isBossWave } from '../configs/wave-curriculum.config';
import type { Enemy } from '../entities/enemy.entity';

/** Managers wired as GameStateManager wires them for leaks and the kill budget. */
function createWiredManagers(): TestManagers {
  const m = createTestManagers(); // resets the id counter
  m.waveManager.initialize(TEST_SPAWN_POINTS, createTestCachedPaths());
  m.enemyManager.setWaveNumberProvider(() => m.waveManager.waveNumber());
  m.enemyManager.setWaveSizeProvider(() => m.waveManager.getExpectedBodyCount());
  return m;
}

describe('Ooze integration', () => {
  function run(stepsPerFrame: number) {
    const m = createWiredManagers();
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

  describe('kill gold', () => {
    const CLUMP = 'slime-clump';
    let m: TestManagers;
    let clock: { now: number };
    let credits: number[];

    beforeEach(() => {
      m = createWiredManagers();
      clock = { now: 0 };
      credits = [];
      m.eventBus.on('enemy:died', (e) => credits.push(e.credits));
    });

    afterEach(() => {
      m.enemyManager.clear();
      vi.restoreAllMocks();
    });

    const alive = (type: string) => m.enemyManager.getAlive().filter((e) => e.typeConfig.id === type);
    const paid = () => credits.reduce((a, b) => a + b, 0);
    const startOoze = (): Enemy => {
      m.waveManager.startWave(makeSingleTypeWaveConfig({ count: 1, type: 'ooze' }));
      tickEngine(m, 16, clock);
      return alive('ooze')[0];
    };
    /** Kill the ooze once its body is full (80 m at 3 m/s after 27 s, the tip 37 s from the HQ), then every clump. */
    const killFullOoze = (): void => {
      const ooze = startOoze();
      tickEngine(m, 28_000, clock);
      expect(ooze.body!.lengthM).toBeCloseTo(80, 5);
      m.enemyManager.kill(ooze);
      expect(alive(CLUMP)).toHaveLength(10);
      for (const clump of alive(CLUMP)) m.enemyManager.kill(clump);
    };

    it('counts the ooze and its ten clumps as bodies of the wave', () => {
      startOoze();
      expect(m.waveManager.getExpectedEnemyCount()).toBe(1);
      expect(m.waveManager.getExpectedBodyCount()).toBe(11);
    });

    it('pays exactly the wave budget when the ooze and all its clumps die', () => {
      killFullOoze();

      expect(credits).toHaveLength(11);
      expect(paid()).toBe(goldBudgetForWave(1).kill);
      expect(Math.max(...credits) - Math.min(...credits)).toBeLessThanOrEqual(1);
      tickEngine(m, 3_000, clock); // the clumps' death animation is over
      expect(m.waveManager.checkWaveComplete()).toBe(true);
    });

    it('leaves the slots of the clumps a young body never became unpaid', () => {
      const ooze = startOoze();
      tickEngine(m, 9_000, clock); // 27 m of body: 3 of 10 clumps
      m.enemyManager.kill(ooze);
      expect(alive(CLUMP)).toHaveLength(3);
      for (const clump of alive(CLUMP)) m.enemyManager.kill(clump);

      // 4 of 11 slots paid, the floor accumulator leaves at most one coin of rounding
      const budget = goldBudgetForWave(1).kill;
      expect(credits).toHaveLength(4);
      expect(paid()).toBeGreaterThanOrEqual(Math.floor((budget * 4) / 11));
      expect(paid()).toBeLessThanOrEqual(Math.ceil((budget * 4) / 11));
      tickEngine(m, 3_000, clock);
      expect(m.waveManager.checkWaveComplete()).toBe(true);
    });

    it('pays the budget of the boss wave it takes in the endless rotation (W45)', () => {
      expect(isBossWave(45)).toBe(true);
      m.enemyManager.setWaveNumberProvider(() => 45);
      killFullOoze();

      expect(credits).toHaveLength(11);
      expect(paid()).toBe(goldBudgetForWave(45).kill);
    });
  });
});
