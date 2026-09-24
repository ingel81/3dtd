/**
 * Integration Test: playtest points 320, 335, 395 and 397 of night 2
 * (docs/archive/REVIEW_SPRINT_2026-09-14.md) through the real GameStateManager
 * sub-step loop, with the real VFX, audio and screen shake services it
 * creates, the real damage path and real enemies.
 *
 * 320: a restart during the warning leaves no marker, cloud or rumble.
 * 335: the quieter repeats of the strike's sound wait out a pause and come
 *      sooner at 4x.
 * 395: a pause holds the freeze, the enemies stand on after it.
 * 397: the wave waits for the beam; its fire share caps the unarmored at
 *      60 %, takes a good quarter from a tank and hardly anything from a ghost.
 *
 * Harness as in ability-strike.spec.ts: only the services around the loop are
 * stubbed, the route grid's radius query is a plain distance filter over the
 * living enemies. The engine's ability renderers and its spatial audio are
 * stubs the test reads back.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

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
      if (!mockServices[name]) mockServices[name] = withAutoStubs({});
      return mockServices[name];
    },
  };
});

import {
  addMissileSilo,
  createMockTilesEngine,
  createTestCachedPaths,
  withAutoStubs,
  TEST_PATH,
  TEST_SPAWN_POINTS,
} from './test-helpers';
import { GameStateManager } from '../managers/game-state.manager';
import { CombatEffectService } from '../services/combat/combat-effect.service';
import { DamageApplicationService } from '../services/combat/damage-application.service';
import { StatusEffectService } from '../services/combat/status-effect.service';
import { GameObject } from '../core/game-object';
import { ABILITIES, type AbilityId } from '../configs/abilities.config';
import { GAME_SOUNDS } from '../configs/audio.config';
import type { EnemyTypeId } from '../configs/enemy-types.config';
import { geoDistanceFast } from '../utils/geo-utils';
import type { Enemy } from '../entities/enemy.entity';
import type { SpawnStart } from '../managers/enemy.manager';
import type { GeoPosition } from '../models/game.types';

type Mock = ReturnType<typeof vi.fn>;

/** The engine the loop gets, and its parts for the test to read back */
function createEngine() {
  // The helper's engine is typed; the loop reaches a few members it does not declare
  const engine = createMockTilesEngine() as unknown as Record<string, Record<string, unknown>>;
  for (const key of ['effects', 'towers', 'enemies', 'projectiles', 'trailStreaks', 'spatialAudio', 'sync', 'orbitalBeams']) {
    engine[key] = withAutoStubs(engine[key]);
  }
  engine['enemies']['create'] = vi.fn(() => Promise.resolve(null));
  // BackgroundMusicService resumes the audio context on wave:started
  engine['spatialAudio']['getListener'] = () => ({ context: { state: 'running', resume: () => Promise.resolve() } });
  // AudioService plays an impact sound and every repeat of its tail here
  engine['spatialAudio']['playAtGeo'] = vi.fn(() => Promise.resolve(null));
  // Headless, like a training tab: no presentFrame
  (engine as Record<string, unknown>)['renderingEnabled'] = false;
  // Every other part (ability renderers, plinths, blood moon, ...) a callable
  // stub whose members are stubs as well, so GameStateManager.reset() runs
  // through; the test reads the ability renderers back from it
  const full = new Proxy(engine, {
    get(obj, prop, receiver) {
      if (!(prop in obj)) Reflect.set(obj, prop, withAutoStubs(vi.fn()));
      return Reflect.get(obj, prop, receiver);
    },
  });
  return { engine: full as never, parts: full as unknown as Record<string, Record<string, Mock>> };
}

const BASE_POSITION: GeoPosition = TEST_PATH[TEST_PATH.length - 1];
/** The fourth waypoint, about 33 m down the path */
const TARGET: GeoPosition = TEST_PATH[3];
const SEGMENT_M = geoDistanceFast(TEST_PATH[0], TEST_PATH[1]);
/** 6500 ms of warning in sub-steps of 16.667 ms */
const NUKE_WARNING_STEPS = 390;
const TAIL = GAME_SOUNDS.nuclearStrike.tail;
/** Sub-steps until the last repeat of the tail, and a few more */
const TAIL_STEPS = Math.ceil(Math.max(...TAIL.map((r) => r.delayMs)) / 16.667) + 5;
/** The missile's one-shots, from the silo (a silo stands in every game here) */
const MISSILE_SOUNDS: readonly string[] = [
  GAME_SOUNDS.nuclearStrike.launch.ignition.id,
  GAME_SOUNDS.nuclearStrike.launch.dive.id,
];

/** The one-shots played at the impact and after it: the blast and its tail, not the missile's */
function strikeSounds(played: Mock): unknown[][] {
  return played.mock.calls.filter((call) => !MISSILE_SOUNDS.includes(call[0] as string));
}

/** A game in setup with `researched` done, the grid stubbed and the real damage path. */
function createGame(timescale: number, researched: AbilityId[]) {
  for (const key of Object.keys(mockServices)) delete mockServices[key];
  GameObject.resetIdCounter();

  // The grid stub has to be in place before the manager injects it
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
  mockServices['StatusEffectService'] = new StatusEffectService();
  mockServices['CombatEffectService'] = new CombatEffectService();

  const gsm = new GameStateManager();
  ref.gsm = gsm;
  const { engine, parts } = createEngine();
  gsm.initialize(engine, BASE_POSITION, TEST_SPAWN_POINTS, createTestCachedPaths());
  gsm.gameSpeed.set(timescale);
  addMissileSilo(gsm.towerManager);
  for (const id of researched) {
    gsm.getEventBus().emit({
      type: 'research:completed',
      researchId: ABILITIES[id].researchId,
      effects: [{ kind: 'global-perk', perkId: ABILITIES[id].perkId, description: '' }],
    });
  }
  return { gsm, parts, bus: gsm.getEventBus(), clock: { now: 1000 } };
}

/** One rendered frame, 16 ms of wall clock; `onStep` after each of its sub-steps */
function frame(gsm: GameStateManager, clock: { now: number }, onStep: () => void = () => undefined): void {
  clock.now += 16;
  gsm.update(clock.now, onStep);
}

/** Frames until `steps` sub-steps have run */
function runSteps(gsm: GameStateManager, clock: { now: number }, steps: number): void {
  let done = 0;
  while (done < steps) frame(gsm, clock, () => done++);
}

/** Enemies at `metres` along the path, which runs straight north */
function spawnAt(gsm: GameStateManager, type: EnemyTypeId, metres: number, paused: boolean): Enemy {
  const start: SpawnStart = {
    segmentIndex: Math.floor(metres / SEGMENT_M),
    segmentProgress: (metres % SEGMENT_M) / SEGMENT_M,
    lateralFactor: 0,
    heightVariation: 0,
    groundHeight: 300,
  };
  return gsm.enemyManager.spawn(TEST_PATH, type, undefined, paused, undefined, start);
}

describe('Abilities through the sub-step loop, playtest 320, 335, 395 and 397 (night 2) replayed', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('320: restart', () => {
    it('during the warning: marker and cloud go, nothing lands, shakes or rumbles after it', () => {
      const { gsm, parts, bus, clock } = createGame(1, ['nuclear-strike']);
      let impacts = 0;
      bus.on('ability:impact', () => impacts++);
      gsm.beginWave();
      expect(gsm.abilityManager.use('nuclear-strike', TARGET).ok).toBe(true);
      expect(parts['abilityMarkers']['showStrike']).toHaveBeenCalledTimes(1);
      const played = parts['spatialAudio']['playAtGeo'];
      // The ignition at the silo with the command
      expect(played.mock.calls.map((call) => call[0])).toEqual([GAME_SOUNDS.nuclearStrike.launch.ignition.id]);
      runSteps(gsm, clock, NUKE_WARNING_STEPS / 2);

      bus.emit({ type: 'command:restart-game' });
      runSteps(gsm, clock, 1);
      expect(parts['abilityMarkers']['clear']).toHaveBeenCalled();
      expect(parts['mushroomClouds']['clear']).toHaveBeenCalled();
      expect(gsm.abilityManager.hasPendingStrikes()).toBe(false);

      // No impact: no cloud, no blast or tail, and no ability shake, which
      // comes only with ability:impact (ScreenShakeService; the switch is
      // ability-shake.scenario.spec.ts)
      runSteps(gsm, clock, 2 * NUKE_WARNING_STEPS + TAIL_STEPS);
      expect(impacts).toBe(0);
      expect(parts['mushroomClouds']['detonate']).not.toHaveBeenCalled();
      expect(strikeSounds(played)).toEqual([]);
    });

    it('right after the impact: the rumbling tail is cut', () => {
      const { gsm, parts, bus, clock } = createGame(1, ['nuclear-strike']);
      let impacts = 0;
      bus.on('ability:impact', () => impacts++);
      gsm.beginWave();
      gsm.abilityManager.use('nuclear-strike', TARGET);
      while (impacts === 0) frame(gsm, clock);
      const played = parts['spatialAudio']['playAtGeo'];
      expect(strikeSounds(played)).toHaveLength(1);

      bus.emit({ type: 'command:restart-game' });
      runSteps(gsm, clock, TAIL_STEPS);
      expect(strikeSounds(played)).toHaveLength(1);
    });
  });

  describe('335: the strike sound\'s tail in game time', () => {
    /**
     * Frames of 16 ms wall clock from the impact until the last repeat of
     * the tail has played, the pause frames not counted; with `pauseFrames`
     * the game pauses in the frame after the impact.
     */
    const tailRun = (timescale: number, pauseFrames = 0) => {
      const { gsm, parts, bus, clock } = createGame(timescale, ['nuclear-strike']);
      let impacts = 0;
      bus.on('ability:impact', () => impacts++);
      gsm.beginWave();
      gsm.abilityManager.use('nuclear-strike', TARGET);
      while (impacts === 0) frame(gsm, clock);

      const played = parts['spatialAudio']['playAtGeo'];
      const atImpact = strikeSounds(played).length;
      let heardInPause = 0;
      if (pauseFrames > 0) {
        gsm.paused.set(true);
        for (let i = 0; i < pauseFrames; i++) frame(gsm, clock);
        heardInPause = strikeSounds(played).length - atImpact;
        gsm.paused.set(false);
      }
      let frames = 0;
      while (strikeSounds(played).length < 1 + TAIL.length && frames < 1000) {
        frame(gsm, clock);
        frames++;
      }
      return { atImpact, heardInPause, frames, volumes: strikeSounds(played).map((call) => call[4]) };
    };

    it('plays the impact, then the quieter pieces of its tail', () => {
      expect(tailRun(1).volumes).toEqual([1, ...TAIL.map((r) => r.volume)]);
    });

    it('P right after the impact: the repeats wait for the resume, then come as without the pause', () => {
      const straight = tailRun(1);
      // About ten seconds of wall clock, far longer than the tail
      const paused = tailRun(1, 600);
      expect(paused.atImpact).toBe(1);
      expect(paused.heardInPause).toBe(0);
      expect(paused.frames).toBe(straight.frames);
    });

    it('at 4x the tail is over in about a quarter of the wall time', () => {
      const single = tailRun(1).frames;
      const fourfold = tailRun(4).frames;
      expect(single).toBeGreaterThan(40);
      expect(fourfold).toBeGreaterThanOrEqual(Math.floor(single / 4) - 1);
      expect(fourfold).toBeLessThanOrEqual(Math.ceil(single / 4) + 1);
    });
  });

  describe('395: the freeze in a pause', () => {
    /** Sub-step whose per-step hook sends the command: 4.5 s in, as in ability-frost.spec.ts */
    const COMMAND_STEP = 270;
    const WARNING_STEPS = 30;
    const FREEZE_STEPS = 180;
    const BOSS_FREEZE_STEPS = 60;
    /** Halfway through the boss's freeze */
    const PAUSE_STEP = COMMAND_STEP + WARNING_STEPS + BOSS_FREEZE_STEPS / 2;

    /** Distance along the path of a zombie and herbert per sub-step from the command on */
    const frostTrace = (pauseFrames: number) => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const { gsm, clock } = createGame(1, ['frost-bomb']);
      gsm.beginWave();
      // Where ability-frost.spec.ts puts the second zombie and herbert: 3 to 13 m from the target at the burst
      const enemies = [gsm.enemyManager.spawn(TEST_PATH, 'zombie', 4), gsm.enemyManager.spawn(TEST_PATH, 'herbert', 5)];
      const trace: number[][] = [];
      let steps = 0;
      let pausedOnce = false;
      let inPause: number[] | null = null;
      while (steps < COMMAND_STEP + WARNING_STEPS + FREEZE_STEPS + 20) {
        if (pauseFrames > 0 && !pausedOnce && steps >= PAUSE_STEP) {
          pausedOnce = true;
          gsm.paused.set(true);
          for (let i = 0; i < pauseFrames; i++) frame(gsm, clock, () => steps++);
          inPause = enemies.map((e) => e.movement.getDistanceAlongPath());
          gsm.paused.set(false);
        }
        frame(gsm, clock, () => {
          steps++;
          if (steps === COMMAND_STEP) expect(gsm.abilityManager.use('frost-bomb', TARGET).ok).toBe(true);
          if (steps >= COMMAND_STEP) trace.push(enemies.map((e) => e.movement.getDistanceAlongPath()));
        });
      }
      return { trace, inPause };
    };
    /** Sub-steps from the one before the burst on in which enemy `index` did not move */
    const stillSteps = (trace: number[][], index: number) => {
      const fromBurst = trace.slice(WARNING_STEPS - 1);
      let still = 0;
      for (let i = 1; i < fromBurst.length; i++) {
        if (fromBurst[i][index] === fromBurst[i - 1][index]) still++;
      }
      return still;
    };

    it('holds zombie and herbert through the pause, 3 s and 1 s of game time as without it', () => {
      const straight = frostTrace(0);
      const paused = frostTrace(600);
      expect(stillSteps(straight.trace, 0)).toBe(FREEZE_STEPS);
      expect(stillSteps(straight.trace, 1)).toBe(BOSS_FREEZE_STEPS);
      expect(paused.trace).toEqual(straight.trace);
      // Nobody moved while the game stood
      const atPause = straight.trace[PAUSE_STEP - COMMAND_STEP];
      expect(paused.inPause).toEqual(atPause);
    });
  });

  describe('397: orbital laser', () => {
    /** The ninth waypoint, about 89 m along the 111 m path: the beam runs back to about 17 m */
    const LASER_TARGET: GeoPosition = TEST_PATH[8];
    const WARNING_STEPS = 60;
    const BURN_STEPS = 240;

    it('keeps the wave open while the beam burns and ends it once the beam is out', () => {
      const { gsm, bus, clock } = createGame(1, ['orbital-laser']);
      const phases: string[] = [];
      let resolvedAt = -1;
      bus.on('ability:resolved', () => (resolvedAt = phases.length));
      gsm.beginWave();
      expect(gsm.abilityManager.use('orbital-laser', LASER_TARGET).ok).toBe(true);
      while (phases.length < WARNING_STEPS + BURN_STEPS + 10) {
        frame(gsm, clock, () => phases.push(gsm.waveManager.phase()));
      }
      // Nothing on the route: without the wait the wave would end on the first sub-step
      expect(resolvedAt).toBe(WARNING_STEPS + BURN_STEPS - 2);
      // The hook runs after a sub-step's completion check, so the step the
      // beam goes out in may already hand on the setup
      expect(phases.slice(0, resolvedAt)).toEqual(Array(resolvedAt).fill('wave'));
      expect(phases.indexOf('setup')).toBeGreaterThanOrEqual(resolvedAt);
      expect(phases.indexOf('setup')).toBeLessThanOrEqual(resolvedAt + 1);
    });

    it('walking into it: unarmored at the 60 % cap, a tank loses a good quarter, a ghost hardly anything', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const { gsm, clock } = createGame(1, ['orbital-laser']);
      gsm.beginWave();
      // 40 m along, walking toward the HQ: they meet the beam head-on
      const [zombie, tank, ghost] = (['zombie', 'tank', 'ghost'] as EnemyTypeId[]).map((type) => spawnAt(gsm, type, 40, false));
      expect(gsm.abilityManager.use('orbital-laser', LASER_TARGET).ok).toBe(true);
      runSteps(gsm, clock, WARNING_STEPS + BURN_STEPS + 10);

      const lost = (e: Enemy) => 1 - e.health.hp / e.health.maxHp;
      expect(lost(zombie)).toBeCloseTo(0.6, 6);
      expect(lost(tank)).toBeGreaterThan(0.25);
      expect(lost(tank)).toBeLessThan(0.34);
      expect(lost(ghost)).toBeGreaterThan(0);
      expect(lost(ghost)).toBeLessThan(0.06);
    });
  });
});
