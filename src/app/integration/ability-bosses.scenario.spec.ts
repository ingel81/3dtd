/**
 * Playtest 398 and the logic of 399 (night 2, docs/REVIEW_SPRINT_2026-09-14.md)
 * replayed through the real EnemyManager and WaveManager, rendering mocked.
 *
 * 398: frost bomb and EMP on part of the worm: the rings in the radius are
 *      frozen or stunned, the whole worm stands, 1 s and 0.75 s as a boss.
 *      The real AbilityManager picks the targets with the route grid's query
 *      for enemies without a body, a 2D distance.
 *      L: the beam burns the rings it runs over on its way toward the spawn,
 *      each by at most the boss cap; the stretch from the real route sweep,
 *      the damage as DamageApplicationService.applyMaxHpFraction takes it.
 * 399: frost bomb and EMP on the ooze: the tip stands, and at the HQ nothing
 *      flows in. The halt is applied as CombatEffectService.applyAbilityHalt
 *      applies it, with the ability's boss durations; that the circle finds
 *      the ooze by its body is ability-ooze.spec.ts.
 *
 * Status effects in game time: StatusEffectService reads the clock the
 * sub-steps advance, the enemies are updated with it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('three', async () => {
  const mod = await import('@/test/mocks/three.mock');
  return { ...mod };
});
// Injectable decorator a no-op, as in ability-ooze.spec.ts
vi.mock('@angular/core', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@angular/core');
  return { ...actual, Injectable: () => (target: unknown) => target };
});

import {
  createTestManagers,
  createTestCachedPaths,
  makeSingleTypeWaveConfig,
  TEST_SPAWN_POINTS,
  type TestManagers,
} from './test-helpers';
import { AbilityManager } from '../managers/ability.manager';
import { StatusEffectService } from '../services/combat/status-effect.service';
import {
  ABILITIES,
  abilityBeamCap,
  abilityFreezeMs,
  abilitySourceId,
  abilityStunMs,
  type AbilityEffect,
  type AbilityId,
} from '../configs/abilities.config';
import { ENEMY_TYPES } from '../configs/enemy-types.config';
import { geoDistanceFast, METERS_PER_DEGREE_LAT } from '../utils/geo-utils';
import { routeSweepToward } from '../utils/route-sweep';
import type { Enemy } from '../entities/enemy.entity';
import type { GameEvent } from '../game-engine/game-event-bus';
import type { GeoPosition } from '../models/game.types';

/** GameClock.FIXED_STEP_MS */
const STEP_MS = 16.667;
/** Frost bomb and EMP: 500 ms of warning */
const WARNING_STEPS = 30;
/** A boss: frozen 1 s, stunned 0.75 s */
const BOSS_FREEZE_STEPS = 60;
const BOSS_STUN_STEPS = 45;
const LASER = ABILITIES['orbital-laser'];
const BEAM = LASER.effect as Extract<AbilityEffect, { kind: 'beam' }>;
/** The laser's warning and its burn, and a few sub-steps after */
const LASER_STEPS = Math.ceil((LASER.warningMs + BEAM.durationMs) / STEP_MS) + 5;

/** Straight route north, a waypoint every 50 m */
function straightPath(meters: number): GeoPosition[] {
  const points: GeoPosition[] = [];
  for (let m = 0; m < meters; m += 50) {
    points.push({ lat: 48.776 + m / METERS_PER_DEGREE_LAT, lon: 9.183, height: 300 });
  }
  points.push({ lat: 48.776 + meters / METERS_PER_DEGREE_LAT, lon: 9.183, height: 300 });
  return points;
}

describe('Frost bomb and EMP on the worm, playtest 398 replayed', () => {
  let m: TestManagers;
  let clock: number;
  let abilities: AbilityManager;
  let resolved: Extract<GameEvent, { type: 'ability:resolved' }>[];
  /** The worm's route */
  let route: GeoPosition[];

  beforeEach(() => {
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    m = createTestManagers();
    clock = 0;
    resolved = [];
    route = [];
    m.eventBus.on('ability:resolved', (event) => resolved.push(event));
    const status = new StatusEffectService();
    status.setGameClockProvider(() => clock);
    abilities = new AbilityManager(m.eventBus, {
      snapToRoute: (target) => ({ ...target }),
      // The route grid's query for enemies without a body: 2D distance
      enemiesInRadius: (center, radiusM, out) => {
        out.length = 0;
        for (const enemy of m.enemyManager.getAlive()) {
          if (geoDistanceFast(center, enemy.position) <= radiusM) out.push(enemy);
        }
        return out;
      },
      // As DamageApplicationService.applyMaxHpFraction takes it
      strike: (targets, fractionOf) => {
        let kills = 0;
        for (const enemy of targets) {
          if (!enemy.alive) continue;
          if (enemy.health.takeDamage(enemy.health.maxHp * fractionOf(enemy)) && m.enemyManager.kill(enemy)) kills++;
        }
        return kills;
      },
      // As CombatEffectService.applyAbilityHalt applies them
      halt: (targets, kind, durationMsOf, sourceId) => {
        for (const enemy of targets) {
          if (kind === 'freeze') status.applyFreeze(enemy, durationMsOf(enemy), sourceId);
          else status.applyStun(enemy, durationMsOf(enemy), sourceId);
        }
      },
      // As GameStateManager asks it, on the worm's route
      routeSweep: (target, maxDistanceM, lengthM) => routeSweepToward([route], target, maxDistanceM, lengthM),
    });
    abilities.setPhaseProvider(() => 'wave');
    for (const id of ['frost-bomb', 'emp', 'orbital-laser'] as AbilityId[]) {
      m.eventBus.emit({
        type: 'research:completed',
        researchId: ABILITIES[id].researchId,
        effects: [{ kind: 'global-perk', perkId: ABILITIES[id].perkId, description: '' }],
      });
    }
  });

  afterEach(() => {
    m.enemyManager.clear();
    vi.restoreAllMocks();
  });

  /** `steps` sub-steps as GameStateManager runs them, abilities before the enemies; the head's distance after each */
  const run = (steps: number, head: Enemy): number[] => {
    const trace: number[] = [];
    for (let i = 0; i < steps; i++) {
      clock += STEP_MS;
      abilities.update(STEP_MS);
      m.waveManager.tickSpawn(STEP_MS);
      m.enemyManager.update(STEP_MS, clock);
      trace.push(head.movement.getDistanceAlongPath());
    }
    return trace;
  };
  const stillSteps = (trace: number[]) => trace.filter((d, i) => i > 0 && d === trace[i - 1]).length;
  /** A worm on a straight 400 m route north; its head */
  const spawnWorm = (): Enemy => {
    route = straightPath(400);
    return m.enemyManager.spawn(route, 'worm');
  };

  /**
   * A worm 20 s out of the portal, then `id` on the ring `slot` places behind
   * the head, far enough that the circle does not reach the head.
   */
  const hitWorm = (id: AbilityId) => {
    const head = spawnWorm();
    const group = head.worm!.group;
    run(1200, head);
    const spacing = ENEMY_TYPES['worm'].chain!.spacing;
    const slot = Math.ceil((ABILITIES[id].radiusM + 5) / spacing);
    const aim = group.segments[slot]!.position;
    expect(abilities.use(id, { lat: aim.lat, lon: aim.lon }).ok).toBe(true);
    const trace = run(WARNING_STEPS, head);
    // Right after the burst, before the halt runs out and the effect is dropped
    const struck = group.segments.filter((e): e is Enemy => e !== null && e.movement.statusEffects.length > 0);
    const kinds = new Set(struck.flatMap((e) => e.movement.statusEffects.map((s) => s.type)));
    trace.push(...run(120, head));
    return { head, struck, kinds, trace };
  };

  it('F: the rings in the 20 m are frozen, the whole worm stands 1 s, the head too', () => {
    const { head, struck, kinds, trace } = hitWorm('frost-bomb');
    expect(resolved).toEqual([expect.objectContaining({ abilityId: 'frost-bomb', kills: 0 })]);
    const hits = resolved[0].hits;
    expect(hits).toBeGreaterThan(1);

    // Frozen rings are the ones in the circle; the head is outside it and stands with them
    expect(struck).toHaveLength(hits);
    expect([...kinds]).toEqual(['freeze']);
    expect(struck).not.toContain(head);
    expect(stillSteps(trace)).toBe(BOSS_FREEZE_STEPS);
    expect(trace.at(-1)).toBeGreaterThan(trace[WARNING_STEPS - 1] + 1);
  });

  it('E: the rings in the 30 m are stunned, the whole worm stands 0.75 s', () => {
    const { head, struck, kinds, trace } = hitWorm('emp');
    expect(resolved).toEqual([expect.objectContaining({ abilityId: 'emp', kills: 0 })]);
    expect(resolved[0].hits).toBeGreaterThan(1);
    expect(struck).toHaveLength(resolved[0].hits);
    expect([...kinds]).toEqual(['stun']);
    expect(struck).not.toContain(head);
    expect(stillSteps(trace)).toBe(BOSS_STUN_STEPS);
  });

  it('L: the rings the beam runs over burn, each by at most the boss cap; the head and the rings ahead of the beam do not', () => {
    const head = spawnWorm();
    const group = head.worm!.group;
    run(1200, head);
    const spacing = ENEMY_TYPES['worm'].chain!.spacing;
    // The beam lands on the ring 25 m behind the head and runs toward the spawn, away from the head
    const slot = Math.ceil((LASER.radiusM + 20) / spacing);
    const aim = group.segments[slot]!.position;
    expect(abilities.use('orbital-laser', { lat: aim.lat, lon: aim.lon }).ok).toBe(true);
    run(LASER_STEPS, head);

    expect(resolved).toEqual([expect.objectContaining({ abilityId: 'orbital-laser', kills: 0 })]);
    const rings = group.segments.filter((e): e is Enemy => e !== null);
    const burnt = rings.filter((e) => e.health.hp < e.health.maxHp);
    expect(burnt.length).toBeGreaterThan(1);
    expect(burnt).toHaveLength(resolved[0].hits);
    const cap = abilityBeamCap(BEAM, ENEMY_TYPES['worm']);
    for (const ring of burnt) expect(1 - ring.health.hp / ring.health.maxHp).toBeLessThanOrEqual(cap + 1e-9);
    // Ahead of the landing point only what its circle reached at the impact
    expect(burnt).not.toContain(head);
    const reach = Math.ceil(LASER.radiusM / spacing);
    for (const ring of burnt) expect(group.segments.indexOf(ring)).toBeGreaterThanOrEqual(slot - reach);
  });
});

describe('Frost bomb and EMP on the ooze, playtest 399 replayed', () => {
  let m: TestManagers;
  let clock: number;
  let status: StatusEffectService;

  beforeEach(() => {
    // Wired as GameStateManager wires them for leaks, as in ooze.spec.ts
    m = createTestManagers();
    m.waveManager.initialize(TEST_SPAWN_POINTS, createTestCachedPaths());
    m.enemyManager.setWaveNumberProvider(() => m.waveManager.waveNumber());
    m.enemyManager.setWaveSizeProvider(() => m.waveManager.getExpectedBodyCount());
    clock = 0;
    status = new StatusEffectService();
    status.setGameClockProvider(() => clock);
    m.waveManager.startWave(makeSingleTypeWaveConfig({ count: 1, type: 'ooze' }));
  });

  afterEach(() => {
    m.enemyManager.clear();
  });

  const run = (steps: number) => {
    for (let i = 0; i < steps; i++) {
      clock += STEP_MS;
      m.waveManager.tickSpawn(STEP_MS);
      m.enemyManager.update(STEP_MS, clock);
    }
  };
  /** The halt of `id` on the ooze, as CombatEffectService.applyAbilityHalt applies it */
  const halt = (ooze: Enemy, id: 'frost-bomb' | 'emp') => {
    const effect: AbilityEffect = ABILITIES[id].effect;
    if (effect.kind === 'freeze') status.applyFreeze(ooze, abilityFreezeMs(effect, ooze.typeConfig), abilitySourceId(id));
    if (effect.kind === 'stun') status.applyStun(ooze, abilityStunMs(effect, ooze.typeConfig), abilitySourceId(id));
  };

  it('the tip stands 1 s frozen and 0.75 s stunned, then moves on', () => {
    run(1200); // 20 s: the tip on the route, the body growing behind it
    const ooze = m.enemyManager.getAlive()[0];
    expect(ooze.typeConfig.id).toBe('ooze');

    let tip = ooze.body!.tipM;
    halt(ooze, 'frost-bomb');
    run(BOSS_FREEZE_STEPS - 1);
    expect(ooze.body!.tipM).toBe(tip);
    run(2);
    expect(ooze.body!.tipM).toBeGreaterThan(tip);

    tip = ooze.body!.tipM;
    halt(ooze, 'emp');
    run(BOSS_STUN_STEPS - 1);
    expect(ooze.body!.tipM).toBe(tip);
    run(2);
    expect(ooze.body!.tipM).toBeGreaterThan(tip);
  });

  it('at the HQ nothing flows in while it is frozen or stunned, and it flows on after', () => {
    const leaks: number[] = [];
    m.eventBus.on('enemy:leaking', (event) => leaks.push(event.damage));
    // The 111 m route at 3 m/s: the tip arrives after 37 s, then the body flows in
    run(2400);
    const ooze = m.enemyManager.getAlive()[0];
    // Flowing in: it has leaked, and a body flowed in whole would be gone
    expect(ooze.typeConfig.id).toBe('ooze');
    expect(leaks.length).toBeGreaterThan(0);

    for (const [id, steps] of [['frost-bomb', BOSS_FREEZE_STEPS], ['emp', BOSS_STUN_STEPS]] as const) {
      const length = ooze.body!.lengthM;
      const hp = ooze.health.hp;
      const leaked = leaks.length;
      halt(ooze, id);
      run(steps - 1);
      expect(ooze.body!.lengthM, id).toBe(length);
      expect(ooze.health.hp, id).toBe(hp);
      expect(leaks.length, id).toBe(leaked);
      run(10);
      expect(ooze.body!.lengthM, id).toBeLessThan(length);
    }
  });
});
