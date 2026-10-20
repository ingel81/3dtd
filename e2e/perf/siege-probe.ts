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
import { chromium } from '@playwright/test';
import { FrameProfiler } from './frame-profile.ts';

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

const browser = await chromium.launch({
  headless: !HEADED,
  args: ['--window-size=1600,1000', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('pageerror', e.message));
if (process.argv.includes('--reduced-motion')) await page.emulateMedia({ reducedMotion: 'reduce' });
const LOG = new RegExp(argument('log', '\[Warmup\]|warm-up|Warm-up|DBG'), 'i');
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
// --css "<rules>": a style sheet over the game's, to try a change of the UI's look on the frames
if (argument('css', '')) await page.addStyleTag({ content: argument('css', '') });

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

const profiler = process.argv.includes('--profile') ? await FrameProfiler.attach(page, LONG_MS) : null;
await profiler?.start();
if (CHROME_TRACE) {
  await browser.startTracing(page, {
    path: CHROME_TRACE,
    categories: process.argv.includes('--trace-gpu') ? ['devtools.timeline', 'toplevel', 'v8.execute', 'gpu', '__metadata'] : ['devtools.timeline', 'toplevel', 'v8.execute', 'disabled-by-default-v8.gc'],
  });
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
const { long, moments, traced, sides, newKeys, depthBefore, ...summary } = result;
if (process.argv.includes('--depth-keys')) for (const key of depthBefore) console.log('DEPTHKEY ' + key);
for (const key of newKeys) console.log('NEWKEY ' + key);
console.log('SIDES ' + JSON.stringify(sides));
if (traced.length) console.log('TRACE ' + traced.join(' '));
console.log('SUMMARY ' + JSON.stringify(summary));
for (const m of moments) console.log('MOMENT ' + JSON.stringify(m));
for (const f of long) console.log('LONG ' + JSON.stringify(f));
if (profiler) console.log(await profiler.stop(Number(argument('lines', '22')), process.argv.includes('--total')));
await browser.close();
