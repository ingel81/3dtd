// The game under load (TODO E57, docs/SIM_WORKER.md): a DevWorld tab of a production build, towers along the
// routes, one wave of many tough enemies, game speed 4; frames per second and the game speed actually reached
// over a stretch of wall clock. The same scene for the build with the simulation on the main thread and the one
// with it in the worker.
//
//   node e2e/perf/serve.mjs <dist/3DTD/browser> <port> [--isolate]
//   node e2e/perf/sim-load.ts --url http://localhost:4231 [--enemies 5000] [--speed 4] [--towers 40]
//                             [--seconds 10] [--browser chromium|firefox] [--headed]
//
// The page needs a handle `__load` (emit a command, read the state, set the speed): the worker build has it in
// SimClient, the main-thread build gets it from a local patch for the measurement only.
import { chromium, firefox, type Page } from '@playwright/test';

function argument(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

const URL_BASE = argument('url', 'http://localhost:4231');
const ENEMIES = Number(argument('enemies', '5000'));
const SPEED = Number(argument('speed', '4'));
const TOWERS = Number(argument('towers', '40'));
const SECONDS = Number(argument('seconds', '10'));
/** Frames without the display's cap (Chromium): the real headroom instead of a flat 60 */
const UNCAPPED = process.argv.includes('--uncapped');
/** A screenshot at the start of the measurement, to see the scene measured */
const SHOT = argument('shot', '');
/** A real place over real tiles instead of the DevWorld: the dev server with a tile key, a visible window (the tiles need the GPU), one map session */
const MAP = process.argv.includes('--map');
/** "lat,lon" of the map run; Stuttgart centre as in the E2E tests */
const PLACE = argument('place', '48.7758,9.1829');
const BROWSER = argument('browser', 'chromium');
const HEADED = process.argv.includes('--headed');
const GPU_ARGS = process.platform === 'win32'
  ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--enable-gpu', '--ignore-gpu-blocklist'];

interface LoadState {
  enemies: number;
  towers: number;
  phase: string;
  gameTimeMs: number;
  paths: [number, number][][];
  /** The worker build: the simulation's time for its last tick */
  tickMs?: number;
  /** The worker build: main-thread ms of the last packet's apply, by part (SimClient.applyTimes) */
  apply?: Record<string, number>;
}

async function gameReady(page: Page): Promise<void> {
  await page.waitForSelector('app-tower-defense', { timeout: 180_000 });
  await page.waitForSelector('td-loading-screen', { timeout: 60_000 }).catch(() => undefined);
  const end = Date.now() + 300_000;
  let gone = 0;
  while (gone < 4 && Date.now() < end) {
    gone = (await page.locator('td-loading-screen').count()) ? 0 : gone + 1;
    await page.waitForTimeout(500);
  }
  // What's new covers the map and the intro's button: closed first
  const whatsNew = page.getByRole('button', { name: /^close$/i });
  await whatsNew.first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined);
  if (await whatsNew.count()) await whatsNew.first().click().catch(() => undefined);
  // The intro flight must be over, or the camera moves through the measurement: wait for its button, click it,
  // and go on once it stayed gone for three seconds
  const skip = page.getByRole('button', { name: /skip intro/i });
  await skip.first().waitFor({ state: 'visible', timeout: 30_000 }).catch(() => undefined);
  let quiet = 0;
  for (let i = 0; i < 60 && quiet < 6; i++) {
    if (await skip.count()) {
      quiet = 0;
      await skip.first().click().catch(() => undefined);
    } else {
      quiet++;
    }
    await page.waitForTimeout(500);
  }
  await page.waitForFunction(() => '__load' in globalThis, null, { timeout: 60_000 });
  await page.waitForTimeout(1000);
}

const state = (page: Page) => page.evaluate(() => (globalThis as unknown as { __load: { state(): LoadState } }).__load.state());
const emit = (page: Page, command: Record<string, unknown>) =>
  page.evaluate((c) => (globalThis as unknown as { __load: { emit(e: unknown): void } }).__load.emit(c), command);

/** Candidate spots beside the routes: every waypoint, both sides, at a few distances; the same list every run. */
function towerSpots(paths: [number, number][][]): { lat: number; lon: number }[] {
  const spots: { lat: number; lon: number }[] = [];
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

async function measure(page: Page, seconds: number): Promise<{ fps: number; p05: number; speed: number; enemies: number; tickMs: number | null; apply: Record<string, number> }> {
  const before = await state(page);
  const { times: frames, ticks, applies } = await page.evaluate((ms) => new Promise<{ times: number[]; ticks: number[]; applies: Record<string, number[]> }>((resolve) => {
    const times: number[] = [];
    const ticks: number[] = [];
    const applies: Record<string, number[]> = {};
    const end = performance.now() + ms;
    const load = (globalThis as unknown as { __load: { state(): { tickMs?: number } } }).__load;
    const tick = (t: number) => {
      times.push(t);
      const tickMs = load.state().tickMs;
      if (tickMs !== undefined) ticks.push(tickMs);
      const apply = (load.state() as { apply?: Record<string, number> }).apply;
      if (apply) for (const [k, v] of Object.entries(apply)) (applies[k] ??= []).push(v);
      if (t < end) requestAnimationFrame(tick);
      else resolve({ times, ticks, applies });
    };
    requestAnimationFrame(tick);
  }), seconds * 1000);
  const after = await state(page);
  const gaps = frames.slice(1).map((t, i) => t - frames[i]).sort((a, b) => a - b);
  const wall = frames[frames.length - 1] - frames[0];
  return {
    fps: (frames.length - 1) / (wall / 1000),
    // The slow end: the frame time only 5 % of frames were slower than, as frames per second
    p05: 1000 / gaps[Math.floor(gaps.length * 0.95)],
    speed: (after.gameTimeMs - before.gameTimeMs) / wall,
    enemies: after.enemies,
    // Median of the worker's tick time over the frames, null for the build without a worker
    tickMs: ticks.length > 0 ? [...ticks].sort((a, b) => a - b)[Math.floor(ticks.length / 2)] : null,
    // Mean main-thread ms per frame of each part of applying the packet
    apply: Object.fromEntries(Object.entries(applies).map(([k, v]) => [k, Number((v.reduce((a, b) => a + b, 0) / v.length).toFixed(2))])),
  };
}

const engine = BROWSER === 'firefox' ? firefox : chromium;
const browser = await engine.launch({
  headless: !HEADED && !MAP,
  args: BROWSER === 'firefox' ? [] : [...GPU_ARGS, ...(UNCAPPED ? ['--disable-frame-rate-limit', '--disable-gpu-vsync'] : [])],
});
const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
// DevWorld loads no tiles, but the production build wants a key before it starts the engine; a map run takes the dev server's own
if (!MAP) {
  await context.addInitScript(() => {
    localStorage.setItem('3dtd-tile-credentials', JSON.stringify({ tileProvider: 'cesium', cesiumIonToken: 'devworld' }));
  });
}
const page = await context.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(MAP ? `${URL_BASE}/?l=${PLACE}` : `${URL_BASE}/?devworld&bot=manual`);
await gameReady(page);
console.log('isolated', await page.evaluate(() => globalThis.crossOriginIsolated));

const start = await state(page);
await emit(page, { type: 'debug:add-credits', amount: 1_000_000 });
await emit(page, { type: 'debug:add-health', amount: 1_000_000 });
const types = ['archer', 'cannon', 'ice', 'fire', 'lightning', 'rocket', 'magic', 'poison', 'dual-gatling', 'chaos'];
// Candidates in turn until TOWERS stand; refused spots (on a street, too close) cost nothing
let tried = 0;
for (const spot of towerSpots(start.paths)) {
  if (tried % 10 === 0 && (await state(page)).towers >= TOWERS) break;
  // With the ground under it, as the placement UI sends it; a spot without ground is none
  const height = await page.evaluate(([lat, lon]) => (globalThis as unknown as { __load: { groundAt(a: number, b: number): number | null } }).__load.groundAt(lat, lon), [spot.lat, spot.lon]);
  if (height !== null) await emit(page, { type: 'command:place-tower', position: { lat: spot.lat, lon: spot.lon, height }, typeId: types[tried % types.length] });
  tried++;
  if (tried % 10 === 0) await page.waitForTimeout(200);
}
await page.waitForTimeout(3000);
const placed = await state(page);
console.log(`towers ${placed.towers} of ${TOWERS} (${tried} spots tried)`);

// A wave runs (combat is on in a wave), and the enemies stand along the routes at once: the wave's own
// spawning keeps a body limit per lane, so the load comes by the debug spawn, in slices along each route
await emit(page, { type: 'command:start-wave', config: { schedule: { entries: [{ enemyType: 'zombie', speed: 0.05, health: 1000 }], baseDelay: 100, spawnMode: 'each' } } });
const kinds = ['zombie', 'rat', 'zombie-soldier', 'skeleton', 'spider', 'bat'];
// 25 slices per route: each slice is a path of its own, whose corner geometry the simulation works out once
// (getRouteProfile caches by path); one per waypoint cost tens of ms each and seconds in all
const SLICES = 25;
const slices = start.paths.flatMap((path) => Array.from({ length: SLICES }, (_, i) => Math.floor((i * (path.length - 2)) / SLICES))
  .map((k) => path.slice(k).map(([lat, lon]) => ({ lat, lon }))));
const perSlice = Math.ceil(ENEMIES / slices.length);
let spawned = 0;
for (let i = 0; i < slices.length && spawned < ENEMIES; i++) {
  const count = Math.min(perSlice, ENEMIES - spawned);
  await emit(page, { type: 'debug:spawn-enemy', enemyType: kinds[i % kinds.length], count, path: slices[i], speed: 1.5, health: 4000 });
  spawned += count;
}
await page.evaluate((s) => (globalThis as unknown as { __load: { speed(v: number): void } }).__load.speed(s), SPEED);

// Until the wave has most of its enemies out
const until = Date.now() + 120_000;
while (Date.now() < until) {
  const now = await state(page);
  console.log(`t=${Math.round((Date.now() - until + 120_000) / 1000)}s enemies ${now.enemies} phase ${now.phase} game ${Math.round(now.gameTimeMs / 1000)}s`);
  if (now.enemies >= ENEMIES * 0.9) break;
  await page.waitForTimeout(1000);
}
if (SHOT) await page.screenshot({ path: SHOT });
const result = await measure(page, SECONDS);
console.log(JSON.stringify({ browser: BROWSER, url: URL_BASE, uncapped: UNCAPPED, speedAsked: SPEED, towers: placed.towers, ...result }));
await browser.close();
