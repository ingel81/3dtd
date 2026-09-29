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
  for (let i = 0; i < 20; i++) {
    const skip = page.getByRole('button', { name: /skip intro/i });
    if (!(await skip.count())) break;
    await skip.first().click().catch(() => undefined);
    await page.waitForTimeout(700);
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

async function measure(page: Page, seconds: number): Promise<{ fps: number; p05: number; speed: number; enemies: number }> {
  const before = await state(page);
  const frames = await page.evaluate((ms) => new Promise<number[]>((resolve) => {
    const times: number[] = [];
    const end = performance.now() + ms;
    const tick = (t: number) => {
      times.push(t);
      if (t < end) requestAnimationFrame(tick);
      else resolve(times);
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
  };
}

const engine = BROWSER === 'firefox' ? firefox : chromium;
const browser = await engine.launch({ headless: !HEADED, args: BROWSER === 'firefox' ? [] : GPU_ARGS });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
// DevWorld loads no tiles, but the production build wants a key before it starts the engine
await context.addInitScript(() => {
  localStorage.setItem('3dtd-tile-credentials', JSON.stringify({ tileProvider: 'cesium', cesiumIonToken: 'devworld' }));
});
const page = await context.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`${URL_BASE}/?devworld&bot=manual`);
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
  await emit(page, { type: 'command:place-tower', position: { lat: spot.lat, lon: spot.lon }, typeId: types[tried % types.length] });
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
const slices = start.paths.flatMap((path) => path.slice(0, -2).map((_, k) => path.slice(k).map(([lat, lon]) => ({ lat, lon }))));
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
const result = await measure(page, SECONDS);
console.log(JSON.stringify({ browser: BROWSER, url: URL_BASE, speedAsked: SPEED, towers: placed.towers, ...result }));
await browser.close();
