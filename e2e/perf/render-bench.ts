// The graphics benchmark per world and quality level (docs/BENCHMARKS.md "Bildkosten"): opens each world with
// `benchmark=render`, waits for the game's own run (src/app/benchmark/render-benchmark.service.ts: the same four
// camera paths around the HQ on every world, GPU time by timer query, draw calls, triangles) and prints its rows,
// then one table of all runs. Frames uncapped, a visible window (the GPU draws), Chromium with ANGLE D3D11 on Windows.
//
//   npx ng build; node e2e/perf/serve.mjs dist/3DTD/browser 4322 --isolate
//   node e2e/perf/render-bench.ts --url http://localhost:4322 [--worlds map:demo-valley,map:harbor-town,tiles:48.7758,9.1829]
//        [--qualities high] [--dpr 1] [--width 1600 --height 900] [--json out.json] [--shots <dir>]
//
// --shots saves one picture per view as it starts measuring (<dir>/<world>-<quality>-<n>.png), to see what was measured.
//
// A world is `map:<id>`, `tiles:<lat>,<lon>` or `devworld`. Tiles over a production build need the key: it is
// read from src/environments/environment.ts into the page's storage (the key dialog comes before any world), never printed. Keep tiles runs few (one map
// session each). A quality level goes into the page as `&quality=<level>` (docs/BENCHMARKS.md).
import { chromium, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';

function argument(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

const URL_BASE = argument('url', 'http://localhost:4322');
/** Worlds split at commas, a tiles world keeps its "lat,lon" */
const WORLDS = argument('worlds', 'map:demo-valley,map:harbor-town,tiles:48.7758,9.1829')
  .split(/,(?=map:|tiles:|devworld)/);
const QUALITIES = argument('qualities', '').split(',').filter(Boolean);
const DPR = Number(argument('dpr', '1'));
const WIDTH = Number(argument('width', '1600'));
const HEIGHT = Number(argument('height', '900'));
const JSON_OUT = argument('json', '');
const SHOTS = argument('shots', '');
const GPU_ARGS = process.platform === 'win32'
  ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--enable-gpu', '--ignore-gpu-blocklist'];

interface Row { view: string; frameMs: number; frameP95Ms: number; gpuMs: number | null; gpuP95Ms: number | null; cpuMs: number; calls: number; triangles: number }
interface Env { world: string; quality: string; gpu: string; canvas: [number, number]; devicePixelRatio: number; gpuTimer: boolean; version: string; commit: string }

function worldQuery(world: string): string {
  if (world === 'devworld') return 'devworld';
  if (world.startsWith('tiles:')) return `l=${world.slice(6)}`;
  return `world=${encodeURIComponent(world)}`;
}

/** The tile key of the dev environment, for a production build that carries none */
function tileCredentials(): Record<string, string> | null {
  try {
    const text = readFileSync(new URL('../../src/environments/environment.ts', import.meta.url), 'utf8');
    const field = (name: string) => new RegExp(`${name}:\\s*['"]([^'"]+)['"]`).exec(text)?.[1] ?? '';
    const token = field('cesiumIonToken');
    return token ? { tileProvider: 'cesium', cesiumIonToken: token, cesiumAssetId: field('cesiumAssetId') || '2275207' } : null;
  } catch {
    return null;
  }
}

/** A picture each time the panel starts measuring a view, until `done` */
async function shoot(page: Page, prefix: string, done: Promise<unknown>): Promise<void> {
  let over = false;
  void done.finally(() => (over = true));
  let shot = 0;
  let seen = '';
  while (!over) {
    const doing = await page.locator('[data-test=render-benchmark] .td-text').textContent({ timeout: 500 }).catch(() => null);
    if (doing?.endsWith('measuring') && doing !== seen) {
      seen = doing;
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${prefix}-${++shot}.png` }).catch(() => undefined);
    }
    await page.waitForTimeout(300);
  }
}

const browser = await chromium.launch({
  headless: false,
  args: [`--window-size=${WIDTH},${HEIGHT + 100}`, '--disable-gpu-vsync', '--disable-frame-rate-limit', ...GPU_ARGS],
});
const credentials = tileCredentials();
const all: { env: Env; rows: Row[] }[] = [];
for (const world of WORLDS) {
  for (const quality of QUALITIES.length ? QUALITIES : ['']) {
    const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: DPR });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
    await page.addInitScript((tiles) => {
      localStorage.setItem('td_seen_version', '9999.0.0');
      localStorage.setItem('td_onboarding_v2', JSON.stringify({ done: true, completed: [] }));
      localStorage.setItem('td_globe_quality_v1', '"off"');
      if (tiles && !localStorage.getItem('3dtd-tile-credentials')) localStorage.setItem('3dtd-tile-credentials', JSON.stringify(tiles));
    }, credentials);
    const q = quality ? `&quality=${quality}` : '';
    const started = Date.now();
    await page.goto(`${URL_BASE}/?${worldQuery(world)}&menu=skip&benchmark=render${q}`);
    const done = page.waitForFunction(() => (globalThis as { __renderBenchmark?: unknown }).__renderBenchmark ?? null, null, { timeout: 420_000, polling: 1000 })
      .then((h) => h.jsonValue() as Promise<{ env?: Env; rows?: Row[]; error?: string }>);
    if (SHOTS) void shoot(page, `${SHOTS}/${world.replace(/[^a-z0-9.-]+/gi, '_')}-${quality || 'default'}`, done);
    const result = await done;
    const ready = await page.evaluate(() => performance.getEntriesByName('load:ready')[0]?.startTime ?? null);
    if (result.error || !result.env || !result.rows) {
      console.log(`\n== ${world} ${quality || '-'}: failed: ${result.error}`, errors);
    } else {
      all.push({ env: result.env, rows: result.rows });
      console.log(`\n== ${world}, quality ${result.env.quality}: ${result.env.gpu}, canvas ${result.env.canvas.join('x')} at DPR ${result.env.devicePixelRatio}, `
        + `ready ${ready === null ? '?' : Math.round(ready)} ms, run ${Math.round((Date.now() - started) / 1000)} s, GPU timer ${result.env.gpuTimer ? 'yes' : 'no'}`);
      console.table(result.rows.map((r) => ({
        view: r.view, frameMs: +r.frameMs.toFixed(2), p95: +r.frameP95Ms.toFixed(2), gpuMs: r.gpuMs === null ? '-' : +r.gpuMs.toFixed(2),
        gpuP95: r.gpuP95Ms === null ? '-' : +r.gpuP95Ms.toFixed(2), cpuMs: +r.cpuMs.toFixed(2), calls: r.calls, trisM: +(r.triangles / 1e6).toFixed(2),
      })));
      if (errors.length) console.log('page errors', errors);
    }
    await ctx.close();
  }
}
await browser.close();

console.log('\nAll runs (ms per frame: frame interval / GPU, draw calls)');
console.table(all.flatMap(({ env, rows }) => rows.map((r) => ({
  world: env.world, quality: env.quality, view: r.view, frameMs: +r.frameMs.toFixed(2), gpuMs: r.gpuMs === null ? '-' : +r.gpuMs.toFixed(2), calls: r.calls,
}))));
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(all, null, 2));
