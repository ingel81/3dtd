/**
 * Integration Test: split on death (a skeleton splits into two minions)
 * across WaveManager + EnemyManager: wave completion, kill gold, leaks and
 * the outcome at different sub-step counts per frame.
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
  tickEngine,
  makeSingleTypeWaveConfig,
} from './test-helpers';
import { goldBudgetForWave } from '../configs/wave-curriculum.config';

const MINION = 'skeleton-minion';

/** Managers wired as GameStateManager wires them for the kill budget. */
function createWiredManagers(): TestManagers {
  const m = createTestManagers();
  m.waveManager.initialize(TEST_SPAWN_POINTS, createTestCachedPaths());
  m.enemyManager.setWaveNumberProvider(() => m.waveManager.waveNumber());
  m.enemyManager.setWaveSizeProvider(() => m.waveManager.getExpectedBodyCount());
  return m;
}

const skeletonWave = (count: number, spawnDelay = 16) =>
  makeSingleTypeWaveConfig({ count, type: 'skeleton', spawnDelay });

describe('Split on death integration', () => {
  let m: TestManagers;
  let clock: { now: number };
  let credits: number[];
  let reached: string[];

  beforeEach(() => {
    m = createWiredManagers();
    clock = { now: 0 };
    credits = [];
    reached = [];
    m.eventBus.on('enemy:died', (e) => credits.push(e.credits));
    m.eventBus.on('enemy:reached-base', (e) => reached.push(e.enemy.typeConfig.id));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const alive = (type: string) => m.enemyManager.getAlive().filter((e) => e.typeConfig.id === type);
  const killAll = (type: string) => {
    for (const e of alive(type)) m.enemyManager.kill(e);
  };
  const paid = () => credits.reduce((a, b) => a + b, 0);

  it('sizes the kill-gold slots by every body the wave can field', () => {
    m.waveManager.startWave(skeletonWave(4));
    expect(m.waveManager.getExpectedEnemyCount()).toBe(4);
    expect(m.waveManager.getExpectedBodyCount()).toBe(12); // 4 skeletons + 8 minions
  });

  it('keeps the wave open until the minions are gone', () => {
    m.waveManager.startWave(skeletonWave(2));
    tickEngine(m, 100, clock);
    expect(alive('skeleton')).toHaveLength(2);

    killAll('skeleton');
    expect(alive(MINION)).toHaveLength(4);
    tickEngine(m, 2500, clock); // the skeletons' death animation is over
    expect(m.enemyManager.getKillingCount()).toBe(0);
    expect(m.waveManager.checkWaveComplete()).toBe(false);

    killAll(MINION);
    tickEngine(m, 2100, clock);
    expect(m.waveManager.checkWaveComplete()).toBe(true);
  });

  it('pays exactly the wave budget when every body dies', () => {
    m.waveManager.startWave(skeletonWave(5));
    tickEngine(m, 200, clock);
    killAll('skeleton');
    killAll(MINION);

    expect(credits).toHaveLength(15);
    expect(paid()).toBe(goldBudgetForWave(1).kill);
  });

  it("forfeits a leaked skeleton's share and that of the minions it never became", () => {
    m.waveManager.startWave(skeletonWave(3));
    tickEngine(m, 100, clock);
    const [, ...rest] = alive('skeleton');
    for (const e of rest) m.enemyManager.kill(e);
    killAll(MINION);

    tickEngine(m, 30_000, clock); // the first skeleton walks into the base
    expect(reached).toEqual(['skeleton']);
    // 6 of 9 slots paid, the floor accumulator leaves at most one coin of rounding
    const budget = goldBudgetForWave(1).kill;
    expect(paid()).toBeGreaterThanOrEqual(Math.floor((budget * 6) / 9));
    expect(paid()).toBeLessThanOrEqual(Math.ceil((budget * 6) / 9));
  });

  it('counts a minion that reaches the base as a leak', () => {
    m.waveManager.startWave(skeletonWave(1));
    tickEngine(m, 50, clock);
    killAll('skeleton');

    tickEngine(m, 30_000, clock);
    expect(reached).toEqual([MINION, MINION]);
    expect(m.waveManager.checkWaveComplete()).toBe(true);
  });

  it('splits identically at 1 and at 10 sub-steps per frame (timescale 1 vs 10)', () => {
    const STEP = 16.667;
    const run = (stepsPerFrame: number) => {
      const t = createWiredManagers(); // resets the id counter
      const gold: number[] = [];
      t.eventBus.on('enemy:died', (e) => gold.push(e.credits));
      // Normal spawns roll a lane: the same sequence in both runs
      let seed = 1;
      const random = vi.spyOn(Math, 'random').mockImplementation(() => {
        seed = (seed * 16807) % 2147483647;
        return seed / 2147483647;
      });

      t.waveManager.startWave(skeletonWave(12, 150));
      let now = 0;
      for (let frame = 0; frame < 600 / stepsPerFrame; frame++) {
        for (let s = 0; s < stepsPerFrame; s++) {
          now += STEP;
          t.waveManager.tickSpawn(STEP);
          t.enemyManager.update(STEP, now);
          // A tower in the sub-step: skeletons fall at 30 % of the 111 m route
          // (from 5.6 s), minions at 50 % (3.2 s later), the last ones after 10 s
          for (const e of t.enemyManager.getAlive()) {
            const at = e.typeConfig.id === 'skeleton' ? 0.3 : 0.5;
            if (e.movement.getPathProgress() >= at) t.enemyManager.kill(e);
          }
        }
        t.enemyManager.presentFrame(now);
      }
      random.mockRestore();

      return {
        gold,
        world: t.enemyManager.getAll().map((e) => [
          e.id,
          e.typeConfig.id,
          e.alive,
          e.movement.currentIndex,
          e.movement.progress,
          e.movement.getLateralFactor(),
          e.position.lat,
          e.position.lon,
          e.health.maxHp,
        ]),
      };
    };

    const one = run(1);
    const ten = run(10);
    expect(ten).toEqual(one);
    // Mid-wave after 10 s: minions have died and some still walk
    expect(one.gold.length).toBeGreaterThan(12);
    expect(one.world.some(([, type, isAlive]) => type === MINION && isAlive)).toBe(true);
  });
});
