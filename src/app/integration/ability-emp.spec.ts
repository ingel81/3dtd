/**
 * Integration Test: an EMP through the real GameStateManager sub-step loop,
 * the real status effects and real enemies.
 *
 * The pulse goes off 30 sub-steps (500 ms) after the command and stuns
 * everything in its radius: machines (`mechanical`) for 6 s of game time,
 * bosses for 0.75 s, everything else for 1.5 s. Stunned enemies stand;
 * the outcome is the same at timescale 1 and 10.
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
  createTestCachedPaths,
  createAbilityTestEngine,
  withAutoStubs,
  TEST_PATH,
  TEST_SPAWN_POINTS,
} from './test-helpers';
import { GameStateManager } from '../managers/game-state.manager';
import { CombatEffectService } from '../services/combat/combat-effect.service';
import { DamageApplicationService } from '../services/combat/damage-application.service';
import { StatusEffectService } from '../services/combat/status-effect.service';
import { GameObject } from '../core/game-object';
import { ABILITIES } from '../configs/abilities.config';
import { ENEMY_TYPES, EnemyTypeId } from '../configs/enemy-types.config';
import { geoDistanceFast } from '../utils/geo-utils';
import type { Enemy } from '../entities/enemy.entity';
import type { GeoPosition } from '../models/game.types';

const createEngine = createAbilityTestEngine;

const EMP = ABILITIES['emp'];
const BASE_POSITION: GeoPosition = TEST_PATH[TEST_PATH.length - 1];
/** Sub-step whose per-step hook sends the command, as the bot does: 4.5 s in */
const COMMAND_STEP = 270;
/** 500 ms of warning in sub-steps of 16.667 ms */
const WARNING_STEPS = 30;
/** 6 s for machines, 1.5 s for the rest, 0.75 s for bosses */
const MACHINE_STEPS = 360;
const OTHER_STEPS = 90;
const BOSS_STEPS = 45;
/** The sixth waypoint, about 56 m along the path */
const TARGET: GeoPosition = TEST_PATH[5];

/**
 * The path runs straight north. At the pulse, 5 s in, the first zombie
 * stands 10 m along (46 m from the target, outside the 30 m), the others
 * between 6 and 26 m from it.
 */
const ROSTER: { type: EnemyTypeId; speed: number }[] = [
  { type: 'zombie', speed: 2 },
  { type: 'tank', speed: 8 },
  { type: 'mech', speed: 6 },
  { type: 'zombie', speed: 7 },
  { type: 'herbert', speed: 9 },
];

interface Trace {
  impactStep: number;
  /** Distance along the path of every enemy, per sub-step from the command on */
  distance: number[][];
  hp: number[];
  hits: number;
  kills: number;
}

function run(timescale: number, steps = COMMAND_STEP + WARNING_STEPS + MACHINE_STEPS + 20): Trace {
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
  gsm.gameSpeed.set(timescale);
  const bus = gsm.getEventBus();
  bus.emit({
    type: 'research:completed',
    researchId: EMP.researchId,
    effects: [{ kind: 'global-perk', perkId: EMP.perkId, description: '' }],
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
        expect(gsm.abilityManager.use('emp', TARGET).ok).toBe(true);
      }
      if (step >= COMMAND_STEP && step <= steps) {
        distance.push(enemies.map((e) => e.movement.getDistanceAlongPath()));
      }
    });
  }
  return { impactStep, distance, hp: enemies.map((e) => e.health.hp / e.health.maxHp), hits, kills };
}

/** Sub-steps from the pulse on in which the enemy did not move */
function stillSteps(trace: Trace, index: number): number {
  // From the sub-step before the pulse: the pulse's own sub-step halts already
  const fromPulse = trace.distance.slice(WARNING_STEPS - 1);
  let still = 0;
  for (let i = 1; i < fromPulse.length; i++) {
    if (fromPulse[i][index] === fromPulse[i - 1][index]) still++;
  }
  return still;
}

describe('EMP through the sub-step loop', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('goes off on the 30th sub-step after the command', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    expect(run(1).impactStep).toBe(COMMAND_STEP + WARNING_STEPS);
  });

  it('stops machines for 6 s, the rest for 1.5 s, the boss for 0.75 s, nobody outside, without damage', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    expect(ENEMY_TYPES['tank'].mechanical).toBe(true);
    expect(ENEMY_TYPES['mech'].mechanical).toBe(true);
    const trace = run(1);
    expect(stillSteps(trace, 0)).toBe(0);              // outside the 30 m
    expect(stillSteps(trace, 1)).toBe(MACHINE_STEPS);  // tank
    expect(stillSteps(trace, 2)).toBe(MACHINE_STEPS);  // mech
    expect(stillSteps(trace, 3)).toBe(OTHER_STEPS);    // zombie
    expect(stillSteps(trace, 4)).toBe(BOSS_STEPS);     // herbert
    expect(trace.hits).toBe(4);
    expect(trace.kills).toBe(0);
    expect(trace.hp).toEqual([1, 1, 1, 1, 1]);
  });

  it('gives the same outcome at timescale 1 and 10', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    expect(run(10)).toEqual(run(1));
  });
});
