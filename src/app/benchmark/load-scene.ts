/**
 * The load scene both load measurements build (TODO E57, E72, E74): towers
 * along the routes, slow enemies with a million HP set down on the routes, a
 * settle phase before each measurement. The in-game
 * benchmark (benchmark.service.ts) and the load runner (e2e/perf/sim-load.ts)
 * drive it through a LoadDriver each: the game itself, or a Playwright page.
 *
 * No imports: Node runs the load runner's TypeScript as it is and loads this
 * file directly.
 */

/** A point on the map, degrees */
export interface LatLon {
  lat: number;
  lon: number;
}

/** What the scene needs of the game, see the file comment */
export interface LoadDriver {
  state(): Promise<{ enemies: number; towers: number; phase: string; gameTimeMs: number }>;
  /** A command or debug event on the main bus, as the UI gives it */
  emit(command: Record<string, unknown>): Promise<void>;
  /** The ground under a spot as the placement UI samples it (geo height), null where there is none */
  groundAt(lat: number, lon: number): Promise<number | null>;
  /** Frames per second over `ms` of wall clock */
  fpsOver(ms: number): Promise<number>;
  wait(ms: number): Promise<void>;
  /**
   * Resolves once the simulation took everything sent so far: a call to it
   * answers only after the commands given before it ran (SimClient.rpc). A
   * debug spawn on new paths can keep the worker in one tick for seconds,
   * during which the count stands still and the frame rate looks settled.
   */
  sync(): Promise<void>;
  log(line: string): void;
  /** True once the run should stop (the benchmark's Cancel): the long loops end early */
  cancelled?(): boolean;
}

/** The towers in turn, one of each kind */
export const LOAD_TOWER_TYPES = ['archer', 'cannon', 'ice', 'fire', 'lightning', 'rocket', 'magic', 'poison', 'dual-gatling', 'chaos'];
/** The enemies in turn, one kind per slice */
export const LOAD_ENEMY_KINDS = ['zombie', 'rat', 'zombie-soldier', 'skeleton', 'spider', 'bat'];
/** Enemies the towers cannot kill in a measurement: the count stays what the step asked for, the towers keep hitting */
export const LOAD_ENEMY_HP = 1_000_000;
/** Walking speed of the enemies, m/s: slow, so few reach the HQ over a curve of several minutes */
export const LOAD_ENEMY_SPEED = 0.5;

/** Candidate spots beside the routes: every waypoint, both sides, at a few distances; the same list every run. */
export function towerSpots(paths: [number, number][][]): LatLon[] {
  const spots: LatLon[] = [];
  for (const distance of [18, 26, 34]) {
    for (const path of paths) {
      for (let i = 3; i < path.length - 3; i += 2) {
        const p = path[i];
        const next = path[i + 1];
        const dLat = next[0] - p[0];
        const dLon = (next[1] - p[1]) * Math.cos((p[0] * Math.PI) / 180);
        const len = Math.hypot(dLat, dLon) || 1;
        for (const side of [1, -1]) {
          const off = (distance / 111_320) * side;
          spots.push({ lat: p[0] - (dLon / len) * off, lon: p[1] + ((dLat / len) * off) / Math.cos((p[0] * Math.PI) / 180) });
        }
      }
    }
  }
  return spots;
}

/**
 * Slices of each route for the debug spawn, starting on its first 70 %
 * only: enemies set down near the HQ reached it within the measurement and
 * left the count. 25 per route: each slice is a path of its own, whose corner
 * geometry the simulation works out once (getRouteProfile caches by path);
 * one per waypoint cost tens of ms each and seconds in all.
 */
export function routeSlices(paths: [number, number][][], slices = 25, share = 0.7): LatLon[][] {
  return paths.flatMap((path) => Array.from({ length: slices }, (_, i) => Math.floor((i * share * (path.length - 2)) / slices))
    .map((k) => path.slice(k).map(([lat, lon]) => ({ lat, lon }))));
}

/** Candidates in turn until `count` towers stand; refused spots (on a street, too close) cost nothing */
export async function placeTowers(driver: LoadDriver, paths: [number, number][][], count: number): Promise<number> {
  let tried = 0;
  for (const spot of towerSpots(paths)) {
    if (driver.cancelled?.()) break;
    if (tried % 10 === 0 && (await driver.state()).towers >= count) break;
    // With the ground under it, as the placement UI sends it; a spot without ground is none
    const height = await driver.groundAt(spot.lat, spot.lon);
    if (height !== null) {
      await driver.emit({ type: 'command:place-tower', position: { lat: spot.lat, lon: spot.lon, height }, typeId: LOAD_TOWER_TYPES[tried % LOAD_TOWER_TYPES.length] });
    }
    tried++;
    if (tried % 10 === 0) await driver.wait(200);
  }
  await driver.wait(3000);
  return tried;
}

/**
 * A wave runs (combat is on in a wave) with a schedule of its own that
 * barely spawns: the load comes by the debug spawn (spawnUpTo), since the
 * wave's own spawning keeps a body limit per lane.
 */
export function startLoadWave(driver: LoadDriver): Promise<void> {
  return driver.emit({ type: 'command:start-wave', config: { schedule: { entries: [{ enemyType: 'zombie', speed: 0.05, health: 1000 }], baseDelay: 100, spawnMode: 'each' } } });
}

/**
 * Enemies spread over the slices until `target` are alive. The simulation
 * takes a round's spawns in one tick, which at thousands of enemies takes
 * seconds (a route profile per slice): a call to the simulation answers only
 * after the commands given before it ran (sync), so the scene waits for that
 * answer and a second more, then counts. Enemies that reached the HQ
 * meanwhile are topped up in another round, up to 4 rounds. `at` carries the
 * slice to go on with from one call to the next.
 */
export async function spawnUpTo(
  driver: LoadDriver,
  slices: LatLon[][],
  target: number,
  at: { slice: number },
  speed = LOAD_ENEMY_SPEED,
  hp = LOAD_ENEMY_HP,
): Promise<void> {
  for (let round = 0; round < 4; round++) {
    if (driver.cancelled?.()) return;
    const missing = target - (await driver.state()).enemies;
    if (missing <= target * 0.005) return;
    const perSlice = Math.ceil(missing / slices.length);
    let spawned = 0;
    for (let i = 0; i < slices.length && spawned < missing; i++, at.slice++) {
      const count = Math.min(perSlice, missing - spawned);
      await driver.emit({ type: 'debug:spawn-enemy', enemyType: LOAD_ENEMY_KINDS[at.slice % LOAD_ENEMY_KINDS.length], count, path: slices[i], speed, health: hp });
      spawned += count;
    }
    await driver.sync();
    await driver.wait(1000);
    const now = await driver.state();
    driver.log(`  enemies ${now.enemies} of ${target} after round ${round + 1}, phase ${now.phase}, game ${Math.round(now.gameTimeMs / 1000)}s`);
  }
}

/** The settle rule: at least this long, then windows of this length ... */
export const SETTLE_MIN_MS = 5000;
export const SETTLE_WINDOW_MS = 2000;
/** ... until two in a row differ by less than this share in frames per second ... */
export const SETTLE_TOLERANCE = 0.05;
/** ... or this long in all */
export const SETTLE_MAX_MS = 30_000;

/** Two windows' frame rates count as settled */
export function settledBetween(last: number, now: number): boolean {
  return Math.abs(now - last) / Math.max(last, 1) < SETTLE_TOLERANCE;
}

/**
 * Let the scene settle before a measurement: fresh enemies still cost route
 * profiles in the simulation, and the browser's GC and JIT take a while to
 * calm down. See the SETTLE_ constants; true when it settled in time.
 */
export async function settle(driver: LoadDriver): Promise<boolean> {
  await driver.sync();
  await driver.wait(SETTLE_MIN_MS);
  let last = await driver.fpsOver(SETTLE_WINDOW_MS);
  for (let waited = SETTLE_MIN_MS + SETTLE_WINDOW_MS; waited < SETTLE_MAX_MS; waited += SETTLE_WINDOW_MS) {
    if (driver.cancelled?.()) return false;
    const now = await driver.fpsOver(SETTLE_WINDOW_MS);
    if (settledBetween(last, now)) return true;
    last = now;
  }
  driver.log('  not settled after 30 s, measuring anyway');
  return false;
}

/**
 * Frames per second over a list of rAF times, and the slow end: the frame
 * time only 5 % of frames were slower than, as frames per second.
 */
export function frameStats(times: readonly number[]): { fps: number; p05: number } {
  if (times.length < 2) return { fps: 0, p05: 0 };
  const gaps = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b);
  const wall = times[times.length - 1] - times[0];
  return {
    fps: (times.length - 1) / (wall / 1000),
    p05: 1000 / gaps[Math.floor(gaps.length * 0.95)],
  };
}
