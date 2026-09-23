/**
 * Playtest 121 of night 1 (docs/archive/REVIEW_SPRINT_2026-09-13.md) replayed: a
 * small wave of three zombies, the last one just before the HQ, and a
 * nuclear strike behind it. The wave stays running until the explosion, the
 * auto-start of the next wave counts only from then on.
 *
 * Through the real GameStateManager sub-step loop and the real
 * GameLoopFacadeService auto-start ("auto 10s", ecbf9a71) on its bus, with
 * the harness of ability-strike.spec.ts: only the services around the loop
 * are stubbed, the route grid's radius query is a plain distance filter.
 * The facade's per-frame hook (tickAutoWave) runs after every frame, as in
 * the game; its startWave is a spy, so the next wave is only counted.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('three', async () => await import('@/test/mocks/three.mock'));
// Only their DI tokens are needed, as in game-loop-facade.auto-wave.spec.ts
vi.mock('../services/boss-intro.service', () => ({ BossIntroService: class BossIntroService {} }));
vi.mock('../services/replay.service', () => ({ ReplayService: class ReplayService {} }));
vi.mock('../services/tower-control.service', () => ({ TowerControlService: class TowerControlService {} }));

const mockServices: Record<string, unknown> = {};
vi.mock('@angular/core', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@angular/core');
  return {
    ...actual,
    Injectable: () => (target: unknown) => target,
    effect: vi.fn(),
    inject: (token: { name?: string }) => {
      const name = token?.name ?? 'unknown';
      if (!mockServices[name]) mockServices[name] = withAutoStubs({});
      return mockServices[name];
    },
  };
});

import { signal } from '@angular/core';
import {
  addMissileSilo,
  createMockTilesEngine,
  createTestCachedPaths,
  withAutoStubs,
  TEST_PATH,
  TEST_SPAWN_POINTS,
} from './test-helpers';
import { GameStateManager } from '../managers/game-state.manager';
import { GameLoopFacadeService } from '../services/facade/game-loop-facade.service';
import { CombatEffectService } from '../services/combat/combat-effect.service';
import { DamageApplicationService } from '../services/combat/damage-application.service';
import { GameObject } from '../core/game-object';
import { ABILITIES } from '../configs/abilities.config';
import { AUTO_WAVE_DELAY_MS } from '../utils/auto-wave-countdown';
import { geoDistanceFast } from '../utils/geo-utils';
import type { Enemy } from '../entities/enemy.entity';
import type { SpawnStart } from '../managers/enemy.manager';
import type { GeoPosition } from '../models/game.types';
import type { FacadeComponentBridge } from '../services/facade/tower-defense-facade.service';

/** The engine the loop gets, as in ability-loop.scenario.spec.ts */
function createEngine(): never {
  const engine = createMockTilesEngine() as unknown as Record<string, Record<string, unknown>>;
  for (const key of ['effects', 'towers', 'enemies', 'projectiles', 'trailStreaks', 'spatialAudio', 'sync']) {
    engine[key] = withAutoStubs(engine[key]);
  }
  engine['enemies']['create'] = vi.fn(() => Promise.resolve(null));
  engine['spatialAudio']['getListener'] = () => ({ context: { state: 'running', resume: () => Promise.resolve() } });
  engine['spatialAudio']['playAtGeo'] = vi.fn(() => Promise.resolve(null));
  (engine as Record<string, unknown>)['renderingEnabled'] = false;
  // ScreenShakeService measures the strike's distance from the camera
  (engine as Record<string, unknown>)['getCamera'] = () => ({ position: { x: 0, y: 400, z: 0 } });
  return new Proxy(engine, {
    get(obj, prop, receiver) {
      if (!(prop in obj)) Reflect.set(obj, prop, withAutoStubs(vi.fn()));
      return Reflect.get(obj, prop, receiver);
    },
  }) as never;
}

const NUKE = ABILITIES['nuclear-strike'];
const BASE_POSITION: GeoPosition = TEST_PATH[TEST_PATH.length - 1];
/** The fourth waypoint, about 33 m down the path: behind every zombie */
const BEHIND: GeoPosition = TEST_PATH[3];
const SEGMENT_M = geoDistanceFast(TEST_PATH[0], TEST_PATH[1]);
const PATH_M = SEGMENT_M * (TEST_PATH.length - 1);
/** 6500 ms of warning in sub-steps of 16.667 ms */
const WARNING_STEPS = 390;
const STEP_MS = 16.667;

/** A game with the strike researched and the facade's auto-start on its bus. */
function createGame() {
  for (const key of Object.keys(mockServices)) delete mockServices[key];
  GameObject.resetIdCounter();

  const ref: { gsm?: GameStateManager } = {};
  mockServices['GlobalRouteGridService'] = withAutoStubs({
    isInitialized: () => false,
    snapToRouteCell: (target: GeoPosition) => ({ ...target }),
    getEnemiesInRadiusGeo: (center: GeoPosition, radiusM: number, _exclude: unknown, out: Enemy[]) => {
      out.length = 0;
      for (const enemy of ref.gsm!.enemyManager.getAlive()) {
        if (geoDistanceFast(center, enemy.position) <= radiusM) out.push(enemy);
      }
      return out;
    },
  });
  mockServices['SpatialGridService'] = withAutoStubs({ updateEnemyTracked: () => null });
  mockServices['EnemyDebugService'] = withAutoStubs({ debugEnemies: () => [] });
  mockServices['EconomyService'] = withAutoStubs({ computeWaveCompletionBonus: () => 0 });
  mockServices['DamageApplicationService'] = new DamageApplicationService();
  mockServices['CombatEffectService'] = new CombatEffectService();
  // What the facade's auto-start reads: the "auto 10s" switch on, no bot
  mockServices['UIStore'] = withAutoStubs({ autoStartWaves: signal(true) });
  mockServices['BotClientService'] = withAutoStubs({ botEnabled: signal(false) });
  mockServices['NgZone'] = { run: (fn: () => unknown) => fn() };
  const store = withAutoStubs({
    phase: signal<string>('wave'),
    waveNumber: signal(1),
    autoWaveSecondsLeft: signal<number | null>(null),
  });
  mockServices['TowerDefenseStore'] = store;

  const gsm = new GameStateManager();
  ref.gsm = gsm;
  gsm.initialize(createEngine(), BASE_POSITION, TEST_SPAWN_POINTS, createTestCachedPaths());
  gsm.gameSpeed.set(1);
  addMissileSilo(gsm.towerManager);
  gsm.getEventBus().emit({
    type: 'research:completed',
    researchId: NUKE.researchId,
    effects: [{ kind: 'global-perk', perkId: NUKE.perkId, description: '' }],
  });

  const facade = new GameLoopFacadeService();
  facade.initialize({ getEngine: () => ({}) } as unknown as FacadeComponentBridge, gsm);
  facade.subscribeToEventBus({ onGameOverExtra: () => undefined });
  const startWave = vi.spyOn(facade, 'startWave').mockImplementation(() => undefined);
  return { gsm, facade, store, startWave, bus: gsm.getEventBus() };
}

/** A zombie `metresBeforeHq` before the HQ, walking at its own speed */
function zombieBeforeHq(gsm: GameStateManager, metresBeforeHq: number): Enemy {
  const metres = PATH_M - metresBeforeHq;
  const start: SpawnStart = {
    segmentIndex: Math.floor(metres / SEGMENT_M),
    segmentProgress: (metres % SEGMENT_M) / SEGMENT_M,
    lateralFactor: 0,
    heightVariation: 0,
    groundHeight: 300,
  };
  return gsm.enemyManager.spawn(TEST_PATH, 'zombie', undefined, false, undefined, start);
}

describe('A strike behind the last zombie of a small wave, playtest 121 (night 1) replayed', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the wave running until the explosion, the auto-start counts from there', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const { gsm, facade, store, startWave, bus } = createGame();

    // Sub-step (1-based) in which each thing happened, -1 until it did. The
    // handlers run inside a sub-step, before its per-step hook counts it.
    let step = 0;
    const leaks: number[] = [];
    let impactAt = -1;
    let completedAt = -1;
    let resolved: { hits: number; kills: number } | null = null;
    bus.on('enemy:reached-base', () => leaks.push(step + 1));
    bus.on('ability:impact', () => (impactAt = step + 1));
    bus.on('ability:resolved', (e) => (resolved = { hits: e.hits, kills: e.kills }));
    bus.on('wave:completed', () => (completedAt = step + 1));

    gsm.beginWave();
    // Three zombies, the last one 6 m before the HQ; the strike behind all of them
    for (const metres of [2, 4, 6]) zombieBeforeHq(gsm, metres);
    expect(gsm.abilityManager.use('nuclear-strike', BEHIND).ok).toBe(true);

    // Per frame: the loop's sub-steps, then the facade's per-frame hook
    let now = 1000;
    /** Phase each sub-step leaves behind, its completion check included */
    const phases: string[] = [];
    /** Countdown the wave panel shows, by sub-step */
    const countdown: (number | null)[] = [];
    const frame = () => {
      now += 16;
      gsm.update(now, () => {
        step++;
        phases.push(gsm.waveManager.phase());
      });
      facade.tickAutoWave();
      countdown[step] = store.autoWaveSecondsLeft();
    };
    while (completedAt < 0 && step < 3 * WARNING_STEPS) frame();
    const impactGameTime = gsm.gameTimeMs;

    // All three leaked while the strike was still coming
    expect(leaks).toHaveLength(3);
    expect(Math.max(...leaks)).toBeLessThan(impactAt);
    expect(impactAt).toBe(WARNING_STEPS);
    // A sub-step's hook sees the phase before its completion check: the wave
    // ran through the impact sub-step, whose check ended it. wave:completed
    // is deferred (WaveManager.endWave) and goes out with the next
    // sub-step's event queue.
    expect(phases.slice(0, impactAt)).toEqual(Array(impactAt).fill('wave'));
    expect(phases[impactAt]).toBe('setup');
    expect(completedAt).toBe(impactAt + 1);
    expect(resolved).toEqual({ hits: 0, kills: 0 });
    // No countdown while the wave ran, 10 s once it was over
    expect(countdown.slice(0, completedAt).filter((s) => s !== undefined && s !== null)).toEqual([]);
    expect(store.autoWaveSecondsLeft()).toBe(AUTO_WAVE_DELAY_MS / 1000);

    // The next wave starts once, 10 s of game time after the explosion
    while (startWave.mock.calls.length === 0 && gsm.gameTimeMs < impactGameTime + 2 * AUTO_WAVE_DELAY_MS) frame();
    expect(startWave).toHaveBeenCalledTimes(1);
    expect(gsm.gameTimeMs - impactGameTime).toBeGreaterThanOrEqual(AUTO_WAVE_DELAY_MS - STEP_MS);
    expect(gsm.gameTimeMs - impactGameTime).toBeLessThan(AUTO_WAVE_DELAY_MS + 2 * STEP_MS);
  });
});
