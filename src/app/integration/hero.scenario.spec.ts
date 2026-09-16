/**
 * Playtest 426 (docs/archive/REVIEW_SPRINT_2026-09-14.md) replayed: the hero at a
 * post through the real GameStateManager sub-step loop at 75x, with real
 * enemies, projectiles and the damage path, the harness of hero.spec.ts.
 *
 * 8d34c49e made him skip the route look-up while he stands at his post, and
 * at 75x one rendered frame carries some 72 sub-steps. Expected: he chases
 * as far as the leash and walks back as at 1x, sub-step for sub-step, and
 * never moves farther in one sub-step than his speed allows (no jump).
 *
 * Two groups of zombies come down the route one after the other; the second
 * starts when the first is gone. Enemies spawn off the wave schedule, as in
 * hero.spec.ts, so the groups stand in for the two waves of the playtest.
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

import { createMockTilesEngine, withAutoStubs, TEST_PATH } from './test-helpers';
import { createHeroTestGame } from './hero-test-helpers';
import { HERO } from '../configs/hero.config';
import { geoDistanceFast } from '../utils/geo-utils';
import type { GeoPosition } from '../models/game.types';

/** GameClock.FIXED_STEP_MS in seconds */
const STEP_S = 16.667 / 1000;

function createEngine(): never {
  const engine = createMockTilesEngine() as unknown as Record<string, Record<string, unknown>>;
  for (const key of ['effects', 'towers', 'enemies', 'projectiles', 'trailStreaks', 'spatialAudio', 'sync']) {
    engine[key] = withAutoStubs(engine[key]);
  }
  engine['enemies']['create'] = vi.fn(() => Promise.resolve(null));
  engine['hero'] = withAutoStubs({});
  engine['spatialAudio']['getListener'] = () => ({ context: { state: 'running', resume: () => Promise.resolve() } });
  (engine as Record<string, unknown>)['renderingEnabled'] = false;
  return withAutoStubs(engine) as never;
}

const HIRE_STEP = 5;
const MOVE_STEP = 10;
/** 44 m south of the HQ, 67 m north of the spawn */
const POST: GeoPosition = TEST_PATH[6];
/** 2 minutes of game time */
const LAST_STEP = 7200;

/** Zombies walking north toward his post */
const GROUP = [
  { type: 'zombie', speed: 5 },
  { type: 'zombie', speed: 4 },
  { type: 'zombie', speed: 6 },
] as const;

interface Run {
  /** Where he stood after each sub-step from the hire on */
  trace: [number, number][];
  /** When the second group came */
  secondAt: number;
  /** Most sub-steps one frame carried */
  maxStepsPerFrame: number;
  kills: number;
  mode: string;
  alive: number;
}

function run(timescale: number): Run {
  const gsm = createHeroTestGame(timescale, mockServices, createEngine());
  const bus = gsm.getEventBus();
  const trace: [number, number][] = [];
  const spawnGroup = () => GROUP.map(({ type, speed }) => gsm.enemyManager.spawn(TEST_PATH, type, speed));

  gsm.beginWave();
  let group = spawnGroup();
  let secondAt = -1;
  let steps = 0;
  let maxStepsPerFrame = 0;
  let now = 1000;
  while (steps < LAST_STEP) {
    now += 16;
    let inFrame = 0;
    gsm.update(now, () => {
      if (steps >= LAST_STEP) return;
      steps++;
      inFrame++;
      if (steps === HIRE_STEP) bus.emit({ type: 'command:hire-hero' });
      if (steps === MOVE_STEP) bus.emit({ type: 'command:hero-move', target: { lat: POST.lat, lon: POST.lon } });
      // The second group once the first is dead or through
      if (secondAt < 0 && steps > MOVE_STEP && group.every((e) => !e.alive)) {
        secondAt = steps;
        group = spawnGroup();
      }
      const hero = gsm.heroManager.getHero();
      if (hero) trace.push([hero.position.lat, hero.position.lon]);
    });
    maxStepsPerFrame = Math.max(maxStepsPerFrame, inFrame);
  }
  const status = gsm.heroManager.getStatus();
  return {
    trace,
    secondAt,
    maxStepsPerFrame,
    kills: status.kills,
    mode: status.mode,
    alive: gsm.enemyManager.getAlive().length,
  };
}

const toGeo = ([lat, lon]: [number, number]): GeoPosition => ({ lat, lon });

describe('Hero at his post at 75x, playtest 426 replayed', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('chases to the leash and walks back as at 1x, sub-step for sub-step, without a jump', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // centre line
    const single = run(1);
    const fast = run(75);

    // 75x really ran as some 72 sub-steps per frame
    expect(single.maxStepsPerFrame).toBeLessThanOrEqual(2);
    expect(fast.maxStepsPerFrame).toBeGreaterThanOrEqual(70);

    // Same hero at every sub-step
    expect(fast.trace).toEqual(single.trace);
    expect(fast.secondAt).toBe(single.secondAt);
    expect(fast.kills).toBe(single.kills);

    // Both groups came and are gone, he fought them
    expect(single.secondAt).toBeGreaterThan(MOVE_STEP);
    expect(single.alive).toBe(0);
    expect(single.kills).toBeGreaterThan(0);

    // Never farther in one sub-step than his speed carries him
    const maxStepM = HERO.speedMps * STEP_S;
    let largest = 0;
    for (let i = 1; i < fast.trace.length; i++) {
      largest = Math.max(largest, geoDistanceFast(toGeo(fast.trace[i - 1]), toGeo(fast.trace[i])));
    }
    expect(largest).toBeLessThanOrEqual(maxStepM + 0.01);

    // Once at his post: out on the leash, never past it, and back at the end
    const arrived = fast.trace.findIndex((p) => geoDistanceFast(toGeo(p), POST) < 0.5);
    expect(arrived).toBeGreaterThan(0);
    const fromPost = fast.trace.slice(arrived).map((p) => geoDistanceFast(toGeo(p), POST));
    expect(Math.max(...fromPost)).toBeGreaterThan(1);
    expect(Math.max(...fromPost)).toBeLessThanOrEqual(HERO.leashM + 0.5);
    expect(fromPost.at(-1)!).toBeLessThan(0.5);
    expect(fast.mode).toBe('hold');
  });
});
