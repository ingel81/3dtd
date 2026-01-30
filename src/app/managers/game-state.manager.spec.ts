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
    GameUIStateService: {
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
      stopAllBeams: vi.fn(),
    },
    EntityPoolService: {},
    OsmStreetService: {},
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
  };
  return stubs[name] ?? {};
}

import { GameStateManager } from './game-state.manager';
import { GAME_BALANCE } from '../configs/game-balance.config';
import { GameEventBus } from '../game-engine';

// Helper to access EventBus
function getEventBus(gsm: GameStateManager): GameEventBus {
  return gsm.getEventBus();
}

// Helper: create a comprehensive mock ThreeTilesEngine
function createMockEngine(): never {
  const noopFn = vi.fn();
  const noopReturning = (val: unknown) => vi.fn().mockReturnValue(val);
  return {
    getScene: noopReturning({}),
    getTerrainHeightAtLocal: noopReturning(0),
    getTerrainHeightAtGeo: noopReturning(0),
    setTimescale: noopFn,
    sync: {
      getOrigin: noopReturning({ lat: 48.77, lon: 9.18 }),
      geoToLocal: noopReturning({ x: 0, y: 0, z: 0 }),
      localToGeo: noopReturning({ lat: 48.77, lon: 9.18, height: 0 }),
    },
    spatialAudio: null,
    effects: {
      spawnFloatingText: noopFn,
      clear: noopFn,
      stopAllTowerFires: noopFn,
      startInnerFire: noopFn,
      stopInnerFire: noopFn,
    },
    enemies: {
      create: noopFn,
      createEnemy: noopFn,
      remove: noopFn,
      removeEnemy: noopFn,
      clear: noopFn,
      startWalkAnimation: noopFn,
      playDeathAnimation: noopFn,
      updatePosition: noopFn,
    },
    towers: {
      create: noopFn,
      createTower: noopFn,
      remove: noopFn,
      removeTower: noopFn,
      clear: noopFn,
    },
    projectiles: {
      create: noopFn,
      remove: noopFn,
      clear: noopFn,
    },
  } as never;
}

const BASE_POSITION = { lat: 48.77, lon: 9.18, height: 0 };
const SPAWN_POINTS = [
  { id: 'sp-1', name: 'North', lat: 48.78, lon: 9.18, height: 0 },
];

describe('GameStateManager', () => {
  let gsm: GameStateManager;

  beforeEach(() => {
    // Reset service mocks
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

      it('keeps event bus subscriptions active (handlers survive restart)', () => {
        // After reset(), command handlers should still be registered
        // (only dispose() removes them — for real component destruction)
        gsm.reset();

        const bus2 = getEventBus(gsm);
        expect(bus2.hasListeners('command:place-tower')).toBe(true);
        expect(bus2.hasListeners('enemy:reached-base')).toBe(true);
      });

      it('emits game:reset event', () => {
        const handler = vi.fn();
        bus.on('game:reset', handler);

        gsm.reset();

        expect(handler).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'game:reset' })
        );
      });

      it('dispose() removes event bus subscriptions', () => {
        gsm.dispose();

        const bus2 = getEventBus(gsm);
        expect(bus2.hasListeners('command:place-tower')).toBe(false);
        expect(bus2.hasListeners('enemy:reached-base')).toBe(false);
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

      it('debug:add-health does not exceed max health', () => {
        bus.emit({ type: 'debug:add-health', amount: 9999 } as never);
        expect(gsm.baseHealth()).toBe(GAME_BALANCE.player.startHealth);
      });
    });
  });
});
