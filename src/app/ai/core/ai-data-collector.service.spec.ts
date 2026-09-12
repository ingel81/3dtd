import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Injector, runInInjectionContext, signal } from '@angular/core';

import { AIDataCollectorService } from './ai-data-collector.service';
import { computePathDPSProfile, createEmptyDPSProfile, type PathDPSProfile } from './dps-profile';
import { calculateWaveThreat } from './game-state-encoder';
import type { WaveConfig } from './models/wave-config';
import type { WaveResult } from './models/wave-result';
import { GameEventBus, type GameEvent } from '../../game-engine/game-event-bus';
import { GameStateManager } from '../../managers/game-state.manager';
import { TowerDefenseStore } from '../../store/tower-defense.store';
import { ResearchStore } from '../../store/research.store';
import { GlobalRouteGridService } from '../../services/world/global-route-grid.service';
import { ComponentType } from '../../core/component';
import { RESEARCH_TREE } from '../../configs/research/research-tree.config';
import { TOWER_TYPES } from '../../configs/tower-types.config';
import type { Enemy } from '../../entities/enemy.entity';

/**
 * Characterization of the collector: which events it listens to, what a wave
 * result contains, how the game-over path and the history behave, and what a
 * snapshot is built from. Nothing else in the suite constructs the real
 * service; the director specs use a stub in its place.
 *
 * Only the DPS-profile computation is replaced, so the cache in front of it
 * can be observed.
 */

vi.mock('./dps-profile', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./dps-profile')>();
  return { ...actual, computePathDPSProfile: vi.fn() };
});

const SUBSCRIBED: GameEvent['type'][] = [
  'wave:started', 'wave:completed', 'enemy:spawned', 'enemy:died', 'enemy:reached-base',
  'health:changed', 'game:started', 'game:over', 'tower:placed', 'tower:sold', 'tower:upgraded',
];

const DEFAULT_CONFIG: WaveConfig = { enemies: [{ type: 'zombie', count: 10 }], totalCount: 10, spawnDelay: 800 };

function enemy(id: string, type = 'zombie', progress?: number): Enemy {
  const movement = progress === undefined ? undefined : { getPathProgress: () => progress };
  return {
    id,
    typeConfig: { id: type },
    getComponent: (t: ComponentType) => (t === ComponentType.MOVEMENT ? movement : undefined),
  } as unknown as Enemy;
}

describe('AIDataCollectorService', () => {
  let bus: GameEventBus;
  let collector: AIDataCollectorService;
  let timescale: number;
  let routes: { lat: number; lon: number; height: number }[][];
  let store: {
    waveNumber: ReturnType<typeof signal<number>>;
    phase: ReturnType<typeof signal<string>>;
    baseHealth: ReturnType<typeof signal<number>>;
    credits: ReturnType<typeof signal<number>>;
  };
  let research: {
    airTargetingUnlocked: ReturnType<typeof signal<boolean>>;
    completedResearches: ReturnType<typeof signal<Set<string>>>;
    activeResearches: ReturnType<typeof signal<{ researchId: string }[]>>;
    centerLevel: ReturnType<typeof signal<number>>;
    researchSlots: ReturnType<typeof signal<number>>;
    maxUpgradeTier: ReturnType<typeof signal<number>>;
    isTowerUnlocked: (id: string) => boolean;
  };
  let grid: {
    getDefenseReachPercent: ReturnType<typeof vi.fn>;
    getGrid: ReturnType<typeof vi.fn>;
    getCoordinateSync: ReturnType<typeof vi.fn>;
    isInitialized: ReturnType<typeof vi.fn>;
  };

  const advance = (ms: number) => vi.setSystemTime(Date.now() + ms);
  const emit = (event: GameEvent) => bus.emit(event);
  const completed = (wave: number, hpLost = 0): GameEvent =>
    ({ type: 'wave:completed', wave, credits: 0, perfect: hpLost === 0, closeCall: false, hpLost });

  function createCollector(): AIDataCollectorService {
    const gameState = {
      getEventBus: () => bus,
      towerManager: { getAll: () => [] },
      trainingTimescale: () => timescale,
      getCachedRoutes: () => routes,
    };
    const injector = Injector.create({
      providers: [
        { provide: GameStateManager, useValue: gameState },
        { provide: TowerDefenseStore, useValue: store },
        { provide: ResearchStore, useValue: research },
        { provide: GlobalRouteGridService, useValue: grid },
      ],
    });
    return runInInjectionContext(injector, () => new AIDataCollectorService());
  }

  /** A whole wave: every progress value below 1 dies, 1 reaches the base. */
  function playWave(wave: number, opts: { progress?: number[]; hpLost?: number; config?: WaveConfig } = {}): void {
    const { progress = [], hpLost = 0, config } = opts;
    if (config) collector.setCurrentWaveConfig(config);
    emit({ type: 'wave:started', wave, enemyCount: progress.length });
    progress.forEach((p, i) => {
      const e = enemy(`w${wave}-${i}`, 'zombie', p);
      emit({ type: 'enemy:spawned', enemy: e });
      if (p >= 1) emit({ type: 'enemy:reached-base', enemy: e, damage: 1 });
      else emit({ type: 'enemy:died', enemy: e, credits: 1 });
    });
    if (hpLost > 0) {
      store.baseHealth.update((h) => h - hpLost);
      emit({ type: 'health:changed', health: store.baseHealth(), delta: -hpLost });
    }
    advance(1000);
    emit(completed(wave, hpLost));
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_000_000);
    bus = new GameEventBus();
    timescale = 1;
    routes = [];
    store = { waveNumber: signal(0), phase: signal('setup'), baseHealth: signal(100), credits: signal(250) };
    research = {
      airTargetingUnlocked: signal(false),
      completedResearches: signal(new Set<string>()),
      activeResearches: signal([]),
      centerLevel: signal(0),
      researchSlots: signal(1),
      maxUpgradeTier: signal(1),
      isTowerUnlocked: (id: string) => id === 'archer',
    };
    grid = {
      getDefenseReachPercent: vi.fn(() => 0.4),
      getGrid: vi.fn(() => null),
      getCoordinateSync: vi.fn(() => null),
      isInitialized: vi.fn(() => false),
    };
    vi.mocked(computePathDPSProfile).mockReset();
    collector = createCollector();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('subscriptions', () => {
    it('subscribes to the game events on construction', () => {
      expect(collector.isCollecting()).toBe(true);
      for (const type of SUBSCRIBED) expect(bus.hasListeners(type)).toBe(true);
      expect(bus.getListenerCount()).toBe(SUBSCRIBED.length);
    });

    it('ignores events after stopCollecting', () => {
      collector.stopCollecting();

      expect(collector.isCollecting()).toBe(false);
      expect(bus.getListenerCount()).toBe(0);
      playWave(1, { progress: [0.5] });
      expect(collector.getWaveHistory()).toEqual([]);
    });

    it('subscribes once, and again after a stop', () => {
      collector.startCollecting();
      expect(bus.getListenerCount()).toBe(SUBSCRIBED.length);

      collector.stopCollecting();
      collector.startCollecting();
      expect(bus.getListenerCount()).toBe(SUBSCRIBED.length);
      playWave(1);
      expect(collector.getWaveHistory()).toHaveLength(1);
    });
  });

  describe('a completed wave', () => {
    /**
     * t=0 wave 3 starts at 80 HP, two zombies spawn; t=1000 two tanks spawn;
     * t=1500 zombie a dies at 40%; t=2500 zombie b dies at 90%; t=2800 tank c
     * reaches the base and costs 5 HP (nominal 50); t=3000 the wave completes
     * with tank d still alive.
     */
    function playScriptedWave(): void {
      store.baseHealth.set(80);
      emit({ type: 'wave:started', wave: 3, enemyCount: 4 });
      const [a, b, c, d] = [enemy('a', 'zombie', 0.4), enemy('b', 'zombie', 0.9), enemy('c', 'tank'), enemy('d', 'tank')];
      emit({ type: 'enemy:spawned', enemy: a });
      emit({ type: 'enemy:spawned', enemy: b });
      advance(1000);
      emit({ type: 'enemy:spawned', enemy: c });
      emit({ type: 'enemy:spawned', enemy: d });
      advance(500);
      emit({ type: 'enemy:died', enemy: a, credits: 5 });
      advance(1000);
      emit({ type: 'enemy:died', enemy: b, credits: 5 });
      advance(300);
      emit({ type: 'enemy:reached-base', enemy: c, damage: 50 });
      emit({ type: 'health:changed', health: 75, delta: -5 });
      advance(200);
      emit(completed(3, 5));
    }

    it('records what happened', () => {
      const heard: WaveResult[] = [];
      collector.onWaveResult((r) => heard.push(r));

      playScriptedWave();

      const [result] = collector.getWaveHistory();
      expect(heard).toEqual([result]);
      expect(collector.waveResultCount()).toBe(1);
      expect(result.waveNumber).toBe(3);
      expect(result.timestamp).toBe(Date.now());
      expect(result.config).toEqual(DEFAULT_CONFIG);
      expect(result.outcome).toMatchObject({
        enemiesSpawned: 4,
        enemiesKilled: 2,
        enemiesReachedBase: 1,
        damageToPlayer: 5,                     // the health delta, not the nominal 50
        damagePercent: 0.05,
        lowestPlayerHealth: 75,
        wasCloseCall: false,
        playerSurvived: true,
        waveDurationMs: 3000,
        enemyProgressValues: [0.4, 0.9, 1],     // tank d never reported progress
      });
      expect(result.outcome.avgPathProgressPercent).toBeCloseTo(2.3 / 3, 10);
      // Measured from each spawn to the END of the wave, not to the death:
      // (3000 + 3000 + 2000 + 2000) / 4.
      expect(result.outcome.avgEnemyLifetimeMs).toBe(2500);
      expect(result.outcome.enemyPerformance).toEqual({
        zombie: { spawned: 2, killed: 2, reachedBase: 0, avgLifetimeMs: 2000, totalDamageDealt: 0 },
        tank: { spawned: 2, killed: 0, reachedBase: 1, avgLifetimeMs: 0, totalDamageDealt: 0 },
      });
    });

    it('divides the time metrics by the training timescale', () => {
      timescale = 4;
      playScriptedWave();

      const { outcome } = collector.getWaveHistory()[0];
      expect(outcome.waveDurationMs).toBe(750);
      expect(outcome.avgEnemyLifetimeMs).toBe(625);
      expect(outcome.enemyPerformance['zombie'].avgLifetimeMs).toBe(500);
    });

    it('reports an empty wave with zeroed progress', () => {
      playWave(1);
      const { outcome } = collector.getWaveHistory()[0];
      expect(outcome.enemyProgressValues).toEqual([]);
      expect(outcome.avgPathProgressPercent).toBe(0);
      expect(outcome.avgEnemyLifetimeMs).toBe(0);
    });

    it('calls a wave a close call below 30% of start health', () => {
      playWave(1, { hpLost: 70 });                  // ends at 30
      playWave(2, { hpLost: 1 });                   // ends at 29
      expect(collector.getWaveHistory().map((r) => r.outcome.wasCloseCall)).toEqual([false, true]);
    });

    it('uses the config the director set, for that wave only', () => {
      const config: WaveConfig = { enemies: [{ type: 'tank', count: 3 }], totalCount: 3, spawnDelay: 500 };
      playWave(1, { config });
      playWave(2);
      expect(collector.getWaveHistory().map((r) => r.config)).toEqual([config, DEFAULT_CONFIG]);
    });
  });

  describe('game over', () => {
    it('finalises the fatal wave and ignores its late wave:completed', () => {
      const heard: WaveResult[] = [];
      collector.onWaveResult((r) => heard.push(r));

      emit({ type: 'wave:started', wave: 5, enemyCount: 1 });
      const e = enemy('e', 'zombie');
      emit({ type: 'enemy:spawned', enemy: e });
      advance(2000);
      emit({ type: 'enemy:reached-base', enemy: e, damage: 100 });
      emit({ type: 'health:changed', health: 0, delta: -100 });
      emit({ type: 'game:over', reason: 'base-destroyed' });

      expect(heard).toHaveLength(1);
      expect(heard[0].waveNumber).toBe(5);
      expect(heard[0].outcome).toMatchObject({
        playerSurvived: false,
        wasCloseCall: true,
        lowestPlayerHealth: 0,
        waveDurationMs: 2000,
        enemyProgressValues: [1],
        avgPathProgressPercent: 1,
        damagePercent: 1,
      });

      emit(completed(5, 100));
      expect(collector.getWaveHistory()).toHaveLength(1);
      expect(collector.waveResultCount()).toBe(1);

      // The guard is one-shot: the next wave is recorded again.
      playWave(6);
      expect(collector.getWaveHistory().map((r) => r.waveNumber)).toEqual([5, 6]);
    });

    it('records nothing when the player quits', () => {
      emit({ type: 'wave:started', wave: 2, enemyCount: 0 });
      emit({ type: 'game:over', reason: 'quit' });
      expect(collector.getWaveHistory()).toEqual([]);
    });

    it('records nothing when the base falls before the first wave', () => {
      emit({ type: 'game:over', reason: 'base-destroyed' });
      expect(collector.getWaveHistory()).toEqual([]);
    });
  });

  describe('history', () => {
    it('keeps the last ten waves', () => {
      for (let w = 1; w <= 12; w++) playWave(w);

      expect(collector.getWaveHistory().map((r) => r.waveNumber)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
      expect(collector.getRecentWaveResults().map((r) => r.waveNumber)).toEqual([8, 9, 10, 11, 12]);
      expect(collector.getRecentWaveResults(3).map((r) => r.waveNumber)).toEqual([10, 11, 12]);
      expect(collector.waveResultCount()).toBe(12);
    });

    it('hands out a copy of the history', () => {
      playWave(1);
      collector.getWaveHistory().pop();
      expect(collector.getWaveHistory()).toHaveLength(1);
    });

    it('clears the history on game:started and on clearHistory()', () => {
      playWave(1);
      emit({ type: 'game:started' });
      expect(collector.getWaveHistory()).toEqual([]);
      expect(collector.waveResultCount()).toBe(0);

      playWave(1);
      collector.clearHistory();
      expect(collector.getWaveHistory()).toEqual([]);
      expect(collector.getStateSnapshot().recentHistory.damagePerWave).toEqual([]);
    });

    it('stops notifying an unsubscribed listener', () => {
      const listener = vi.fn();
      const unsubscribe = collector.onWaveResult(listener);
      playWave(1);
      unsubscribe();
      playWave(2);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('keeps the entry and the other listeners when one listener throws', () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const after = vi.fn();
      collector.onWaveResult(() => { throw new Error('boom'); });
      collector.onWaveResult(after);

      playWave(1);

      expect(after).toHaveBeenCalledTimes(1);
      expect(collector.getWaveHistory()).toHaveLength(1);
      expect(console.error).toHaveBeenCalled();
    });

    it('recentAvgDamage is evaluated once and does not follow new waves', () => {
      // Current behaviour: the computed reads plain arrays, not signals, so it
      // caches the value of its first read.
      expect(collector.recentAvgDamage()).toBe(0);
      playWave(1, { hpLost: 20 });
      expect(collector.recentAvgDamage()).toBe(0);

      const late = createCollector();
      playWave(1, { hpLost: 20 });
      expect(late.recentAvgDamage()).toBeCloseTo(0.2, 10);
    });
  });

  describe('getStateSnapshot', () => {
    it('reads meta and player state from the store', () => {
      emit({ type: 'game:started' });
      advance(90_000);
      store.waveNumber.set(4);
      store.phase.set('wave');
      store.baseHealth.set(60);

      const snapshot = collector.getStateSnapshot();

      expect(snapshot.timestamp).toBe(Date.now());
      expect(snapshot.waveNumber).toBe(4);
      expect(snapshot.phase).toBe('wave');
      expect(snapshot.gameTimeSeconds).toBe(90);
      expect(snapshot.player).toEqual({ credits: 250, lives: 60, maxLives: 100, livesPercent: 0.6 });
      expect(snapshot.defense.defenseReachPercent).toBe(0.4);
      expect(grid.getDefenseReachPercent).toHaveBeenCalledWith(routes);
      expect(snapshot.dpsByDamageType).toBeDefined();
      expect(collector.lastSnapshot()).toBe(snapshot);
    });

    it('builds the research snapshot from the research store', () => {
      research.completedResearches.set(new Set(['gatling-tech']));
      research.activeResearches.set([{ researchId: 'cannon-tech' }]);
      research.centerLevel.set(2);
      research.researchSlots.set(3);
      research.maxUpgradeTier.set(2);
      research.airTargetingUnlocked.set(true);

      const { research: snap } = collector.getStateSnapshot();

      expect(snap).toMatchObject({
        completedIds: ['gatling-tech'],
        completedCount: 1,
        totalCount: Object.keys(RESEARCH_TREE).length,
        activeIds: ['cannon-tech'],
        centerLevel: 2,
        slotsUsed: 1,
        maxSlots: 3,
        airTargetingUnlocked: true,
        maxUpgradeTier: 2,
      });
      expect(Object.keys(snap.towerUnlocked).sort()).toEqual(Object.keys(TOWER_TYPES).sort());
      expect(Object.entries(snap.towerUnlocked).filter(([, on]) => on).map(([id]) => id)).toEqual(['archer']);
    });

    it('summarises the recent waves', () => {
      const config: WaveConfig = { enemies: [{ type: 'tank', count: 2 }, { type: 'zombie', count: 8 }], totalCount: 10, spawnDelay: 400 };
      playWave(1, { progress: [0.5, 0.85, 1], hpLost: 75 });   // ends at 25: close call
      playWave(2, { progress: [0.2] });
      playWave(3, { progress: [0.9, 0.95], config });

      const history = collector.getStateSnapshot().recentHistory;

      expect(history.damagePerWave).toEqual([0.75, 0, 0]);
      expect(history.progressPerWave[0]).toBeCloseTo(2.35 / 3, 10);
      expect(history.progressPerWave.slice(1)).toEqual([0.2, 0.925]);
      expect(history.nearMissPerWave).toEqual([2 / 3, 0, 1]);
      expect(history.enemyTypesUsed).toEqual([['zombie'], ['zombie'], ['tank', 'zombie']]);
      expect(history.lastWaveThreat).toBe(calculateWaveThreat(config));
      expect(history.avgWaveDuration).toBe(1);
      expect(history.winStreak).toBe(2);
      // Health never comes back, so the two waves after the close call start
      // below 30% and count as close calls too, although they cost nothing.
      expect(history.closeCallStreak).toBe(3);
    });

    it('counts trailing close calls', () => {
      playWave(1, { hpLost: 75 });
      store.baseHealth.set(100);                  // debug heal: wave 2 starts healthy
      playWave(2);
      store.baseHealth.set(20);
      playWave(3);
      playWave(4);
      expect(collector.getStateSnapshot().recentHistory.closeCallStreak).toBe(2);
    });

    describe('expected armor distribution', () => {
      const zeroes = { unarmored: 0, light: 0, heavy: 0, fortified: 0, ethereal: 0 };

      it('weights the running wave by enemy count', () => {
        collector.setCurrentWaveConfig({
          enemies: [{ type: 'zombie', count: 3 }, { type: 'tank', count: 1 }],
          totalCount: 4,
          spawnDelay: 500,
        });
        expect(collector.getStateSnapshot().expectedArmorDistribution)
          .toEqual({ ...zeroes, unarmored: 0.75, heavy: 0.25 });
      });

      it('counts an unknown enemy type as a zombie', () => {
        // getEnemyType falls back to the zombie config, so the armor lookup
        // never comes up empty.
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        collector.setCurrentWaveConfig({
          enemies: [{ type: 'tank', count: 1 }, { type: 'no-such-enemy', count: 3 }],
          totalCount: 4,
          spawnDelay: 500,
        });
        expect(collector.getStateSnapshot().expectedArmorDistribution)
          .toEqual({ ...zeroes, unarmored: 0.75, heavy: 0.25 });
      });

      it('falls back to the curriculum template of the next wave between waves', () => {
        store.waveNumber.set(0);                    // next: Zombie Horde, all unarmored
        expect(collector.getStateSnapshot().expectedArmorDistribution).toEqual({ ...zeroes, unarmored: 1 });
      });

      it('is undefined past the curriculum with no wave running', () => {
        store.waveNumber.set(30);
        expect(collector.getStateSnapshot().expectedArmorDistribution).toBeUndefined();
      });
    });

    describe('DPS profile', () => {
      const computed: PathDPSProfile = { groundDPS: [7], airDPS: [3], binPositions: [] };
      const gridObject = { cells: [] };
      const sync = { origin: 'here' };

      function readyGrid(): void {
        grid.isInitialized.mockReturnValue(true);
        grid.getGrid.mockReturnValue(gridObject);
        grid.getCoordinateSync.mockReturnValue(sync);
        routes.push([{ lat: 48.7, lon: 9.1, height: 300 }]);
        vi.mocked(computePathDPSProfile).mockReturnValue(computed);
      }

      it('is empty while the route grid is not ready', () => {
        expect(collector.getStateSnapshot().dpsProfile).toEqual(createEmptyDPSProfile());
        expect(computePathDPSProfile).not.toHaveBeenCalled();
      });

      it('is empty with a ready grid but no routes', () => {
        readyGrid();
        routes.length = 0;
        expect(collector.getCurrentDPSProfile()).toEqual(createEmptyDPSProfile());
        expect(computePathDPSProfile).not.toHaveBeenCalled();
      });

      it('computes once and serves the cache until the towers change', () => {
        readyGrid();

        expect(collector.getStateSnapshot().dpsProfile).toBe(computed);
        expect(collector.getCurrentDPSProfile()).toBe(computed);
        expect(computePathDPSProfile).toHaveBeenCalledTimes(1);
        expect(computePathDPSProfile).toHaveBeenCalledWith(routes, gridObject, [], sync, false);

        const events = [
          { type: 'tower:placed' }, { type: 'tower:sold' }, { type: 'tower:upgraded' },
        ] as unknown as GameEvent[];
        for (const event of events) {
          emit(event);
          collector.getCurrentDPSProfile();
        }
        expect(computePathDPSProfile).toHaveBeenCalledTimes(1 + events.length);
      });

      it('recomputes when anti-air targeting unlocks', () => {
        readyGrid();
        collector.getCurrentDPSProfile();
        research.airTargetingUnlocked.set(true);
        collector.getCurrentDPSProfile();

        expect(computePathDPSProfile).toHaveBeenCalledTimes(2);
        expect(vi.mocked(computePathDPSProfile).mock.calls[1][4]).toBe(true);
      });
    });
  });
});
