/**
 * Playtest 238 of night 1 (docs/archive/REVIEW_SPRINT_2026-09-13.md) replayed:
 * regular W7 (bat_swarm) and W8 (hornet_strike) at a place with two spawns.
 * At each portal the air units come as in 232 and 233 with a custom wave:
 * through the middle of the opening, all of a type at the same height, level
 * for a stretch in front of the gate, then climbing to their cruise height.
 *
 * The waves come from the real WaveDirector rule path and the
 * adapter the facade's AI start uses (adaptDirectorWave), into the real
 * WaveManager and EnemyManager with mocked rendering (createTestManagers).
 * AI waves bring no spawn mode, so every entry draws its spawn at random;
 * Math.random is seeded, so both portals get their share. Not covered: the
 * look of the climb (232, 233 ok per custom wave) and the dragon's size.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('three', async () => await import('@/test/mocks/three.mock'));

import { Injector, runInInjectionContext } from '@angular/core';
import { WaveDirector } from '../director/wave-director';
import { StateSnapshotService } from '../director/state-snapshot.service';
import { adaptDirectorWave } from '../director/wave-config-adapter';
import { TEMPLATES } from '../director/templates';
import { createEmptySnapshot, type GameStateSnapshot } from '../director/models/game-state-snapshot';
import type { WaveConfig } from '../director/models/wave-config';
import { createTestManagers, TEST_SPAWN_POINTS, type TestManagers } from '../integration/test-helpers';
import { geoDistanceFast, METERS_PER_DEGREE_LAT } from '../utils/geo-utils';
import type { Enemy } from '../entities/enemy.entity';
import type { GeoPosition, RouteWaypoint } from '../models/game.types';

const STEP_MS = 16.667;
/** Height of the routes; the mocked grid leaves the ground there */
const GROUND = 300;

/** Straight 150 m north from (lat, lon), an 8 m corridor at the start: a portal of scale 1 */
function route(lat: number, lon: number): RouteWaypoint[] {
  return [0, 50, 100, 150].map((m, i) => ({
    lat: lat + m / METERS_PER_DEGREE_LAT,
    lon,
    height: GROUND,
    ...(i === 0 ? { corridorLeft: 4, corridorRight: 4 } : {}),
  }));
}

/** Two spawns about 290 m apart */
const ROUTES = [route(48.776, 9.183), route(48.776, 9.187)];
const SPAWNS: typeof TEST_SPAWN_POINTS = ROUTES.map((r, i) => ({
  id: `spawn-${i + 1}`,
  name: `Spawn ${i + 1}`,
  lat: r[0].lat,
  lon: r[0].lon,
  height: 300,
}));

class StubCollector {
  snapshot: GameStateSnapshot = createEmptySnapshot();
  setCurrentWaveConfig = vi.fn<(config: WaveConfig) => void>();
  onWaveResult(): () => void {
    return () => undefined;
  }
  getStateSnapshot(): GameStateSnapshot {
    return this.snapshot;
  }
}

/** A defense strong enough that the fairness gate has no finite cap, as in wave-director.spec.ts */
function overwhelmingDefense(snapshot: GameStateSnapshot, waveNumber: number): void {
  const dps = { unarmored: 1e6, light: 1e6, heavy: 1e6, fortified: 1e6, ethereal: 1e6 };
  snapshot.waveNumber = waveNumber;
  snapshot.defense.totalDPS = 1e6;
  snapshot.defense.effectiveDPSPerArmor = { ground: dps, air: dps };
  snapshot.defense.gateDpsPerArmor = { ground: dps, air: dps };
  snapshot.defense.killThroughput = { ground: 1e6, air: 1e6 };
  snapshot.defense.capabilities = {
    hasAntiAir: true, hasSplash: true, hasSlow: true, hasDoT: true, hasAntiEthereal: true,
  };
}

/** Math.random with a fixed sequence */
function seededRandom(seed = 7): void {
  let state = seed;
  vi.spyOn(Math, 'random').mockImplementation(() => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  });
}

interface Tracked {
  enemy: Enemy;
  /** Index of the spawn whose portal it came out of */
  portal: number;
  /** Height offset at the spawn: kept until the climb starts */
  from: number;
  /** Body height over the ground at the spawn: the offset makes up for the altitude spread in terrainHeight */
  altitude: number;
  /** Distance from its portal's route start at the spawn */
  startDistance: number;
  /** Distance along the route where its climb starts and ends */
  climbStart: number;
  climbEnd: number;
  /** Stayed at `from` until climbStart and never sank */
  levelThenUp: boolean;
  /** Height over the ground once out of the portal phase, null until then */
  cruise: number | null;
}

describe('Regular air waves at two portals, playtest 238 (night 1) replayed', () => {
  let director: WaveDirector;
  let collector: StubCollector;
  let m: TestManagers;

  beforeEach(() => {
    collector = new StubCollector();
    const injector = Injector.create({ providers: [{ provide: StateSnapshotService, useValue: collector }] });
    director = runInInjectionContext(injector, () => new WaveDirector());
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    seededRandom();
  });

  afterEach(() => {
    m?.enemyManager.clear();
    vi.restoreAllMocks();
  });

  /** Plan wave `wave` as after wave - 1, play it at both portals until every air unit is out of its portal phase */
  async function play(wave: number) {
    overwhelmingDefense(collector.snapshot, wave - 1);
    const planned = await director.getNextWave(wave);
    const config = adaptDirectorWave(planned.config);

    m = createTestManagers();
    m.waveManager.initialize(SPAWNS, new Map(SPAWNS.map((s, i) => [s.id, ROUTES[i] as GeoPosition[]])));
    const tracked: Tracked[] = [];
    let spawnedViaPortal = 0;
    m.eventBus.on('enemy:spawned', ({ enemy, viaPortal }) => {
      if (viaPortal) spawnedViaPortal++;
      const exit = enemy.portalExit;
      const d = ROUTES.map((r) => geoDistanceFast(enemy.position, r[0]));
      tracked.push({
        enemy,
        portal: d[0] < d[1] ? 0 : 1,
        from: enemy.heightOffset,
        altitude: enemy.transform.terrainHeight + enemy.heightOffset - GROUND,
        startDistance: Math.min(...d),
        climbStart: exit?.climbStart ?? NaN,
        climbEnd: exit?.climbEnd ?? NaN,
        levelThenUp: exit !== null && exit.from === enemy.heightOffset,
        cruise: exit === null ? enemy.heightOffset : null,
      });
    });

    m.waveManager.startWave(config);
    const expected = config.schedule.entries.length;
    const previous = new Map<Enemy, number>();
    let clock = 0;
    for (let s = 0; s < 30_000; s++) {
      clock += STEP_MS;
      m.waveManager.tickSpawn(STEP_MS);
      m.enemyManager.update(STEP_MS, clock);
      for (const t of tracked) {
        if (t.cruise !== null) continue;
        const e = t.enemy;
        if (e.portalExit === null) {
          t.cruise = e.heightOffset;
          continue;
        }
        const last = previous.get(e) ?? t.from;
        if (e.movement.getDistanceAlongPath() <= t.climbStart && e.heightOffset !== t.from) t.levelThenUp = false;
        if (e.heightOffset < last) t.levelThenUp = false;
        previous.set(e, e.heightOffset);
      }
      if (tracked.length === expected && tracked.every((t) => t.cruise !== null)) break;
    }
    return { planned, expected, tracked, spawnedViaPortal };
  }

  function expectOutOfTheirPortals({ expected, tracked, spawnedViaPortal }: Awaited<ReturnType<typeof play>>) {
    expect(tracked).toHaveLength(expected);
    expect(spawnedViaPortal).toBe(expected);
    // Both portals send their share, each unit starts on its portal's route start
    for (const portal of [0, 1]) expect(tracked.filter((t) => t.portal === portal).length).toBeGreaterThan(0);
    for (const t of tracked) expect(t.startDistance).toBeLessThan(0.01);
    for (const t of tracked) {
      const type = t.enemy.typeConfig;
      expect(type.isAirUnit, type.id).toBe(true);
      // Through the opening, below its cruise height, level in front of the gate, then up
      expect(t.altitude, type.id).toBeLessThan(type.heightOffset - (type.heightVariation ?? 0));
      expect(t.levelThenUp, type.id).toBe(true);
      expect(t.climbEnd, type.id).toBeGreaterThan(t.climbStart);
      expect(t.cruise, type.id).toBe(type.heightOffset);
    }
    // All of a type come through the same height, at both portals (both of scale 1)
    const types = new Set(tracked.map((t) => t.enemy.typeConfig.id));
    for (const type of types) {
      const altitudes = tracked.filter((t) => t.enemy.typeConfig.id === type).map((t) => t.altitude);
      expect(Math.max(...altitudes) - Math.min(...altitudes), type).toBeLessThan(1e-9);
    }
    return types;
  }

  it('W7 bat_swarm: every bat comes out of its portal and climbs, at both portals', async () => {
    const run = await play(7);
    expect(TEMPLATES[run.planned.config.templateIdx!].id).toBe('bat_swarm');
    expect([...expectOutOfTheirPortals(run)]).toEqual(['bat']);
  });

  it('W8 hornet_strike: hornets and bats alike, at both portals', async () => {
    const run = await play(8);
    expect(TEMPLATES[run.planned.config.templateIdx!].id).toBe('hornet_strike');
    expect([...expectOutOfTheirPortals(run)].sort()).toEqual(['bat', 'hornet']);
  });
});
