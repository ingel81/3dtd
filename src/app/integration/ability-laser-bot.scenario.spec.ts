/**
 * Scenario: the training bot's orbital laser through the real
 * GameStateManager sub-step loop. The OrbitalLaserStrategy aims at a
 * walking column on the wave's route, the command goes to the real
 * AbilityManager, and the hits the beam reports when it resolves are the
 * hits the strategy expected.
 *
 * Only the services around the loop are stubbed, as in ability-laser.spec.ts:
 * the route grid's radius query is a plain distance filter over the living
 * enemies.
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
import { EnemyTypeId } from '../configs/enemy-types.config';
import { geoDistanceFast } from '../utils/geo-utils';
import { OrbitalLaserStrategy } from '../bots/strategies/ability/orbital-laser.strategy';
import type { Enemy } from '../entities/enemy.entity';
import type { SpawnStart } from '../managers/enemy.manager';
import type { GeoPosition } from '../models/game.types';
import type { GameStateSnapshot } from '../director/models/game-state-snapshot';

const LASER = ABILITIES['orbital-laser'];
const BASE_POSITION: GeoPosition = TEST_PATH[TEST_PATH.length - 1];
const COMMAND_STEP = 30;
/** Command, 1 s of warning, 4 s of burn and a little more, in sub-steps */
const END_STEP = COMMAND_STEP + 60 + 240 + 10;
const SEGMENT_M = geoDistanceFast(TEST_PATH[0], TEST_PATH[1]);

/**
 * Walking enemies at `metres` along the 111 m path: a column of zombies and
 * tanks from 62 m back to 14 m, the head past half the path.
 */
const ROSTER: { type: EnemyTypeId; metres: number }[] = [
  { type: 'zombie', metres: 62 },
  { type: 'zombie', metres: 58 },
  { type: 'tank', metres: 54 },
  { type: 'zombie', metres: 50 },
  { type: 'zombie', metres: 46 },
  { type: 'zombie', metres: 42 },
  { type: 'tank', metres: 38 },
  { type: 'zombie', metres: 34 },
  { type: 'zombie', metres: 30 },
  { type: 'zombie', metres: 26 },
  { type: 'zombie', metres: 22 },
  { type: 'zombie', metres: 18 },
  { type: 'zombie', metres: 14 },
];

interface Outcome {
  reason: string;
  target: GeoPosition;
  /** Metres along the path the column head stands at the command */
  headAtCommand: number;
  hits: number;
  kills: number;
  hpShare: number[];
}

function run(timescale: number): Outcome {
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
  mockServices['CombatEffectService'] = new CombatEffectService();

  const gsm = new GameStateManager();
  ref.gsm = gsm;
  gsm.initialize(createAbilityTestEngine(), BASE_POSITION, TEST_SPAWN_POINTS, createTestCachedPaths());
  gsm.gameSpeed.set(timescale);
  const bus = gsm.getEventBus();
  bus.emit({
    type: 'research:completed', playerId: 'local', local: true,
    researchId: LASER.researchId,
    effects: [{ kind: 'global-perk', perkId: LASER.perkId, description: '' }],
  });

  let hits = 0;
  let kills = 0;
  bus.on('ability:resolved', (event) => {
    hits += event.hits;
    kills += event.kills;
  });

  gsm.beginWave();
  const enemies = ROSTER.map(({ type, metres }) => {
    const start: SpawnStart = {
      segmentIndex: Math.floor(metres / SEGMENT_M),
      segmentProgress: (metres % SEGMENT_M) / SEGMENT_M,
      lateralFactor: 0,
      heightVariation: 0,
      groundHeight: 300,
    };
    return gsm.enemyManager.spawn(TEST_PATH, type, undefined, false, undefined, start);
  });

  const strategy = new OrbitalLaserStrategy(gsm);
  const decision = { phase: 'wave' } as GameStateSnapshot;
  let reason = '';
  let target: GeoPosition = { lat: 0, lon: 0 };
  let headAtCommand = 0;
  let step = 0;
  let now = 1000;
  while (step < END_STEP) {
    now += 16;
    gsm.update(now, () => {
      step++;
      if (step === COMMAND_STEP) {
        headAtCommand = enemies[0].movement.getDistanceAlongPath();
        expect(strategy.canExecute(decision)).toBe(true);
        const action = strategy.execute(decision)!;
        reason = action.reason ?? '';
        target = { lat: action.position!.z, lon: action.position!.x };
        expect(gsm.abilityManager.use('orbital-laser', target).ok).toBe(true);
      }
    });
  }
  return {
    reason,
    target,
    headAtCommand,
    hits,
    kills,
    hpShare: enemies.map((e) => e.health.hp / e.health.maxHp),
  };
}

describe('Training bot fires the orbital laser through the sub-step loop', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('burns as many enemies as it expected', () => {
    const { reason, hits } = run(1);
    const expected = Number(/through (\d+) enemies/.exec(reason)![1]);
    expect(expected).toBe(ROSTER.length);
    expect(hits).toBe(expected);
  });

  it('aims ahead of the column head, where it stands when the beam lands', () => {
    const { target, headAtCommand } = run(1);
    // The zombie at the head walks 5 m in the 1 s of warning
    expect(geoDistanceFast(TEST_PATH[0], target)).toBeCloseTo(headAtCommand + 5, 0);
  });

  it('gives the same aim and outcome at timescale 1 and 10', () => {
    expect(run(10)).toEqual(run(1));
  });
});
