/**
 * Integration Test: the hero through the real GameStateManager sub-step
 * loop, with real enemies, real projectiles and the real damage path.
 *
 * Hire and move orders go over the command bus, as the UI sends them. The
 * same commands at the same sub-steps have to give the same hero, the same
 * kills and the same credits whether a frame carries one sub-step
 * (timescale 1) or ten (timescale 10), which a replay and lockstep rely on.
 *
 * Only the services around the loop are stubbed. The route grid's radius
 * query is a plain distance filter over the living enemies, because the
 * stubbed grid tracks no cells.
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

import { createMockTilesEngine, createTestCachedPaths, TEST_PATH, TEST_SPAWN_POINTS } from './test-helpers';
import { GameStateManager } from '../managers/game-state.manager';
import { CombatEffectService } from '../services/combat/combat-effect.service';
import { DamageApplicationService } from '../services/combat/damage-application.service';
import { GameObject } from '../core/game-object';
import { HERO } from '../configs/hero.config';
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
  const engine = createMockTilesEngine() as unknown as Record<string, Record<string, unknown>>;
  for (const key of ['effects', 'towers', 'enemies', 'projectiles', 'trailStreaks', 'spatialAudio', 'sync']) {
    engine[key] = withAutoStubs(engine[key]);
  }
  engine['enemies']['create'] = vi.fn(() => Promise.resolve(null));
  engine['hero'] = withAutoStubs({});
  engine['spatialAudio']['getListener'] = () => ({ context: { state: 'running', resume: () => Promise.resolve() } });
  // Headless, like a training tab: no presentFrame
  (engine as Record<string, unknown>)['renderingEnabled'] = false;
  return withAutoStubs(engine) as never;
}

/** HQ at the north end of the 111 m path */
const BASE_POSITION: GeoPosition = TEST_PATH[TEST_PATH.length - 1];
const HIRE_STEP = 5;
const MOVE_STEP = 10;
/** 44 m south of the HQ: he walks there in about 5.5 s */
const POST: GeoPosition = TEST_PATH[6];
const READ_STEP = 1800;

/** Zombies (80 HP, unarmored) walking north toward him, spread by their speed */
const ROSTER = [
  { type: 'zombie', speed: 5 },
  { type: 'zombie', speed: 4 },
  { type: 'zombie', speed: 6 },
  { type: 'zombie', speed: 3 },
] as const;

interface Outcome {
  hero: GeoPosition;
  kills: number;
  level: number;
  heroKillEvents: number;
  deaths: number;
  hp: number[];
  credits: number;
  shots: number;
}

function createGame(timescale: number) {
  for (const key of Object.keys(mockServices)) delete mockServices[key];
  GameObject.resetIdCounter();

  const ref: { gsm?: GameStateManager } = {};
  mockServices['GlobalRouteGridService'] = withAutoStubs({
    isInitialized: () => false,
    getEnemiesInRadiusGeo: (center: GeoPosition, radiusM: number, _exclude: unknown, out: Enemy[]) => {
      out.length = 0;
      for (const enemy of ref.gsm!.enemyManager.getAlive()) {
        if (geoDistanceFast(center, enemy.position) <= radiusM) out.push(enemy);
      }
      return out;
    },
  });
  const paths = createTestCachedPaths();
  mockServices['PathAndRouteService'] = withAutoStubs({ getCachedPaths: () => paths });
  mockServices['SpatialGridService'] = withAutoStubs({ updateEnemyTracked: () => null });
  mockServices['EnemyDebugService'] = withAutoStubs({ debugEnemies: () => [] });
  mockServices['EconomyService'] = withAutoStubs({ computeWaveCompletionBonus: () => 0 });
  mockServices['DamageApplicationService'] = new DamageApplicationService();
  mockServices['CombatEffectService'] = new CombatEffectService();

  const gsm = new GameStateManager();
  ref.gsm = gsm;
  gsm.initialize(createEngine(), BASE_POSITION, TEST_SPAWN_POINTS, paths);
  gsm.trainingTimescale.set(timescale);

  gsm.getEventBus().emit({
    type: 'research:completed',
    researchId: HERO.researchId,
    effects: [{ kind: 'global-perk', perkId: HERO.perkId, description: '' }],
  });
  gsm.addCredits(HERO.cost);
  return gsm;
}

function run(timescale: number): Outcome {
  const gsm = createGame(timescale);
  const bus = gsm.getEventBus();
  let heroKillEvents = 0;
  bus.on('hero:kill', () => heroKillEvents++);
  let deaths = 0;
  bus.on('enemy:died', () => deaths++);
  const spawnShot = vi.spyOn(gsm.projectileManager, 'spawnShot');

  gsm.beginWave();
  const enemies = ROSTER.map(({ type, speed }) => gsm.enemyManager.spawn(TEST_PATH, type, speed));

  let steps = 0;
  let outcome: Outcome | null = null;
  let now = 1000;
  while (!outcome) {
    now += 16;
    gsm.update(now, () => {
      steps++;
      if (steps === HIRE_STEP) bus.emit({ type: 'command:hire-hero' });
      if (steps === MOVE_STEP) bus.emit({ type: 'command:hero-move', target: { lat: POST.lat, lon: POST.lon } });
      if (steps === READ_STEP && !outcome) {
        const hero = gsm.heroManager.getHero()!;
        const status = gsm.heroManager.getStatus();
        outcome = {
          hero: { lat: hero.position.lat, lon: hero.position.lon },
          kills: status.kills,
          level: status.level,
          heroKillEvents,
          deaths,
          hp: enemies.map((e) => e.health.hp),
          credits: gsm.credits(),
          shots: spawnShot.mock.calls.length,
        };
      }
    });
  }
  return outcome;
}

describe('Hero through the sub-step loop', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is hired and sent by command, shoots with the hero source and counts his kills', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // centre line
    const outcome = run(1);

    expect(outcome.shots).toBeGreaterThan(0);
    expect(outcome.kills).toBeGreaterThan(0);
    expect(outcome.kills).toBe(outcome.heroKillEvents);
    // His kills are ordinary kills: enemy:died for each, credits from the kill budget
    expect(outcome.deaths).toBeGreaterThanOrEqual(outcome.kills);
    // He held his post or chased from it, never farther than the leash
    expect(geoDistanceFast(outcome.hero, POST)).toBeLessThanOrEqual(HERO.leashM + 0.5);
  });

  it('gives the same outcome at timescale 1 and 10', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const single = run(1);
    const tenfold = run(10);
    expect(tenfold).toEqual(single);
  });

  it('walks to the post along the route', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const gsm = createGame(1);
    const bus = gsm.getEventBus();
    const before = gsm.credits();
    bus.emit({ type: 'command:hire-hero' });
    expect(gsm.credits()).toBe(before - HERO.cost);
    bus.emit({ type: 'command:hero-move', target: { lat: POST.lat, lon: POST.lon + 0.0001 } }); // 7 m off the route

    let now = 1000;
    for (let i = 0; i < 600; i++) {
      now += 16;
      gsm.update(now);
    }
    const hero = gsm.heroManager.getHero()!;
    expect(geoDistanceFast(hero.position, POST)).toBeLessThan(0.5);
    expect(gsm.heroManager.getStatus().mode).toBe('hold');
  });
});
