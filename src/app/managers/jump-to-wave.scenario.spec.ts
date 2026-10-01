import { beforeEach, describe, it, expect, vi } from 'vitest';

// Mock three.js
vi.mock('three', async () => await import('@/test/mocks/three.mock'));

// inject() hands out the stubs below by class name, as in game-state.manager.spec.ts
const mockServices: Record<string, unknown> = {};
vi.mock('@angular/core', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@angular/core');
  return {
    ...actual,
    Injectable: () => (target: unknown) => target,
    effect: vi.fn(),
    inject: (token: { name?: string }) => {
      const name = token?.name ?? 'unknown';
      if (!mockServices[name]) {
        mockServices[name] = createStubService(name);
      }
      return mockServices[name];
    },
  };
});

const HQ = { lat: 48.77, lon: 9.18 };
/** Where the route grid snaps an ability's target to */
const ROUTE_CELL = { lat: 48.771, lon: 9.181 };

/** The stubs of game-state.manager.spec.ts, plus the route grid and combat an ability uses and the place a record is kept for */
function createStubService(name: string): Record<string, unknown> {
  const stubs: Record<string, Record<string, unknown>> = {
    SimCoords: createTestCoords() as unknown as Record<string, unknown>,
    SimOps: createTestOps() as unknown as Record<string, unknown>,
    GlobalRouteGridService: {
      clear: vi.fn(),
      initialize: vi.fn(),
      isInitialized: vi.fn().mockReturnValue(false),
      generateFromRoutes: vi.fn(),
      unregisterTower: vi.fn(),
      snapToRouteCell: vi.fn().mockReturnValue(ROUTE_CELL),
      getEnemiesInRadiusGeo: vi.fn((_c: unknown, _r: number, _f: unknown, out: unknown[]) => {
        out.length = 0;
        return out;
      }),
    },
    CombatEffectService: {
      initialize: vi.fn(),
      applyAbilityStrike: vi.fn().mockReturnValue(0),
      resetAbilityDamage: vi.fn(),
    },
    StatusEffectService: {
      setGameClockProvider: vi.fn(),
      applySlow: vi.fn(),
      applyPoison: vi.fn(),
      applyEffect: vi.fn(),
      removeExpired: vi.fn(),
      hasActiveEffect: vi.fn().mockReturnValue(false),
    },
    TowerCombatService: {
      initialize: vi.fn(),
      turnTowersToGuard: vi.fn(),
      turnToGuardHeading: vi.fn(),
      updateTowerShooting: vi.fn(),
      updateBeamTowers: vi.fn(),
      updateMeleeTowers: vi.fn(),
      updateChainTowers: vi.fn(),
      stopAllBeams: vi.fn(),
      stopAllMelee: vi.fn(),
    },
    SpatialGridService: {
      updateEnemy: vi.fn(),
      removeEnemy: vi.fn(),
      hasEnemyInRadius: vi.fn().mockReturnValue(false),
      getEnemyIdsInRadius: vi.fn().mockReturnValue([]),
      clear: vi.fn(),
      getEnemyGrid: vi.fn().mockReturnValue({ size: 0 }),
    },
    EconomyService: {
      computeWaveCompletionBonus: vi.fn().mockReturnValue(0),
      reset: vi.fn(),
      perfectStreak: 0,
    },
    LocationManagementService: {
      hq: signal(HQ),
      spawns: signal([{ lat: 48.78, lon: 9.18 }]),
      displayName: signal('Marktplatz 1, Stuttgart'),
      address: signal({ city: 'Stuttgart' }),
    },
    GeocodingService: {
      extractLocationName: (a: { city?: string }) => a.city ?? 'Unknown',
    },
  };
  return stubs[name] ?? {};
}

import { signal } from '@angular/core';
import { GameStateManager } from './game-state.manager';
import { GameEventBus, SubscriptionBag } from '../game-engine/game-event-bus';
import type { MainEventBus } from '../sim/client/view-events';
import { ABILITIES } from '../configs/abilities.config';
import { Tower } from '../entities/tower.entity';
import { abilityButtonView } from '../components/ability-bar/ability-button';
import { skippedWavesGold } from '../services/economy.service';
import { RunLogCollector } from '../run-log/run-log.service';
import { runSummary } from '../run-log/run-summary';
import { BestWaveService } from '../services/location/best-wave.service';
import { createTestCoords, createTestOps } from '../integration/test-helpers';
import { GameClock } from './game-state/game-clock';

/** GameClock.FIXED_STEP_MS: the length of one gameplay sub-step. */
const STEP_MS = GameClock.FIXED_STEP_MS;
const NUKE = ABILITIES['nuclear-strike'];

/**
 * Playtest 381 and 382 (docs/archive/REVIEW_SPRINT_2026-09-14.md) replayed with the
 * real GameStateManager: its jumpToWave, its AbilityManager, and the
 * `wave:jumped` and `credits:changed` it sends read by the real run tally
 * (the run log behind the game-over summary) and the real BestWaveService (the
 * world map's records).
 */
describe('Dev wave jump, playtest 381 and 382 replayed', () => {
  let gsm: GameStateManager;
  let bus: GameEventBus;

  beforeEach(() => {
    localStorage.clear();
    Object.keys(mockServices).forEach((k) => delete mockServices[k]);
    gsm = new GameStateManager();
    gsm.initialize({ ...HQ, height: 0 }, [{ id: 'sp-1', name: 'North', lat: 48.78, lon: 9.18, height: 0 }] as never[], new Map());
    bus = gsm.getEventBus();
    // The strike's launch site
    gsm.towerManager.add(new Tower({ ...HQ, height: 0 }, 'missile-silo'));
  });

  it('381: the strike used in W1, W1 over, a jump over 3 waves: the bar shows the charge full again', () => {
    const status = () => gsm.abilityManager.getStatus('nuclear-strike');
    const button = () => abilityButtonView(NUKE, status(), gsm.phase() === 'wave', false);
    bus.emit({ type: 'debug:ready-ability', abilityId: 'nuclear-strike' });

    // W1 runs, the strike goes out and lands in game-time sub-steps
    gsm.waveManager.waveNumber.set(1);
    gsm.waveManager.phase.set('wave');
    bus.emit({ type: 'command:use-ability', abilityId: 'nuclear-strike', target: ROUTE_CELL });
    expect(status().charges).toBe(0);
    for (let t = 0; t < NUKE.warningMs + 500; t += STEP_MS) gsm.abilityManager.update(STEP_MS);
    expect(status().pending).toBe(false);

    // W1 is over, as WaveManager ends it
    gsm.waveManager.phase.set('setup');
    bus.emit({ type: 'wave:completed', wave: 1, credits: 0, perfect: true, closeCall: false, hpLost: 0 });
    expect(button()).toMatchObject({ state: 'recharging', pips: [true, false, false], status: 'recharges in 2 waves' });

    // Jump: next start W5, W2 to W4 skipped
    expect(gsm.jumpToWave(5, true)).toBe(true);
    expect(status().charges).toBe(NUKE.maxCharges);
    expect(button()).toMatchObject({ state: 'waiting', pips: [true, true, true], status: 'ready, fires during a wave' });
  });

  it('381, counter-check: a jump over one wave only is one wave toward the charge', () => {
    const status = () => gsm.abilityManager.getStatus('nuclear-strike');
    bus.emit({ type: 'debug:ready-ability', abilityId: 'nuclear-strike' });
    gsm.waveManager.waveNumber.set(1);
    gsm.waveManager.phase.set('wave');
    bus.emit({ type: 'command:use-ability', abilityId: 'nuclear-strike', target: ROUTE_CELL });
    gsm.waveManager.phase.set('setup');
    bus.emit({ type: 'wave:completed', wave: 1, credits: 0, perfect: true, closeCall: false, hpLost: 0 });

    gsm.jumpToWave(3, true);
    expect(status()).toMatchObject({ charges: 0, wavesUntilCharge: 1 });
  });

  it('382: a place with W5, restart, jump to 35, game over: no record hint, the map keeps W5, "Earned" leaves the jump gold out', () => {
    const log = new RunLogCollector();
    const bag = new SubscriptionBag();
    // One thread, one bus: the simulation's events reach the main side as they are
    const mainBus = bus as unknown as MainEventBus;
    log.attach(mainBus, bag);
    log.open({ seed: 1, map: 'devworld', player: 'human' }, {
      step: () => 0,
      timeMs: () => 0,
      credits: () => gsm.credits(),
      baseHealth: () => gsm.baseHealth(),
      enemiesAlive: () => 0,
      dps: () => 0,
      towers: () => [],
    });
    const best = new BestWaveService();
    best.connect(mainBus, () => true);

    // An earlier run reached W5 here
    for (let wave = 1; wave <= 5; wave++) bus.emit({ type: 'wave:started', wave, enemyCount: 10 });
    expect(best.records()[0].bestWave).toBe(5);

    gsm.reset();
    bus.emit({ type: 'game:reset' });
    const credits = gsm.credits();
    expect(gsm.jumpToWave(35, true)).toBe(true);
    const jumpGold = skippedWavesGold(1, 34);
    expect(gsm.credits()).toBe(credits + jumpGold);

    bus.emit({ type: 'wave:started', wave: 35, enemyCount: 1 });
    // A kill reward of the run's own
    bus.emit({ type: 'credits:changed', credits: credits + jumpGold + 40, delta: 40 , source: 'kill', playerId: 'local', local: true });
    bus.emit({ type: 'game:over', reason: 'base-destroyed' });

    expect(best.newRecord()).toBeNull();
    expect(best.records()).toHaveLength(1);
    expect(best.records()[0].bestWave).toBe(5);
    log.flushOpenWave();
    expect(runSummary(log.current(), 0, (type) => type))
      .toMatchObject({ waveReached: 35, goldEarned: 40 });

    bag.disposeAll();
    best.disconnect();
  });
});
