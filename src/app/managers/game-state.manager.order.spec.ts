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
 * the loop makes, the renderer calls (SimSink) log as `sink.*`. Nothing is
 * presented from the loop any more: the frame packet is written after it
 * (SimCore). `research:progress` stays out of the log: it is throttled on the
 * wall clock, not on game time.
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
import { GameEventBus } from '../game-engine/game-event-bus';
import { GameObject } from '../core/game-object';
import { createSinkSpy, createTestCoords, createTestOps, withAutoStubs } from '../integration/test-helpers';
import type { Tower } from '../entities/tower.entity';
import type { GameEvent } from '../game-engine/game-event-bus';
import { LOCAL_PLAYER_ID } from './game-state/command-log';

const log: string[] = [];
const logged = (label: string, ret?: unknown) => vi.fn(() => {
  log.push(label);
  return ret;
});

/** Answers of checkWaveComplete, in call order; false once empty. */
let waveCompleteAnswers: boolean[] = [];

/** The renderer calls the order depends on log, every other one is a quiet stub */
function createSink() {
  const sink = createSinkSpy() as unknown as Record<string, Record<string, unknown>>;
  sink['effects']['clear'] = logged('sink.effects.clear');
  sink['effects']['spawnFloatingText'] = logged('sink.effects.spawnFloatingText');
  sink['oozes']['clear'] = logged('sink.oozes.clear');
  sink['towers']['updateRangeIndicator'] = logged('sink.towers.updateRangeIndicator');
  return sink;
}

function createStub(name: string): Record<string, unknown> {
  switch (name) {
    case 'SimCoords':
      return createTestCoords() as unknown as Record<string, unknown>;
    case 'SimOps':
      return createTestOps(createSink() as never) as unknown as Record<string, unknown>;
    case 'GlobalRouteGridService':
      // A world stands: towers ask for their line of sight
      return { isInitialized: () => true, getGroundLocalYAt: () => null, getGroundLocalYForEnemy: () => null };
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
/**
 * One sub-step in a wave: spawner, enemies, combat, hero, the wave-end check
 * (no strike pending), then the hook at the boundary. The hook (bot tick)
 * ran before the check until the command boundary (SIMULATOR_PLAN P1): a
 * bot's command landed inside the step then.
 */
const WAVE_STEP = [
  ...STEP_HEAD, 'wave.tickSpawn', 'enemy.update', ...COMBAT, 'hero.update',
  'ability.hasPendingStrikes', 'wave.checkWaveComplete', 'onSubStep',
];
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
    waveCompleteAnswers = [];

    const on = vi.spyOn(GameEventBus.prototype, 'on');
    gsm = new GameStateManager();
    gsm.initialize(BASE_POSITION, SPAWN_POINTS as never[], new Map());
    subscriptions = on.mock.calls.map(([type]) => type);
    on.mockRestore();

    bus = gsm.getEventBus();
    trace(gsm.projectileManager, 'projectile', ['update', 'clear']);
    trace(gsm.researchManager, 'research', [
      'update', 'startQueued', 'reset', 'onCenterPlaced', 'onCenterRemoved', 'upgradeCenter',
    ]);
    trace(gsm.abilityManager, 'ability', ['update', 'reset', 'hasPendingStrikes']);
    trace(gsm.heroManager, 'hero', ['update', 'reset']);
    trace(bus, 'bus', ['processQueue']);
    trace(gsm.waveManager, 'wave', ['tickSpawn', 'endWave', 'reset', 'startWave', 'beginWave']);
    (gsm.waveManager as unknown as { checkWaveComplete: () => boolean }).checkWaveComplete = () => {
      log.push('wave.checkWaveComplete');
      return waveCompleteAnswers.shift() ?? false;
    };
    trace(gsm.enemyManager, 'enemy', ['update', 'clear']);
    trace(gsm.towerManager, 'tower', [
      'placeTower', 'sell', 'clear', 'refreshGuardHeading', 'refreshGuardHeadings',
    ]);
    trace(gsm.towerLos, 'los', ['register', 'recompute', 'unregister', 'clearAll']);
    trace(gsm.debugEnemies, 'debugEnemies', ['clear']);
    bus.onAny((event) => {
      if (event.type !== 'research:progress') log.push(`event:${event.type}`);
    });
    const corridorPending = gsm.corridorPending.bind(gsm);
    gsm.corridorPending = () => {
      log.push('corridorPending');
      return corridorPending();
    };
    log.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('frame and sub-steps', () => {
    it('runs a frame outside a wave: the sub-steps, nothing else', () => {
      gsm.update(1000, onSubStep); // first frame: 16 ms fallback, below one step
      gsm.update(1050, onSubStep); // 50 ms + 16 ms carried: three steps
      gsm.update(1066, onSubStep); // 16 ms + ~16 ms carried: one step

      expect(log).toEqual([
        ...repeat(SETUP_STEP, 3),
        ...SETUP_STEP,
      ]);
    });

    it('runs the spawner and combat in a wave and checks the wave end before the per-step hook', () => {
      gsm.waveManager.phase.set('wave');
      gsm.update(1000, onSubStep);
      gsm.update(1050, onSubStep);

      expect(log).toEqual(repeat(WAVE_STEP, 3));
    });

    it('runs combat outside a wave while debug enemies are alive', () => {
      gsm.debugEnemies.add({ id: 'enemy-99' } as never);
      gsm.update(1000, onSubStep);
      gsm.update(1050, onSubStep);

      expect(log).toEqual(repeat(DEBUG_STEP, 3));
    });

    it('ends a wave inside the sub-step it completes in, and the next sub-step delivers wave:completed', () => {
      gsm.waveManager.phase.set('wave');
      waveCompleteAnswers = [false, true];
      gsm.update(1000, onSubStep);
      log.length = 0;
      gsm.update(1050, onSubStep);

      expect(log).toEqual([
        ...WAVE_STEP,
        ...WAVE_STEP.slice(0, -1),
        'wave.endWave',
        'enemy.clear',
        // The wave books its own completion gold (WaveManager.endWave through
        // the gold provider), so wave:completed can carry the real amount.
        'economy.computeWaveCompletionBonus',
        'event:credits:changed',
        'combat.stopAllBeams',
        'combat.stopAllMelee',
        'debugEnemies.clear',
        // The hook sees the setup the check just began
        'onSubStep',
        ...STEP_HEAD,
        'event:wave:completed',
        'combat.turnTowersToGuard',
        'enemy.update',
        'hero.update',
        'onSubStep',
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

      const heldStep = WAVE_STEP.filter((call) => call !== 'wave.checkWaveComplete');
      expect(log).toEqual(repeat(heldStep, 3));
      expect(gsm.waveManager.phase()).toBe('wave');
    });

    it('breaks the loop after the sub-step that destroys the base and keeps the remainder', () => {
      gsm.update(1000, onSubStep);
      gsm.baseHealth.set(0);
      log.length = 0;
      gsm.update(1050, onSubStep); // budget for three steps, one runs

      expect(log).toEqual([
        // No hook after the step that ends the game: the loop breaks first
        ...SETUP_STEP.slice(0, -1),
        // The event goes out before the field is cleared: the run log writes
        // the block of the wave the base fell in, and it can only count the
        // enemies that were standing while they are still there.
        'event:game:over',
        'enemy.clear',
        'debugEnemies.clear',
      ]);
      expect(gsm.waveManager.phase()).toBe('gameover');

      // 66 - 16.667 carried plus 16 ms: three steps, the game over is not repeated
      log.length = 0;
      gsm.update(1066, onSubStep);
      expect(log).toEqual(repeat(SETUP_STEP, 3));
    });

    it('hands the frame timing to the profiler last', () => {
      gsm.setProfiler({
        accumulateFrameTiming: (...args: unknown[]) => log.push(`profiler.accumulateFrameTiming(steps=${args[5]})`),
      } as never);
      gsm.update(1000, onSubStep);
      gsm.update(1050, onSubStep);

      expect(log).toEqual([
        'profiler.accumulateFrameTiming(steps=0)',
        ...repeat(SETUP_STEP, 3),
        'profiler.accumulateFrameTiming(steps=3)',
      ]);
    });

  });

  describe('pause', () => {
    it('runs nothing while paused and resumes without catching up', () => {
      gsm.update(1000, onSubStep);
      gsm.update(1050, onSubStep);
      const clock = gsm.gameTimeMs;
      log.length = 0;

      gsm.paused.set(true);
      gsm.update(1066, onSubStep);
      gsm.update(5000, onSubStep);
      expect(log).toEqual([]);
      expect(gsm.gameTimeMs).toBe(clock);

      log.length = 0;
      gsm.paused.set(false);
      gsm.update(5016, onSubStep); // 16 ms since the last paused frame, ~16 ms carried
      expect(log).toEqual(SETUP_STEP);
    });
  });

  describe('timescale', () => {
    it('runs the same sub-step sequence at 10x, only more of them per frame', () => {
      gsm.setGameSpeed(10);
      gsm.waveManager.phase.set('wave');
      gsm.update(1000, onSubStep); // 16 ms x 10: nine steps
      gsm.update(1020, onSubStep); // 20 ms x 10 + ~10 ms carried: twelve steps

      expect(log).toEqual([
        ...repeat(WAVE_STEP, 9),
        ...repeat(WAVE_STEP, 12),
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

      gsm.setGameSpeed(10);
      gsm.waveManager.phase.set('wave');
      gsm.update(1000, (stepMs) => seen.push(`hook ${gsm.gameTimeMs} ${stepMs}`));

      const expected: string[] = [];
      let now = 0;
      for (let i = 0; i < 9; i++) {
        now += 16.667;
        expected.push(`enemy ${now} 16.667`, `shoot ${now} 16.667`, `hook ${now} 16.667`);
      }
      expect(seen).toEqual(expected);
      expect(gsm.gameTimeMs).toBe(now);
    });
  });

  describe('event wiring', () => {
    it('subscribes in this order at construction and initialize()', () => {
      expect(subscriptions).toEqual([
        // EnemyManager, WaveManager, AbilityManager, HeroManager (constructors)
        'enemy:reached-base', 'enemy:leaking', 'enemy:died',
        'research:completed', 'wave:completed',
        'research:completed', 'hero:kill',
        // GameStateManager: LOS masks for the re-simulation, AA retrofit, guard turns, kill reward
        'enemy:reached-base', 'enemy:leaking',
        'tower:los-resolved',
        'research:completed', 'wave:completed',
        'enemy:died', 'enemy:reached-base', 'enemy:died',
        // GameCommandsHandler
        'command:place-tower', 'command:sell-tower', 'command:upgrade-tower', 'command:set-targeting',
        'command:set-hold-fire', 'command:man-tower', 'command:leave-tower', 'command:tower-trigger',
        'command:tower-aim',
        'command:start-research', 'command:cancel-research', 'command:queue-research', 'command:unqueue-research',
        'command:move-queued-research',
        'command:use-ability',
        'command:hire-hero', 'command:hero-move', 'command:hero-ammo',
        'command:start-wave', 'command:los-mask', 'command:leave-game', 'command:set-ready', 'command:give-credits',
        'command:restart-game',
        'debug:add-credits', 'debug:add-health', 'debug:complete-all-research', 'debug:kill-all', 'debug:spawn-enemy',
        'debug:remove-enemy', 'debug:max-upgrade-all-towers',
        'debug:ready-ability', 'debug:jump-to-wave', 'debug:enemy-move', 'debug:movement', 'debug:enemy-speed',
        'debug:ready-hero',
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
        'sink.effects.spawnFloatingText',
      ]);
    });

    it('asks for the line of sight again when research unlocks air targeting', () => {
      gsm.addCredits(10_000, 'cheat');
      gsm.researchManager.completeResearch('gatling-tech');
      const gatling = gsm.placeTower(BASE_POSITION, 'dual-gatling');
      expect(gatling).not.toBeNull();
      gsm.towerLos.applyMask(gatling!, { range: 20, ground: true, air: false, bits: new Uint8Array(0) });
      log.length = 0;

      bus.emit({
        type: 'research:completed', playerId: 'local', local: true,
        researchId: 'aa-retrofit',
        effects: [{ kind: 'enable-targeting', capability: 'air' }],
      });
      expect(log).toEqual(['event:research:completed', 'los.recompute', 'event:tower:los-needed']);
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

    it('places: tower, cost, then the request for its line of sight', () => {
      expect(archer).toBeDefined();
      expect(log).toEqual([
        'event:command:place-tower',
        'corridorPending',
        'tower.placeTower',
        'tower.refreshGuardHeading',
        'event:tower:placed',
        'event:audio:play',
        'event:credits:changed',
        'los.register',
        'event:tower:los-needed',
      ]);
    });

    it('upgrades range: cost, LOS request, range ring, guard heading, then tower:upgraded', () => {
      gsm.towerLos.applyMask(archer, { range: 20, ground: true, air: false, bits: new Uint8Array(0) });
      log.length = 0;
      bus.emit({ type: 'command:upgrade-tower', towerId: archer.id, upgradeId: 'range' });

      expect(log).toEqual([
        'event:command:upgrade-tower',
        'event:credits:changed',
        'los.recompute',
        'event:tower:los-needed',
        'sink.towers.updateRangeIndicator',
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

    it('sells: grid, tower, refund', () => {
      log.length = 0;
      bus.emit({ type: 'command:sell-tower', towerId: archer.id });

      expect(log).toEqual([
        'event:command:sell-tower',
        'los.unregister',
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
        'los.unregister',
        'research.onCenterRemoved',
        'event:research:state-changed',
        'tower.sell',
        'event:tower:sold',
        'event:audio:play',
        'event:credits:changed',
      ]);
    });

    it('places and sells the missile silo with the ability snapshot last, after the tower list changed', () => {
      gsm.researchManager.completeResearch('nuclear-strike');
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
        'los.unregister',
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
        // Still waiting for its first sight: that answer covers the new range
        'los.recompute',
        'sink.towers.updateRangeIndicator',
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
        // The wave-start snapshot asks whether a strike is pending (snapshotRefusal)
        'ability.hasPendingStrikes',
        'event:wave:groups',
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
        'los.clearAll',
        'combat.stopAllBeams',
        'combat.stopAllMelee',
        'enemy.clear',
        'debugEnemies.clear',
        'tower.clear',
        'projectile.clear',
        'wave.reset',
        'enemy.clear',
        'research.reset',
        'ability.reset',
        'hero.reset',
        'sink.effects.clear',
        'sink.oozes.clear',
        'event:credits:changed',
        'economy.reset',
        'event:game:reset',
      ]);
    });

    it('applies debug health and heal through health:changed', () => {
      bus.emit({ type: 'debug:add-health', amount: -20 });
      gsm.healBase();

      expect(log).toEqual(['event:debug:add-health', 'event:health:changed']);
    });
  });

  // Commands act between two complete sub-steps and land in the command log
  // with that boundary (docs/EVENT_SYSTEM.md, "Befehlsgrenze und Befehlslog")
  describe('command boundary and log', () => {
    const ADD_5: GameEvent = { type: 'debug:add-credits', amount: 5 };

    /** Emit `command` once from inside the next sub-step, after the hero, as a listener of a sim event would. */
    function emitInStep(command: GameEvent): void {
      const hero = gsm.heroManager as unknown as { update: (ms: number) => void };
      const update = hero.update;
      let sent = false;
      hero.update = (ms) => {
        update(ms);
        if (sent) return;
        sent = true;
        bus.emit(command);
      };
    }

    it('holds a command from inside a sub-step until the step and its checks are done', () => {
      gsm.waveManager.phase.set('wave');
      gsm.update(1000, onSubStep);
      emitInStep(ADD_5);
      log.length = 0;
      gsm.update(1016, onSubStep); // 16 ms + 16 ms carried: one step

      const step = WAVE_STEP.slice(0, -1);
      expect(log).toEqual([
        ...step.slice(0, step.indexOf('hero.update') + 1),
        'event:debug:add-credits',
        'ability.hasPendingStrikes',
        'wave.checkWaveComplete',
        // The boundary
        'event:credits:changed',
        'onSubStep',
      ]);
      expect(gsm.commandLog.entries).toEqual([
        { step: 1, playerId: LOCAL_PLAYER_ID, command: { type: 'debug:add-credits', amount: 5 } },
      ]);
    });

    it('runs a command from between two frames at once, stamped with the steps run so far', () => {
      gsm.update(1000, onSubStep);
      gsm.update(1050, onSubStep); // three steps
      log.length = 0;
      bus.emit(ADD_5);

      expect(log).toEqual(['event:debug:add-credits', 'event:credits:changed']);
      expect(gsm.commandLog.entries.map((e) => e.step)).toEqual([3]);
    });

    it('runs the per-step hook at the boundary: a bot command acts before the next step', () => {
      gsm.update(1000, onSubStep);
      log.length = 0;
      let sent = false;
      gsm.update(1050, () => {
        log.push('onSubStep');
        if (sent) return;
        sent = true;
        bus.emit(ADD_5);
      });

      expect(log).toEqual([
        ...SETUP_STEP,
        'event:debug:add-credits',
        'event:credits:changed',
        ...SETUP_STEP,
        ...SETUP_STEP,
      ]);
      expect(gsm.commandLog.entries.map((e) => e.step)).toEqual([1]);
    });

    it('runs a command from the step that ends the game after the game over, before the loop breaks', () => {
      gsm.update(1000, onSubStep);
      gsm.baseHealth.set(0);
      emitInStep(ADD_5);
      log.length = 0;
      gsm.update(1050, onSubStep);

      expect(log).toEqual([
        ...SETUP_STEP.slice(0, -1),
        'event:debug:add-credits',
        'event:game:over',
        'enemy.clear',
        'debugEnemies.clear',
        'event:credits:changed',
      ]);
      expect(gsm.commandLog.entries.map((e) => e.step)).toEqual([1]);
    });

    it('logs a refused command as well: a re-simulation has to see the same inputs', () => {
      bus.emit({ type: 'command:hire-hero' });

      expect(log).toEqual(['event:command:hire-hero', 'event:hero:rejected']);
      expect(gsm.commandLog.entries).toEqual([
        { step: 0, playerId: LOCAL_PLAYER_ID, command: { type: 'command:hire-hero' } },
      ]);
    });

    it('runs a logged command again through the same path and logs it again', () => {
      bus.emit(ADD_5);
      const credits = gsm.credits();
      gsm.replayCommand(gsm.commandLog.entries[0]);

      expect(gsm.credits()).toBe(credits + 5);
      expect(gsm.commandLog.entries).toHaveLength(2);
      expect(gsm.commandLog.entries[1]).toEqual(gsm.commandLog.entries[0]);
    });

    it('starts a new log with a new run', () => {
      bus.emit(ADD_5);
      bus.emit({ type: 'command:restart-game' });
      expect(gsm.commandLog.entries).toEqual([]);

      bus.emit(ADD_5);
      gsm.reset();
      expect(gsm.commandLog.entries).toEqual([]);
    });
  });
});
