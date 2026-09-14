/**
 * Playtest 360, 362, 363, 420 and 421 (night 2026-09-14): the ooze in a wave
 * through the real WaveManager and EnemyManager, its leaks through the HQ's
 * leak budget (BaseHealthLedger, subscribed as GameStateManager subscribes
 * it) into ScreenShakeService and the run summary (RunStatsTracker).
 * Rendering mocked. The wall clock the shake throttles by runs at game time
 * divided by the timescale, as it does in the game.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('three', async () => {
  const mod = await import('@/test/mocks/three.mock');
  return { ...mod };
});

import {
  createTestManagers,
  createTestCachedPaths,
  makeSingleTypeWaveConfig,
  TestManagers,
  TEST_PATH,
  TEST_SPAWN_POINTS,
  tickEngine,
} from './test-helpers';
import { SubscriptionBag } from '../game-engine/game-event-bus';
import { ScreenShakeService } from '../game-engine/screen-shake.service';
import { BaseHealthLedger } from '../managers/game-state/base-health-ledger';
import { RunStatsTracker } from '../services/infrastructure/run-stats';
import { GAME_BALANCE } from '../configs/game-balance.config';
import { SCREEN_SHAKE_CONFIG } from '../configs/visual-effects.config';
import { enemyBaseDamageForWave } from '../configs/wave-curriculum.config';
import { METERS_PER_DEGREE_LAT } from '../utils/geo-utils';
import type { ThreeTilesEngine } from '../three-engine';
import type { Enemy } from '../entities/enemy.entity';

const STEP = 16;
const { hqDamageMinIntervalMs } = SCREEN_SHAKE_CONFIG;
const START_HEALTH = GAME_BALANCE.player.startHealth;

describe('Ooze in a wave: HQ leaks, shake, run summary, clumps (playtest 360, 362, 363, 420, 421)', () => {
  let m: TestManagers;
  let ledger: BaseHealthLedger;
  let shake: ScreenShakeService;
  let stats: RunStatsTracker;
  let clock: { now: number };
  let wall: number;
  /** Wall-clock times of the HQ shakes */
  let shakes: number[];
  /** HP the HQ lost, each with its wall-clock time */
  let hurt: { delta: number; wall: number }[];
  /** enemy:leaking, the points of an ooze flowing in, with the wall-clock time */
  let leaking: { damage: number; wall: number }[];
  let reached: number[];

  beforeEach(() => {
    localStorage.clear();
    m = createTestManagers();
    m.waveManager.initialize(TEST_SPAWN_POINTS, createTestCachedPaths());
    m.enemyManager.setWaveNumberProvider(() => m.waveManager.waveNumber());
    m.enemyManager.setWaveSizeProvider(() => m.waveManager.getExpectedBodyCount());
    // Leaks cost HP inside the wave's budget, as in GameStateManager.initialize
    ledger = new BaseHealthLedger(m.eventBus);
    m.eventBus.on('enemy:reached-base', (e) => ledger.applyLeak(e.damage));
    m.eventBus.on('enemy:leaking', (e) => ledger.applyLeak(e.damage));

    clock = { now: 0 };
    wall = 0;
    shakes = [];
    hurt = [];
    leaking = [];
    reached = [];
    vi.spyOn(performance, 'now').mockImplementation(() => wall);
    const engine = {
      triggerScreenShake: vi.fn(() => {
        shakes.push(wall);
      }),
      getCamera: () => ({ position: {} }),
      sync: { geoToLocalSimpleInto: vi.fn() },
    };
    shake = new ScreenShakeService(m.eventBus, engine as unknown as ThreeTilesEngine);
    m.eventBus.on('health:changed', (e) => hurt.push({ delta: e.delta, wall }));
    m.eventBus.on('enemy:leaking', (e) => leaking.push({ damage: e.damage, wall }));
    m.eventBus.on('enemy:reached-base', (e) => reached.push(e.damage));
    stats = new RunStatsTracker();
    stats.attach(m.eventBus, new SubscriptionBag());
  });

  afterEach(() => {
    shake.destroy();
    m.enemyManager.clear();
    vi.restoreAllMocks();
  });

  /** `gameMs` of game time in sub-steps; the wall clock runs at game time / `timescale`. */
  const run = (gameMs: number, timescale = 1): void => {
    for (let t = 0; t < gameMs; t += STEP) {
      tickEngine(m, STEP, clock);
      wall += STEP / timescale;
    }
  };
  const alive = (type: string): Enemy[] => m.enemyManager.getAlive().filter((e) => e.typeConfig.id === type);
  /** Starts wave `wave` with one ooze, as Custom Wave or the boss rotation brings it. */
  const startOoze = (wave: number): Enemy => {
    m.waveManager.jumpTo(wave - 1);
    m.waveManager.startWave(makeSingleTypeWaveConfig({ count: 1, type: 'ooze' }));
    run(STEP);
    return alive('ooze')[0];
  };
  const runToWaveEnd = (timescale = 1): void => {
    while (!m.waveManager.checkWaveComplete() && clock.now < 200_000) run(100, timescale);
    expect(m.waveManager.checkWaveComplete()).toBe(true);
  };
  /** A zombie one metre before the HQ, at the end of the ooze's route */
  const zombieAtTheHq = (): Enemy => {
    const end = TEST_PATH.at(-1)!;
    return m.enemyManager.spawn([{ ...end, lat: end.lat - 1 / METERS_PER_DEGREE_LAT }, end], 'zombie');
  };

  it('362: at W1 a full ooze costs 10 HP point by point, each point shakes, and the wave ends once all of it is in', () => {
    const ooze = startOoze(1);
    let flowingWhileTheWaveRuns = 0;
    while (!m.waveManager.checkWaveComplete() && clock.now < 120_000) {
      if (leaking.length > 0 && m.enemyManager.getById(ooze.id)) flowingWhileTheWaveRuns++;
      run(100);
    }
    expect(m.waveManager.checkWaveComplete()).toBe(true);
    expect(m.enemyManager.getById(ooze.id)).toBeNull();
    // It flowed for about 25 s after the first point, the wave running on
    expect(flowingWhileTheWaveRuns).toBeGreaterThan(200);

    expect(hurt.map((h) => h.delta)).toEqual(new Array(10).fill(-1));
    expect(ledger.baseHealth()).toBe(START_HEALTH - 10);
    // A point every 8 m, 2.7 s at 3 m/s: far enough apart for each to shake
    expect(shakes).toHaveLength(10);
  });

  it('421: at W45 and 4x it shakes at most every 900 ms of wall time, until the leak budget of the wave is spent', () => {
    expect(enemyBaseDamageForWave(45)).toBe(5);
    startOoze(45);
    runToWaveEnd(4);

    // 80 m at 5 x 10 / 80 = 0.625 HP a metre: 50 points, the budget lets 18 through
    const cap = GAME_BALANCE.combat.maxLeakDamagePerWave;
    expect(leaking.reduce((sum, l) => sum + l.damage, 0) + reached.reduce((a, b) => a + b, 0)).toBe(50);
    expect(hurt.map((h) => h.delta)).toEqual(new Array(cap).fill(-1));
    expect(ledger.baseHealth()).toBe(START_HEALTH - cap);

    // A point every 133 ms of wall time: the first one after each 900 ms shakes
    expect(shakes.length).toBeGreaterThan(1);
    expect(shakes.length).toBeLessThan(hurt.length / 4);
    for (let i = 1; i < shakes.length; i++) {
      expect(shakes[i] - shakes[i - 1]).toBeGreaterThanOrEqual(hqDamageMinIntervalMs);
      expect(shakes[i] - shakes[i - 1]).toBeLessThan(hqDamageMinIntervalMs + 150);
    }

    // With the budget spent the HQ loses nothing more and nothing shakes,
    // while the ooze keeps flowing in (the red edge pulses on enemy:leaking)
    const lastHurt = hurt.at(-1)!.wall;
    expect(shakes.at(-1)!).toBeLessThanOrEqual(lastHurt);
    expect(leaking.filter((l) => l.wall > lastHurt).length).toBeGreaterThan(20);
  });

  it('421: a zombie leak at W45 costs 5 HP, not 10, and shakes no harder than an ooze point: not inside the 900 ms', () => {
    startOoze(45);
    while (shakes.length === 0 && clock.now < 60_000) run(STEP, 4);
    const pointShake = shakes[0];

    const zombie = zombieAtTheHq();
    while (m.enemyManager.getById(zombie.id)) run(STEP, 4);

    const zombieLeak = hurt.find((h) => h.delta === -5);
    expect(zombieLeak).toBeDefined();
    expect(zombieLeak!.wall - pointShake).toBeLessThan(hqDamageMinIntervalMs);
    // 5 HP is a factor 0.5 like 1 HP (screen-shake.service.ts: at least 0.5), not a harder hit
    expect(shakes).toEqual([pointShake]);
  });

  it('421: from W91 on a zombie leak costs 10 HP and shakes at once, inside the 900 ms', () => {
    expect(enemyBaseDamageForWave(91)).toBe(10);
    startOoze(91);
    while (shakes.length === 0 && clock.now < 60_000) run(STEP, 4);
    const pointShake = shakes[0];

    const zombie = zombieAtTheHq();
    while (m.enemyManager.getById(zombie.id)) run(STEP, 4);

    const zombieLeak = hurt.find((h) => h.delta === -10)!;
    expect(zombieLeak.wall - pointShake).toBeLessThan(hqDamageMinIntervalMs);
    expect(shakes).toEqual([pointShake, zombieLeak.wall]);
  });

  it('420: an ooze that flowed in partly and was then killed is one leak of W45 in the summary and no kill; its clumps are kills', () => {
    const ooze = startOoze(45);
    while (hurt.length < 3) run(100);
    m.enemyManager.kill(ooze);
    const clumps = alive('slime-clump');
    expect(clumps.length).toBeGreaterThan(0);
    for (const clump of clumps) m.enemyManager.kill(clump);
    run(3_000);
    expect(m.waveManager.checkWaveComplete()).toBe(true);

    const summary = stats.summary(clock.now);
    expect(summary.waveReached).toBe(45);
    expect(summary.leaksPerWave[44]).toBe(1);
    expect(summary.kills).toBe(clumps.length);
    expect(summary.hqDamagePerWave[44]).toBe(hurt.reduce((sum, h) => sum - h.delta, 0));
  });

  it.each([
    [500, 1],
    [5_000, 2],
    [8_000, 3],
    [28_000, 10],
  ])('363: killed %i ms after its spawn it breaks into %i clumps', (ms, count) => {
    const ooze = startOoze(1);
    run(ms);
    m.enemyManager.kill(ooze);
    expect(alive('slime-clump')).toHaveLength(count);
  });

  it('363: the wave ends after the last clump, not with the ooze', () => {
    const ooze = startOoze(1);
    run(28_000);
    m.enemyManager.kill(ooze);
    const clumps = alive('slime-clump');
    expect(clumps).toHaveLength(10);
    run(3_000);
    expect(m.waveManager.checkWaveComplete()).toBe(false);

    // The rearmost clump last, so none of them reaches the HQ meanwhile
    const byDistance = [...clumps].sort((a, b) => a.movement.getDistanceAlongPath() - b.movement.getDistanceAlongPath());
    for (const clump of byDistance.slice(1)) m.enemyManager.kill(clump);
    run(3_000);
    expect(m.waveManager.checkWaveComplete()).toBe(false);

    m.enemyManager.kill(byDistance[0]);
    run(3_000);
    expect(m.waveManager.checkWaveComplete()).toBe(true);
    expect(reached).toEqual([]);
  });

  it('360: a slow on the ooze slows all of it: the tip, the growth of the body and, once it is full, the tail', () => {
    const ooze = startOoze(1);
    run(10_000 - STEP);
    const body = ooze.body!;
    expect(body.tipM).toBeCloseTo(30, 0);
    expect(body.tailM).toBe(0);

    ooze.movement.applyStatusEffect({ type: 'slow', value: 0.5, duration: 60_000, startTime: clock.now, sourceId: 'ice' });
    run(20_000);
    expect(body.tipM).toBeCloseTo(60, 0);
    expect(body.tailM).toBe(0);

    run(20_000);
    expect(body.tipM).toBeCloseTo(90, 0);
    expect(body.tailM).toBeCloseTo(10, 0);
  });
});
