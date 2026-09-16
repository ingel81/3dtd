/**
 * Playtest 393 (night 2, docs/archive/REVIEW_SPRINT_2026-09-14.md) replayed: an ooze
 * passes the hero at his post. He shoots on while a stretch of its body is
 * within his 18 m, and the tracers fly to the body point nearest him, not to
 * its tip.
 *
 * hero.manager.spec.ts and hero-body-contact.spec.ts check the manager and
 * the measure with a fake world. This runs the real GameStateManager
 * sub-step loop, whose HeroWorld.bodyContact turns his position into local
 * metres through the engine and measures on the ooze's real body (OozeBodies,
 * RouteBody). The harness of hero.scenario.spec.ts; the engine converts geo
 * to local on a flat frame, and the route grid's radius query is the real
 * GlobalRouteGrid's, which finds a body by its nearest point (it tracks no
 * cells here, so it finds nothing else).
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

import { Vector3 } from 'three';
import { createMockTilesEngine, createTestCachedPaths, TEST_PATH, TEST_SPAWN_POINTS } from './test-helpers';
import { GameStateManager } from '../managers/game-state.manager';
import { CombatEffectService } from '../services/combat/combat-effect.service';
import { DamageApplicationService } from '../services/combat/damage-application.service';
import { GameObject } from '../core/game-object';
import { GlobalRouteGrid } from '../utils/global-route-grid';
import { HERO } from '../configs/hero.config';
import { DEG_TO_RAD, METERS_PER_DEGREE_LAT, geoDistanceFast } from '../utils/geo-utils';
import type { Enemy } from '../entities/enemy.entity';
import type { ProjectileManager } from '../managers/projectile.manager';
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

/** The origin of the helper's engine */
const ORIGIN = { lat: 48.776, lon: 9.183, height: 300 };
const M_PER_DEG_LON = METERS_PER_DEGREE_LAT * Math.cos(ORIGIN.lat * DEG_TO_RAD);
/** Geo to local on a flat frame around the origin, as the engine's sync near it */
const flatSync = {
  getOrigin: () => ({ ...ORIGIN }),
  geoToLocalSimple: (lat: number, lon: number, height: number) =>
    new Vector3((lon - ORIGIN.lon) * M_PER_DEG_LON, height - ORIGIN.height, -(lat - ORIGIN.lat) * METERS_PER_DEGREE_LAT),
  geoToLocalSimpleInto: (lat: number, lon: number, height: number, target: Vector3): Vector3 =>
    target.set((lon - ORIGIN.lon) * M_PER_DEG_LON, height - ORIGIN.height, -(lat - ORIGIN.lat) * METERS_PER_DEGREE_LAT),
};

function createEngine(): never {
  const engine = createMockTilesEngine() as unknown as Record<string, Record<string, unknown>>;
  for (const key of ['effects', 'towers', 'enemies', 'projectiles', 'trailStreaks', 'spatialAudio', 'oozes']) {
    engine[key] = withAutoStubs(engine[key]);
  }
  engine['sync'] = withAutoStubs({ ...engine['sync'], ...flatSync });
  engine['enemies']['create'] = vi.fn(() => Promise.resolve(null));
  engine['hero'] = withAutoStubs({});
  engine['spatialAudio']['getListener'] = () => ({
    context: { state: 'running', resume: () => Promise.resolve() },
    getWorldPosition: (target: Vector3) => target.set(0, 0, 0),
  });
  (engine as Record<string, unknown>)['renderingEnabled'] = false;
  return withAutoStubs(engine) as never;
}

/** HQ at the north end of the 111 m path */
const BASE_POSITION: GeoPosition = TEST_PATH[TEST_PATH.length - 1];
const HIRE_STEP = 5;
const MOVE_STEP = 10;
/** 44 m south of the HQ, 67 m north of the spawn */
const POST: GeoPosition = TEST_PATH[6];
/** The ooze comes once he holds his post, 10 s in */
const OOZE_STEP = 600;
/** 45 s: its tip, 3 m/s, some 100 m along the path, short of the HQ */
const LAST_STEP = 2700;

interface Shot {
  step: number;
  target: Enemy;
  aim: GeoPosition | null;
  hero: GeoPosition;
  tip: GeoPosition;
}

function run() {
  for (const key of Object.keys(mockServices)) delete mockServices[key];
  GameObject.resetIdCounter();

  const grid = new GlobalRouteGrid();
  grid.initialize((() => null) as never, flatSync as never);
  mockServices['GlobalRouteGridService'] = withAutoStubs({
    isInitialized: () => false,
    getGroundLocalYAt: () => null,
    addBodyEnemy: (enemy: Enemy) => grid.addBodyEnemy(enemy),
    removeBodyEnemy: (enemy: Enemy) => grid.removeBodyEnemy(enemy),
    getEnemiesInRadiusGeo: (center: GeoPosition, radiusM: number, excludeId: string | undefined, out: Enemy[]) =>
      grid.getEnemiesInRadiusGeo(center, radiusM, excludeId, out),
  });
  const paths = createTestCachedPaths();
  mockServices['PathAndRouteService'] = withAutoStubs({ getCachedPaths: () => paths });
  mockServices['SpatialGridService'] = withAutoStubs({ updateEnemyTracked: () => null });
  mockServices['EnemyDebugService'] = withAutoStubs({ debugEnemies: () => [] });
  mockServices['EconomyService'] = withAutoStubs({ computeWaveCompletionBonus: () => 0 });
  mockServices['DamageApplicationService'] = new DamageApplicationService();
  mockServices['CombatEffectService'] = new CombatEffectService();

  const gsm = new GameStateManager();
  gsm.initialize(createEngine(), BASE_POSITION, TEST_SPAWN_POINTS, paths);
  const bus = gsm.getEventBus();
  bus.emit({
    type: 'research:completed',
    researchId: HERO.researchId,
    effects: [{ kind: 'global-perk', perkId: HERO.perkId, description: '' }],
  });
  gsm.addCredits(HERO.cost);

  let steps = 0;
  const shots: Shot[] = [];
  const spawnShot = gsm.projectileManager.spawnShot.bind(gsm.projectileManager);
  vi.spyOn(gsm.projectileManager, 'spawnShot').mockImplementation((...args: Parameters<ProjectileManager['spawnShot']>) => {
    const target = args[2];
    shots.push({
      step: steps,
      target,
      aim: args[7] ?? null,
      hero: { ...gsm.heroManager.getHero()!.position },
      tip: { ...target.position },
    });
    return spawnShot(...args);
  });

  gsm.beginWave();
  let ooze: Enemy | null = null;
  let now = 1000;
  while (steps < LAST_STEP) {
    now += 16;
    gsm.update(now, () => {
      if (steps >= LAST_STEP) return;
      steps++;
      if (steps === HIRE_STEP) bus.emit({ type: 'command:hire-hero' });
      if (steps === MOVE_STEP) bus.emit({ type: 'command:hero-move', target: { lat: POST.lat, lon: POST.lon } });
      if (steps === OOZE_STEP) ooze = gsm.enemyManager.spawn(TEST_PATH, 'ooze');
    });
  }
  return { shots, ooze: ooze as Enemy | null, hero: gsm.heroManager.getHero()!.position };
}

describe('An ooze passes the hero at his post, playtest 393 replayed', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('393: he shoots on while its body is within 18 m, its tip far past him, at the body point nearest him', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // centre line
    const { shots, ooze, hero } = run();

    expect(ooze).not.toBeNull();
    expect(ooze!.body).not.toBeNull();
    expect(ooze!.alive).toBe(true);
    // On his leash: he met the tip on its way in and stands in the body since
    expect(geoDistanceFast(hero, POST)).toBeLessThanOrEqual(HERO.leashM + 0.5);

    // Shots while the tip is out of his range: he still fires, at the ooze
    const pastTip = shots.filter((s) => geoDistanceFast(s.hero, s.tip) > HERO.rangeM);
    expect(pastTip.length).toBeGreaterThan(10);
    for (const shot of pastTip) {
      expect(shot.target).toBe(ooze);
      // The body lies under his feet: the aim point is where he stands, not the tip
      expect(shot.aim).not.toBeNull();
      expect(geoDistanceFast(shot.aim!, shot.hero)).toBeLessThan(1);
      expect(geoDistanceFast(shot.aim!, shot.tip)).toBeGreaterThan(HERO.rangeM);
    }
    // Up to the end, with the tip some 35 m past him
    const last = pastTip.at(-1)!;
    expect(last.step).toBeGreaterThan(LAST_STEP - 60);
    expect(geoDistanceFast(last.hero, last.tip)).toBeGreaterThan(30);
  });
});
