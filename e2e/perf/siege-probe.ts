// Hitches of a siege gun on a destructible map (TODO E256): Jumpers on Ruined City, sent as Wave Debug "Single" sends
// them, their shots at the buildings along the route, the blasts and the falls. Over the window every frame's
// interval, its GPU time (a timer query), the slowest one-pixel read back (waiting for the GPU process, which builds
// a program's shaders on its first draw), the programs three built and the geometries and textures it uploaded, the
// JS heap, the worker's tick; and the presentation's own calls (the shot, the impact, the stages, falls and craters
// of the world damage, the map's layers and the effects they spawn) timed as they run, so each long frame lists
// what ran in it, and per shot or impact the longest frame after it. Prints whether the map's ground baker still
// runs in its worker at the end.
//
//   npx ng serve --port <port>
//   node e2e/perf/siege-probe.ts --url http://localhost:<port> [--map ruined-city] [--enemy jumper] [--window 40000]
//        [--long 33] [--start wave|spawn] [--close] [--trace view.updateHeights,...] [--profile [--total]] [--headed]
//   A baseline (perf-run.ts): --vsync (default: frames as fast as they go), --user-data <dir>, --idle <ms>: the game
//   standing that long before the wave, --json <file>: the idle frames, the wave's first --wave-start ms (5000) and
//   the whole window
import { chromium } from '@playwright/test';
import { FrameProfiler } from './frame-profile.ts';
import { FrameReport, frameWindow, startFrames, stopFrames, vsyncArgs, vsyncOn } from './perf-run.ts';

function argument(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

const URL_BASE = argument('url', 'http://localhost:4200');
const MAP = argument('map', 'ruined-city');
const ENEMY = argument('enemy', 'jumper');
const SETTLE_MS = Number(argument('settle', '4000'));
const WINDOW_MS = Number(argument('window', '40000'));
const LONG_MS = Number(argument('long', '33'));
const QUALITY = argument('quality', 'high');
const HEADED = process.argv.includes('--headed');
// --start wave (default): Wave Debug as the player does it, the type picked, `--pick` ms later "Start Custom Wave" with
// a count of one; --start spawn: the enemy put on the route straight away (debug:spawn-enemy, nothing of a wave);
// --start button: the run's next wave with the wave button, as a player starts it (no Wave Debug); --start idle:
// nothing, the game standing after its load (the background's warm-up)
const START = argument('start', 'wave');
const PICK_MS = Number(argument('pick', '3000'));
// --close: the camera goes to the first shot, 45 m behind the gun and up, looking at where the shell lands
const CLOSE = process.argv.includes('--close');
// --no-read: no one-pixel read back per frame (a read waits for all the GPU work queued before it: its first one
// stands for whatever was queued, not for the game's frame)
const READ = !process.argv.includes('--no-read');
// --speed 4: the game's speed over the window (the side switches of a long walk in less time)
const SPEED = Number(argument('speed', '1'));
// --chrome-trace <file>: a Chrome trace of the window (devtools.timeline), for e2e/perf/trace-tasks.ts
const CHROME_TRACE = argument('chrome-trace', '');
// --trace view.updateHeights,...: every call of these, with its arguments, time and length
const TRACE = argument('trace', '') ? argument('trace', '').split(',') : [];

const LAUNCH_ARGS = ['--window-size=1600,1000', '--enable-gpu', '--ignore-gpu-blocklist', ...vsyncArgs(false)];
/** The game standing idle this long before the wave, its frames in --json (0: none) */
const IDLE_MS = Number(argument('idle', '0'));
/** The wave's start in --json: its first this many ms */
const WAVE_START_MS = Number(argument('wave-start', '5000'));
const report = new FrameReport();
// --user-data <dir>: a browser profile kept between runs, as a player's: its shader caches (GrShaderCache, the
// GPU program cache) hold what earlier runs compiled. A fresh profile compiles every Skia and WebGL program anew
// each run. No --chrome-trace with it (a persistent context has no browser to trace)
const USER_DATA = argument('user-data', '');
const persistent = USER_DATA
  ? await chromium.launchPersistentContext(USER_DATA, { headless: !HEADED, args: LAUNCH_ARGS, viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 })
  : null;
const browser = persistent ? null! : await chromium.launch({ headless: !HEADED, args: LAUNCH_ARGS });
const page = persistent ? (persistent.pages()[0] ?? (await persistent.newPage())) : await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('pageerror', e.message));
// --block <regex>: requests whose URL matches fail (an asset left out, to see what it costs)
if (argument('block', '')) {
  const block = new RegExp(argument('block', ''));
  await page.route((url) => block.test(url.href), (route) => route.abort());
}
if (process.argv.includes('--reduced-motion')) await page.emulateMedia({ reducedMotion: 'reduce' });
const LOG = new RegExp(argument('log', '\\[Warmup\\]|warm-up|Warm-up|DBG'), 'i');
page.on('console', (m) => {
  if (LOG.test(m.text())) console.log('console', m.text());
});
await page.addInitScript((quality) => {
  localStorage.setItem('td_render_quality_v1', JSON.stringify({ setting: quality, auto: null, overrides: {}, plantMotion: 'full' }));
  localStorage.setItem('td_seen_version', '9999.0.0');
  localStorage.setItem('td_onboarding_v2', JSON.stringify({ done: true, completed: [] }));
  localStorage.setItem('td_globe_quality_v1', '"off"');
  // The custom map's view, for its calls (custom-map-view.ts)
  (globalThis as { __mapProbe?: unknown }).__mapProbe = true;
}, QUALITY);
const t0 = Date.now();
await page.goto(`${URL_BASE}/?world=map:${MAP}&menu=skip`);
await page.waitForFunction(() => '__load' in globalThis, null, { timeout: 300_000 });
await page.waitForSelector('app-quick-actions', { timeout: 300_000 });
console.log(`loaded in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
// The intro flight moves the camera over the whole map: skipped (its button comes a moment after the load)
const skip = page.getByRole('button', { name: /skip intro|intro überspringen/i });
await skip.waitFor({ timeout: 8000 }).catch(() => undefined);
for (let i = 0; i < 10 && (await skip.count()); i++) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
}
await page.waitForTimeout(SETTLE_MS);
// --overflow: the elements reaching past the window (the root layer grows with them, and paints them)
if (process.argv.includes('--overflow')) {
  const out = await page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    const h = document.documentElement.clientHeight;
    const list: string[] = [];
    for (const e of Array.from(document.querySelectorAll('*'))) {
      const b = e.getBoundingClientRect();
      if ((b.right > w + 1 || b.bottom > h + 1) && b.width > 0 && b.height > 0) {
        const cls = typeof e.className === 'string' ? e.className.trim().split(/\s+/).join('.') : '';
        list.push(`${e.localName}${cls ? '.' + cls : ''} ${Math.round(b.left)}..${Math.round(b.right)} x ${Math.round(b.top)}..${Math.round(b.bottom)}`);
      }
    }
    const root = document.scrollingElement!;
    return { viewport: `${w}x${h}`, scroll: `${root.scrollWidth}x${root.scrollHeight}`, list: list.slice(0, 40) };
  });
  console.log('OVERFLOW ' + JSON.stringify(out, null, 1));
}
// --css "<rules>": a style sheet over the game's, to try a change of the UI's look on the frames
if (argument('css', '')) await page.addStyleTag({ content: argument('css', '') });

if (IDLE_MS > 0) {
  await startFrames(page);
  await page.waitForTimeout(IDLE_MS);
  const idle = await stopFrames(page);
  report.add(frameWindow('idle', idle.gaps, idle.heap));
}

if (START === 'wave') {
  await page.evaluate((enemy) => {
    interface Debug { mixedMode(): boolean; toggleMixedMode(): void; setEnemyType(id: string): void; setEnemyCount(n: number): void }
    const g = globalThis as unknown as { ng: { getComponent(e: Element): { waveDebug: Debug } } };
    const waveDebug = g.ng.getComponent(document.querySelector('app-tower-defense')!).waveDebug;
    if (waveDebug.mixedMode()) waveDebug.toggleMixedMode();
    waveDebug.setEnemyType(enemy);
    waveDebug.setEnemyCount(1);
  }, ENEMY);
  await page.waitForTimeout(PICK_MS);
}

// --layers: the compositor's layers painted in the window (CDP LayerTree): per layer how often, how much area,
// its element, in the first 600 ms and after
interface LayerInfo { layerId: string; backendNodeId?: number; width: number; height: number; drawsContent: boolean; compositingReasons?: string[] }
const layerCdp = process.argv.includes('--layers') ? await page.context().newCDPSession(page) : null;
const layerPaints: { layerId: string; at: number; area: number; clip: string }[] = [];
const layersSeen = new Map<string, LayerInfo>();
let layerT0 = 0;
if (layerCdp) {
  await layerCdp.send('DOM.enable');
  await layerCdp.send('LayerTree.enable');
  layerCdp.on('LayerTree.layerTreeDidChange', (e: { layers?: LayerInfo[] }) => {
    for (const l of e.layers ?? []) layersSeen.set(l.layerId, l);
  });
  layerCdp.on('LayerTree.layerPainted', (e: { layerId: string; clip: { x: number; y: number; width: number; height: number } }) => {
    const c = e.clip;
    layerPaints.push({ layerId: e.layerId, at: Date.now() - layerT0, area: c.width * c.height, clip: `${c.width}x${c.height}+${c.x}+${c.y}` });
  });
}

const profiler = process.argv.includes('--profile') ? await FrameProfiler.attach(page, LONG_MS) : null;
await profiler?.start();
if (CHROME_TRACE) {
  await browser.startTracing(page, {
    path: CHROME_TRACE,
    categories: process.argv.includes('--trace-paint')
      ? ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.invalidationTracking']
      : process.argv.includes('--trace-gpu') ? ['devtools.timeline', 'toplevel', 'v8.execute', 'gpu', '__metadata'] : ['devtools.timeline', 'toplevel', 'v8.execute', 'disabled-by-default-v8.gc'],
  });
}
layerT0 = Date.now();
// --flash <dir>: Chrome's paint flashing on, screenshots 30, 60 and 120 ms into the window (green: repainted)
if (argument('flash', '')) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('Overlay.enable');
  await cdp.send('Overlay.setShowPaintRects', { result: true });
  const dir = argument('flash', '');
  for (const ms of [30, 60, 120]) void page.waitForTimeout(ms).then(() => page.screenshot({ path: `${dir}/flash-${ms}.png` }));
}
// --at x,y: the element at a point of the page, 300 ms into the window (what a layer's paints cover)
if (argument('at', '')) {
  const [ax, ay] = argument('at', '').split(',').map(Number);
  void page.waitForTimeout(300).then(() => page.evaluate(([x, y]) => {
    const chain: string[] = [];
    for (let e: Element | null = document.elementFromPoint(x, y); e && chain.length < 8; e = e.parentElement) chain.push(`${e.localName}${e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).join('.') : ''}`);
    return chain.join(' < ');
  }, [ax, ay])).then((chain) => console.log(`AT ${chain}`));
}
// The button's click comes from outside the page, as the player's: started once the page records its frames
const clicked = START === 'button' ? page.waitForTimeout(300).then(() => page.locator('.td-wave-btn').click()) : Promise.resolve();
const result = await page.evaluate(
  async ([enemy, ms, longMs, close, how, trace, speed, readBack]) => {
    interface Info { programs: { name: string; cacheKey: string }[] | null; memory: { geometries: number; textures: number } }
    interface Component {
      engine?: { getRenderer(): { info: Info } };
      presentation?: { host: Record<string, unknown> | null };
      sim?: { mirror: { scalars: { tickMs: number; gameTimeMs: number } } };
    }
    const g = globalThis as unknown as {
      ng: { getComponent(e: Element): Component };
      __load: { emit(c: unknown): void; state(): { paths: [number, number][][]; enemies: number } };
    };
    const component = g.ng.getComponent(document.querySelector('app-tower-defense')!);
    const renderer = component.engine!.getRenderer();
    const host = component.presentation!.host!;
    const engine = (host as { engine: Record<string, unknown> }).engine;
    const programName = (p: { name: string; cacheKey: string }) => p.name || `[${p.cacheKey.slice(0, 40).replace(/\s+/g, ' ')}]`;
    const programs = () => (renderer.info.programs ?? []).map(programName);

    // The presentation's calls, timed: [name, start, ms]
    const calls: [string, number, number][] = [];
    const wrap = (owner: Record<string, unknown> | undefined, label: string, methods: string[]) => {
      if (!owner) return;
      for (const m of methods) {
        const fn = owner[m] as ((...a: unknown[]) => unknown) | undefined;
        if (typeof fn !== 'function') continue;
        const name = `${label}.${m}`;
        const keep = trace.includes(name);
        owner[m] = function (this: unknown, ...args: unknown[]) {
          const s = performance.now();
          try {
            return fn.apply(this, args);
          } finally {
            calls.push([keep ? `${name}(${JSON.stringify(args).slice(0, 80)})` : name, s, performance.now() - s]);
          }
        };
      }
    };
    if (close) {
      const siege = host['siege'] as { shot: (...a: unknown[]) => void };
      const shot = siege.shot;
      let moved = false;
      siege.shot = function (this: unknown, ...args: unknown[]) {
        if (!moved) {
          moved = true;
          interface V { x: number; y: number; z: number; set(x: number, y: number, z: number): V }
          const v = (): V => ({ x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } });
          const sync = engine['sync'] as { geoToLocalSimpleInto(lat: number, lon: number, h: number, out: V): V };
          const enemy = (host['siege'] as { source: { enemy(id: string): { position: { lat: number; lon: number; height?: number } } | null } }).source.enemy(args[0] as string);
          const to = sync.geoToLocalSimpleInto(args[1] as number, args[2] as number, args[3] as number, v());
          const p = enemy?.position;
          const from = p ? sync.geoToLocalSimpleInto(p.lat, p.lon, p.height ?? 0, v()) : to;
          const dx = from.x - to.x;
          const dz = from.z - to.z;
          const len = Math.hypot(dx, dz) || 1;
          const rig = engine['cameraRig'] as { setLocalPosition(...a: number[]): void };
          rig.setLocalPosition(from.x + (dx / len) * 45, from.y + 28, from.z + (dz / len) * 45, to.x, to.y, to.z);
        }
        return shot.apply(this, args);
      };
    }
    wrap(host['siege'] as Record<string, unknown>, 'siege', ['shot', 'impact']);
    wrap(host['worldDamage'] as Record<string, unknown>, 'worldDamage', ['setStage', 'setStages', 'fell', 'dig', 'setCraters']);
    wrap(engine['effects'] as Record<string, unknown>, 'effects', ['spawnExplosion', 'spawnGroundDust', 'spawnBurstAtGeo', 'spawnMuzzleFlash']);
    wrap(engine['siegeShells'] as Record<string, unknown>, 'shells', ['fire', 'land', 'update']);
    wrap(engine['shotLights'] as Record<string, unknown>, 'lights', ['pulse']);
    wrap(host['gameSounds'] as Record<string, unknown>, 'sounds', ['playAt', 'play']);
    wrap(engine['spatialAudio'] as Record<string, unknown>, 'audio', ['playAt', 'load', 'preload']);
    // Every method of an object's class (no getters)
    const methodsOf = (o: object | undefined) => {
      const proto = o ? Object.getPrototypeOf(o) : null;
      if (!proto) return [];
      return Object.entries(Object.getOwnPropertyDescriptors(proto)).filter(([n, d]) => n !== 'constructor' && typeof d.value === 'function').map(([n]) => n);
    };
    const world = engine['world'] as { destruction?: Record<string, unknown> } | undefined;
    const destruction = world?.destruction;
    wrap(destruction, 'destruction', methodsOf(destruction));
    const surface = (world as Record<string, unknown> | undefined)?.['surface'] as Record<string, unknown> | undefined;
    wrap(surface, 'surface', methodsOf(surface));
    wrap(world as Record<string, unknown> | undefined, 'world', methodsOf(world));
    const ground = destruction?.['ground'] as Record<string, unknown> | undefined;
    wrap(ground, 'ground', methodsOf(ground));
    // The map's view and its layers: what a fall and a crater rebuild
    const view = (globalThis as unknown as { __mapProbe?: Record<string, unknown> }).__mapProbe;
    if (view && typeof view === 'object') {
      for (const part of ['terrain', 'objects', 'environment', 'cover', 'impactMarks', 'flyingDebris', 'rubblePieces', 'decals', 'effects', 'bridges']) {
        const o = view[part] as Record<string, unknown> | undefined;
        if (o && typeof o === 'object') wrap(o, `view.${part}`, methodsOf(o));
      }
      wrap(view, 'view', methodsOf(view));
      const baker = ((view['terrain'] as Record<string, unknown> | undefined)?.['occlusion'] as { baker?: { worker?: unknown } } | undefined)?.baker;
      console.log(`DBG ground baker ${baker ? (baker.worker ? 'in a worker' : 'on this thread') : 'none'}`);
      const terrain = view['terrain'] as Record<string, unknown> | undefined;
      for (const part of ['occlusion', 'farShadow', 'chunks', 'heightTexture', 'normals']) {
        const o = terrain?.[part] as Record<string, unknown> | undefined;
        if (o && typeof o === 'object') wrap(o, `terrain.${part}`, methodsOf(o));
      }
    }
    wrap(renderer as unknown as Record<string, unknown>, 'renderer', ['render', 'compile', 'compileAsync', 'initTexture']);
    // The slowest draw calls: [start, ms, what]
    const draws: [number, number, string][] = [];
    const direct = (renderer as unknown as { renderBufferDirect: (...a: unknown[]) => void }).renderBufferDirect;
    (renderer as unknown as { renderBufferDirect: (...a: unknown[]) => void }).renderBufferDirect = function (this: unknown, ...args: unknown[]) {
      const s = performance.now();
      direct.apply(this, args);
      const d = performance.now() - s;
      if (d > 3) {
        const [, , , material, object] = args as [unknown, unknown, unknown, { type: string; name: string }, { name: string; type: string; parent?: { name: string } }];
        draws.push([s, d, `${object.type}:${object.name || object.parent?.name || '?'}/${material.type}:${material.name}`]);
      }
    };

    const gl = renderer as unknown as { getContext(): WebGL2RenderingContext };
    const ctx = gl.getContext();
    const frames: { at: number; gap: number; read: number; gpu: number; tick: number; heap: number; newPrograms: string[]; geometries: number; textures: number }[] = [];
    // The JS heap (Chromium's performance.memory): a drop between two frames is a collection in between
    const heap = () => ((performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0) / 1048576;
    // GPU time of each frame: a timer query from one probe callback to the next spans the engine's frame between
    const timer = ctx.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
    const queries: [WebGLQuery, number][] = [];
    let open: WebGLQuery | null = null;
    const pollQueries = () => {
      while (queries.length && ctx.getQueryParameter(queries[0][0], ctx.QUERY_RESULT_AVAILABLE)) {
        const [q, index] = queries.shift()!;
        if (!ctx.getParameter(timer!.GPU_DISJOINT_EXT) && frames[index]) frames[index].gpu = ctx.getQueryParameter(q, ctx.QUERY_RESULT) / 1e6;
        ctx.deleteQuery(q);
      }
    };
    let known = programs();
    const keysBefore = new Set((renderer.info.programs ?? []).map((p) => p.cacheKey));
    const depthBefore = [...keysBefore].filter((k) => k.startsWith('depth,')).map((k) => k.replace(/\s+/g, ' ').slice(0, 1500));
    let last = performance.now();
    const start = last;
    // The side a crab's front faces (EnemyInstanceManager, crabSide), per enemy: how often it changes, in game time
    interface CrabState { crabSide: number; isDead: boolean }
    const pools = (engine['enemies'] as { instanceManager: { pools: Map<string, { instances: Map<string, CrabState> }> } }).instanceManager.pools;
    const sides = new Map<string, { side: number; switches: number; fromMs: number; toMs: number }>();
    const gameMs = () => component.sim?.mirror.scalars.gameTimeMs ?? 0;
    const watchSides = () => {
      const now = gameMs();
      for (const pool of pools.values()) {
        for (const [id, st] of pool.instances) {
          if (st.crabSide === undefined || st.crabSide === 0 || st.isDead) continue;
          const seen = sides.get(id);
          if (!seen) sides.set(id, { side: st.crabSide, switches: 0, fromMs: now, toMs: now });
          else {
            if (seen.side !== st.crabSide) seen.switches++;
            seen.side = st.crabSide;
            seen.toMs = now;
          }
        }
      }
    };
    if (speed !== 1) (g.__load as unknown as { speed(v: number): void }).speed(speed);
    if (how === 'wave') (component as unknown as { startCustomWave(): void }).startCustomWave();
    else if (how === 'spawn') {
      const path = g.__load.state().paths[0].map(([lat, lon]) => ({ lat, lon }));
      g.__load.emit({ type: 'debug:spawn-enemy', enemyType: enemy, count: 1, path, start: 'portal' });
    }
    await new Promise<void>((resolve) => {
      const frame = () => {
        const now = performance.now();
        if (timer) {
          if (open) {
            ctx.endQuery(timer.TIME_ELAPSED_EXT);
            queries.push([open, frames.length]);
          }
          pollQueries();
          open = ctx.createQuery();
          if (open) ctx.beginQuery(timer.TIME_ELAPSED_EXT, open);
        }
        watchSides();
        const r0 = performance.now();
        if (readBack) ctx.readPixels(0, 0, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, new Uint8Array(4));
        const read = performance.now() - r0;
        const list = programs();
        const left = [...known];
        const added: string[] = [];
        for (const n of list) {
          const k = left.indexOf(n);
          if (k >= 0) left.splice(k, 1);
          else added.push(n);
        }
        known = list;
        frames.push({
          at: last - start, gap: now - last, read, gpu: -1, heap: heap(), tick: component.sim?.mirror.scalars.tickMs ?? 0, newPrograms: added,
          geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures,
        });
        last = now;
        if (now - start < ms) requestAnimationFrame(frame);
        else {
          if (open && timer) ctx.endQuery(timer.TIME_ELAPSED_EXT);
          resolve();
        }
      };
      requestAnimationFrame(frame);
    });
    const gaps = frames.map((f) => f.gap);
    const r = (x: number) => Math.round(x * 10) / 10;
    // Long frames with what ran in them (calls that started in the frame's interval, by their time)
    const long = frames
      .map((f, i) => ({ f, i }))
      .filter(({ f }) => f.gap > longMs || f.read > 16 || f.gpu > longMs || f.newPrograms.length > 0)
      .map(({ f, i }) => {
        const prev = frames[i - 1];
        const from = start + f.at;
        const to = from + f.gap;
        const inside: Record<string, [number, number]> = {};
        for (const [name, s, d] of calls) {
          if (s < from || s > to) continue;
          const e = (inside[name] ??= [0, 0]);
          e[0]++;
          e[1] += d;
        }
        const slow = draws.filter(([s]) => s >= from && s <= to).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([, d, w]) => `${w}=${r(d)}`).join(' ');
        return {
          slow,
          atS: r(f.at / 1000), gapMs: r(f.gap), gpuMs: r(f.gpu), readMs: r(f.read), tickMs: r(f.tick),
          heapMb: r(f.heap - (prev?.heap ?? f.heap)),
          geo: f.geometries - (prev?.geometries ?? f.geometries), tex: f.textures - (prev?.textures ?? f.textures),
          programs: f.newPrograms.join(' '),
          calls: Object.entries(inside).filter(([, [, d]]) => d > 0.5).sort((a, b) => b[1][1] - a[1][1]).map(([n, [c, d]]) => `${n}x${c}=${r(d)}`).join(' '),
        };
      });
    // Each shot and impact, its own cost and the longest frame within 300 ms after it
    const moments = calls
      .filter(([n]) => n === 'siege.shot' || n === 'siege.impact' || n === 'worldDamage.fell' || n === 'worldDamage.setStage')
      .map(([n, s, d]) => {
        const after = frames.filter((f) => start + f.at + f.gap >= s && start + f.at <= s + 300);
        return { what: n, atS: r((s - start) / 1000), ownMs: r(d), worstFrameMs: r(Math.max(0, ...after.map((f) => f.gap))) };
      });
    if (view && typeof view === 'object') {
      const baker = ((view['terrain'] as Record<string, unknown> | undefined)?.['occlusion'] as { baker?: { worker?: unknown } } | undefined)?.baker;
      console.log(`DBG ground baker at the end ${baker ? (baker.worker ? 'in a worker' : 'on this thread') : 'none'}`);
    }
    const traced = calls.filter(([n, , d]) => trace.includes(n.split('(')[0]) && d > 0.05).map(([n, s, d]) => `${n}@${r((s - start) / 1000)}=${r(d)}`);
    const sorted = [...gaps].sort((a, b) => a - b);
    return {
      // For --json: each frame's start in the window, its interval and the heap
      ats: frames.map((f) => f.at),
      gaps,
      heaps: frames.map((f) => f.heap),
      frames: frames.length,
      medianMs: r(sorted[Math.floor(sorted.length / 2)] ?? 0),
      maxGapMs: r(Math.max(0, ...gaps)),
      over33: gaps.filter((x) => x > 33).length,
      over50: gaps.filter((x) => x > 50).length,
      maxReadMs: r(Math.max(0, ...frames.map((f) => f.read))),
      maxGpuMs: r(Math.max(0, ...frames.map((f) => f.gpu))),
      medianGpuMs: r([...frames.map((f) => f.gpu)].filter((x) => x >= 0).sort((a, b) => a - b)[Math.floor(frames.length / 2)] ?? -1),
      maxTickMs: r(Math.max(0, ...frames.map((f) => f.tick))),
      enemies: g.__load.state().enemies,
      moments,
      long,
      traced,
      depthBefore,
      // The programs built in the window, by their keys (what tells them from the ones there were)
      newKeys: (renderer.info.programs ?? []).filter((p) => !keysBefore.has(p.cacheKey)).map((p) => p.cacheKey.replace(/\s+/g, ' ').slice(0, 400)),
      sides: [...sides.values()].map((v) => ({ switches: v.switches, gameS: r((v.toMs - v.fromMs) / 1000), perMinute: r((v.switches * 60_000) / Math.max(1, v.toMs - v.fromMs)) })),
    };
  },
  [ENEMY, WINDOW_MS, LONG_MS, CLOSE, START, TRACE, SPEED, READ] as const,
);
await clicked;
if (CHROME_TRACE) await browser.stopTracing();
// --paints (with --chrome-trace and --trace-paint): what the page painted in the window, by element and area
if (CHROME_TRACE && process.argv.includes('--paints')) {
  const { readFileSync } = await import('node:fs');
  interface Ev { name: string; ph: string; ts: number; dur?: number; args?: { data?: { nodeId?: number; clip?: number[]; layerId?: number } } }
  const raw = JSON.parse(readFileSync(CHROME_TRACE, 'utf8')) as { traceEvents: Ev[] } | Ev[];
  const events = Array.isArray(raw) ? raw : raw.traceEvents;
  const paints = events.filter((e) => e.name === 'Paint' && e.args?.data?.clip);
  const t0 = Math.min(...paints.map((e) => e.ts));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.getDocument', { depth: 0 });
  const names = new Map<number, string>();
  const nameOf = async (id: number | undefined): Promise<string> => {
    if (!id) return '?';
    if (names.has(id)) return names.get(id)!;
    let n = 'gone';
    try {
      const d = (await cdp.send('DOM.describeNode', { backendNodeId: id })) as { node: { localName: string; attributes?: string[] } };
      const a = d.node.attributes ?? [];
      n = `${d.node.localName}${a.includes('class') ? '.' + a[a.indexOf('class') + 1].trim().split(/\s+/).join('.') : ''}`;
    } catch { /* gone */ }
    names.set(id, n);
    return n;
  };
  const by = new Map<string, { n: number; area: number; ms: number; first: number }>();
  for (const e of paints) {
    const c = e.args!.data!.clip!;
    const xs = [c[0], c[2], c[4], c[6]];
    const ys = [c[1], c[3], c[5], c[7]];
    const area = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
    const key = `${await nameOf(e.args!.data!.nodeId)} layer ${e.args!.data!.layerId}`;
    const v = by.get(key) ?? { n: 0, area: 0, ms: 0, first: (e.ts - t0) / 1000 };
    v.n++;
    v.area += area;
    v.ms += (e.dur ?? 0) / 1000;
    by.set(key, v);
  }
  for (const [k, v] of [...by.entries()].sort((a, b) => b[1].area - a[1].area).slice(0, 20)) {
    console.log(`PAINT ${k}: ${v.n}x, ${Math.round(v.area / 1000)}k px, ${v.ms.toFixed(1)} ms, first at ${v.first.toFixed(0)} ms`);
  }
  // The tiles rastered, by layer (RasterTask on the tile workers), in the first 200 ms and after
  const raster = new Map<string, { early: number; late: number; n: number }>();
  for (const e of events) {
    if (e.name !== 'RasterTask' || e.dur === undefined) continue;
    const tile = (e.args as { tileData?: { layerId?: number } } | undefined)?.tileData;
    const key = String(tile?.layerId ?? '?');
    const v = raster.get(key) ?? { early: 0, late: 0, n: 0 };
    if ((e.ts - t0) / 1000 < 200) v.early += e.dur / 1000;
    else v.late += e.dur / 1000;
    v.n++;
    raster.set(key, v);
  }
  for (const [k, v] of [...raster.entries()].sort((a, b) => b[1].early - a[1].early).slice(0, 10)) {
    const l = layersSeen.get(k);
    let node = '';
    if (l?.backendNodeId) node = await nameOf(l.backendNodeId);
    console.log(`RASTER layer ${k} ${node} ${l ? `${Math.round(l.width)}x${Math.round(l.height)}` : ''}: ${v.n} tiles, ${v.early.toFixed(1)} ms in 200 ms, ${v.late.toFixed(1)} ms after`);
  }
}
if (layerCdp) {
  const per = new Map<string, { early: number; late: number; area: number }>();
  for (const p of layerPaints) {
    const e = per.get(p.layerId) ?? { early: 0, late: 0, area: 0 };
    if (p.at < 600) e.early++;
    else e.late++;
    e.area += p.area;
    per.set(p.layerId, e);
  }
  for (const [id, e] of [...per.entries()].sort((a, b) => b[1].area - a[1].area).slice(0, 15)) {
    const l = layersSeen.get(id);
    let node = '?';
    if (l?.backendNodeId) {
      try {
        const d = (await layerCdp.send('DOM.describeNode', { backendNodeId: l.backendNodeId })) as { node: { localName: string; attributes?: string[] } };
        const attrs = d.node.attributes ?? [];
        const cls = attrs[attrs.indexOf('class') + 1];
        node = `${d.node.localName}${attrs.includes('class') ? '.' + cls.split(' ').join('.') : ''}`;
      } catch {
        node = 'gone';
      }
    }
    let reasons: string;
    try {
      const r = (await layerCdp.send('LayerTree.compositingReasons', { layerId: id })) as { compositingReasonIds?: string[] };
      reasons = (r.compositingReasonIds ?? []).join(',');
    } catch {
      reasons = '-';
    }
    const clips = new Map<string, number>();
    for (const p of layerPaints) if (p.layerId === id) clips.set(p.clip, (clips.get(p.clip) ?? 0) + 1);
    const full = layerPaints.filter((p) => p.layerId === id && p.area > 1e6).map((p) => `${p.clip}@${p.at}ms`);
    if (full.length) console.log(`LAYER-BIG ${full.join(' ')}`);
    const top = [...clips.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4).map(([c, n]) => `${c}*${n}`).join(' ');
    console.log(`LAYER ${node} ${l ? `${Math.round(l.width)}x${Math.round(l.height)}` : ''} paints early ${e.early} late ${e.late}, area ${Math.round(e.area / 1000)}k px [${reasons}] clips ${top}`);
  }
}
const { long, moments, traced, sides, newKeys, depthBefore, ats, gaps, heaps, ...summary } = result;
const early = (i: number) => ats[i] < WAVE_START_MS;
report.add(frameWindow('wave start', gaps.filter((_, i) => early(i)), heaps.filter((_, i) => early(i))));
report.add(frameWindow(START === 'wave' ? 'wave' : 'siege', gaps, heaps, { enemies: summary.enemies, maxGpuMs: summary.maxGpuMs, medianGpuMs: summary.medianGpuMs, long }));
await report.write('siege-probe', URL_BASE, vsyncOn(false), { map: MAP, enemy: ENEMY });
if (process.argv.includes('--depth-keys')) for (const key of depthBefore) console.log('DEPTHKEY ' + key);
for (const key of newKeys) console.log('NEWKEY ' + key);
console.log('SIDES ' + JSON.stringify(sides));
if (traced.length) console.log('TRACE ' + traced.join(' '));
console.log('SUMMARY ' + JSON.stringify(summary));
for (const m of moments) console.log('MOMENT ' + JSON.stringify(m));
for (const f of long) console.log('LONG ' + JSON.stringify(f));
if (profiler) console.log(await profiler.stop(Number(argument('lines', '22')), process.argv.includes('--total')));
await (persistent ?? browser).close();
