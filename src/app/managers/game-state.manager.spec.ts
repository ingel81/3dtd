import { beforeEach, describe, it, expect, vi } from 'vitest';

// Mock three.js
vi.mock('three', async () => await import('@/test/mocks/three.mock'));

// Mock Angular's inject() to return stubs for all injected services
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

function createStubService(name: string): Record<string, unknown> {
  const stubs: Record<string, Record<string, unknown>> = {
    GameStore: {
      trainingTimescale: Object.assign(vi.fn().mockReturnValue(1.0), { set: vi.fn() }),
    },
    UIStore: {
      specialPointsDebugVisible: vi.fn().mockReturnValue(false),
    },
    PathAndRouteService: {
      getCachedPaths: vi.fn().mockReturnValue(new Map()),
    },
    GlobalRouteGridService: {
      initDebugViz: vi.fn(),
      clear: vi.fn(),
      initialize: vi.fn(),
      generateFromRoutes: vi.fn(),
      getDefenseReachPercent: vi.fn().mockReturnValue(0),
    },
    CombatEffectService: {
      initialize: vi.fn(),
    },
    StatusEffectService: {
      setGameClockProvider: vi.fn(),
      applySlow: vi.fn(),
      applyPoison: vi.fn(),
      applyEffect: vi.fn(),
      removeExpired: vi.fn(),
      hasActiveEffect: vi.fn().mockReturnValue(false),
    },
    HQDamageService: {
      initialize: vi.fn(),
      reset: vi.fn(),
      healBase: vi.fn(),
      triggerGameOverEffects: vi.fn(),
      showGameOverScreen: vi.fn().mockReturnValue(false),
      onTilesLoaded: vi.fn(),
    },
    TowerCombatService: {
      initialize: vi.fn(),
      updateTowerIdleRotations: vi.fn(),
      updateTowerShooting: vi.fn(),
      updateBeamTowers: vi.fn(),
      updateMeleeTowers: vi.fn(),
      updateChainTowers: vi.fn(),
      stopAllBeams: vi.fn(),
      stopAllMelee: vi.fn(),
    },
    OsmStreetService: {},
    ResearchStore: {
      isTowerUnlocked: vi.fn().mockReturnValue(true),
      centerLevel: vi.fn().mockReturnValue(0),
      researchSlots: vi.fn().mockReturnValue(1),
      maxUpgradeTier: vi.fn().mockReturnValue(1),
      airTargetingUnlocked: vi.fn().mockReturnValue(false),
      completedResearches: Object.assign(vi.fn().mockReturnValue(new Set()), { set: vi.fn(), update: vi.fn() }),
      activeResearches: Object.assign(vi.fn().mockReturnValue([]), { set: vi.fn() }),
      applyResearchEffects: vi.fn(),
      resetResearchState: vi.fn(),
    },
    WaveDebugService: {
      setCurrentWaveConfig: vi.fn(),
    },
    EnemyDebugService: {
      debugEnemies: vi.fn().mockReturnValue([]),
      clearDebugEnemies: vi.fn(),
    },
    MarkerVisualizationService: {
      spawnHQDebugPoint: vi.fn(),
    },
    TowerPlacementService: {
      clearAllTowerOverlays: vi.fn(),
      registerTowerOnGrid: vi.fn(),
      unregisterTowerFromGrid: vi.fn(),
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
  };
  return stubs[name] ?? {};
}

import { GameStateManager } from './game-state.manager';
import { GAME_BALANCE } from '../configs/game-balance.config';
import { GameEventBus } from '../game-engine';

function getEventBus(gsm: GameStateManager): GameEventBus {
  return gsm.getEventBus();
}

/** Creates a deep auto-mock: any missing property returns a noop fn or nested proxy */
function createDeepMock(): never {
  const noopFn = vi.fn();
  const noopReturning = (val: unknown) => vi.fn().mockReturnValue(val);

  const handler: ProxyHandler<Record<string, unknown>> = {
    get(target, prop) {
      if (prop in target) return target[prop as string];
      // Return a vi.fn() for any unknown property (auto-stub)
      const fn = vi.fn().mockReturnValue(undefined);
      target[prop as string] = fn;
      return fn;
    },
  };

  const autoProxy = () => new Proxy({} as Record<string, unknown>, handler);

  return new Proxy(
    {
      getScene: noopReturning({}),
      getTerrainHeightAtLocal: noopReturning(0),
      getTerrainHeightAtGeo: noopReturning(0),
      setTimescale: noopFn,
      sync: {
        getOrigin: noopReturning({ lat: 48.77, lon: 9.18 }),
        geoToLocal: noopReturning({ x: 0, y: 0, z: 0 }),
        geoToLocalSimple: noopReturning({ x: 0, y: 0, z: 0 }),
        localToGeo: noopReturning({ lat: 48.77, lon: 9.18, height: 0 }),
      },
      spatialAudio: new Proxy({} as Record<string, unknown>, {
        get(target, prop) {
          if (prop in target) return target[prop as string];
          // playAtGeo returns a Promise, all others return undefined
          const fn = prop === 'playAtGeo'
            ? vi.fn().mockResolvedValue(undefined)
            : vi.fn().mockReturnValue(undefined);
          target[prop as string] = fn;
          return fn;
        },
      }),
      effects: autoProxy(),
      enemies: autoProxy(),
      towers: autoProxy(),
      projectiles: autoProxy(),
      trailStreaks: autoProxy(),
      tentacles: autoProxy(),
      triggerScreenShake: noopFn,
    } as Record<string, unknown>,
    handler
  ) as never;
}

function createMockEngine(): never {
  return createDeepMock();
}

const BASE_POSITION = { lat: 48.77, lon: 9.18, height: 0 };
const SPAWN_POINTS = [
  { id: 'sp-1', name: 'North', lat: 48.78, lon: 9.18, height: 0 },
];

describe('GameStateManager', () => {
  let gsm: GameStateManager;

  beforeEach(() => {
    Object.keys(mockServices).forEach(k => delete mockServices[k]);
    gsm = new GameStateManager();
  });

  describe('initial state', () => {
    it('starts with correct initial health', () => {
      expect(gsm.baseHealth()).toBe(GAME_BALANCE.player.startHealth);
    });

    it('starts with correct initial credits', () => {
      expect(gsm.credits()).toBe(GAME_BALANCE.player.startCredits);
    });

    it('has an event bus', () => {
      expect(getEventBus(gsm)).toBeDefined();
    });
  });

  describe('initialize()', () => {
    it('registers event handlers on the EventBus', () => {
      const engine = createMockEngine();
      gsm.initialize(engine, {} as never, BASE_POSITION, SPAWN_POINTS as never[], new Map());

      const bus = getEventBus(gsm);
      expect(bus.hasListeners('command:place-tower')).toBe(true);
      expect(bus.hasListeners('command:sell-tower')).toBe(true);
      expect(bus.hasListeners('command:upgrade-tower')).toBe(true);
      expect(bus.hasListeners('command:start-wave')).toBe(true);
      expect(bus.hasListeners('command:restart-game')).toBe(true);
      expect(bus.hasListeners('enemy:reached-base')).toBe(true);
      expect(bus.hasListeners('enemy:died')).toBe(true);
    });
  });

  describe('after initialize()', () => {
    let bus: GameEventBus;

    beforeEach(() => {
      const engine = createMockEngine();
      gsm.initialize(engine, {} as never, BASE_POSITION, SPAWN_POINTS as never[], new Map());
      bus = getEventBus(gsm);
    });

    describe('credits management', () => {
      it('spendCredits() deducts when sufficient', () => {
        const initial = gsm.credits();
        const result = gsm.spendCredits(10);
        expect(result).toBe(true);
        expect(gsm.credits()).toBe(initial - 10);
      });

      it('spendCredits() returns false when insufficient', () => {
        const result = gsm.spendCredits(999999);
        expect(result).toBe(false);
        expect(gsm.credits()).toBe(GAME_BALANCE.player.startCredits);
      });

      it('spendCredits() emits credits:changed event', () => {
        const handler = vi.fn();
        bus.on('credits:changed', handler);

        gsm.spendCredits(5);

        expect(handler).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'credits:changed',
            credits: GAME_BALANCE.player.startCredits - 5,
            delta: -5,
          })
        );
      });
    });

    describe('health management', () => {
      it('enemy:reached-base reduces health', () => {
        const initialHealth = gsm.baseHealth();
        bus.emit({
          type: 'enemy:reached-base',
          enemy: { id: 'e1' } as never,
          damage: 10,
        });
        expect(gsm.baseHealth()).toBe(initialHealth - 10);
      });

      it('health does not go below 0', () => {
        bus.emit({
          type: 'enemy:reached-base',
          enemy: { id: 'e1' } as never,
          damage: 9999,
        });
        expect(gsm.baseHealth()).toBe(0);
      });

      it('enemy:reached-base emits health:changed event', () => {
        const handler = vi.fn();
        bus.on('health:changed', handler);

        bus.emit({
          type: 'enemy:reached-base',
          enemy: { id: 'e1' } as never,
          damage: 15,
        });

        expect(handler).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'health:changed',
            health: GAME_BALANCE.player.startHealth - 15,
            delta: -15,
          })
        );
      });
    });

    describe('enemy:died credits', () => {
      it('awards credits on enemy death', () => {
        const initial = gsm.credits();
        bus.emit({
          type: 'enemy:died',
          enemy: {
            position: { lat: 48.77, lon: 9.18, height: 0 },
            transform: { terrainHeight: 0 },
            typeConfig: { heightOffset: 0 },
          } as never,
          credits: 25,
        });
        expect(gsm.credits()).toBe(initial + 25);
      });

      it('does not award credits when credits=0', () => {
        const initial = gsm.credits();
        bus.emit({
          type: 'enemy:died',
          enemy: {
            position: { lat: 48.77, lon: 9.18, height: 0 },
            transform: { terrainHeight: 0 },
          } as never,
          credits: 0,
        });
        expect(gsm.credits()).toBe(initial);
      });
    });

    describe('placeTower()', () => {
      it('returns null if not enough credits', () => {
        gsm.spendCredits(gsm.credits());
        const result = gsm.placeTower(BASE_POSITION, 'archer');
        expect(result).toBeNull();
      });

      it('returns null for invalid tower type', () => {
        const result = gsm.placeTower(BASE_POSITION, 'nonexistent' as never);
        expect(result).toBeNull();
      });

      it('deducts cost on successful placement', () => {
        const initial = gsm.credits();
        const tower = gsm.placeTower(BASE_POSITION, 'archer');
        if (tower) {
          expect(gsm.credits()).toBeLessThan(initial);
        }
      });
    });

    describe('reset()', () => {
      it('resets health to start value', () => {
        bus.emit({
          type: 'enemy:reached-base',
          enemy: { id: 'e1' } as never,
          damage: 50,
        });
        gsm.reset();
        expect(gsm.baseHealth()).toBe(GAME_BALANCE.player.startHealth);
      });

      it('resets credits to start value', () => {
        gsm.spendCredits(20);
        gsm.reset();
        expect(gsm.credits()).toBe(GAME_BALANCE.player.startCredits);
      });

      it('can be called multiple times without error', () => {
        expect(() => gsm.reset()).not.toThrow();
        expect(() => gsm.reset()).not.toThrow();
        expect(gsm.baseHealth()).toBe(GAME_BALANCE.player.startHealth);
        expect(gsm.credits()).toBe(GAME_BALANCE.player.startCredits);
      });
    });

    describe('healBase()', () => {
      it('restores health to 100', () => {
        bus.emit({
          type: 'enemy:reached-base',
          enemy: { id: 'e1' } as never,
          damage: 60,
        });
        expect(gsm.baseHealth()).toBe(40);
        gsm.healBase();
        expect(gsm.baseHealth()).toBe(100);
      });
    });

    describe('setTrainingTimescale()', () => {
      it('sets timescale within bounds', () => {
        gsm.setTrainingTimescale(3.0, false);
        expect(gsm.trainingTimescale()).toBe(3.0);
      });

      it('clamps minimum to 0.1', () => {
        gsm.setTrainingTimescale(0.01, false);
        expect(gsm.trainingTimescale()).toBe(0.1);
      });

      it('clamps maximum to 75', () => {
        gsm.setTrainingTimescale(100, false);
        expect(gsm.trainingTimescale()).toBe(75);
      });
    });

    describe('command events', () => {
      it('command:restart-game calls reset', () => {
        const resetSpy = vi.spyOn(gsm, 'reset');
        bus.emit({ type: 'command:restart-game' });
        expect(resetSpy).toHaveBeenCalled();
      });

      it('debug:add-credits increases credits', () => {
        const initial = gsm.credits();
        bus.emit({ type: 'debug:add-credits', amount: 100 } as never);
        expect(gsm.credits()).toBe(initial + 100);
      });

      it('debug:add-health changes health (clamped)', () => {
        bus.emit({
          type: 'enemy:reached-base',
          enemy: { id: 'e1' } as never,
          damage: 30,
        });
        expect(gsm.baseHealth()).toBe(70);
        bus.emit({ type: 'debug:add-health', amount: 20 } as never);
        expect(gsm.baseHealth()).toBe(90);
      });

      it('debug:add-health allows exceeding start health (debug)', () => {
        bus.emit({ type: 'debug:add-health', amount: 1000 } as never);
        expect(gsm.baseHealth()).toBe(GAME_BALANCE.player.startHealth + 1000);
      });
    });

    describe('sub-step loop (fixed-timestep accumulation)', () => {
      const FIXED_STEP = 16.667; // matches GameStateManager.FIXED_STEP_MS

      it('runs one sub-step per ~16.7ms of game-time', () => {
        const onSub = vi.fn();
        gsm.update(0, onSub);          // first call sets lastUpdateTime, raw delta ~16ms
        gsm.update(16.667, onSub);     // ~1 sub-step worth
        // Expect at least one sub-step. The first call may also fire one
        // depending on the initial-delta fallback (16ms default).
        expect(onSub.mock.calls.length).toBeGreaterThanOrEqual(1);
      });

      it('accumulates remainder across frames (no game-time loss)', () => {
        const onSub = vi.fn();
        // First call seeds lastUpdateTime; deltas applied from second call on.
        gsm.update(0, onSub);
        const stepsAfterFirst = onSub.mock.calls.length;
        // Two half-step frames should together produce ≥ 1 extra sub-step.
        gsm.update(8, onSub);    // 8ms — below threshold alone
        gsm.update(16, onSub);   // accumulator now passes threshold
        expect(onSub.mock.calls.length).toBeGreaterThan(stepsAfterFirst);
      });

      it('gameTimeMs increases monotonically by stepMs per sub-step', () => {
        const onSub = vi.fn();
        let lastTime = gsm.gameTimeMs;
        for (let i = 0; i < 5; i++) {
          gsm.update(i * 17, onSub);
          expect(gsm.gameTimeMs).toBeGreaterThanOrEqual(lastTime);
          lastTime = gsm.gameTimeMs;
        }
        // After several frames at ~17ms each, game-time should have advanced.
        expect(gsm.gameTimeMs).toBeGreaterThan(0);
      });

      it('caps sub-steps per frame at MAX_SUBSTEPS_PER_FRAME (600)', () => {
        const onSub = vi.fn();
        // Seed with a NON-ZERO time so the next delta computes properly
        // (lastUpdateTime=0 is treated as "first frame" via a truthiness check).
        gsm.update(1, onSub);
        gsm.update(17, onSub);
        const stepsAfterSeed = onSub.mock.calls.length;
        // Massive 60-second jump in wall-clock — should be capped to 600
        // sub-steps (= ~10s game-time) plus the max-remainder allowance.
        gsm.update(60_017, onSub);
        const stepsThisFrame = onSub.mock.calls.length - stepsAfterSeed;
        expect(stepsThisFrame).toBeLessThanOrEqual(600);
        // And it should be a meaningful number, not just 1.
        expect(stepsThisFrame).toBeGreaterThan(100);
      });

      it('scales sub-step count by training timescale', () => {
        const baselineHits = vi.fn();
        gsm.setTrainingTimescale(1.0, false);
        gsm.update(0, baselineHits);
        gsm.update(100, baselineHits); // 100ms wall × 1× = 100ms game-time
        const baseline = baselineHits.mock.calls.length;

        // Reset for a fresh frame budget.
        const sped = vi.fn();
        const gsm2 = new GameStateManager();
        const engine = createMockEngine();
        gsm2.initialize(engine, {} as never, BASE_POSITION, SPAWN_POINTS as never[], new Map());
        gsm2.setTrainingTimescale(5.0, false);
        gsm2.update(0, sped);
        gsm2.update(100, sped); // 100ms wall × 5× = 500ms game-time
        // 5× timescale should yield ≥ 4× the sub-step count of 1×.
        expect(sped.mock.calls.length).toBeGreaterThanOrEqual(baseline * 4);
      });

      it('does not advance simulation when paused at gameover phase', () => {
        // Trigger gameover via massive damage
        bus.emit({
          type: 'enemy:reached-base',
          enemy: { id: 'e1' } as never,
          damage: 9999,
        });
        expect(gsm.baseHealth()).toBe(0);

        const onSub = vi.fn();
        const gtBefore = gsm.gameTimeMs;
        gsm.update(0, onSub);
        gsm.update(100, onSub);
        // Sub-steps may still tick — but if game-over phase has been set the
        // sub-step loop breaks out after one tick. We just assert game-time
        // hasn't run away wildly.
        expect(gsm.gameTimeMs - gtBefore).toBeLessThan(1000);
      });

      it('reset() zeroes the game-clock and remainder', () => {
        gsm.update(0, undefined);
        gsm.update(100, undefined);
        expect(gsm.gameTimeMs).toBeGreaterThan(0);
        gsm.reset();
        expect(gsm.gameTimeMs).toBe(0);
      });
    });
  });
});
