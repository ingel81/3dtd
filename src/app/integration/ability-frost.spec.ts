/**
 * Integration Test: a frost bomb through the real GameStateManager sub-step
 * loop, the real status effects and real enemies.
 *
 * The bomb bursts 30 sub-steps (500 ms) after the command and freezes
 * everything in its radius for 3 s of game time, bosses for 1 s. Frozen
 * enemies stand; the outcome is the same whether a frame carries one
 * sub-step (timescale 1) or ten (timescale 10).
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
import { StatusEffectService } from '../services/combat/status-effect.service';
import { GameObject } from '../core/game-object';
import { ABILITIES } from '../configs/abilities.config';
import { EnemyTypeId } from '../configs/enemy-types.config';
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

const FROST = ABILITIES['frost-bomb'];
const BASE_POSITION: GeoPosition = TEST_PATH[TEST_PATH.length - 1];
/** Sub-step whose per-step hook sends the command, as the bot does: 4.5 s in */
const COMMAND_STEP = 270;
/** 500 ms of warning in sub-steps of 16.667 ms */
const WARNING_STEPS = 30;
/** 3 s of freeze, bosses 1 s */
const FREEZE_STEPS = 180;
const BOSS_FREEZE_STEPS = 60;
const TARGET: GeoPosition = TEST_PATH[3];

/**
 * The path runs straight north, the target about 33 m along it. At the
 * burst, 5 s in, the first zombie stands 10 m along (23 m from the target,
 * outside the 20 m), the others between 3 and 13 m from it; herbert is the
 * boss, the bat flies.
 */
const ROSTER: { type: EnemyTypeId; speed: number }[] = [
  { type: 'zombie', speed: 2 },
  { type: 'zombie', speed: 4 },
  { type: 'tank', speed: 6 },
  { type: 'herbert', speed: 5 },
  { type: 'bat', speed: 8 },
];

interface Trace {
  impactStep: number;
  /** Distance along the path of every enemy, per sub-step from the command on */
  distance: number[][];
  hits: number;
  kills: number;
}

function run(timescale: number, steps = COMMAND_STEP + WARNING_STEPS + FREEZE_STEPS + 20): Trace {
  for (const key of Object.keys(mockServices)) delete mockServices[key];
  GameObject.resetIdCounter();

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
  const combat = new CombatEffectService();
  mockServices['CombatEffectService'] = combat;
  const halt = vi.spyOn(combat, 'applyAbilityHalt');

  const gsm = new GameStateManager();
  ref.gsm = gsm;
  gsm.initialize(createEngine(), BASE_POSITION, TEST_SPAWN_POINTS, createTestCachedPaths());
  gsm.trainingTimescale.set(timescale);
  const bus = gsm.getEventBus();
  bus.emit({
    type: 'research:completed',
    researchId: FROST.researchId,
    effects: [{ kind: 'global-perk', perkId: FROST.perkId, description: '' }],
  });
  let hits = 0;
  let kills = 0;
  bus.on('ability:resolved', (event) => {
    hits += event.hits;
    kills += event.kills;
  });

  gsm.beginWave();
  const enemies = ROSTER.map(({ type, speed }) => gsm.enemyManager.spawn(TEST_PATH, type, speed));

  let step = 0;
  let impactStep = -1;
  const distance: number[][] = [];
  let now = 1000;
  while (step < steps) {
    now += 16;
    gsm.update(now, () => {
      step++;
      if (impactStep < 0 && halt.mock.calls.length > 0) impactStep = step;
      if (step === COMMAND_STEP) {
        expect(gsm.abilityManager.use('frost-bomb', TARGET).ok).toBe(true);
      }
      if (step >= COMMAND_STEP && step <= steps) {
        distance.push(enemies.map((e) => e.movement.getDistanceAlongPath()));
      }
    });
  }
  return { impactStep, distance, hits, kills };
}

/** Sub-steps from the burst on in which the enemy did not move */
function stillSteps(trace: Trace, index: number): number {
  // From the sub-step before the burst: the burst's own sub-step halts already
  const fromBurst = trace.distance.slice(WARNING_STEPS - 1);
  let still = 0;
  for (let i = 1; i < fromBurst.length; i++) {
    if (fromBurst[i][index] === fromBurst[i - 1][index]) still++;
  }
  return still;
}

describe('Frost bomb through the sub-step loop', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('bursts on the 30th sub-step after the command', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    expect(run(1).impactStep).toBe(COMMAND_STEP + WARNING_STEPS);
  });

  it('freezes ground and air in the radius for 3 s, the boss for 1 s, and nobody outside', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const trace = run(1);
    expect(stillSteps(trace, 0)).toBe(0);                 // outside the 20 m
    expect(stillSteps(trace, 1)).toBe(FREEZE_STEPS);
    expect(stillSteps(trace, 2)).toBe(FREEZE_STEPS);
    expect(stillSteps(trace, 3)).toBe(BOSS_FREEZE_STEPS);
    expect(stillSteps(trace, 4)).toBe(FREEZE_STEPS);      // the bat hangs in the air
    expect(trace.hits).toBe(4);
    expect(trace.kills).toBe(0);
  });

  it('gives the same outcome at timescale 1 and 10', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const single = run(1);
    const tenfold = run(10);
    expect(tenfold).toEqual(single);
  });
});
