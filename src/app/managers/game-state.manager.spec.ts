import { afterEach, beforeEach, describe, it, expect, vi, type Mock } from 'vitest';

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
      turnTowersToGuard: vi.fn(),
      turnToGuardHeading: vi.fn(),
      updateTowerShooting: vi.fn(),
      updateBeamTowers: vi.fn(),
      updateMeleeTowers: vi.fn(),
      updateChainTowers: vi.fn(),
      stopAllBeams: vi.fn(),
      stopTowerBeam: vi.fn(),
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
      recomputeTowerLOS: vi.fn(),
      scheduleLosRecompute: vi.fn(),
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

import { effect, signal } from '@angular/core';
import { GameStateManager } from './game-state.manager';
import { GAME_BALANCE } from '../configs/game-balance.config';
import { TOWER_TYPES } from '../configs/tower-types.config';
import { getResearch } from '../configs/research/research-tree.config';
import { GameEventBus } from '../game-engine';
import { skippedWavesGold } from '../services/economy.service';

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
      plinths: autoProxy(),
      towerBadges: autoProxy(),
      bloodMoon: autoProxy(),
      searchlights: autoProxy(),
      projectiles: autoProxy(),
      trailStreaks: autoProxy(),
      tentacles: autoProxy(),
      hero: autoProxy(),
      orbitalBeams: autoProxy(),
      oozes: autoProxy(),
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
      gsm.initialize(engine, BASE_POSITION, SPAWN_POINTS as never[], new Map());

      const bus = getEventBus(gsm);
      expect(bus.hasListeners('command:place-tower')).toBe(true);
      expect(bus.hasListeners('command:sell-tower')).toBe(true);
      expect(bus.hasListeners('command:upgrade-tower')).toBe(true);
      expect(bus.hasListeners('command:start-wave')).toBe(true);
      expect(bus.hasListeners('command:restart-game')).toBe(true);
      expect(bus.hasListeners('command:use-ability')).toBe(true);
      expect(bus.hasListeners('enemy:reached-base')).toBe(true);
      expect(bus.hasListeners('enemy:died')).toBe(true);
    });
  });

  describe('after initialize()', () => {
    let bus: GameEventBus;

    beforeEach(() => {
      const engine = createMockEngine();
      gsm.initialize(engine, BASE_POSITION, SPAWN_POINTS as never[], new Map());
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

      it('an ooze flowing in costs HP inside the same leak budget', () => {
        const cap = GAME_BALANCE.combat.maxLeakDamagePerWave;
        const before = gsm.baseHealth();
        bus.emit({ type: 'enemy:leaking', enemy: { id: 'ooze' } as never, damage: 2 });
        expect(gsm.baseHealth()).toBe(before - 2);
        bus.emit({ type: 'enemy:leaking', enemy: { id: 'ooze' } as never, damage: 9999 });
        bus.emit({ type: 'enemy:reached-base', enemy: { id: 'ooze' } as never, damage: 1 });
        expect(gsm.baseHealth()).toBe(before - cap);
      });

      it('a single wave cannot cost more than the leak budget', () => {
        // Late-game leaks are 10 HP each and nothing heals, so one wave with a
        // missing counter could otherwise erase half a run. See
        // GAME_BALANCE.combat.maxLeakDamagePerWave.
        const before = gsm.baseHealth();
        bus.emit({
          type: 'enemy:reached-base',
          enemy: { id: 'e1' } as never,
          damage: 9999,
        });
        expect(gsm.baseHealth()).toBe(before - GAME_BALANCE.combat.maxLeakDamagePerWave);
      });

      it('the leak budget refills when the next wave starts', () => {
        const cap = GAME_BALANCE.combat.maxLeakDamagePerWave;
        const before = gsm.baseHealth();
        bus.emit({ type: 'enemy:reached-base', enemy: { id: 'e1' } as never, damage: 9999 });
        gsm.startWave({ schedule: { entries: [] }, baseDelay: 100 } as never);
        bus.emit({ type: 'enemy:reached-base', enemy: { id: 'e2' } as never, damage: 9999 });
        expect(gsm.baseHealth()).toBe(before - 2 * cap);
      });

      it('the leak budget refills when a manual wave begins, too', () => {
        const cap = GAME_BALANCE.combat.maxLeakDamagePerWave;
        const before = gsm.baseHealth();
        vi.spyOn(gsm.waveManager, 'beginWave').mockImplementation(() => undefined);
        bus.emit({ type: 'enemy:reached-base', enemy: { id: 'e1' } as never, damage: 9999 });
        gsm.beginWave();
        bus.emit({ type: 'enemy:reached-base', enemy: { id: 'e2' } as never, damage: 9999 });
        expect(gsm.baseHealth()).toBe(before - 2 * cap);
      });

      it('health does not go below 0 across repeated waves', () => {
        for (let w = 0; w < 20; w++) {
          gsm.startWave({ schedule: { entries: [] }, baseDelay: 100 } as never);
          bus.emit({ type: 'enemy:reached-base', enemy: { id: `e${w}` } as never, damage: 9999 });
        }
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
            heightOffset: 0,
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

      it('hands plinth height and overhang of a place command to the tower manager', () => {
        const place = vi.spyOn(gsm.towerManager, 'placeTower').mockReturnValue(null);
        const position = { ...BASE_POSITION, height: 7 };
        bus.emit({
          type: 'command:place-tower', position, typeId: 'archer', rotation: 0.5, plinthHeight: 1.5, plinthOverhang: [3, 4],
        });
        bus.emit({ type: 'command:place-tower', position, typeId: 'archer' });

        expect(place.mock.calls).toEqual([
          [position, 'archer', 0.5, 1.5, [3, 4]],
          [position, 'archer', 0, 0, []],
        ]);
      });

      it('refuses a second one-per-map building while the first stands, and takes no credits for it', () => {
        const typeId = 'research-center';
        expect(TOWER_TYPES[typeId].unique).toBe(true);
        const first = gsm.placeTower(BASE_POSITION, typeId);
        expect(first).not.toBeNull();
        const credits = gsm.credits();
        expect(gsm.placeTower({ ...BASE_POSITION, lat: BASE_POSITION.lat + 0.001 }, typeId)).toBeNull();
        expect(gsm.credits()).toBe(credits);

        gsm.sellTower(first!);
        expect(gsm.placeTower({ ...BASE_POSITION, lat: BASE_POSITION.lat + 0.001 }, typeId)).not.toBeNull();
      });

      it('towerCount counts the towers standing now, also when read before the first one', () => {
        // The corridor lock asks when the location loads, before any tower stands
        expect(gsm.towerCount()).toBe(0);
        gsm.towerManager.placeTower(BASE_POSITION, 'archer', 0);
        expect(gsm.towerCount()).toBe(1);
        gsm.towerManager.placeTower({ ...BASE_POSITION, lat: BASE_POSITION.lat + 0.001 }, 'archer', 0);
        expect(gsm.towerCount()).toBe(2);
      });
    });

    describe('command:set-targeting', () => {
      it('sets the strategy and the air sub-strategy of the tower, each only when given', () => {
        const tower = { targetingStrategy: 'closest', airSubStrategy: 'closest' };
        vi.spyOn(gsm.towerManager, 'getById').mockImplementation((id) => (id === 't1' ? tower as never : null));

        bus.emit({ type: 'command:set-targeting', towerId: 't1', strategy: 'air-priority' });
        expect(tower).toEqual({ targetingStrategy: 'air-priority', airSubStrategy: 'closest' });

        bus.emit({ type: 'command:set-targeting', towerId: 't1', airSubStrategy: 'lowest-hp' });
        expect(tower).toEqual({ targetingStrategy: 'air-priority', airSubStrategy: 'lowest-hp' });

        // An unknown tower (sold meanwhile) changes nothing
        bus.emit({ type: 'command:set-targeting', towerId: 'gone', strategy: 'first' });
        expect(tower.targetingStrategy).toBe('air-priority');
      });
    });

    describe('command:set-hold-fire', () => {
      it('holds fire of a fighting tower and greys it out, not of a passive building', () => {
        const archer = { id: 't1', holdFire: false, typeConfig: { id: 'archer', attackType: 'projectile' } };
        const center = { id: 't2', holdFire: false, typeConfig: { id: 'research-center', attackType: 'passive' } };
        const towers: Record<string, unknown> = { t1: archer, t2: center };
        vi.spyOn(gsm.towerManager, 'getById').mockImplementation((id) => (towers[id] ?? null) as never);
        const engine = gsm.tilesEngine as unknown as {
          towers: { setHoldFire: Mock };
          towerBadges: { setHoldFire: Mock };
        };
        const setHoldFire = engine.towers.setHoldFire;
        const badge = engine.towerBadges.setHoldFire;

        bus.emit({ type: 'command:set-hold-fire', towerId: 't1', holdFire: true });
        expect(archer.holdFire).toBe(true);
        expect(setHoldFire).toHaveBeenLastCalledWith('t1', true);
        // A flame goes out at once, not only at the next sub-step
        expect((mockServices['TowerCombatService'] as Record<string, Mock>)['stopTowerBeam']).toHaveBeenCalledWith('t1');
        // The pause sign over the tower comes with the grey model
        expect(badge).toHaveBeenLastCalledWith('t1', true);

        bus.emit({ type: 'command:set-hold-fire', towerId: 't1', holdFire: false });
        expect(archer.holdFire).toBe(false);
        expect(setHoldFire).toHaveBeenLastCalledWith('t1', false);

        setHoldFire.mockClear();
        badge.mockClear();
        bus.emit({ type: 'command:set-hold-fire', towerId: 't2', holdFire: true });
        bus.emit({ type: 'command:set-hold-fire', towerId: 'gone', holdFire: true });
        expect(center.holdFire).toBe(false);
        expect(setHoldFire).not.toHaveBeenCalled();
        expect(badge).not.toHaveBeenCalled();
      });
    });

    describe('corridor build under way (corridorPending)', () => {
      let building: boolean;
      beforeEach(() => {
        building = true;
        gsm.setCorridorPending(() => building);
      });

      it('places no tower and takes no credits until the corridor is built', () => {
        const place = vi.spyOn(gsm.towerManager, 'placeTower');
        const credits = gsm.credits();
        expect(gsm.placeTower(BASE_POSITION, 'archer')).toBeNull();
        expect(place).not.toHaveBeenCalled();
        expect(gsm.credits()).toBe(credits);

        building = false;
        expect(gsm.placeTower(BASE_POSITION, 'archer')).not.toBeNull();
        expect(place).toHaveBeenCalledTimes(1);
      });

      it('starts no wave, with or without a config, until the corridor is built', () => {
        const start = vi.spyOn(gsm.waveManager, 'startWave').mockImplementation(() => undefined);
        const begin = vi.spyOn(gsm.waveManager, 'beginWave').mockImplementation(() => undefined);
        gsm.startWave({ schedule: { entries: [] }, baseDelay: 100 } as never);
        gsm.beginWave();
        expect(start).not.toHaveBeenCalled();
        expect(begin).not.toHaveBeenCalled();

        building = false;
        gsm.startWave({ schedule: { entries: [] }, baseDelay: 100 } as never);
        gsm.beginWave();
        expect(start).toHaveBeenCalledTimes(1);
        expect(begin).toHaveBeenCalledTimes(1);
      });

      it('waits for nothing without a corridor owner', () => {
        gsm.setCorridorPending(null);
        expect(gsm.corridorPending()).toBe(false);
      });
    });

    describe('command:use-ability', () => {
      it('hands the ability and the target to the AbilityManager', () => {
        const use = vi.spyOn(gsm.abilityManager, 'use');
        bus.emit({
          type: 'command:use-ability',
          abilityId: 'nuclear-strike',
          target: { lat: 48.771, lon: 9.181, height: 3 },
        });
        expect(use).toHaveBeenCalledWith('nuclear-strike', { lat: 48.771, lon: 9.181, height: 3 });
      });

      it('answers a locked ability with ability:rejected', () => {
        const rejected = vi.fn();
        bus.on('ability:rejected', rejected);
        bus.emit({ type: 'command:use-ability', abilityId: 'nuclear-strike', target: { lat: 48.771, lon: 9.181 } });
        expect(rejected).toHaveBeenCalledWith({
          type: 'ability:rejected',
          abilityId: 'nuclear-strike',
          reason: 'locked',
        });
      });
    });

    describe('debug:ready-ability (Nuke ready)', () => {
      it('lands with the sub-step\'s event queue, not at the click', () => {
        bus.emitDeferred({ type: 'debug:ready-ability', abilityId: 'nuclear-strike' });
        expect(gsm.abilityManager.getStatus('nuclear-strike').unlocked).toBe(false);

        bus.processQueue();
        const status = gsm.abilityManager.getStatus('nuclear-strike');
        expect(status.unlocked).toBe(true);
        expect(status.charges).toBe(status.maxCharges);
      });

      it('researches the strike with its prerequisites once, then refills on every click', () => {
        const completed: string[] = [];
        bus.on('research:completed', (event) => completed.push(event.researchId));
        const refill = vi.spyOn(gsm.abilityManager, 'refillCharges');

        bus.emit({ type: 'debug:ready-ability', abilityId: 'nuclear-strike' });
        expect(completed).toContain('advanced-weaponry');
        expect(completed[completed.length - 1]).toBe('nuclear-strike');

        completed.length = 0;
        bus.emit({ type: 'debug:ready-ability', abilityId: 'nuclear-strike' });
        expect(completed).toEqual([]);
        expect(refill).toHaveBeenCalledTimes(2);
        expect(refill).toHaveBeenCalledWith('nuclear-strike');
      });
    });

    describe('jumpToWave() (dev cheat)', () => {
      it('sets the counter so the next start is the given wave, and pays the skipped waves', () => {
        const jumped = vi.fn();
        bus.on('wave:jumped', jumped);
        const credits = gsm.credits();

        expect(gsm.jumpToWave(35, true)).toBe(true);

        const gold = skippedWavesGold(1, 34);
        expect(gsm.waveNumber()).toBe(34);
        expect(gsm.phase()).toBe('setup');
        expect(gsm.credits()).toBe(credits + gold);
        expect(jumped).toHaveBeenCalledWith({ type: 'wave:jumped', from: 0, wave: 35, skipped: 34, credits: gold });
        expect(gsm.enemyManager.getAll()).toEqual([]);
      });

      it('pays nothing without the gold grant', () => {
        const credits = gsm.credits();
        gsm.jumpToWave(14, false);
        expect(gsm.waveNumber()).toBe(13);
        expect(gsm.credits()).toBe(credits);
      });

      it('recharges the abilities by the skipped waves and leaves research alone', () => {
        const advance = vi.spyOn(gsm.abilityManager, 'advanceWaves');
        const research = vi.spyOn(gsm.researchManager, 'update');
        gsm.jumpToWave(10, true);
        expect(advance).toHaveBeenCalledWith(9);
        expect(research).not.toHaveBeenCalled();
      });

      it('refuses during a wave, backwards and onto the next wave', () => {
        const jumped = vi.fn();
        bus.on('wave:jumped', jumped);
        gsm.jumpToWave(20, false);
        expect(gsm.jumpToWave(15, false)).toBe(false);
        expect(gsm.jumpToWave(20, false)).toBe(false);
        expect(gsm.jumpToWave(20.5, false)).toBe(false);

        gsm.waveManager.phase.set('wave');
        expect(gsm.jumpToWave(40, false)).toBe(false);
        expect(gsm.waveNumber()).toBe(19);
        expect(jumped).toHaveBeenCalledTimes(1);
      });

      it('runs through the command pipeline as debug:jump-to-wave', () => {
        bus.emit({ type: 'debug:jump-to-wave', wave: 45, grantGold: false });
        expect(gsm.waveNumber()).toBe(44);
      });

      it('still sends game:started once, before the first wave of the run', () => {
        const started = vi.fn();
        bus.on('game:started', started);
        vi.spyOn(gsm.waveManager, 'beginWave').mockImplementation(() => undefined);

        gsm.jumpToWave(35, false);
        gsm.beginWave();
        gsm.beginWave();
        expect(started).toHaveBeenCalledTimes(1);

        gsm.reset();
        gsm.beginWave();
        expect(started).toHaveBeenCalledTimes(2);
      });
    });

    describe('debug:ready-hero (Hero ready)', () => {
      const paths = () => mockServices['PathAndRouteService'] as { getCachedPaths: ReturnType<typeof vi.fn> };

      beforeEach(() => {
        paths().getCachedPaths.mockReturnValue(new Map([['sp-1', [
          { lat: BASE_POSITION.lat + 0.001, lon: BASE_POSITION.lon },
          { lat: BASE_POSITION.lat, lon: BASE_POSITION.lon },
        ]]]));
      });

      afterEach(() => {
        paths().getCachedPaths.mockReturnValue(new Map());
      });

      it('lands with the sub-step\'s event queue: the research with its prerequisites, then the hire for free', () => {
        const credits = gsm.credits();
        const completed: string[] = [];
        bus.on('research:completed', (event) => completed.push(event.researchId));

        bus.emitDeferred({ type: 'debug:ready-hero' });
        expect(gsm.heroManager.getHero()).toBeNull();

        bus.processQueue();
        expect(completed).toEqual(['gatling-tech', 'siege-engineering', 'mercenary-contract']);
        expect(gsm.heroManager.getStatus()).toMatchObject({ unlocked: true, hired: true });
        expect(gsm.credits()).toBe(credits);
      });

      it('changes nothing once he is hired', () => {
        bus.emit({ type: 'debug:ready-hero' });
        const hero = gsm.heroManager.getHero();
        bus.emit({ type: 'debug:ready-hero' });
        expect(gsm.heroManager.getHero()).toBe(hero);
      });

      it('shows a hero hired in a pause at once, though no sub-step runs', () => {
        const present = vi.fn();
        gsm.heroManager.setView({ present, clear: vi.fn() });
        gsm.researchManager.completeResearch(getResearch('mercenary-contract')!.id);
        gsm.addCredits(getResearch('mercenary-contract')!.cost + 1000);
        gsm.update(1, undefined);
        gsm.paused.set(true);
        const clock = gsm.gameTimeMs;

        bus.emit({ type: 'command:hire-hero' }); // the ability bar's button, not deferred
        gsm.update(500, undefined);
        gsm.update(1000, undefined);

        expect(gsm.heroManager.getStatus().hired).toBe(true);
        expect(present).toHaveBeenCalledTimes(1);
        expect(gsm.gameTimeMs).toBe(clock);
      });
    });

    describe('research:completed', () => {
      it('queues an LOS recompute for the towers the AA retrofit gives air targeting', () => {
        gsm.addCredits(1000);
        const gatling = gsm.placeTower(BASE_POSITION, 'dual-gatling');
        gsm.placeTower({ ...BASE_POSITION, lat: BASE_POSITION.lat + 0.001 }, 'archer');
        expect(gatling).not.toBeNull();
        const placement = mockServices['TowerPlacementService'] as Record<string, ReturnType<typeof vi.fn>>;

        bus.emit({
          type: 'research:completed',
          researchId: 'aa-retrofit',
          effects: [{ kind: 'enable-targeting', capability: 'air' }],
        });

        // Queued, not run in the handler: the ResearchStore only learns about
        // the unlock in a research:completed handler subscribed after this one.
        expect(placement['scheduleLosRecompute'].mock.calls).toEqual([[gatling]]);
        expect(placement['recomputeTowerLOS']).not.toHaveBeenCalled();
      });
    });

    describe('research queue', () => {
      it('starts a queued research in the sub-step a slot frees, paid only then', () => {
        const first = getResearch('gatling-tech')!;
        const queued = getResearch('ice-magic')!;
        gsm.addCredits(first.cost + queued.cost);
        gsm.researchManager.onCenterPlaced(); // 1 slot
        bus.emit({ type: 'command:start-research', researchId: first.id });
        const afterStart = gsm.credits();

        bus.emit({ type: 'command:queue-research', researchId: queued.id });
        expect(gsm.credits()).toBe(afterStart);

        // Run the game clock past the first research at the training speed
        gsm.setTrainingTimescale(75, false);
        let t = 1;
        gsm.update(t, undefined);
        while (!gsm.researchManager.isCompleted(first.id) && t < 10_000) {
          t += 50;
          gsm.update(t, undefined);
        }

        expect(gsm.researchManager.isActive(queued.id)).toBe(true);
        expect(gsm.credits()).toBe(afterStart - queued.cost);
      });

      it('does not start anything from the queue while paused', () => {
        gsm.addCredits(1000);
        gsm.researchManager.onCenterPlaced();
        bus.emit({ type: 'command:queue-research', researchId: 'ice-magic' });
        gsm.paused.set(true);
        gsm.update(1, undefined);
        gsm.update(100, undefined);
        expect(gsm.researchManager.isActive('ice-magic')).toBe(false);

        gsm.paused.set(false);
        gsm.update(117, undefined);
        expect(gsm.researchManager.isActive('ice-magic')).toBe(true);
      });

      it('leaves command:start-research as it was: refused when every slot is busy', () => {
        gsm.addCredits(1000);
        gsm.researchManager.onCenterPlaced();
        bus.emit({ type: 'command:start-research', researchId: 'gatling-tech' });
        bus.emit({ type: 'command:start-research', researchId: 'ice-magic' });
        expect(gsm.researchManager.isActive('ice-magic')).toBe(false);
        expect(gsm.researchManager.getQueuedResearches()).toEqual([]);
      });
    });

    describe('guard heading', () => {
      const combat = () => mockServices['TowerCombatService'] as Record<string, ReturnType<typeof vi.fn>>;

      it('turns the towers to their guard heading once a wave is completed', () => {
        // The music also listens for the wave end; it has no audio graph here.
        vi.spyOn(gsm.backgroundMusic as unknown as { playBuildPhase: () => void }, 'playBuildPhase')
          .mockImplementation(() => undefined);
        bus.emit({ type: 'wave:completed', wave: 1, credits: 0, perfect: true, closeCall: false, hpLost: 0 });
        expect(combat()['turnTowersToGuard']).toHaveBeenCalledWith(gsm.towerManager);
      });

      it('follows a new guard heading after a range upgrade between waves', () => {
        const tower = gsm.placeTower(BASE_POSITION, 'archer')!;
        gsm.recomputeTowerRangeAfterUpgrade(tower);
        expect(combat()['turnToGuardHeading']).toHaveBeenCalledWith(tower);
      });

      it('keeps the heading after a range upgrade during a wave', () => {
        const tower = gsm.placeTower(BASE_POSITION, 'archer')!;
        gsm.waveManager.phase.set('wave');
        gsm.recomputeTowerRangeAfterUpgrade(tower);
        expect(combat()['turnToGuardHeading']).not.toHaveBeenCalled();
      });

      it('recomputes the guard headings when the routes change', () => {
        const tower = gsm.placeTower(BASE_POSITION, 'archer')!;
        expect(tower.guardHeading).toBeNull();

        // North to south, a few meters east of the tower.
        const paths = mockServices['PathAndRouteService'] as { getCachedPaths: ReturnType<typeof vi.fn> };
        paths.getCachedPaths.mockReturnValue(new Map([['sp-1', [
          { lat: BASE_POSITION.lat + 0.01, lon: BASE_POSITION.lon + 0.00005 },
          { lat: BASE_POSITION.lat - 0.01, lon: BASE_POSITION.lon + 0.00005 },
        ]]]));
        gsm.initializeGlobalRouteGrid();

        // Entered from the north, slightly east of it.
        expect(tower.guardHeading).toBeGreaterThan(0);
        expect(tower.guardHeading).toBeLessThan(Math.PI / 4);
        expect(combat()['turnTowersToGuard']).toHaveBeenCalledWith(gsm.towerManager);
      });

      it('sets the tile region for new routes, not when their cells are built again', () => {
        const setRouteCorridor = vi.fn();
        (gsm.tilesEngine as unknown as { setRouteCorridor: typeof setRouteCorridor }).setRouteCorridor = setRouteCorridor;
        gsm.initializeGlobalRouteGrid();
        expect(setRouteCorridor).toHaveBeenCalledTimes(1);

        gsm.rebuildRouteCells();
        expect(setRouteCorridor).toHaveBeenCalledTimes(1);
      });

      // Debug enemies fought between waves never complete a wave
      describe('once the last enemy outside a wave is gone', () => {
        const enemy = (id: string) => ({
          id,
          position: { lat: 48.77, lon: 9.18, height: 0 },
          transform: { terrainHeight: 0 },
        }) as never;

        beforeEach(() => combat()['turnTowersToGuard'].mockClear());

        it('turns the towers to guard when the last one dies', () => {
          const [a, b] = [enemy('a'), enemy('b')];
          const alive = vi.spyOn(gsm.enemyManager, 'getAlive').mockReturnValue([b]);
          bus.emit({ type: 'enemy:died', enemy: a, credits: 0 });
          expect(combat()['turnTowersToGuard']).not.toHaveBeenCalled();

          alive.mockReturnValue([]);
          bus.emit({ type: 'enemy:died', enemy: b, credits: 0 });
          expect(combat()['turnTowersToGuard']).toHaveBeenCalledWith(gsm.towerManager);
        });

        it('counts an enemy that reaches the base as gone', () => {
          // Still alive while the event runs, removed after it
          const a = enemy('a');
          vi.spyOn(gsm.enemyManager, 'getAlive').mockReturnValue([a]);
          bus.emit({ type: 'enemy:reached-base', enemy: a, damage: 0 });
          expect(combat()['turnTowersToGuard']).toHaveBeenCalledWith(gsm.towerManager);
        });

        it('turns them when the enemy debugger removes the last one', () => {
          vi.spyOn(gsm.enemyManager, 'getAlive').mockReturnValue([]);
          bus.emit({ type: 'debug:remove-enemy', enemyId: 'a' });
          expect(combat()['turnTowersToGuard']).toHaveBeenCalledTimes(1);
        });

        it('leaves the turn to the wave end during a wave', () => {
          vi.spyOn(gsm.enemyManager, 'getAlive').mockReturnValue([]);
          gsm.waveManager.phase.set('wave');
          bus.emit({ type: 'enemy:died', enemy: enemy('a'), credits: 0 });
          expect(combat()['turnTowersToGuard']).not.toHaveBeenCalled();
        });

        it('waits for the children of an enemy that splits', () => {
          // A debug skeleton: its minions spawn right after its enemy:died
          vi.spyOn(gsm.enemyManager, 'getAlive').mockReturnValue([]);
          const skeleton = {
            ...(enemy('s') as object),
            alive: false,
            typeConfig: { splitOnDeath: { type: 'skeleton-minion', count: 2, spread: 0.3 } },
          } as never;
          bus.emit({ type: 'enemy:died', enemy: skeleton, credits: 0 });
          expect(combat()['turnTowersToGuard']).not.toHaveBeenCalled();
        });

        it('turns them after a kill-all, which splits nothing', () => {
          vi.spyOn(gsm.enemyManager, 'getAlive').mockReturnValue([]);
          bus.emit({ type: 'debug:kill-all' });
          expect(combat()['turnTowersToGuard']).toHaveBeenCalledWith(gsm.towerManager);
        });
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

      it('clears the ooze renderer, a killed ooze\'s collapsing band and debris included, which a wave end leaves', () => {
        const engine = createMockEngine() as unknown as { oozes: { clear: Mock } };
        const game = new GameStateManager();
        game.initialize(engine as never, BASE_POSITION, SPAWN_POINTS as never[], new Map());
        const clear = engine.oozes.clear;
        clear.mockClear();
        game.reset();
        expect(clear).toHaveBeenCalledTimes(1);
      });
    });

    describe('healBase()', () => {
      it('restores health to 100', () => {
        // Within the per-wave leak cap, so the damage lands in full.
        bus.emit({
          type: 'enemy:reached-base',
          enemy: { id: 'e1' } as never,
          damage: 10,
        });
        expect(gsm.baseHealth()).toBe(90);
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

      it('debug:add-credits takes credits, never past zero', () => {
        bus.emit({ type: 'debug:add-credits', amount: -100 } as never);
        expect(gsm.credits()).toBe(GAME_BALANCE.player.startCredits - 100);

        bus.emit({ type: 'debug:add-credits', amount: -100000 } as never);
        expect(gsm.credits()).toBe(0);
      });

      it('debug:add-health changes health (clamped)', () => {
        // 15 is inside the per-wave leak cap, so it lands in full.
        bus.emit({
          type: 'enemy:reached-base',
          enemy: { id: 'e1' } as never,
          damage: 15,
        });
        expect(gsm.baseHealth()).toBe(85);
        bus.emit({ type: 'debug:add-health', amount: 5 } as never);
        expect(gsm.baseHealth()).toBe(90);
      });

      it('debug:add-health allows exceeding start health (debug)', () => {
        bus.emit({ type: 'debug:add-health', amount: 1000 } as never);
        expect(gsm.baseHealth()).toBe(GAME_BALANCE.player.startHealth + 1000);
      });
    });

    describe('sub-step loop (fixed-timestep accumulation)', () => {
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

      it('does not try to catch up an arbitrarily large wall-clock gap', () => {
        const onSub = vi.fn();
        // Seed with a NON-ZERO time so the next delta computes properly
        // (lastUpdateTime=0 is treated as "first frame" via a truthiness check).
        gsm.update(1, onSub);
        gsm.update(17, onSub);
        const stepsAfterSeed = onSub.mock.calls.length;

        // A 60-second jump — what a background tab produces on return, and
        // what a stalled frame produces under load. The delta is clamped
        // before it becomes game-time, so the loop works off a few steps
        // rather than thousands. Catching it all up is what turned one slow
        // frame into a slower next one.
        gsm.update(60_017, onSub);

        const stepsThisFrame = onSub.mock.calls.length - stepsAfterSeed;
        expect(stepsThisFrame).toBeGreaterThan(0);
        expect(stepsThisFrame).toBeLessThanOrEqual(4);
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
        gsm2.initialize(engine, BASE_POSITION, SPAWN_POINTS as never[], new Map());
        gsm2.setTrainingTimescale(5.0, false);
        gsm2.update(0, sped);
        gsm2.update(100, sped); // 100ms wall × 5× = 500ms game-time
        // 5× timescale should yield ≥ 4× the sub-step count of 1×.
        expect(sped.mock.calls.length).toBeGreaterThanOrEqual(baseline * 4);
      });

      it('does not advance simulation when paused at gameover phase', () => {
        // Trigger gameover. Damage is capped per wave, so drain it across
        // several waves rather than in one hit.
        for (let w = 0; w < 20; w++) {
          gsm.startWave({ schedule: { entries: [] }, baseDelay: 100 } as never);
          bus.emit({
            type: 'enemy:reached-base',
            enemy: { id: `e${w}` } as never,
            damage: 9999,
          });
        }
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

      describe('pause', () => {
        it('runs no sub-step and keeps the game clock while paused', () => {
          const onSub = vi.fn();
          gsm.update(1, onSub);
          gsm.update(17, onSub);
          const steps = onSub.mock.calls.length;
          const clock = gsm.gameTimeMs;

          gsm.paused.set(true);
          gsm.update(34, onSub);
          gsm.update(500, onSub);
          gsm.update(5000, onSub);

          expect(onSub.mock.calls.length).toBe(steps);
          expect(gsm.gameTimeMs).toBe(clock);
        });

        it('does not tick the wave spawner while paused', () => {
          const tick = vi.spyOn(gsm.waveManager, 'tickSpawn');
          gsm.waveManager.phase.set('wave');
          gsm.paused.set(true);
          gsm.update(1, undefined);
          gsm.update(200, undefined);
          expect(tick).not.toHaveBeenCalled();
        });

        it('does not catch up the paused wall time after resuming', () => {
          const onSub = vi.fn();
          gsm.update(1, onSub);
          gsm.update(17, onSub);

          gsm.paused.set(true);
          for (let t = 1000; t <= 60_000; t += 1000) gsm.update(t, onSub);
          const beforeResume = onSub.mock.calls.length;

          gsm.paused.set(false);
          gsm.update(60_017, onSub); // one normal frame after the pause

          expect(onSub.mock.calls.length - beforeResume).toBeLessThanOrEqual(2);
        });

        it('stops the renderer clock while paused and restores it on resume', () => {
          const engine = createMockEngine() as unknown as { setTimescale: ReturnType<typeof vi.fn> };
          const paused = new GameStateManager();
          paused.initialize(engine as never, BASE_POSITION, SPAWN_POINTS as never[], new Map());
          paused.setTrainingTimescale(2, false);

          paused.paused.set(true);
          paused.update(1, undefined);
          expect(engine.setTimescale).toHaveBeenLastCalledWith(0);

          paused.paused.set(false);
          paused.update(17, undefined);
          expect(engine.setTimescale).toHaveBeenLastCalledWith(2);
        });

        /** A game whose GameStore the test drives; Angular would run its effects on each change. */
        function withStore(pausedAtStart: boolean) {
          const store = { trainingTimescale: signal(1), paused: signal(pausedAtStart), renderingEnabled: signal(true) };
          mockServices['GameStore'] = store;
          const from = vi.mocked(effect).mock.calls.length;
          const game = new GameStateManager();
          const effects = vi.mocked(effect).mock.calls.slice(from).map(([fn]) => fn as () => void);
          const sync = () => {
            for (const run of effects) run();
          };
          sync();
          const engine = createMockEngine() as unknown as { spatialAudio: { holdLoops: Mock } };
          return { store, game, sync, engine };
        }

        it('holds every audio loop through GameStore.paused, which the boss intro sets as well (playtest 545 to 547)', () => {
          const { store, game, sync, engine } = withStore(false);
          game.initialize(engine as never, BASE_POSITION, SPAWN_POINTS as never[], new Map());
          const holdLoops = engine.spatialAudio.holdLoops;
          expect(holdLoops).toHaveBeenLastCalledWith(false);

          store.paused.set(true);
          sync();
          expect(game.paused()).toBe(true);
          expect(holdLoops).toHaveBeenLastCalledWith(true);

          store.paused.set(false);
          sync();
          expect(holdLoops).toHaveBeenLastCalledWith(false);
        });

        it('holds the loops of an engine that arrives while the game is paused', () => {
          const { game, engine } = withStore(true);
          game.initialize(engine as never, BASE_POSITION, SPAWN_POINTS as never[], new Map());
          expect(engine.spatialAudio.holdLoops).toHaveBeenLastCalledWith(true);
        });

        it('presents no enemy frame while paused, so no ooze loop starts in the pause (playtest 548)', () => {
          const engine = createMockEngine();
          const game = new GameStateManager();
          game.initialize(engine, BASE_POSITION, SPAWN_POINTS as never[], new Map());
          const present = vi.spyOn(game.enemyManager, 'presentFrame');
          game.update(1, undefined);
          game.update(18, undefined);
          const running = present.mock.calls.length;
          expect(running).toBeGreaterThan(0);

          game.paused.set(true);
          game.update(35, undefined);
          game.update(500, undefined);
          expect(present.mock.calls.length).toBe(running);

          game.paused.set(false);
          game.update(517, undefined);
          expect(present.mock.calls.length).toBeGreaterThan(running);
        });
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
