/**
 * Integration Test: an orbital laser through the real GameStateManager
 * sub-step loop, the real route sweep on the wave's route, the real damage
 * path and real enemies.
 *
 * The beam lands 60 sub-steps (1 s) after the command on the route point
 * nearest the aim and runs 18 m/s toward the spawn for 4 s, 72 m. Every
 * enemy it passes loses its fire share of max HP per sub-step under it, at
 * most 60 %, bosses 20 %; the outcome is the same at timescale 1 and 10.
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
import type { SpawnStart } from '../managers/enemy.manager';
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

const LASER = ABILITIES['orbital-laser'];
const BASE_POSITION: GeoPosition = TEST_PATH[TEST_PATH.length - 1];
const COMMAND_STEP = 30;
/** 1 s of warning, then 4 s of burn, in sub-steps of 16.667 ms */
const WARNING_STEPS = 60;
const BURN_STEPS = 240;
/** The ninth waypoint, about 89 m along the 111 m path: the beam runs back to about 17 m */
const TARGET: GeoPosition = TEST_PATH[8];

/**
 * Enemies standing still (spawned paused) at `metres` along the path, which
 * runs straight north with a waypoint every 11.1 m. The one at 100 m stands
 * behind the start point (toward the HQ), the one at 8 m beyond the end of
 * the 72 m.
 */
const ROSTER: { type: EnemyTypeId; metres: number; preDamage: number }[] = [
  { type: 'zombie', metres: 50, preDamage: 0 },
  { type: 'tank', metres: 30, preDamage: 0 },
  { type: 'herbert', metres: 70, preDamage: 0 },
  { type: 'zombie', metres: 100, preDamage: 0 },
  { type: 'zombie', metres: 8, preDamage: 0 },
  { type: 'zombie', metres: 60, preDamage: 0.5 },
];
const SEGMENT_M = geoDistanceFast(TEST_PATH[0], TEST_PATH[1]);

interface Outcome {
  impactStep: number;
  resolvedStep: number;
  hpShare: number[];
  alive: boolean[];
  hits: number;
  kills: number;
  credits: number;
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
  gsm.initialize(createEngine(), BASE_POSITION, TEST_SPAWN_POINTS, createTestCachedPaths());
  gsm.trainingTimescale.set(timescale);
  const bus = gsm.getEventBus();
  bus.emit({
    type: 'research:completed',
    researchId: LASER.researchId,
    effects: [{ kind: 'global-perk', perkId: LASER.perkId, description: '' }],
  });

  let step = 0;
  let impactStep = -1;
  let resolvedStep = -1;
  let hits = 0;
  let kills = 0;
  bus.on('ability:impact', () => (impactStep = step + 1));
  bus.on('ability:resolved', (event) => {
    resolvedStep = step + 1;
    hits += event.hits;
    kills += event.kills;
  });

  gsm.beginWave();
  const enemies = ROSTER.map(({ type, metres, preDamage }) => {
    const start: SpawnStart = {
      segmentIndex: Math.floor(metres / SEGMENT_M),
      segmentProgress: (metres % SEGMENT_M) / SEGMENT_M,
      lateralFactor: 0,
      heightVariation: 0,
      groundHeight: 300,
    };
    const enemy = gsm.enemyManager.spawn(TEST_PATH, type, undefined, true, undefined, start);
    enemy.health.takeDamage(enemy.health.maxHp * preDamage);
    return enemy;
  });

  let now = 1000;
  const end = COMMAND_STEP + WARNING_STEPS + BURN_STEPS + 10;
  while (step < end) {
    now += 16;
    gsm.update(now, () => {
      step++;
      if (step === COMMAND_STEP) {
        expect(gsm.abilityManager.use('orbital-laser', TARGET).ok).toBe(true);
      }
    });
  }
  return {
    impactStep,
    resolvedStep,
    hpShare: enemies.map((e) => e.health.hp / e.health.maxHp),
    alive: enemies.map((e) => e.alive),
    hits,
    kills,
    credits: gsm.credits(),
  };
}

describe('Orbital laser through the sub-step loop', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lands 60 sub-steps after the command and resolves after 4 s of burn', () => {
    const outcome = run(1);
    expect(outcome.impactStep).toBe(COMMAND_STEP + WARNING_STEPS);
    // The landing sub-step burns the first of the 240 ticks
    expect(outcome.resolvedStep).toBe(COMMAND_STEP + WARNING_STEPS + BURN_STEPS - 1);
  });

  it('burns the enemies along the stretch by their armor, capped, and nobody off it', () => {
    const { hpShare, alive, hits, kills } = run(1);
    expect(hpShare[0]).toBeCloseTo(0.4, 6);       // unarmored: fire 1.5, at the 60 % cap
    expect(hpShare[1]).toBeGreaterThan(0.6);      // heavy: fire 0.6, a third or so
    expect(hpShare[1]).toBeLessThan(0.72);
    expect(hpShare[2]).toBeGreaterThan(0.95);     // fortified boss: 0.25 x 30 % per second
    expect(hpShare[2]).toBeLessThan(0.97);
    expect(hpShare[3]).toBe(1);                   // behind the start point
    expect(hpShare[4]).toBe(1);                   // beyond the 72 m
    expect(alive[5]).toBe(false);                 // half gone, the rest burnt
    expect(hits).toBe(4);
    expect(kills).toBe(1);
  });

  it('gives the same outcome at timescale 1 and 10', () => {
    expect(run(10)).toEqual(run(1));
  });
});
