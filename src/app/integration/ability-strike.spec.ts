/**
 * Integration Test: a nuclear strike through the real GameStateManager
 * sub-step loop, the real damage path and real enemies.
 *
 * The strike counts down and resolves in game time, one sub-step at a time.
 * The same command at the same sub-step has to give the same outcome whether
 * a frame carries one sub-step (timescale 1) or ten (timescale 10). The
 * multiplayer concept needs that for lockstep, and training runs at 75x.
 *
 * Only the services around the loop are stubbed. The route grid's radius
 * query is replaced by a plain distance filter over the living enemies,
 * because the stubbed grid tracks no cells.
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
  createMockTilesEngine,
  createTestCachedPaths,
  TEST_PATH,
  TEST_SPAWN_POINTS,
} from './test-helpers';
import { GameStateManager } from '../managers/game-state.manager';
import { CombatEffectService } from '../services/combat/combat-effect.service';
import { DamageApplicationService } from '../services/combat/damage-application.service';
import { GameObject } from '../core/game-object';
import { ABILITIES } from '../configs/abilities.config';
import { ENEMY_TYPES, EnemyTypeId } from '../configs/enemy-types.config';
import { geoDistanceFast } from '../utils/geo-utils';
import type { Enemy } from '../entities/enemy.entity';
import type { GeoPosition } from '../models/game.types';

/** Any property the test does not set is a vi.fn(). */
function withAutoStubs<T extends object>(target: T): T {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      if (!(prop in obj)) Reflect.set(obj, prop, vi.fn());
      return Reflect.get(obj, prop, receiver);
    },
  });
}

function createEngine(): never {
  // The helper's engine is typed; the loop reaches a few members it does not declare
  const engine = createMockTilesEngine() as unknown as Record<string, Record<string, unknown>>;
  for (const key of ['effects', 'towers', 'enemies', 'projectiles', 'trailStreaks', 'spatialAudio', 'sync']) {
    engine[key] = withAutoStubs(engine[key]);
  }
  engine['enemies']['create'] = vi.fn(() => Promise.resolve(null));
  engine['hero'] = withAutoStubs({});
  // BackgroundMusicService resumes the audio context on wave:started
  engine['spatialAudio']['getListener'] = () => ({ context: { state: 'running', resume: () => Promise.resolve() } });
  // Headless, like a training tab: no presentFrame
  (engine as Record<string, unknown>)['renderingEnabled'] = false;
  return withAutoStubs(engine) as never;
}

const NUKE = ABILITIES['nuclear-strike'];
/** HQ at the end of the path */
const BASE_POSITION: GeoPosition = TEST_PATH[TEST_PATH.length - 1];
/** Sub-step whose per-step hook sends the command, as the bot does. */
const COMMAND_STEP = 30;
/** 1500 ms of warning in sub-steps of 16.667 ms */
const WARNING_STEPS = 90;
/** Outcome read at this sub-step, the same one in both runs */
const READ_STEP = COMMAND_STEP + WARNING_STEPS + 10;
/** Halfway through the warning */
const PAUSE_STEP = COMMAND_STEP + WARNING_STEPS / 2;
/** The fourth waypoint, about 33 m down the path */
const TARGET: GeoPosition = TEST_PATH[3];

/**
 * Speeds spread the enemies along the path: at the impact, two seconds in,
 * the first stands about 31 m from the target (outside the 25 m), the others
 * between 9 and 24 m. Half of them come in with half their HP gone, so the
 * strike kills them; herbert is the boss.
 */
const ROSTER: { type: EnemyTypeId; speed: number; preDamage: number }[] = [
  { type: 'zombie', speed: 1, preDamage: 0 },
  { type: 'zombie', speed: 5, preDamage: 0 },
  { type: 'zombie', speed: 6, preDamage: 0.5 },
  { type: 'tank', speed: 8, preDamage: 0.5 },
  { type: 'herbert', speed: 5, preDamage: 0.5 },
  { type: 'bat', speed: 10, preDamage: 0 },
  { type: 'zombie', speed: 12, preDamage: 0.5 },
];

/** A skeleton where the third zombie of ROSTER stands, half its HP gone, so the strike kills it */
const SKELETON_ROSTER: typeof ROSTER = [{ type: 'skeleton', speed: 6, preDamage: 0.5 }];

interface Outcome {
  impactStep: number;
  hpShare: number[];
  alive: boolean[];
  kills: number;
  /** Sum of `kills` over the ability:impact events */
  abilityKills: number;
  /** HP share of every living skeleton-minion */
  minions: number[];
  credits: number;
}

/** A game in setup with the strike researched, the grid stubbed and the real damage path. */
function createGame(timescale: number) {
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
  const combat = new CombatEffectService();
  mockServices['CombatEffectService'] = combat;
  const strike = vi.spyOn(combat, 'applyAbilityStrike');

  const gsm = new GameStateManager();
  ref.gsm = gsm;
  gsm.initialize(createEngine(), BASE_POSITION, TEST_SPAWN_POINTS, createTestCachedPaths());
  gsm.trainingTimescale.set(timescale);

  gsm.getEventBus().emit({
    type: 'research:completed',
    researchId: NUKE.researchId,
    effects: [{ kind: 'global-perk', perkId: NUKE.perkId, description: '' }],
  });
  return { gsm, strike };
}

/**
 * @param pauseFrames frames the game stays paused at PAUSE_STEP, 0 for none
 * @param roster      enemies spawned at the wave start
 */
function run(timescale: number, pauseFrames = 0, roster = ROSTER): Outcome {
  const { gsm, strike } = createGame(timescale);
  const bus = gsm.getEventBus();
  let kills = 0;
  bus.on('enemy:died', () => kills++);
  let abilityKills = 0;
  bus.on('ability:impact', (event) => (abilityKills += event.kills));

  gsm.beginWave();
  const enemies = roster.map(({ type, speed, preDamage }) => {
    const enemy = gsm.enemyManager.spawn(TEST_PATH, type, speed);
    enemy.health.takeDamage(enemy.health.maxHp * preDamage);
    return enemy;
  });

  let steps = 0;
  let impactStep = -1;
  let outcome: Outcome | null = null;
  let now = 1000;
  let pausedOnce = false;
  while (!outcome) {
    if (pauseFrames > 0 && !pausedOnce && steps >= PAUSE_STEP) {
      pausedOnce = true;
      gsm.paused.set(true);
      for (let i = 0; i < pauseFrames; i++) {
        now += 16;
        gsm.update(now, () => steps++);
      }
      gsm.paused.set(false);
    }
    now += 16;
    gsm.update(now, () => {
      steps++;
      if (impactStep < 0 && strike.mock.calls.length > 0) impactStep = steps;
      if (steps === COMMAND_STEP) {
        expect(gsm.abilityManager.use('nuclear-strike', TARGET).ok).toBe(true);
      }
      if (steps === READ_STEP && !outcome) {
        outcome = {
          impactStep,
          hpShare: enemies.map((e) => e.health.hp / e.health.maxHp),
          alive: enemies.map((e) => e.alive),
          kills,
          abilityKills,
          minions: gsm.enemyManager.getAlive()
            .filter((e) => e.typeConfig.id === 'skeleton-minion')
            .map((e) => e.health.hp / e.health.maxHp),
          credits: gsm.credits(),
        };
      }
    });
  }
  return outcome;
}

describe('Nuclear strike through the sub-step loop', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lands on the 90th sub-step after the command', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // centre line, no height spread
    expect(run(1).impactStep).toBe(COMMAND_STEP + WARNING_STEPS);
  });

  it('hits ground and air in the radius: 60% of max HP, the boss 20%', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    expect(ENEMY_TYPES['bat'].isAirUnit).toBe(true);
    const { hpShare, alive, kills, abilityKills } = run(1);

    expect(hpShare[0]).toBe(1);             // 31 m away, untouched
    expect(hpShare[1]).toBeCloseTo(0.4);    // full HP, keeps 40%
    expect(alive[2]).toBe(false);           // half HP, 60% more kills it
    expect(alive[3]).toBe(false);
    expect(hpShare[4]).toBeCloseTo(0.3);    // boss: half HP, 20% more
    expect(alive[4]).toBe(true);
    expect(hpShare[5]).toBeCloseTo(0.4);    // bat, in the air
    expect(alive[6]).toBe(false);
    expect(kills).toBe(3);
    expect(abilityKills).toBe(3);
  });

  it('splits a struck skeleton, its minions take no damage and are no ability kills', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    expect(ENEMY_TYPES['skeleton'].splitOnDeath).toMatchObject({ type: 'skeleton-minion', count: 2 });
    const { alive, kills, abilityKills, minions } = run(1, 0, SKELETON_ROSTER);

    expect(alive[0]).toBe(false);
    expect(kills).toBe(1);           // enemy:died for the skeleton only
    expect(abilityKills).toBe(1);    // the gate books one leak, not three
    expect(minions).toEqual([1, 1]); // both minions on the route at full HP
  });

  it('gives the same outcome at timescale 1 and 10', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const single = run(1);
    const tenfold = run(10);
    expect(tenfold).toEqual(single);
    expect(single.kills).toBeGreaterThan(0);
  });

  it('stands still while the game is paused', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const straight = run(1);
    // About ten seconds of wall clock, far longer than the warning
    const paused = run(1, 600);
    expect(paused.impactStep).toBe(COMMAND_STEP + WARNING_STEPS);
    expect(paused).toEqual(straight);
  });

  it('keeps the wave open until a pending strike has landed', () => {
    // Nothing on the route, as right after the last leak: without the wait
    // the wave ends on the first sub-step, and the impact lands in the setup
    // phase, or with auto-start in the next wave and books its kills there.
    const phases = (timescale: number) => {
      const { gsm } = createGame(timescale);
      const impactPhases: string[] = [];
      gsm.getEventBus().on('ability:impact', () => impactPhases.push(gsm.waveManager.phase()));
      gsm.beginWave();
      expect(gsm.abilityManager.use('nuclear-strike', TARGET).ok).toBe(true);

      // The phase each sub-step leaves to the next, its completion check included
      const seen: string[] = [];
      let now = 1000;
      while (seen.length < WARNING_STEPS + 5) {
        now += 16;
        gsm.update(now, () => seen.push(gsm.waveManager.phase()));
      }
      return { impactPhases, seen: seen.slice(0, WARNING_STEPS + 5) };
    };

    const single = phases(1);
    expect(single.impactPhases).toEqual(['wave']);
    expect(single.seen.slice(0, WARNING_STEPS)).toEqual(Array(WARNING_STEPS).fill('wave'));
    // Ends on the impact sub-step, not later
    expect(single.seen[WARNING_STEPS]).toBe('setup');
    expect(phases(10)).toEqual(single);
  });
});
