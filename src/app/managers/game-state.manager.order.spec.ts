/**
 * Characterization: the order of operations of the GameStateManager.
 *
 * Records which manager and service the loop calls, in which order, inside one
 * frame with several sub-steps, paused and resumed, at timescale 1 and 10, and
 * which listener answers an event first. Determinism rests on this order
 * (MULTIPLAYER_CONCEPT.md, sections 2 and 4): a refactor of the loop has to
 * keep every sequence here unchanged.
 *
 * The real sub-managers run; their per-step methods are wrapped to log and
 * then call through. Services injected by Angular are stubs that log the calls
 * the loop makes. `research:progress` stays out of the log: it is throttled on
 * the wall clock, not on game time.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('three', async () => await import('@/test/mocks/three.mock'));

const mockServices: Record<string, unknown> = {};
vi.mock('@angular/core', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@angular/core');
  return {
    ...actual,
    Injectable: () => (target: unknown) => target,
    effect: vi.fn(),
    inject: (token: { name?: string }) => {
      const name = token?.name ?? 'unknown';
      if (!mockServices[name]) mockServices[name] = withAutoStubs(createStub(name));
      return mockServices[name];
    },
  };
});

import { GameStateManager } from './game-state.manager';
import { GameEventBus } from '../game-engine';
import { GameObject } from '../core/game-object';
import { withAutoStubs } from '../integration/test-helpers';
import type { Tower } from '../entities/tower.entity';

const log: string[] = [];
const logged = (label: string, ret?: unknown) => vi.fn(() => {
  log.push(label);
  return ret;
});

/** Debug enemies the stubbed EnemyDebugService reports. */
let debugEnemies: unknown[] = [];
/** Answers of checkWaveComplete, in call order; false once empty. */
let waveCompleteAnswers: boolean[] = [];

function createStub(name: string): Record<string, unknown> {
  switch (name) {
    case 'GameStore':
      return { gameSpeed: Object.assign(vi.fn(() => 1), { set: vi.fn() }) };
    case 'UIStore':
      return { specialPointsDebugVisible: () => false };
    case 'PathAndRouteService':
      return { getCachedPaths: () => new Map() };
    case 'HQDamageService':
      return {
        reset: logged('hq.reset'),
        healBase: logged('hq.healBase'),
        triggerGameOverEffects: logged('hq.triggerGameOverEffects'),
        showGameOverScreen: () => false,
      };
    case 'TowerCombatService':
      return {
        updateTowerShooting: logged('combat.updateTowerShooting'),
        updateBeamTowers: logged('combat.updateBeamTowers'),
        updateMeleeTowers: logged('combat.updateMeleeTowers'),
        updateChainTowers: logged('combat.updateChainTowers'),
        stopAllBeams: logged('combat.stopAllBeams'),
        stopAllMelee: logged('combat.stopAllMelee'),
        stopTowerBeam: logged('combat.stopTowerBeam'),
        turnTowersToGuard: logged('combat.turnTowersToGuard'),
        turnToGuardHeading: logged('combat.turnToGuardHeading'),
      };
    case 'ResearchStore':
      return {
        isTowerUnlocked: () => true,
        airTargetingUnlocked: () => false,
        activeResearches: Object.assign(vi.fn(() => []), {
          set: logged('researchStore.activeResearches.set'),
        }),
      };
    case 'WaveDebugService':
      return { setCurrentWaveGroups: logged('waveDebug.setCurrentWaveGroups') };
    case 'EnemyDebugService':
      return {
        debugEnemies: () => debugEnemies,
        clearDebugEnemies: logged('enemyDebug.clearDebugEnemies'),
      };
    case 'MarkerVisualizationService':
      return { spawnHQDebugPoint: logged('marker.spawnHQDebugPoint') };
    case 'TowerPlacementService':
      return {
        registerTowerOnGrid: logged('placement.registerTowerOnGrid'),
        unregisterTowerFromGrid: logged('placement.unregisterTowerFromGrid'),
        recomputeTowerLOS: logged('placement.recomputeTowerLOS'),
        scheduleLosRecompute: logged('placement.scheduleLosRecompute'),
        clearAllTowerOverlays: logged('placement.clearAllTowerOverlays'),
      };
    case 'SpatialGridService':
      return { updateEnemyTracked: () => null };
    case 'EconomyService':
      return {
        computeWaveCompletionBonus: logged('economy.computeWaveCompletionBonus', 7),
        reset: logged('economy.reset'),
      };
    default:
      return {};
  }
}

function createEngine(): never {
  const auto = (seed: Record<string, unknown> = {}) => withAutoStubs(seed);
  const engine = {
    getScene: () => ({}),
    getTerrainHeightAtGeo: () => 0,
    renderingEnabled: true,
    setTimescale: (scale: number) => log.push(`engine.setTimescale(${scale})`),
    sync: auto({
      getOrigin: () => ({ lat: 48.77, lon: 9.18, height: 0 }),
      geoToLocal: () => ({ x: 0, y: 0, z: 0 }),
      geoToLocalSimple: () => ({ x: 0, y: 0, z: 0 }),
      localToGeo: () => ({ lat: 48.77, lon: 9.18, height: 0 }),
    }),
    spatialAudio: auto({ playAtGeo: vi.fn(() => Promise.resolve()) }),
    effects: auto({
      clear: logged('engine.effects.clear'),
      spawnFloatingText: logged('engine.effects.spawnFloatingText'),
    }),
    towers: auto({
      updateRangeIndicator: logged('engine.towers.updateRangeIndicator'),
    }),
    plinths: auto(),
    towerBadges: auto(),
    bloodMoon: auto(),
    searchlights: auto(),
    enemies: auto(),
    projectiles: auto(),
    trailStreaks: auto(),
    tentacles: auto(),
    abilityMarkers: auto(),
    orbitalBeams: auto(),
    mushroomClouds: auto(),
    hero: auto(),
    oozes: auto(),
  };
  return auto(engine) as never;
}

/** Wraps methods of a live object: log the call, then run the original. */
function trace(obj: object, label: string, methods: string[]): void {
  const target = obj as Record<string, (...args: unknown[]) => unknown>;
  for (const method of methods) {
    const original = target[method].bind(obj);
    target[method] = (...args: unknown[]) => {
      log.push(`${label}.${method}`);
      return original(...args);
    };
  }
}

const BASE_POSITION = { lat: 48.77, lon: 9.18, height: 0 };
const SPAWN_POINTS = [{ id: 'sp-1', name: 'North', lat: 48.78, lon: 9.18, height: 0 }];

const COMBAT = [
  'combat.updateTowerShooting',
  'combat.updateBeamTowers',
  'combat.updateMeleeTowers',
  'combat.updateChainTowers',
];
const STEP_HEAD = [
  'projectile.update',
  'research.update',
  'research.startQueued',
  'ability.update',
  'bus.processQueue',
];
/** One sub-step outside a wave, no debug enemies */
const SETUP_STEP = [...STEP_HEAD, 'enemy.update', 'hero.update', 'onSubStep'];
/** One sub-step outside a wave with debug enemies: combat runs, no spawner */
const DEBUG_STEP = [...STEP_HEAD, 'enemy.update', ...COMBAT, 'hero.update', 'onSubStep'];
/** One sub-step in a wave: spawner, enemies, combat, hero, hook, then the wave-end check (no strike pending) */
const WAVE_STEP = [
  ...STEP_HEAD, 'wave.tickSpawn', 'enemy.update', ...COMBAT, 'hero.update', 'onSubStep',
  'ability.hasPendingStrikes', 'wave.checkWaveComplete',
];
/** Once per frame after the loop, when a sub-step ran and rendering is on */
const PRESENT = ['enemy.presentFrame', 'projectile.presentFrame', 'hero.presentFrame'];

const repeat = (sequence: string[], times: number): string[] =>
  Array.from({ length: times }, () => sequence).flat();

describe('GameStateManager order of operations (characterization)', () => {
  let gsm: GameStateManager;
  let bus: GameEventBus;
  let subscriptions: string[];
  const onSubStep = () => log.push('onSubStep');

  beforeEach(() => {
    for (const key of Object.keys(mockServices)) delete mockServices[key];
    GameObject.resetIdCounter();
    debugEnemies = [];
    waveCompleteAnswers = [];

    const on = vi.spyOn(GameEventBus.prototype, 'on');
    gsm = new GameStateManager();
    gsm.initialize(createEngine(), BASE_POSITION, SPAWN_POINTS as never[], new Map());
    subscriptions = on.mock.calls.map(([type]) => type);
    on.mockRestore();

    // The music has no audio graph here
    const music = gsm.backgroundMusic as unknown as Record<string, () => void>;
    for (const method of ['playBuildPhase', 'playWavePhase', 'fadeOutAndStop', 'stop']) {
      music[method] = () => undefined;
    }

    bus = gsm.getEventBus();
    trace(gsm.projectileManager, 'projectile', ['update', 'presentFrame', 'clear']);
    trace(gsm.researchManager, 'research', [
      'update', 'startQueued', 'reset', 'onCenterPlaced', 'onCenterRemoved', 'upgradeCenter',
    ]);
    trace(gsm.abilityManager, 'ability', ['update', 'reset', 'hasPendingStrikes']);
    trace(gsm.heroManager, 'hero', ['update', 'reset', 'presentFrame']);
    trace(bus, 'bus', ['processQueue']);
    trace(gsm.waveManager, 'wave', ['tickSpawn', 'endWave', 'reset', 'startWave', 'beginWave']);
    (gsm.waveManager as unknown as { checkWaveComplete: () => boolean }).checkWaveComplete = () => {
      log.push('wave.checkWaveComplete');
      return waveCompleteAnswers.shift() ?? false;
    };
    trace(gsm.enemyManager, 'enemy', ['update', 'presentFrame', 'clear']);
    trace(gsm.towerManager, 'tower', [
      'placeTower', 'sell', 'clear', 'selectTower', 'refreshGuardHeading', 'refreshGuardHeadings',
    ]);
    bus.onAny((event) => {
      if (event.type !== 'research:progress') log.push(`event:${event.type}`);
    });
    gsm.setCorridorPending(() => {
      log.push('corridorPending');
      return false;
    });
    log.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('frame and sub-steps', () => {
    it('runs a frame outside a wave: timescale to the renderer, the sub-steps, then the present', () => {
      gsm.update(1000, onSubStep); // first frame: 16 ms fallback, below one step
      gsm.update(1050, onSubStep); // 50 ms + 16 ms carried: three steps
      gsm.update(1066, onSubStep); // 16 ms + ~16 ms carried: one step

      expect(log).toEqual([
        'engine.setTimescale(1)',
        'engine.setTimescale(1)',
        ...repeat(SETUP_STEP, 3),
        ...PRESENT,
        'engine.setTimescale(1)',
        ...SETUP_STEP,
        ...PRESENT,
      ]);
    });

    it('runs the spawner and combat in a wave and checks the wave end after the per-step hook', () => {
      gsm.waveManager.phase.set('wave');
      gsm.update(1000, onSubStep);
      gsm.update(1050, onSubStep);

      expect(log).toEqual([
        'engine.setTimescale(1)',
        'engine.setTimescale(1)',
        ...repeat(WAVE_STEP, 3),
        ...PRESENT,
      ]);
    });

    it('runs combat outside a wave while debug enemies are alive', () => {
      debugEnemies = [{}];
      gsm.update(1000, onSubStep);
      gsm.update(1050, onSubStep);

      expect(log).toEqual([
        'engine.setTimescale(1)',
        'engine.setTimescale(1)',
        ...repeat(DEBUG_STEP, 3),
        ...PRESENT,
      ]);
    });

    it('ends a wave inside the sub-step it completes in, and the next sub-step delivers wave:completed', () => {
      gsm.waveManager.phase.set('wave');
      waveCompleteAnswers = [false, true];
      gsm.update(1000, onSubStep);
      log.length = 0;
      gsm.update(1050, onSubStep);

      expect(log).toEqual([
        'engine.setTimescale(1)',
        ...WAVE_STEP,
        ...WAVE_STEP,
        'wave.endWave',
        'enemy.clear',
        // The wave books its own completion gold (WaveManager.endWave through
        // the gold provider), so wave:completed can carry the real amount.
        'economy.computeWaveCompletionBonus',
        'event:credits:changed',
        'combat.stopAllBeams',
        'combat.stopAllMelee',
        'enemyDebug.clearDebugEnemies',
        ...STEP_HEAD,
        'event:wave:completed',
        'combat.turnTowersToGuard',
        'enemy.update',
        'hero.update',
        'onSubStep',
        ...PRESENT,
      ]);
      expect(gsm.waveManager.phase()).toBe('setup');
    });

    it('holds the wave end while a strike is pending, without asking the wave manager', () => {
      gsm.waveManager.phase.set('wave');
      waveCompleteAnswers = [true, true, true];
      (gsm.abilityManager as unknown as { hasPendingStrikes: () => boolean }).hasPendingStrikes = () => {
        log.push('ability.hasPendingStrikes');
        return true;
      };
      gsm.update(1000, onSubStep);
      gsm.update(1050, onSubStep);

      const heldStep = WAVE_STEP.slice(0, -1);
      expect(log).toEqual([
        'engine.setTimescale(1)',
        'engine.setTimescale(1)',
        ...repeat(heldStep, 3),
        ...PRESENT,
      ]);
      expect(gsm.waveManager.phase()).toBe('wave');
    });

    it('breaks the loop after the sub-step that destroys the base and keeps the remainder', () => {
      gsm.update(1000, onSubStep);
      gsm.baseHealth.set(0);
      log.length = 0;
      gsm.update(1050, onSubStep); // budget for three steps, one runs

      expect(log).toEqual([
        'engine.setTimescale(1)',
        ...SETUP_STEP,
        // The event goes out before the field is cleared: the run log writes
        // the block of the wave the base fell in, and it can only count the
        // enemies that were standing while they are still there.
        'event:game:over',
        'enemy.clear',
        'enemyDebug.clearDebugEnemies',
        'tower.selectTower',
        'hq.triggerGameOverEffects',
        ...PRESENT,
      ]);
      expect(gsm.waveManager.phase()).toBe('gameover');

      // 66 - 16.667 carried plus 16 ms: three steps, the game over is not repeated
      log.length = 0;
      gsm.update(1066, onSubStep);
      expect(log).toEqual(['engine.setTimescale(1)', ...repeat(SETUP_STEP, 3), ...PRESENT]);
    });

    it('syncs active research to the store once per frame, after the present', () => {
      gsm.addCredits(100_000, 'cheat');
      gsm.researchManager.onCenterPlaced();
      bus.emit({ type: 'command:start-research', researchId: 'gatling-tech' });
      gsm.update(1000, onSubStep);
      log.length = 0;
      gsm.update(1050, onSubStep);

      expect(log).toEqual([
        'engine.setTimescale(1)',
        ...repeat(SETUP_STEP, 3),
        ...PRESENT,
        'researchStore.activeResearches.set',
      ]);
    });

    it('hands the frame timing to the profiler last', () => {
      gsm.setProfiler({
        accumulateFrameTiming: (...args: unknown[]) => log.push(`profiler.accumulateFrameTiming(steps=${args[5]})`),
      } as never);
      gsm.update(1000, onSubStep);
      gsm.update(1050, onSubStep);

      expect(log).toEqual([
        'engine.setTimescale(1)',
        'profiler.accumulateFrameTiming(steps=0)',
        'engine.setTimescale(1)',
        ...repeat(SETUP_STEP, 3),
        ...PRESENT,
        'profiler.accumulateFrameTiming(steps=3)',
      ]);
    });

    it('skips presenting when rendering is off', () => {
      (gsm.tilesEngine as unknown as { renderingEnabled: boolean }).renderingEnabled = false;
      gsm.update(1000, onSubStep);
      gsm.update(1050, onSubStep);

      expect(log).toEqual(['engine.setTimescale(1)', 'engine.setTimescale(1)', ...repeat(SETUP_STEP, 3)]);
    });
  });

  describe('pause', () => {
    it('only stops the renderer clock while paused and resumes without catching up', () => {
      gsm.update(1000, onSubStep);
      gsm.update(1050, onSubStep);
      const clock = gsm.gameTimeMs;
      log.length = 0;

      gsm.paused.set(true);
      gsm.update(1066, onSubStep);
      gsm.update(5000, onSubStep);
      expect(log).toEqual(['engine.setTimescale(0)', 'engine.setTimescale(0)']);
      expect(gsm.gameTimeMs).toBe(clock);

      log.length = 0;
      gsm.paused.set(false);
      gsm.update(5016, onSubStep); // 16 ms since the last paused frame, ~16 ms carried
      expect(log).toEqual(['engine.setTimescale(1)', ...SETUP_STEP, ...PRESENT]);
    });
  });

  describe('timescale', () => {
    it('runs the same sub-step sequence at 10x, only more of them per frame', () => {
      gsm.setGameSpeed(10, false);
      gsm.waveManager.phase.set('wave');
      gsm.update(1000, onSubStep); // 16 ms x 10: nine steps
      gsm.update(1020, onSubStep); // 20 ms x 10 + ~10 ms carried: twelve steps

      expect(log).toEqual([
        'engine.setTimescale(10)',
        ...repeat(WAVE_STEP, 9),
        ...PRESENT,
        'engine.setTimescale(10)',
        ...repeat(WAVE_STEP, 12),
        ...PRESENT,
      ]);
    });

    it('advances the clock before the step and hands every consumer the same game time', () => {
      const seen: string[] = [];
      const combat = mockServices['TowerCombatService'] as Record<string, ReturnType<typeof vi.fn>>;
      combat['updateTowerShooting'].mockImplementation((now: number, stepMs: number) => seen.push(`shoot ${now} ${stepMs}`));
      const enemyUpdate = gsm.enemyManager.update.bind(gsm.enemyManager);
      gsm.enemyManager.update = (stepMs: number, now: number) => {
        seen.push(`enemy ${now} ${stepMs}`);
        enemyUpdate(stepMs, now);
      };
      const present = gsm.enemyManager.presentFrame.bind(gsm.enemyManager);
      gsm.enemyManager.presentFrame = (now: number) => {
        seen.push(`present ${now}`);
        present(now);
      };

      gsm.setGameSpeed(10, false);
      gsm.waveManager.phase.set('wave');
      gsm.update(1000, (stepMs) => seen.push(`hook ${gsm.gameTimeMs} ${stepMs}`));

      const expected: string[] = [];
      let now = 0;
      for (let i = 0; i < 9; i++) {
        now += 16.667;
        expected.push(`enemy ${now} 16.667`, `shoot ${now} 16.667`, `hook ${now} 16.667`);
      }
      expected.push(`present ${now}`);
      expect(seen).toEqual(expected);
      expect(gsm.gameTimeMs).toBe(now);
    });
  });

  describe('event wiring', () => {
    it('subscribes in this order at construction and initialize()', () => {
      expect(subscriptions).toEqual([
        // EnemyManager, WaveManager, AbilityManager, HeroManager (constructors)
        'debug:remove-enemy', 'debug:spawn-enemy',
        'debug:kill-all', 'enemy:reached-base', 'enemy:leaking', 'enemy:died',
        'research:completed', 'wave:completed',
        'research:completed', 'hero:kill',
        // ReplayRecorder: its triggers; every other event only while it records a wave (onAny)
        'command:start-wave', 'wave:started', 'wave:jumped',
        // VFXService, AudioService, ScreenShakeService, BackgroundMusicService, BloodMoonService
        'vfx:projectile-impact', 'vfx:blood', 'vfx:muzzle-flash', 'vfx:chain-lightning',
        'enemy:split', 'ability:used', 'ability:impact', 'ability:state-changed', 'game:reset', 'hero:level-up',
        'audio:play', 'ability:used', 'ability:impact', 'game:reset',
        'vfx:projectile-impact', 'health:changed', 'ability:used', 'ability:impact', 'enemy:died',
        'wave:started', 'wave:completed', 'game:over', 'game:reset',
        'wave:started', 'wave:completed', 'game:over', 'game:reset',
        // GameStateManager: AA retrofit, guard turns, kill reward
        'enemy:reached-base', 'enemy:leaking', 'research:completed', 'wave:completed',
        'enemy:died', 'enemy:reached-base', 'debug:remove-enemy', 'debug:kill-all', 'enemy:died',
        // GameCommandsHandler
        'command:place-tower', 'command:sell-tower', 'command:upgrade-tower', 'command:set-targeting',
        'command:set-hold-fire',
        'command:start-research', 'command:cancel-research', 'command:queue-research', 'command:unqueue-research',
        'command:move-queued-research',
        'command:use-ability',
        'command:hire-hero', 'command:hero-move', 'command:hero-ammo',
        'command:start-wave', 'command:restart-game',
        'debug:add-credits', 'debug:add-health', 'debug:complete-all-research', 'debug:max-upgrade-all-towers',
        'debug:ready-ability', 'debug:jump-to-wave', 'debug:ready-hero',
      ]);
    });

    it('answers a leak with the health change first, then the guard turn', () => {
      bus.emit({ type: 'enemy:reached-base', enemy: { id: 'e1' } as never, damage: 10 });

      expect(log).toEqual([
        'event:enemy:reached-base',
        'event:health:changed',
        'combat.turnTowersToGuard',
      ]);
    });

    it('answers a kill with the guard turn first, then the credits and the popup', () => {
      bus.emit({
        type: 'enemy:died',
        enemy: {
          id: 'e1',
          position: { lat: 48.77, lon: 9.18, height: 0 },
          transform: { terrainHeight: 0 },
          heightOffset: 0,
        } as never,
        credits: 5,
        killedBy: null,
      });

      expect(log).toEqual([
        'event:enemy:died',
        'combat.turnTowersToGuard',
        'event:credits:changed',
        'engine.effects.spawnFloatingText',
      ]);
    });

    it('queues an LOS recompute when research unlocks air targeting', () => {
      gsm.addCredits(10_000, 'cheat');
      const gatling = gsm.placeTower(BASE_POSITION, 'dual-gatling');
      expect(gatling).not.toBeNull();
      log.length = 0;

      bus.emit({
        type: 'research:completed',
        researchId: 'aa-retrofit',
        effects: [{ kind: 'enable-targeting', capability: 'air' }],
      });
      expect(log).toEqual(['event:research:completed', 'placement.scheduleLosRecompute']);
    });
  });

  describe('tower lifecycle', () => {
    let archer: Tower;

    beforeEach(() => {
      gsm.addCredits(100_000, 'cheat');
      log.length = 0;
      bus.emit({ type: 'command:place-tower', position: BASE_POSITION, typeId: 'archer' });
      archer = gsm.towerManager.getAll()[0];
    });

    it('places: tower, cost, grid registration', () => {
      expect(archer).toBeDefined();
      expect(log).toEqual([
        'event:command:place-tower',
        'corridorPending',
        'tower.placeTower',
        'tower.refreshGuardHeading',
        'event:tower:placed',
        'event:audio:play',
        'event:credits:changed',
        'placement.registerTowerOnGrid',
      ]);
    });

    it('upgrades range: cost, LOS, range ring, guard heading, then tower:upgraded', () => {
      log.length = 0;
      bus.emit({ type: 'command:upgrade-tower', towerId: archer.id, upgradeId: 'range' });

      expect(log).toEqual([
        'event:command:upgrade-tower',
        'event:credits:changed',
        'placement.recomputeTowerLOS',
        'engine.towers.updateRangeIndicator',
        'tower.refreshGuardHeading',
        'combat.turnToGuardHeading',
        'event:tower:upgraded',
      ]);
    });

    it('refuses an upgrade above the researched tier without a trace', () => {
      for (let i = 0; i < 5; i++) archer.applyUpgrade('damage');
      log.length = 0;
      const credits = gsm.credits();
      bus.emit({ type: 'command:upgrade-tower', towerId: archer.id, upgradeId: 'damage' });

      expect(log).toEqual(['event:command:upgrade-tower']);
      expect(gsm.credits()).toBe(credits);
    });

    it('sells: grid, selection, tower, refund', () => {
      log.length = 0;
      bus.emit({ type: 'command:sell-tower', towerId: archer.id });

      expect(log).toEqual([
        'event:command:sell-tower',
        'placement.unregisterTowerFromGrid',
        'tower.selectTower',
        'tower.sell',
        'event:tower:sold',
        'event:audio:play',
        'event:credits:changed',
      ]);
    });

    it('places and sells the research center with the research manager last and first', () => {
      log.length = 0;
      bus.emit({ type: 'command:place-tower', position: { ...BASE_POSITION, lat: 48.771 }, typeId: 'research-center' });
      const center = gsm.towerManager.getAll().find((t) => t.typeConfig.id === 'research-center')!;
      expect(log).toEqual([
        'event:command:place-tower',
        'corridorPending',
        'tower.placeTower',
        'tower.refreshGuardHeading',
        'event:tower:placed',
        'event:audio:play',
        'event:credits:changed',
        'research.onCenterPlaced',
        'event:research:state-changed',
      ]);

      log.length = 0;
      bus.emit({ type: 'command:sell-tower', towerId: center.id });
      expect(log).toEqual([
        'event:command:sell-tower',
        'placement.unregisterTowerFromGrid',
        'tower.selectTower',
        'research.onCenterRemoved',
        'event:research:state-changed',
        'tower.sell',
        'event:tower:sold',
        'event:audio:play',
        'event:credits:changed',
      ]);
    });

    it('places and sells the missile silo with the ability snapshot last, after the tower list changed', () => {
      const snapshots: boolean[] = [];
      bus.on('ability:state-changed', (e) => snapshots.push(e.abilities.find((a) => a.id === 'nuclear-strike')!.launchSite));
      log.length = 0;
      bus.emit({ type: 'command:place-tower', position: { ...BASE_POSITION, lat: 48.771 }, typeId: 'missile-silo' });
      const silo = gsm.towerManager.getAll().find((t) => t.typeConfig.id === 'missile-silo')!;
      expect(log).toEqual([
        'event:command:place-tower',
        'corridorPending',
        'tower.placeTower',
        'tower.refreshGuardHeading',
        'event:tower:placed',
        'event:audio:play',
        'event:credits:changed',
        'event:ability:state-changed',
      ]);

      log.length = 0;
      bus.emit({ type: 'command:sell-tower', towerId: silo.id });
      expect(log).toEqual([
        'event:command:sell-tower',
        'placement.unregisterTowerFromGrid',
        'tower.selectTower',
        'tower.sell',
        'event:tower:sold',
        'event:audio:play',
        'event:credits:changed',
        'event:ability:state-changed',
      ]);
      expect(snapshots).toEqual([true, false]);
    });

    it('max-upgrades every tower through the debug command', () => {
      log.length = 0;
      bus.emit({ type: 'debug:max-upgrade-all-towers' });

      expect(log).toEqual([
        'event:debug:max-upgrade-all-towers',
        'placement.recomputeTowerLOS',
        'engine.towers.updateRangeIndicator',
        'tower.refreshGuardHeading',
        'combat.turnToGuardHeading',
        'event:tower:upgraded',
      ]);
    });
  });

  describe('lifecycle', () => {
    it('starts the first wave: corridor lock, preview, game:started, then the wave', () => {
      gsm.startWave({
        schedule: {
          entries: [
            { enemyType: 'zombie', speed: 1, health: 10 },
            { enemyType: 'zombie', speed: 1, health: 10 },
          ],
          baseDelay: 100,
        },
      } as never);

      expect(log).toEqual([
        'corridorPending',
        'waveDebug.setCurrentWaveGroups',
        'event:game:started',
        'wave.startWave',
        'event:wave:started',
      ]);
    });

    it('begins a manual wave: corridor lock, game:started, then the wave', () => {
      gsm.beginWave();

      expect(log).toEqual([
        'corridorPending',
        'event:game:started',
        'wave.beginWave',
        'event:wave:started',
      ]);
    });

    it('resets in this order', () => {
      gsm.spendCredits(10, 'cheat');
      log.length = 0;
      gsm.reset();

      expect(log).toEqual([
        'hq.reset',
        'tower.selectTower',
        'placement.clearAllTowerOverlays',
        'combat.stopAllBeams',
        'combat.stopAllMelee',
        'enemy.clear',
        'enemyDebug.clearDebugEnemies',
        'tower.clear',
        'projectile.clear',
        'wave.reset',
        'enemy.clear',
        'research.reset',
        'ability.reset',
        'hero.reset',
        'engine.effects.clear',
        'event:credits:changed',
        'economy.reset',
        'event:game:reset',
      ]);
    });

    it('applies debug health and heal through health:changed', () => {
      bus.emit({ type: 'debug:add-health', amount: -20 });
      gsm.healBase();

      expect(log).toEqual(['event:debug:add-health', 'event:health:changed', 'hq.healBase']);
    });
  });
});
