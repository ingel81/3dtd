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
import { EFFECTIVENESS_COLORS } from '../configs/combat/damage-matrix.config';
import type { DamageEffectiveness } from '../configs/combat/combat.types';
import { geoDistanceFast } from '../utils/geo-utils';
import type { Enemy } from '../entities/enemy.entity';
import type { SpawnStart } from '../managers/enemy.manager';
import type { GeoPosition } from '../models/game.types';

const createEngine = createAbilityTestEngine;

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
  maxHp: number[];
  hits: number;
  kills: number;
  credits: number;
  /** Credits gained since the wave start */
  earned: number;
  /** Damage numbers, as "text colour" */
  numbers: string[];
  /** Gold popups, as "text colour" */
  goldPopups: string[];
}

/** The floating texts of a run as "text colour": damage numbers start with "-", gold with "+" */
function floatingTexts(texts: ReturnType<typeof vi.fn>, prefix: '-' | '+'): string[] {
  return texts.mock.calls
    .filter(([text]) => (text as string).startsWith(prefix))
    .map(([text, , , , config]) => `${text} ${(config as { color: string }).color}`);
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
  const engine = createEngine() as unknown as { effects: { spawnFloatingText: ReturnType<typeof vi.fn> } };
  gsm.initialize(engine as never, BASE_POSITION, TEST_SPAWN_POINTS, createTestCachedPaths());
  const creditsBefore = gsm.credits();
  gsm.gameSpeed.set(timescale);
  const bus = gsm.getEventBus();
  bus.emit({
    type: 'research:completed', playerId: 'local', local: true,
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
    maxHp: enemies.map((e) => e.health.maxHp),
    hits,
    kills,
    credits: gsm.credits(),
    earned: gsm.credits() - creditsBefore,
    numbers: floatingTexts(engine.effects.spawnFloatingText, '-'),
    goldPopups: floatingTexts(engine.effects.spawnFloatingText, '+'),
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

  it('shows every burnt enemy one number with what it lost, coloured by fire against its armor', () => {
    const { numbers, hpShare, maxHp } = run(1);
    const number = (i: number, share: number, tier: DamageEffectiveness) =>
      `-${Math.round(maxHp[i] * share)} ${EFFECTIVENESS_COLORS[tier]}`;
    expect([...numbers].sort()).toEqual([
      number(0, 1 - hpShare[0], 'devastating'), // zombie, unarmored: fire 1.5
      number(1, 1 - hpShare[1], 'normal'),      // tank, heavy: fire 0.6
      number(2, 1 - hpShare[2], 'weak'),        // herbert, fortified: fire 0.25
      number(5, 0.5, 'devastating'),            // the half-burnt zombie: the half it had left
    ].sort());
  });

  it('pays its kill from the kill budget like any other kill, with its gold popup', () => {
    const { kills, goldPopups, earned } = run(1);
    expect(kills).toBe(1);
    expect(earned).toBeGreaterThan(0);
    expect(goldPopups).toEqual([`+${earned} #FFD700`]);
  });
});
