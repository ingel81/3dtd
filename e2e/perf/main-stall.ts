// Backpressure (docs/archive/SIM_DECOUPLE_PLAN.md, TODO E85): what the simulation does while the main thread stands. A DevWorld
// tab of a build, the main thread blocked for a few seconds (as a hidden tab or a long hang leaves it), the game time
// before and after: the worker runs on for MAX_AHEAD_MS and then waits, and does not catch the stall up afterwards.
//
//   node e2e/perf/serve.mjs <dist dir> 4260 --isolate
//   node e2e/perf/main-stall.ts --url http://localhost:4260 [--stall 3000] [--speed 4] [--browser chromium] [--headed]
import { chromium, firefox } from '@playwright/test';

function argument(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

const URL_BASE = argument('url', 'http://localhost:4260');
const STALL_MS = Number(argument('stall', '3000'));
const SPEED = Number(argument('speed', '4'));
const BROWSER = argument('browser', 'chromium');
const HEADED = process.argv.includes('--headed');

type Load = { speed(v: number): void; ping(): Promise<unknown>; state(): { gameTimeMs: number; subStep: number } };

const browser = await (BROWSER === 'firefox' ? firefox : chromium).launch({ headless: !HEADED });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
await context.addInitScript(() => {
  localStorage.setItem('3dtd-tile-credentials', JSON.stringify({ tileProvider: 'cesium', cesiumIonToken: 'devworld' }));
});
const page = await context.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`${URL_BASE}/?devworld&bot=manual`);
await page.waitForFunction(() => '__load' in globalThis, null, { timeout: 300_000 });
await page.waitForSelector('td-loading-screen', { state: 'detached', timeout: 300_000 }).catch(() => undefined);
await page.waitForTimeout(4000);

const result = await page.evaluate(async ([stallMs, speed]) => {
  const load = (globalThis as unknown as { __load: Load }).__load;
  const frames = (n: number) => new Promise<void>((resolve) => {
    const next = () => (--n > 0 ? requestAnimationFrame(next) : resolve());
    requestAnimationFrame(next);
  });
  load.speed(speed);
  await frames(60);
  const before = load.state().gameTimeMs;
  const t0 = performance.now();
  // The main thread stands: no frame, no demand, no message taken
  while (performance.now() - t0 < stallMs) { /* busy */ }
  // What the simulation published meanwhile is applied with the next frames
  await frames(3);
  const after = load.state().gameTimeMs;
  const t1 = performance.now();
  await frames(120);
  const later = load.state().gameTimeMs;
  return {
    stallMs: Math.round(t1 - t0),
    // Game time the simulation ran while the main thread stood, as wall clock at the speed set
    ranOnMs: Math.round((after - before) / speed),
    // The speed reached after the stall: near the speed set when nothing is caught up
    speedAfter: Number(((later - after) / (performance.now() - t1)).toFixed(2)),
  };
}, [STALL_MS, SPEED] as const);
console.log('RESULT ' + JSON.stringify({ browser: BROWSER, speed: SPEED, ...result }));
await browser.close();
