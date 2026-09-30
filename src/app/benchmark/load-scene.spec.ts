import { describe, it, expect } from 'vitest';
import {
  frameStats, stepEvenness, placeTowers, routeSlices, settle, settledBetween, spawnUpTo, towerSpots, LOAD_TOWER_TYPES, type LoadDriver,
} from './load-scene';

const path: [number, number][] = Array.from({ length: 20 }, (_, i) => [48 + i * 0.0002, 9]);

/** A game as the scene sees it: enemies and towers counted, commands kept, no wall clock */
function fakeGame(fps: number[] = []) {
  const game = { enemies: 0, towers: 0, syncs: 0, commands: [] as Record<string, unknown>[] };
  const driver: LoadDriver = {
    state: async () => ({ enemies: game.enemies, towers: game.towers, phase: 'wave', gameTimeMs: 0 }),
    emit: async (command) => {
      game.commands.push(command);
      if (command['type'] === 'command:place-tower') game.towers++;
      if (command['type'] === 'debug:spawn-enemy') game.enemies += command['count'] as number;
    },
    groundAt: async () => 0,
    fpsOver: async () => fps.shift() ?? 60,
    wait: async () => undefined,
    sync: async () => {
      game.syncs++;
    },
    log: () => undefined,
  };
  return { game, driver };
}

describe('load scene', () => {
  it('lists the same tower spots every run, on both sides of every other waypoint at three distances', () => {
    const spots = towerSpots([path]);
    // Waypoints 3, 5 ... 15, both sides, 3 distances
    expect(spots).toHaveLength(7 * 2 * 3);
    expect(towerSpots([path])).toEqual(spots);
    expect(spots[0].lon).not.toBe(9);
  });

  it('slices each route on its first 70 %', () => {
    const slices = routeSlices([path]);
    expect(slices).toHaveLength(25);
    expect(slices[0]).toHaveLength(20);
    // The last slice starts at 24 / 25 * 0.7 of the route (18 waypoints to spread over)
    expect(slices[24][0].lat).toBeCloseTo(path[Math.floor((24 * 0.7 * 18) / 25)][0]);
  });

  it('places towers of every kind in turn until enough stand', async () => {
    const { game, driver } = fakeGame();
    await placeTowers(driver, [path], 12);
    expect(game.towers).toBeGreaterThanOrEqual(12);
    const kinds = game.commands.filter((c) => c['type'] === 'command:place-tower').map((c) => c['typeId']);
    expect(kinds.slice(0, LOAD_TOWER_TYPES.length)).toEqual(LOAD_TOWER_TYPES);
  });

  it('fills to the target, waits for the simulation after the round, slow enemies with a million HP', async () => {
    const { game, driver } = fakeGame();
    const at = { slice: 0 };
    await spawnUpTo(driver, routeSlices([path]), 1000, at);
    expect(game.enemies).toBe(1000);
    expect(game.syncs).toBe(1);
    const spawns = game.commands.filter((c) => c['type'] === 'debug:spawn-enemy');
    expect(spawns.every((c) => c['health'] === 1_000_000 && c['speed'] === 0.5)).toBe(true);
    expect(at.slice).toBe(25);
  });

  it('settles once two windows differ by less than 5 %, else gives up after 30 s', async () => {
    expect(settledBetween(100, 104)).toBe(true);
    expect(settledBetween(100, 106)).toBe(false);
    expect(await settle(fakeGame([50, 90, 120, 118]).driver)).toBe(true);
    const restless = Array.from({ length: 20 }, (_, i) => (i % 2 ? 50 : 100));
    expect(await settle(fakeGame(restless).driver)).toBe(false);
  });

  it('stops filling when cancelled', async () => {
    const { game, driver } = fakeGame();
    driver.cancelled = () => true;
    await spawnUpTo(driver, routeSlices([path]), 1000, { slice: 0 });
    expect(game.enemies).toBe(0);
  });

  it('reads frames per second and the slow end from rAF times', () => {
    // 99 frames of 10 ms and one of 50 ms
    const times = [0];
    for (let i = 0; i < 100; i++) times.push(times[i] + (i === 50 ? 50 : 10));
    const { fps, p05 } = frameStats(times);
    expect(fps).toBeCloseTo(100 / 1.04);
    expect(p05).toBe(100);
    expect(frameStats([1])).toEqual({ fps: 0, p05: 0 });
  });

  it('tells a picture that moves evenly from one that stands and jumps', () => {
    const times = Array.from({ length: 61 }, (_, k) => k * 10);
    // One enemy walks 2 m/s along x, shown anew every frame; a second stands
    const even = times.map((t) => [t * 0.002, 5, 7, 7]);
    expect(stepEvenness(times, even)).toEqual({ stepCv: expect.closeTo(0, 6), stillShare: 0, probes: 1 });
    // The same walk, shown anew only every third frame
    const stepped = times.map((_, k) => [Math.floor(k / 3) * 0.06, 5, 7, 7]);
    const s = stepEvenness(times, stepped)!;
    expect(s.stepCv).toBeGreaterThan(1.3);
    expect(s.stillShare).toBeCloseTo(2 / 3, 1);
    // Nobody walks, or the enemy is gone
    expect(stepEvenness(times, times.map(() => [7, 7]))).toBeNull();
    expect(stepEvenness(times, times.map(() => [NaN, NaN]))).toBeNull();
  });
});
