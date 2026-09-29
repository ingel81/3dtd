/**
 * Integration Test: playtest points 320, 395 and 397 of night 2
 * (docs/archive/REVIEW_SPRINT_2026-09-14.md) through the real GameStateManager
 * sub-step loop, the real damage path and real enemies. What the strike
 * looks and sounds like (markers, cloud, the rumbling tail of 320 and 335)
 * is the main thread's and tested there.
 *
 * 320: a restart during the warning: nothing lands.
 * 395: a pause holds the freeze, the enemies stand on after it.
 * 397: the wave waits for the beam; its fire share caps the unarmored at
 *      60 %, takes a good quarter from a tank and hardly anything from a ghost.
 *
 * Harness as in ability-strike.spec.ts: only the services around the loop are
 * stubbed, the route grid's radius query is a plain distance filter over the
 * living enemies.
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
  provideSimServices,
  addMissileSilo,
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
import type { EnemyTypeId } from '../configs/enemy-types.config';
import { geoDistanceFast } from '../utils/geo-utils';
import type { Enemy } from '../entities/enemy.entity';
import type { SpawnStart } from '../managers/enemy.manager';
import type { GeoPosition } from '../models/game.types';

const BASE_POSITION: GeoPosition = TEST_PATH[TEST_PATH.length - 1];
/** The fourth waypoint, about 33 m down the path */
const TARGET: GeoPosition = TEST_PATH[3];
const SEGMENT_M = geoDistanceFast(TEST_PATH[0], TEST_PATH[1]);
/** 6500 ms of warning in sub-steps of 16.667 ms */
const NUKE_WARNING_STEPS = 390;

/** A game in setup with `researched` done, the grid stubbed and the real damage path. */
function createGame(timescale: number, researched: AbilityId[]) {
  for (const key of Object.keys(mockServices)) delete mockServices[key];
  provideSimServices(mockServices);
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
  mockServices['EconomyService'] = withAutoStubs({ computeWaveCompletionBonus: () => 0 });
  mockServices['DamageApplicationService'] = new DamageApplicationService();
  mockServices['StatusEffectService'] = new StatusEffectService();
  mockServices['CombatEffectService'] = new CombatEffectService();

  const gsm = new GameStateManager();
  ref.gsm = gsm;
  gsm.initialize(BASE_POSITION, TEST_SPAWN_POINTS, createTestCachedPaths());
  gsm.gameSpeed.set(timescale);
  addMissileSilo(gsm.towerManager);
  for (const id of researched) {
    gsm.getEventBus().emit({
      type: 'research:completed', playerId: 'local', local: true,
      researchId: ABILITIES[id].researchId,
      effects: [{ kind: 'global-perk', perkId: ABILITIES[id].perkId, description: '' }],
    });
  }
  return { gsm, bus: gsm.getEventBus(), clock: { now: 1000 } };
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
    it('during the warning: nothing lands after it', () => {
      const { gsm, bus, clock } = createGame(1, ['nuclear-strike']);
      let impacts = 0;
      bus.on('ability:impact', () => impacts++);
      gsm.beginWave();
      expect(gsm.abilityManager.use('nuclear-strike', TARGET).ok).toBe(true);
      runSteps(gsm, clock, NUKE_WARNING_STEPS / 2);

      bus.emit({ type: 'command:restart-game' });
      runSteps(gsm, clock, 1);
      expect(gsm.abilityManager.hasPendingStrikes()).toBe(false);

      runSteps(gsm, clock, 2 * NUKE_WARNING_STEPS);
      expect(impacts).toBe(0);
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
