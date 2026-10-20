// Stutter of the build preview (TODO E258): a tower picked for building as the build menu does, the real mouse moved
// over screen points beside a route stretch, in passes over the same stretch, once the camera stands and the engine's
// background warm-up (warmRest) is through. Per pass, split into the pick (the first second) and the move: the frame
// intervals (longest, over 33 ms), with --read the slowest one-pixel read back (the GPU process's wait, where ANGLE builds a
// program on its first draw) and the programs linked; then the programs, geometries and textures three made, the GL
// uploads by call, the main thread's time in the preview's parts (cursor pick, footprint and validation, LOS update,
// cube render) and the cube's GPU time. A pass ends in Escape and the next picks the tower anew, as a player does.
//
//   npx ng serve --port <port>
//   node e2e/perf/build-preview-probe.ts --url http://localhost:<port> --map autumn-keep [--passes 3] [--profile]
//   An own map (an OSM world): --seed <dir>/<id>.3dtdmap --map <id> (with <id>.summary.json beside it, see map-load.ts)
//   --idle: a pass 0 of the same moves with nothing picked; --shots <prefix>: screenshots at a pass's start and move 40
//   --user-data <dir>: a kept browser profile (run once to warm it, measure the second); --vsync: frames at the
//   display's rate, as a player has them (without: as fast as they go); --settle 30000: after the background warm-up
//   Finding a long frame: --frame-gpu, --gl-slow <ms>, --sync-draws <ms>, --without los|cube, --time <paths>, --read
import { chromium, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { FrameProfiler } from './frame-profile.ts';

function argument(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

const URL_BASE = argument('url', 'http://localhost:4200');
const MAP = argument('map', 'autumn-keep');
const SEED = argument('seed', '');
const PASSES = Number(argument('passes', '3'));
const TOWER = argument('tower', 'archer');
/** Metres between two pointer positions, ms between two moves, metres beside the route, points per pass */
const STEP_M = Number(argument('step', '1'));
const MOVE_MS = Number(argument('move-ms', '33'));
const SIDE_M = Number(argument('side', '13'));
const POINTS = Number(argument('points', '160'));
const QUALITY = argument('quality', 'high');
const HEADED = process.argv.includes('--headed');
const PROFILE = process.argv.includes('--profile');
/** Pass 0 first: the same moves without a tower picked, what the frames cost without the preview */
const IDLE = process.argv.includes('--idle');
/** Screenshots at the pass's start and after 40 moves, to this path prefix */
const SHOTS = argument('shots', '');
/** The pick's window: the frames this long after the tower was picked */
const PICK_MS = Number(argument('pick-ms', '1000'));

// --read: a one-pixel read back per frame, the GPU process's wait (where ANGLE builds a program on its first draw);
// off by default, as the read waits for the GPU and so makes the frame it is in a long one
const READ = process.argv.includes('--read');
// --frame-gpu: each frame's GPU time by timer query (EXT_disjoint_timer_query_webgl2), in the list of long frames; the
// cube's own query is then left out (one query of a kind runs at a time)
const FRAME_GPU = process.argv.includes('--frame-gpu');
// --gl-slow <ms>: every WebGL call that takes longer, with where it came from, in the list of long frames (a call that
// waits for the GPU process: its command buffer full, or a result it has to wait for)
const GL_SLOW_MS = Number(argument('gl-slow', '0'));
// --chrome-trace <file>: a Chrome trace of the last pass's pick (for e2e/perf/trace-tasks.ts); not with --user-data
const CHROME_TRACE = argument('chrome-trace', '');
// --without los|cube: the preview without its LOS viz (no cell plates, no cube), or without the cube's render
const WITHOUT = argument('without', '');
// --time world.view.environment.update,...: methods by their path from the engine, timed as the preview's parts are
const TIME = argument('time', '') ? argument('time', '').split(',') : [];
// --sync-draws <ms>: for this long after the pick, a round trip to the GPU process after every draw (getError waits
// until it has run all before), booked on the object drawn: what the GPU process spends on a draw, its CPU included
// (ANGLE's work, which the GPU timer does not see). The frames themselves get slow then. With --gl-slow as well, the
// calls before each draw that waited over 20 ms
const SYNC_DRAWS_MS = Number(argument('sync-draws', '0'));

// --vsync: frames at the display's rate, as a player has them. Without it they run as fast as they can: the GPU
// process then falls behind now and then, and a WebGL call waits on it (long frames that are the uncapped rate's)
const VSYNC = process.argv.includes('--vsync');
const LAUNCH_ARGS = ['--window-size=1600,1000', '--enable-gpu', '--ignore-gpu-blocklist', ...(VSYNC ? [] : ['--disable-gpu-vsync', '--disable-frame-rate-limit'])];
// --user-data <dir>: a browser profile kept between runs, as a player's (siege-probe.ts): a fresh one compiles Skia's
// and the GPU program cache's programs anew, a first run's hitches that are not the game's
const USER_DATA = argument('user-data', '');
const persistent = USER_DATA
  ? await chromium.launchPersistentContext(USER_DATA, { headless: !HEADED, args: LAUNCH_ARGS, viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 })
  : null;
const browser = persistent ? null : await chromium.launch({ headless: !HEADED, args: LAUNCH_ARGS });
const page = persistent ? (persistent.pages()[0] ?? (await persistent.newPage())) : await browser!.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const close = () => (persistent ? persistent.close() : browser!.close());
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.addInitScript(([quality, frameGpu, glSlowMs]) => {
  localStorage.setItem('td_render_quality_v1', JSON.stringify({ setting: quality, auto: null, overrides: {}, plantMotion: 'full' }));
  localStorage.setItem('td_seen_version', '9999.0.0');
  localStorage.setItem('td_onboarding_v2', JSON.stringify({ done: true, completed: [] }));
  localStorage.setItem('td_globe_quality_v1', '"off"');
  // GL uploads by call: bytes and calls, summed until read
  const gl = WebGL2RenderingContext.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
  const uploads: Record<string, { calls: number; bytes: number; ms: number }> = {};
  (globalThis as { __uploads?: unknown }).__uploads = uploads;
  const linkTimes: number[] = [];
  (globalThis as { __linkTimes?: unknown }).__linkTimes = linkTimes;
  // Bytes where the call's data is all uploaded (a sub-range upload names its own count: left at 0)
  const sizeOf = (name: string, args: unknown[]) => {
    if (name === 'bufferData') return typeof args[1] === 'number' ? args[1] : ArrayBuffer.isView(args[1]) ? args[1].byteLength : 0;
    if (name === 'bufferSubData' || name === 'compileShader' || name === 'linkProgram') return 0;
    for (const a of args) if (ArrayBuffer.isView(a)) return a.byteLength;
    return 0;
  };
  for (const name of ['texImage2D', 'texSubImage2D', 'texImage3D', 'texSubImage3D', 'texStorage2D', 'compressedTexImage2D', 'bufferData', 'bufferSubData', 'compileShader', 'linkProgram']) {
    const original = gl[name];
    if (!original) continue;
    gl[name] = function (this: unknown, ...args: unknown[]) {
      const t0 = performance.now();
      const result = original.apply(this, args);
      const u = (uploads[name] ??= { calls: 0, bytes: 0, ms: 0 });
      u.calls++;
      u.bytes += sizeOf(name, args);
      u.ms += performance.now() - t0;
      if (name === 'linkProgram') linkTimes.push(t0);
      return result;
    };
  }
  (globalThis as { __frameGpu?: boolean }).__frameGpu = frameGpu;
  // Armed by the pick for --sync-draws (until `until`): after each draw a getError, its wait booked on `drawing`
  const sync = { until: 0, drawing: '', costs: [] as [string, number][], calls: [] as string[], logged: [] as string[] };
  (globalThis as { __sync?: unknown }).__sync = sync;
  for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements', 'clear']) {
    const original = gl[name];
    gl[name] = function (this: WebGL2RenderingContext, ...args: unknown[]) {
      const result = original.apply(this, args);
      if (performance.now() < sync.until) {
        const t0 = performance.now();
        this.getError();
        const ms = performance.now() - t0;
        if (ms > 2) sync.costs.push([`${name} ${sync.drawing}`, ms]);
        if (ms > 20 && sync.logged.length < 6) sync.logged.push(`${ms.toFixed(1)} ms ${name} ${sync.drawing}: ${sync.calls.join(' ')}`);
        sync.calls.length = 0;
      }
      return result;
    };
  }
  const slow: [number, string, number, string][] = [];
  (globalThis as { __glSlow?: unknown }).__glSlow = slow;
  if (glSlowMs > 0) {
    for (const name of Object.getOwnPropertyNames(WebGL2RenderingContext.prototype)) {
      const descriptor = Object.getOwnPropertyDescriptor(WebGL2RenderingContext.prototype, name);
      const original = descriptor?.value as ((...args: unknown[]) => unknown) | undefined;
      if (typeof original !== 'function' || name === 'constructor') continue;
      gl[name] = function (this: unknown, ...args: unknown[]) {
        if (performance.now() < sync.until && sync.calls.length < 400) {
          sync.calls.push(`${name}(${args.map((a) => (typeof a === 'number' ? a : ArrayBuffer.isView(a) ? `[${a.constructor.name.replace('Array', '')} ${(a as ArrayBufferView).byteLength}]` : a === null ? 'null' : typeof a === 'object' ? (a as object).constructor.name.replace('WebGL', '') : String(a))).join(',')})`);
        }
        const t0 = performance.now();
        const result = original.apply(this, args);
        const ms = performance.now() - t0;
        if (ms > glSlowMs) {
          const stack = (new Error().stack ?? '').split('\n').slice(2, 9).map((l) => l.trim().replace(/^at /, '').replace(/\(?https?:\/\/[^/]+\//, '(')).join(' < ');
          slow.push([performance.now(), name, ms, stack]);
        }
        return result;
      };
    }
  }
}, [QUALITY, FRAME_GPU, GL_SLOW_MS] as const);

async function seed(target: Page, file: string): Promise<void> {
  const bytes = [...readFileSync(file)];
  const summary = JSON.parse(readFileSync(file.replace(/\.3dtdmap$/, '.summary.json'), 'utf8')) as { id: string };
  await target.evaluate(async ({ bytes, summary }) => {
    await new Promise((resolve, reject) => {
      // No version: a kept profile's store is at the app's (MapStore's), a fresh one starts at 1 and the app upgrades it
      const req = indexedDB.open('3dtd-maps');
      req.onupgradeneeded = () => {
        for (const store of ['files', 'summaries']) {
          if (!req.result.objectStoreNames.contains(store)) req.result.createObjectStore(store, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => {
        const tx = req.result.transaction(['files', 'summaries'], 'readwrite');
        tx.objectStore('files').put({ id: summary.id, file: new Uint8Array(bytes), preview: null });
        tx.objectStore('summaries').put(summary);
        tx.oncomplete = () => {
          req.result.close();
          resolve(null);
        };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  }, { bytes, summary });
}

if (SEED) {
  await page.goto(`${URL_BASE}/build-info.json`);
  await seed(page, SEED);
}
const t0 = Date.now();
await page.goto(`${URL_BASE}/?world=map:${MAP}&menu=skip`);
await page.waitForFunction(() => '__load' in globalThis, null, { timeout: 300_000 });
await page.waitForSelector('app-quick-actions', { timeout: 300_000 });
console.log(`loaded in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
for (let i = 0; i < 10; i++) {
  if (!(await page.getByRole('button', { name: /skip intro|intro überspringen/i }).count())) break;
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
}
await page.waitForTimeout(Number(argument('settle', '4000')));

// The preview's parts timed on the main thread: wrapped on the live objects, summed until read
await page.evaluate(([without, timed]) => {
  interface Ng { getComponent(e: Element): Record<string, unknown> }
  const host = document.querySelector('app-tower-defense')!;
  const comp = (globalThis as unknown as { ng: Ng }).ng.getComponent(host) as Record<string, Record<string, unknown>>;
  const engine = comp['engine'] as unknown as Record<string, unknown> & { picker: Record<string, unknown>; getTowerShadowMapper(): Record<string, unknown> };
  const placement = comp['towerPlacement'] as Record<string, unknown>;
  const times: Record<string, { calls: number; ms: number; max: number }> = {};
  (globalThis as { __parts?: unknown }).__parts = times;
  // The calls over a millisecond by their end, to name what ran in a long frame
  const events: [number, string, number][] = [];
  (globalThis as { __events?: unknown }).__events = events;
  const wrap = (target: Record<string, unknown>, name: string, label: string) => {
    const original = target[name] as (...args: unknown[]) => unknown;
    if (typeof original !== 'function') return;
    target[name] = function (this: unknown, ...args: unknown[]) {
      const t = performance.now();
      try {
        return original.apply(this, args);
      } finally {
        const now = performance.now();
        const ms = now - t;
        const s = (times[label] ??= { calls: 0, ms: 0, max: 0 });
        s.calls++;
        s.ms += ms;
        s.max = Math.max(s.max, ms);
        if (ms > 1) events.push([now, label, ms]);
      }
    };
  };
  wrap(engine.picker, 'raycastTerrain', 'pick');
  wrap(placement, 'updatePreviewPosition', 'preview (all)');
  wrap(placement, 'probeFootprint', 'footprint');
  wrap(placement, 'validateTowerPosition', 'validate');
  wrap(placement, 'tickBuildPreviewViz', 'preview tick');
  wrap(engine, 'render', 'engine render');
  // The object three draws now, for --sync-draws
  const renderer = (engine as unknown as { getRenderer(): Record<string, unknown> }).getRenderer();
  const direct = renderer['renderBufferDirect'] as (...args: unknown[]) => unknown;
  const sync = (globalThis as unknown as { __sync: { drawing: string } }).__sync;
  renderer['renderBufferDirect'] = function (this: unknown, ...args: unknown[]) {
    const [camera, , geometry, material, object] = args as [{ type: string }, unknown, { attributes: Record<string, unknown> }, { type: string; name: string; transparent: boolean }, { name: string; type: string; parent?: { name: string } }];
    sync.drawing = `${object.type} "${object.name || object.parent?.name || ''}" ${material.type}${material.name ? ` "${material.name}"` : ''}${material.transparent ? ' transparent' : ''} [${Object.keys(geometry.attributes).join(' ')}] via ${camera.type}`;
    return direct.apply(this, args);
  };
  const mapper = engine.getTowerShadowMapper();
  // update() returns whether it rendered: a cube only then
  const update = mapper['update'] as (...args: unknown[]) => boolean;
  // The cube's GPU time (EXT_disjoint_timer_query_webgl2), read back once the GPU has it
  const gl = (engine as unknown as { getRenderer(): { getContext(): WebGL2RenderingContext } }).getRenderer().getContext();
  const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number } | null;
  const pending: WebGLQuery[] = [];
  const gpu = { renders: 0, ms: 0, max: 0 };
  (globalThis as { __cubeGpu?: unknown }).__cubeGpu = gpu;
  const collect = () => {
    while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
      const query = pending.shift()!;
      const ms = gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6;
      gl.deleteQuery(query);
      gpu.renders++;
      gpu.ms += ms;
      gpu.max = Math.max(gpu.max, ms);
    }
    requestAnimationFrame(collect);
  };
  requestAnimationFrame(collect);
  const cubeTimer = (globalThis as { __frameGpu?: boolean }).__frameGpu ? null : timer;
  mapper['update'] = function (this: unknown, ...args: unknown[]) {
    const t = performance.now();
    const timer = cubeTimer;
    const query = timer ? gl.createQuery() : null;
    if (query && timer) gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
    const rendered = update.apply(this, args);
    if (query && timer) {
      gl.endQuery(timer.TIME_ELAPSED_EXT);
      if (rendered) pending.push(query);
      else gl.deleteQuery(query);
    }
    if (rendered) {
      const now = performance.now();
      const ms = now - t;
      const s = (times['cube render'] ??= { calls: 0, ms: 0, max: 0 });
      s.calls++;
      s.ms += ms;
      s.max = Math.max(s.max, ms);
      events.push([now, 'cube render', ms]);
    }
    return rendered;
  };
  const los = placement['buildPreviewLos'] as Record<string, unknown>;
  wrap(los, 'update', 'los update');
  // The cells a rebuilt preview draws
  const grid = los['grid'] as Record<string, unknown>;
  const cellsInRange = grid['getCellsInRange'] as (...args: unknown[]) => unknown[];
  grid['getCellsInRange'] = function (this: unknown, ...args: unknown[]) {
    const cells = cellsInRange.apply(this, args);
    const s = (times['cells'] ??= { calls: 0, ms: 0, max: 0 });
    s.calls++;
    s.ms += cells.length;
    s.max = Math.max(s.max, cells.length);
    return cells;
  };
  wrap(los, 'dispose', 'los dispose');
  if (without === 'los') los['update'] = () => undefined;
  if (without === 'cube') mapper['update'] = () => false;
  for (const path of timed) {
    const names = path.split('.');
    let target: Record<string, unknown> | undefined = engine;
    for (const name of names.slice(0, -1)) target = target?.[name] as Record<string, unknown> | undefined;
    if (typeof target?.[names[names.length - 1]] !== 'function') throw new Error(`--time: no method ${path}`);
    wrap(target!, names[names.length - 1], path);
  }
}, [WITHOUT, TIME] as const);

/** The camera's position, to wait until it stands (an intro flight, a glide) */
async function cameraStill(): Promise<void> {
  let last = '';
  for (let i = 0; i < 120; i++) {
    const now = await page.evaluate(() => {
      interface Ng { getComponent(e: Element): { engine: { getCamera(): { position: { x: number; y: number; z: number } } } } }
      const p = (globalThis as unknown as { ng: Ng }).ng.getComponent(document.querySelector('app-tower-defense')!).engine.getCamera().position;
      return `${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}`;
    });
    if (now === last) return;
    last = now;
    await page.waitForTimeout(500);
  }
  console.log('camera did not stand still');
}

/** Screen points beside the first route stretch the camera sees, STEP_M apart */
const routePoints = () => page.evaluate(([step, side, count]) => {
  interface Ng { getComponent(e: Element): Record<string, unknown> }
  const host = document.querySelector('app-tower-defense')!;
  const comp = (globalThis as unknown as { ng: Ng }).ng.getComponent(host) as Record<string, unknown>;
  interface V { x: number; y: number; z: number; clone(): V; project(c: unknown): V }
  const engine = comp['engine'] as {
    sync: { geoToLocalSimple(lat: number, lon: number, h: number): V; localToGeo(v: V): { lat: number; lon: number } };
    picker: { raycastTerrain(x: number, y: number): V | null };
    getCamera(): unknown;
    getTerrainHeightAtGeo(lat: number, lon: number): number | null;
  };
  const load = (globalThis as unknown as { __load: { state(): { paths: [number, number][][] } } }).__load;
  const placement = comp['towerPlacement'] as { buildPreviewLos: { grid: { getCellsInRange(x: number, z: number, r: number): unknown[] } } };
  const grid = placement.buildPreviewLos.grid;
  const canvas = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0];
  const rect = canvas.getBoundingClientRect();
  let best: { x: number; y: number }[] = [];
  for (const path of load.state().paths) {
    const run: { x: number; y: number }[] = [];
    for (let i = 0; i + 1 < path.length && best.length < count; i++) {
      const a = engine.sync.geoToLocalSimple(path[i][0], path[i][1], 0);
      const b = engine.sync.geoToLocalSimple(path[i + 1][0], path[i + 1][1], 0);
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      if (len < 1e-3) continue;
      for (let d = 0; d < len; d += step) {
        const x = a.x + (dx / len) * d - (dz / len) * side;
        const z = a.z + (dz / len) * d + (dx / len) * side;
        const p = engine.sync.geoToLocalSimple(path[i][0], path[i][1], 0);
        p.x = x;
        p.z = z;
        const geo = engine.sync.localToGeo(p);
        p.y = engine.getTerrainHeightAtGeo(geo.lat, geo.lon) ?? a.y;
        const ndc = p.clone().project(engine.getCamera());
        const screen = { x: rect.left + ((ndc.x + 1) / 2) * rect.width, y: rect.top + ((1 - ndc.y) / 2) * rect.height };
        // On the screen, beside the corridor's cells (a route the grid holds), and the cursor's pick lands there
        let inside = Math.abs(ndc.x) < 0.8 && Math.abs(ndc.y) < 0.75 && ndc.z < 1 && grid.getCellsInRange(x, z, side + 4).length > 0;
        if (inside) {
          const hit = engine.picker.raycastTerrain(screen.x, screen.y);
          inside = !!hit && Math.hypot(hit.x - x, hit.z - z) < 3;
        }
        if (inside) {
          run.push(screen);
          if (run.length > best.length) best = [...run];
          if (best.length >= count) break;
        } else run.length = 0;
      }
    }
  }
  return best;
}, [STEP_M, SIDE_M, POINTS] as const);
await cameraStill();
// The towers and enemies the engine readies after load (warmRest) done: their frames are not the preview's
await page.waitForFunction(() => {
  interface Ng { getComponent(e: Element): { engine: { warmQueue: unknown[]; warmRunning: boolean } } }
  const engine = (globalThis as unknown as { ng: Ng }).ng.getComponent(document.querySelector('app-tower-defense')!).engine;
  return engine.warmQueue.length === 0 && !engine.warmRunning;
}, null, { timeout: 120_000, polling: 250 });
await page.waitForTimeout(1000);
const points = await routePoints();
console.log(`${points.length} points on screen`);
if (points.length < 10) {
  await close();
  throw new Error('no route stretch on screen');
}

async function snapshot() {
  return page.evaluate(() => {
    interface Ng { getComponent(e: Element): { engine?: { getRenderer(): { info: { programs: unknown[]; memory: { geometries: number; textures: number } } } } } }
    const host = document.querySelector('app-tower-defense')!;
    const info = (globalThis as unknown as { ng: Ng }).ng.getComponent(host).engine!.getRenderer().info;
    const g = globalThis as unknown as { __uploads: Record<string, { calls: number; bytes: number; ms: number }>; __parts: Record<string, unknown> };
    const names = (info.programs as { name: string; cacheKey: string }[]).map((p) => p.name || `[${p.cacheKey.slice(0, 50).replace(/\s+/g, ' ')}]`);
    const cube = (globalThis as unknown as { __cubeGpu: { renders: number; ms: number; max: number } }).__cubeGpu;
    const cubeGpu = { ...cube };
    cube.renders = 0;
    cube.ms = 0;
    cube.max = 0;
    const out = { cubeGpu, names, programs: info.programs.length, geometries: info.memory.geometries, textures: info.memory.textures, uploads: g.__uploads, parts: g.__parts };
    const json = JSON.parse(JSON.stringify(out));
    for (const k of Object.keys(g.__uploads)) delete g.__uploads[k];
    for (const k of Object.keys(g.__parts)) delete g.__parts[k];
    return json as typeof out;
  });
}

const profiler = PROFILE ? await FrameProfiler.attach(page, Number(argument('long', '33'))) : null;
for (let pass = IDLE ? 0 : 1; pass <= PASSES; pass++) {
  await cameraStill();
  await snapshot();
  const before = await snapshot();
  // Frames and the GPU wait of each, recorded in the page until stopped
  await page.evaluate(([read, frameGpu]) => {
    const canvases = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height);
    const ctx = canvases[0]?.getContext('webgl2') ?? null;
    const gl = read ? ctx : null;
    const timer = frameGpu && ctx ? (ctx.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number } | null) : null;
    const rec = { gaps: [] as number[], ends: [] as number[], reads: [] as number[], gpu: [] as number[], pickAt: Infinity, leaveAt: Infinity, on: true };
    (globalThis as { __rec?: unknown }).__rec = rec;
    // A query from one frame's callback to the next: the GPU work between, booked on the frame that ends it
    let open: WebGLQuery | null = null;
    const queries: [WebGLQuery, number][] = [];
    let last = performance.now();
    const frame = () => {
      const now = performance.now();
      rec.gaps.push(now - last);
      rec.ends.push(now);
      rec.gpu.push(-1);
      last = now;
      if (timer && ctx) {
        if (open) {
          ctx.endQuery(timer.TIME_ELAPSED_EXT);
          queries.push([open, rec.gaps.length - 1]);
        }
        while (queries.length && ctx.getQueryParameter(queries[0][0], ctx.QUERY_RESULT_AVAILABLE)) {
          const [query, at] = queries.shift()!;
          rec.gpu[at] = ctx.getQueryParameter(query, ctx.QUERY_RESULT) / 1e6;
          ctx.deleteQuery(query);
        }
        open = rec.on ? ctx.createQuery() : null;
        if (open) ctx.beginQuery(timer.TIME_ELAPSED_EXT, open);
      }
      if (gl) {
        const r0 = performance.now();
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
        rec.reads.push(performance.now() - r0);
      }
      if (rec.on) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }, [READ, FRAME_GPU] as const);
  await profiler?.start();
  const tracing = CHROME_TRACE && browser && pass === PASSES;
  if (tracing) {
    await browser.startTracing(page, {
      path: CHROME_TRACE,
      // The GPU process's tasks too (gpu.service): a WebGL call that waits shows there what the process ran meanwhile
      categories: ['devtools.timeline', 'toplevel', 'v8.execute', 'disabled-by-default-v8.gc', 'gpu', 'disabled-by-default-gpu.service', '__metadata'],
    });
  }
  await page.mouse.move(points[0].x, points[0].y);
  await page.evaluate(([tower, syncMs]) => {
    interface Ng { getComponent(e: Element): { selectTowerType(id: string): void } }
    const load = (globalThis as unknown as { __load: { emit(c: unknown): void } }).__load;
    load.emit({ type: 'debug:add-credits', amount: 1_000_000 });
    (globalThis as unknown as { __rec: { pickAt: number } }).__rec.pickAt = performance.now();
    if (syncMs > 0) (globalThis as unknown as { __sync: { until: number } }).__sync.until = performance.now() + syncMs;
    if (tower) (globalThis as unknown as { ng: Ng }).ng.getComponent(document.querySelector('app-tower-defense')!).selectTowerType(tower);
  }, [pass > 0 ? TOWER : '', SYNC_DRAWS_MS] as const);
  const tStart = Date.now();
  // The trace covers the pick only: a trace of the whole pass is too large to read and slows the frames it records
  const traced = tracing ? page.waitForTimeout(PICK_MS).then(() => browser.stopTracing()) : null;
  for (const [i, p] of points.entries()) {
    if (SHOTS && (i === 0 || i === 40)) await page.screenshot({ path: `${SHOTS}-${pass}-${i}.png` });
    await page.mouse.move(p.x, p.y);
    await page.waitForTimeout(MOVE_MS);
  }
  const moveMs = Date.now() - tStart;
  await traced;
  // Out of build mode (with nothing picked Escape opens the menu)
  await page.evaluate(() => ((globalThis as unknown as { __rec: { leaveAt: number } }).__rec.leaveAt = performance.now()));
  if (pass > 0) await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const rec = await page.evaluate((PICK_MS) => {
    const r = (globalThis as unknown as { __rec: { gaps: number[]; ends: number[]; reads: number[]; gpu: number[]; pickAt: number; leaveAt: number; on: boolean } }).__rec;
    r.on = false;
    const links = (globalThis as unknown as { __linkTimes: number[] }).__linkTimes.splice(0);
    const events = (globalThis as unknown as { __events: [number, string, number][] }).__events.splice(0);
    const slow = (globalThis as unknown as { __glSlow: [number, string, number, string][] }).__glSlow.splice(0);
    // The pick: the frames up to PICK_MS after the tower was picked; the move: the ones after, up to Escape; the leave
    const pickEnd = r.pickAt + PICK_MS;
    const inPick = (t: number) => t >= r.pickAt && t < pickEnd;
    const split = (keep: (t: number) => boolean) => ({
      gaps: r.gaps.filter((_, i) => keep(r.ends[i])),
      reads: r.reads.filter((_, i) => keep(r.ends[i])),
      links: links.filter(keep).length,
    });
    // Each frame over 33 ms: its start after the pick, its GPU time and the timed calls that ended in it
    const long = r.gaps.flatMap((gap, i) => {
      if (gap <= 33 || r.ends[i] < r.pickAt) return [];
      const from = r.ends[i] - gap;
      const ran = events.filter(([t]) => t > from && t <= r.ends[i]).map(([, label, ms]) => `${label} ${ms.toFixed(1)}`);
      for (const [t, name, ms, stack] of slow) if (t > from && t <= r.ends[i]) ran.push(`\n      gl.${name} ${ms.toFixed(1)} ms < ${stack}`);
      return [`${(from - r.pickAt).toFixed(0)} ms: ${gap.toFixed(1)} ms, GPU ${r.gpu[i] >= 0 ? r.gpu[i].toFixed(1) : '?'} ms${ran.length ? `, ${ran.join(', ')}` : ''}`];
    });
    return { pick: split(inPick), move: split((t) => t >= pickEnd && t < r.leaveAt), leave: split((t) => t >= r.leaveAt), long };
  }, PICK_MS);
  const after = await snapshot();
  const round = (x: number) => Math.round(x * 10) / 10;
  const line = (r: { gaps: number[]; reads: number[]; links: number }) => {
    const sorted = [...r.gaps].sort((a, b) => b - a);
    return `${r.gaps.length} frames, longest ${sorted.slice(0, 5).map(round).join(' ')} ms, >33 ms ${r.gaps.filter((g) => g > 33).length}, ` +
      `>50 ms ${r.gaps.filter((g) => g > 50).length}, sum over 33 ms ${round(r.gaps.filter((g) => g > 33).reduce((x, g) => x + g - 16.7, 0))} ms, ` +
      `slowest read ${round(Math.max(0, ...r.reads))} ms, median ${round(sorted[Math.floor(sorted.length / 2)] ?? 0)} ms, ${r.links} programs linked`;
  };
  const uploads = Object.fromEntries(
    Object.entries(after.uploads).map(([k, v]) => [k, `${v.calls}x${v.bytes ? ` ${(v.bytes / 1e6).toFixed(2)} MB` : ''} ${v.ms.toFixed(0)} ms`]),
  );
  const parts = Object.fromEntries(
    Object.entries(after.parts as Record<string, { calls: number; ms: number; max: number }>).map(([k, v]) => [k, `${v.calls}x sum ${v.ms.toFixed(0)} max ${v.max.toFixed(1)} ms`]),
  );
  console.log(`PASS ${pass} (${moveMs} ms of moves)`);
  console.log(`  pick: ${line(rec.pick)}`);
  console.log(`  move: ${line(rec.move)}`);
  console.log(`  leave: ${line(rec.leave)}`);
  for (const l of rec.long) console.log(`  long at ${l}`);
  if (SYNC_DRAWS_MS > 0) {
    const costs = await page.evaluate(() => (globalThis as unknown as { __sync: { costs: [string, number][] } }).__sync.costs.splice(0));
    const logged = await page.evaluate(() => (globalThis as unknown as { __sync: { logged: string[] } }).__sync.logged.splice(0));
    for (const l of logged) console.log(`  calls before ${l}`);
    const sums = new Map<string, [number, number, number]>();
    for (const [what, ms] of costs) {
      const v = sums.get(what) ?? [0, 0, 0];
      sums.set(what, [v[0] + 1, v[1] + ms, Math.max(v[2], ms)]);
    }
    for (const [what, [n, sum, max]] of [...sums].sort((a, b) => b[1][1] - a[1][1]).slice(0, 15)) {
      console.log(`  sync ${sum.toFixed(1)} ms (${n}x, max ${max.toFixed(1)}): ${what}`);
    }
  }
  const left = [...before.names];
  const added = after.names.filter((n) => {
    const k = left.indexOf(n);
    if (k < 0) return true;
    left.splice(k, 1);
    return false;
  });
  console.log(`  programs +${after.programs - before.programs} ${added.join(' | ')}, geometries ${before.geometries} -> ${after.geometries}, textures ${before.textures} -> ${after.textures}`);
  console.log(`  uploads ${JSON.stringify(uploads)}`);
  console.log(`  parts ${JSON.stringify(parts)}`);
  const g = after.cubeGpu;
  console.log(`  cube GPU ${g.renders} renders, sum ${g.ms.toFixed(1)} ms, mean ${(g.ms / Math.max(1, g.renders)).toFixed(2)} ms, max ${g.max.toFixed(2)} ms`);
  if (profiler) console.log(await profiler.stop(Number(argument('lines', '16'))));
  await page.waitForTimeout(500);
}
await close();
