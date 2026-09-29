// The game under load (TODO E57, docs/SIM_WORKER.md): a DevWorld tab of a production build, towers along the
// routes, one wave of many tough enemies, game speed 4; frames per second and the game speed actually reached
// over a stretch of wall clock. The same scene for the build with the simulation on the main thread and the one
// with it in the worker.
//
//   npm run build (writes build-info.json: game version and commit, which every result carries)
//   node e2e/perf/serve.mjs <dist/3DTD/browser> <port> [--isolate]
//   node e2e/perf/sim-load.ts --url http://localhost:4231 [--enemies 5000] [--speed 4] [--towers 40] [--machine A] [--dpr 1]
//                             [--seconds 10] [--browser chromium|firefox] [--headed]
//   A curve over the enemy count (TODO E72): --steps 3000,5000,8000,12000,16000 --speeds 4,1 [--hide-enemies]
//   tops the enemies up to each step in the same window and measures every speed there; --hide-enemies measures
//   each once more with the enemy meshes and health bars left out of the draw (the render share per enemy).
//
// The page needs a handle `__load` (emit a command, read the state, set the speed): the worker build has it in
// SimClient, the main-thread build gets it from a local patch for the measurement only.
import { chromium, firefox, type Page } from '@playwright/test';
import os from 'node:os';

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
/** "x,y,steps": zoom in with the mouse wheel at that spot after the measurement, for a second screenshot (shot-zoom.png) */
const ZOOM = argument('zoom', '');
const BROWSER = argument('browser', 'chromium');
const STEPS = argument('steps', '').split(',').filter(Boolean).map(Number);
const SPEEDS = argument('speeds', '').split(',').filter(Boolean).map(Number);
const HIDE = process.argv.includes('--hide-enemies');
/** The machine's name in the results, to tell measurements of several computers apart (never a host name: the repo is public) */
const MACHINE = argument('machine', 'A');
/**
 * Device pixels per CSS pixel, 1 by default so both browsers draw the same pixels; `system` leaves it to the browser
 * (Firefox takes the system's scaling, 1.25 on a scaled desktop, Chromium 1)
 */
const DPR_ARG = argument('dpr', '1');
const DPR = DPR_ARG === 'system' ? '' : DPR_ARG;
/** Enemies the towers cannot kill in a measurement: the count stays what the step asked for, the towers keep hitting */
const ENEMY_HP = Number(argument('hp', '1000000'));
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

interface Sums {
  wallMs: number; packets: number; emptyPackets: number; subSteps: number; tickMs: number; events: number; ops: number;
  apply: Record<string, number>;
}
const stats = (page: Page, reset: boolean) =>
  page.evaluate((r) => (globalThis as unknown as { __load: { stats?(reset: boolean): Sums } }).__load.stats?.(r) ?? null, reset);

async function measure(page: Page, seconds: number): Promise<{ fps: number; p05: number; speed: number; enemies: number; tickMs: number | null; apply: Record<string, number>; sums: Record<string, number> | null }> {
  await stats(page, true);
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
  const s = await stats(page, false);
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
    // Summed over every packet instead of sampled per frame: the worker's load (share of wall time), per sub-step and per
    // packet costs, the apply per packet by part, events per packet, the share of packets without a sub-step
    sums: s && s.packets > 0 ? {
      workerLoad: round(s.tickMs / s.wallMs, 3),
      tickPerStepMs: round(s.tickMs / Math.max(1, s.subSteps), 3),
      packetsPerS: round(s.packets / (s.wallMs / 1000), 1),
      emptyShare: round(s.emptyPackets / s.packets, 3),
      eventsPerPacket: round(s.events / s.packets, 1),
      opsPerPacket: round(s.ops / s.packets, 1),
      applyPerPacketMs: round(Object.values(s.apply).reduce((a, b) => a + b, 0) / s.packets, 3),
      ...Object.fromEntries(Object.entries(s.apply).map(([k, v]) => [`apply.${k}`, round(v / s.packets, 3)])),
    } : null,
  };
}

function round(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}

const engine = BROWSER === 'firefox' ? firefox : chromium;
const browser = await engine.launch({
  headless: !HEADED && !MAP,
  args: BROWSER === 'firefox' ? [] : [...GPU_ARGS, ...(UNCAPPED ? ['--disable-frame-rate-limit', '--disable-gpu-vsync'] : [])],
});
const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, ...(DPR ? { deviceScaleFactor: Number(DPR) } : {}) });
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
// What the numbers were measured on: from the OS and from the page (the GPU as WebGL names it; Firefox rounds it to a
// common model on purpose, against fingerprinting)
const machine = {
  name: MACHINE,
  cpu: os.cpus()[0]?.model.trim(),
  threads: os.cpus().length,
  memoryGb: Math.round(os.totalmem() / 2 ** 30),
  os: `${os.type()} ${os.release()}`,
  browser: `${BROWSER} ${browser.version()}`,
  ...(await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return {
      gpu: info ? String(gl!.getParameter(info.UNMASKED_RENDERER_WEBGL)) : String(gl?.getParameter(gl.RENDERER) ?? 'none'),
      devicePixelRatio: Math.round(devicePixelRatio * 100) / 100,
      viewport: [innerWidth, innerHeight],
    };
  })),
};
console.log('MACHINE ' + JSON.stringify(machine));
// The build measured: game version and commit from its build-info.json (tools/build-info.mjs, run by `npm run build`)
const build = (await fetch(`${URL_BASE}/build-info.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null)) as
  { version?: string; commit?: string; dirty?: boolean } | null;
console.log('BUILD ' + JSON.stringify(build));

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
// Starts on the first 70 % of each route only: enemies set down near the HQ reached it within the measurement and left
// the count
const slices = start.paths.flatMap((path) => Array.from({ length: SLICES }, (_, i) => Math.floor((i * 0.7 * (path.length - 2)) / SLICES))
  .map((k) => path.slice(k).map(([lat, lon]) => ({ lat, lon }))));
let sliceAt = 0;
/**
 * Enemies spread over the slices until `target` are alive. The simulation takes a round's spawns in one tick, which
 * at thousands of enemies takes seconds (a route profile per slice), so the runner waits until the count reached what
 * it spawned. Enemies that reached the HQ during a long fill are topped up in another round, up to 4 rounds.
 */
async function spawnUpTo(target: number): Promise<void> {
  for (let round = 0; round < 4; round++) {
    const before = (await state(page)).enemies;
    const missing = target - before;
    if (missing <= target * 0.005) return;
    const perSlice = Math.ceil(missing / slices.length);
    let spawned = 0;
    for (let i = 0; i < slices.length && spawned < missing; i++, sliceAt++) {
      const count = Math.min(perSlice, missing - spawned);
      await emit(page, { type: 'debug:spawn-enemy', enemyType: kinds[sliceAt % kinds.length], count, path: slices[i], speed: 1.5, health: ENEMY_HP });
      spawned += count;
    }
    const until = Date.now() + 180_000;
    while (Date.now() < until) {
      await page.waitForTimeout(1000);
      const now = await state(page);
      console.log(`  enemies ${now.enemies} of ${target}, phase ${now.phase}, game ${Math.round(now.gameTimeMs / 1000)}s`);
      if (now.enemies >= before + spawned * 0.98) break;
    }
  }
}
/** Frames per second over `ms` of wall clock */
const fpsOver = (ms: number) => page.evaluate((span) => new Promise<number>((resolve) => {
  let frames = 0;
  const start = performance.now();
  const tick = (t: number) => {
    frames++;
    if (t - start < span) requestAnimationFrame(tick);
    else resolve((frames * 1000) / (t - start));
  };
  requestAnimationFrame(tick);
}), ms);

/**
 * Let the scene settle before a measurement: fresh enemies still cost route profiles in the simulation, and the
 * browser's GC and JIT take a while to calm down. At least 5 s, then 2 s windows until two in a row differ by less
 * than 5 % in frames per second, 30 s at most.
 */
async function settle(): Promise<void> {
  await page.waitForTimeout(5000);
  let last = await fpsOver(2000);
  for (let waited = 7000; waited < 30_000; waited += 2000) {
    const now = await fpsOver(2000);
    if (Math.abs(now - last) / Math.max(last, 1) < 0.05) return;
    last = now;
  }
  console.log('  not settled after 30 s, measuring anyway');
}

const setSpeed = (value: number) => page.evaluate((v) => (globalThis as unknown as { __load: { speed(v: number): void } }).__load.speed(v), value);
const hideEnemies = (hidden: boolean) =>
  page.evaluate((h) => (globalThis as unknown as { __load: { hideEnemies?(h: boolean): number } }).__load.hideEnemies?.(h) ?? 0, hidden);

if (STEPS.length > 0) {
  // The curve: each step topped up in the same window, every speed measured there, a line per measurement
  const rows: Record<string, unknown>[] = [];
  for (const target of STEPS) {
    const speeds = SPEEDS.length > 0 ? SPEEDS : [SPEED];
    for (const speed of speeds) {
      await setSpeed(speed);
      // Topped up before every measurement, then settled: the debug spawn works out a route profile per slice in the
      // simulation, and a top-up just before a measurement counted that into it
      await spawnUpTo(target);
      await settle();
      for (const hidden of HIDE ? [false, true] : [false]) {
        if (HIDE) await hideEnemies(hidden);
        const r = await measure(page, SECONDS);
        const row = { version: build?.version ?? 'unknown', commit: build?.commit ?? 'unknown', dirty: build?.dirty ?? null, machine: MACHINE, devicePixelRatio: machine.devicePixelRatio, browser: BROWSER, uncapped: UNCAPPED, target, speedAsked: speed, hidden, towers: placed.towers, ...r };
        rows.push(row);
        console.log(JSON.stringify(row));
        const limit = r.speed < speed * 0.97 || r.fps < 58;
        console.log(`STEP ${target} x${speed}${hidden ? ' hidden' : ''}: fps ${r.fps.toFixed(1)} p05 ${r.p05.toFixed(1)} speed ${r.speed.toFixed(2)} ` +
          `enemies ${r.enemies} worker ${r.sums?.workerLoad ?? '-'} apply/packet ${r.sums?.applyPerPacketMs ?? '-'} ms${limit ? '  <- limit' : ''}`);
      }
      if (HIDE) await hideEnemies(false);
    }
  }
  console.log('CURVE ' + JSON.stringify(rows));
  await browser.close();
  process.exit(0);
}

await spawnUpTo(ENEMIES);
await setSpeed(SPEED);
await settle();
if (SHOT) await page.screenshot({ path: SHOT });
const result = await measure(page, SECONDS);
if (SHOT && ZOOM) {
  const [x, y, steps] = ZOOM.split(',').map(Number);
  // Home: the camera's quick jump to the HQ, where the route ends
  await page.keyboard.press(argument('jump', 'Home'));
  await page.waitForTimeout(2500);
  await page.mouse.move(x, y);
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, -400);
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(4000);
  await page.screenshot({ path: SHOT.replace(/\.png$/, '-zoom.png') });
}
console.log(JSON.stringify({ build, machine, browser: BROWSER, url: URL_BASE, uncapped: UNCAPPED, speedAsked: SPEED, towers: placed.towers, ...result }));
await browser.close();
