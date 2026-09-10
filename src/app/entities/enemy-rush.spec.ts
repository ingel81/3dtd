import { describe, it, expect } from 'vitest';
import { EnemyRush, RUSH_MAX_INTERVAL_MS, RUSH_MIN_INTERVAL_MS } from './enemy-rush';

/** Game time of every walk/run switch within `totalMs`, stepped in `stepMs`. */
function switchTimes(rush: EnemyRush, totalMs: number, stepMs: number): number[] {
  const times: number[] = [];
  let was = rush.running;
  for (let t = stepMs; t <= totalMs; t += stepMs) {
    rush.tick(stepMs);
    if (rush.running !== was) times.push(t);
    was = rush.running;
  }
  return times;
}

describe('EnemyRush', () => {
  it('starts walking and returns 1, then the run multiplier while running', () => {
    const rush = new EnemyRush('enemy-1', 2.5);
    expect(rush.running).toBe(false);
    expect(rush.tick(16)).toBe(1);

    rush.tick(RUSH_MAX_INTERVAL_MS); // past any first phase
    expect(rush.running).toBe(true);
    expect(rush.tick(0)).toBe(2.5);
  });

  it('switches every 3-8 s of game time', () => {
    const times = switchTimes(new EnemyRush('enemy-42', 2.5), 600_000, 10);
    expect(times.length).toBeGreaterThan(600_000 / RUSH_MAX_INTERVAL_MS - 1);
    let prev = 0;
    for (const t of times) {
      expect(t - prev).toBeGreaterThanOrEqual(RUSH_MIN_INTERVAL_MS);
      expect(t - prev).toBeLessThan(RUSH_MAX_INTERVAL_MS + 10);
      prev = t;
    }
  });

  it('is the same for the same id, and differs between ids', () => {
    const a = switchTimes(new EnemyRush('enemy-7', 2.5), 120_000, 1000 / 60);
    const b = switchTimes(new EnemyRush('enemy-7', 2.5), 120_000, 1000 / 60);
    const c = switchTimes(new EnemyRush('enemy-8', 2.5), 120_000, 1000 / 60);
    expect(b).toEqual(a);
    expect(c).not.toEqual(a);
  });

  it('switches at the same game time whatever the step size', () => {
    // Integer steps keep the sums exact: each switch lands in the step that
    // crosses the phase end, so the coarse run sees it at most one step later.
    const fine = switchTimes(new EnemyRush('enemy-3', 2.5), 60_000, 10);
    const coarse = switchTimes(new EnemyRush('enemy-3', 2.5), 60_000, 50);
    expect(coarse).toHaveLength(fine.length);
    coarse.forEach((t, i) => {
      expect(t - fine[i]).toBeGreaterThanOrEqual(0);
      expect(t - fine[i]).toBeLessThan(50);
    });
  });

  it('force sets the state and restarts the phase', () => {
    const rush = new EnemyRush('enemy-5', 2.5);
    rush.force(true);
    expect(rush.running).toBe(true);
    expect(rush.tick(RUSH_MIN_INTERVAL_MS - 1)).toBe(2.5); // phase is at least 3 s
  });
});
