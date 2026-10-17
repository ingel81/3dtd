// Hitches in a game on a shipped map (TODO E215): how long the picture stands after the first switch of sky, weather
// or fog, and after the first boss on the map. Per case the longest frame interval in the seconds after it, the
// slowest one-pixel read back (it waits for the GPU process, where ANGLE builds a program's shaders on its first
// draw while the page runs on) and the programs three built for it.
//
//   npx ng serve --port <port>   (or node e2e/perf/serve.mjs <dist dir> <port>)
//   node e2e/perf/hitch-probe.ts --url http://localhost:<port> [--map autumn-keep] [--cases night,rain,herbert] [--headed]
import { chromium } from '@playwright/test';
import { FrameProfiler } from './frame-profile.ts';

function argument(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

const URL_BASE = argument('url', 'http://localhost:4200');
const MAP = argument('map', 'autumn-keep');
const SETTLE_MS = Number(argument('settle', '3000'));
const WINDOW_MS = Number(argument('window', '5000'));
// A fixed level: Auto would measure and switch it (and compile) in the middle of a case
const QUALITY = argument('quality', 'high');
const HEADED = process.argv.includes('--headed');

/** What each case does: an environment patch on the map's own, or enemies of a type on the first route */
const CASES: Record<string, { env?: Record<string, unknown>; enemy?: string; wave?: number; vfx?: Record<string, unknown>; level?: string }> = {
  night: { env: { sky: 'night', sunElevation: 30, moonlight: 1 } },
  day: { env: {} },
  dusk: { env: { sky: 'dusk', sunElevation: 8 } },
  overcast: { env: { sky: 'overcast' } },
  rain: { env: { weather: 'rain', weatherStrength: 1 } },
  snow: { env: { weather: 'snow', weatherStrength: 1 } },
  fog: { env: { weather: 'fog', weatherStrength: 1 } },
  storm: { env: { skyImage: 'thunderstorm', sky: 'overcast', weather: 'rain', weatherStrength: 1 } },
  herbert: { enemy: 'herbert' },
  // Bloom and colour grading switched in the display menu: the frames through the composer or not
  bloom: { vfx: { bloom: true, colorGrading: 'none' } },
  grading: { vfx: { bloom: true, colorGrading: 'noir' } },
  plain: { vfx: { bloom: false, colorGrading: 'none' } },
  // A quality level picked (or Auto's answer): the engine and the world switch
  low: { level: 'low' },
  medium: { level: 'medium' },
  high: { level: 'high' },
  ultra: { level: 'ultra' },
  // The run's own boss wave, started with the wave button: Herbert out of the portal, the boss intro's camera cut
  wave10: { wave: 10 },
};
const ORDER = argument('cases', 'herbert,night,day,dusk,rain,snow,fog,storm,day').split(',');

const browser = await chromium.launch({
  headless: !HEADED,
  args: ['--window-size=1600,1000', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('console', (m) => {
  if (/\[Warmup\]|warm-up|Warm-up|DBG/i.test(m.text())) console.log('console', m.text());
});
await page.addInitScript((quality) => {
  localStorage.setItem('td_render_quality_v1', JSON.stringify({ setting: quality, auto: null, overrides: {}, plantMotion: 'full' }));
  localStorage.setItem('td_seen_version', '9999.0.0');
  localStorage.setItem('td_onboarding_v2', JSON.stringify({ done: true, completed: [] }));
  localStorage.setItem('td_globe_quality_v1', '"off"');
  (globalThis as { __mapProbe?: unknown }).__mapProbe = true;
}, QUALITY);
const t0 = Date.now();
await page.goto(`${URL_BASE}/?world=map:${MAP}&menu=skip`);
await page.waitForFunction(() => '__load' in globalThis && typeof (globalThis as { __mapProbe?: unknown }).__mapProbe === 'object', null, { timeout: 300_000 });
await page.waitForSelector('app-quick-actions', { timeout: 300_000 });
console.log(`loaded in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
// The intro flight blocks the boss intro: skipped
for (let i = 0; i < 10; i++) {
  if (!(await page.getByRole('button', { name: /skip intro/i }).count())) break;
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
}
await page.waitForTimeout(SETTLE_MS);

/** Records frames for `ms` after `act` runs in the page; each frame reads a pixel back and times it */
async function measure(name: string): Promise<void> {
  const spec = CASES[name];
  if (spec.wave) {
    await page.evaluate((wave) => (globalThis as unknown as { __load: { emit(c: unknown): void } }).__load.emit({ type: 'debug:jump-to-wave', wave, grantGold: false }), spec.wave);
    await page.waitForTimeout(1500);
  }
  const running = page.evaluate(
    async ([spec, ms]) => {
      interface View { doc: { environment: Record<string, unknown> }; setEnvironment(env: unknown): void }
      const g = globalThis as unknown as {
        __mapProbe: View;
        __mapBase?: Record<string, unknown>;
        __load: { emit(c: unknown): void; state(): { paths: [number, number][][]; enemies: number } };
      };
      const view = g.__mapProbe;
      g.__mapBase ??= { ...view.doc.environment };
      const canvases = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height);
      const gl = canvases[0]?.getContext('webgl2') ?? null;
      const programs = () => {
        interface Ng { getComponent(e: Element): { engine?: { getRenderer(): { info: { programs: unknown[] } } } } }
        const host = document.querySelector('app-tower-defense');
        const ng = (globalThis as { ng?: Ng }).ng;
        return (host && ng?.getComponent(host).engine?.getRenderer().info.programs) || [];
      };
      const names = (list: unknown[]) => list.map((p) => (p as { name: string }).name);
      const before = names(programs());
      const gaps: number[] = [];
      const reads: number[] = [];
      // Frames the engine held back (a quality level's programs compiling): the picture stands
      interface HeldEngine { qualityCompile?: { holding: boolean } }
      const engineHost = document.querySelector('app-tower-defense');
      const held = () => !!engineHost && !!((globalThis as { ng?: { getComponent(e: Element): { engine?: HeldEngine } } }).ng?.getComponent(engineHost).engine?.qualityCompile?.holding);
      let heldMs = 0;
      let last = performance.now();
      const start = last;
      let intro = false;
      if (spec.env) view.setEnvironment({ ...g.__mapBase, ...spec.env });
      if (spec.level) {
        interface Ng { getComponent(e: Element): { engineInit?: { quality: { set(level: string): void } } } }
        const host = document.querySelector('app-tower-defense');
        if (host) (globalThis as { ng?: Ng }).ng?.getComponent(host).engineInit?.quality.set(spec.level);
      }
      if (spec.vfx) {
        interface Ng { getComponent(e: Element): { engine?: { applyVfxSettings(s: unknown): void } } }
        const host = document.querySelector('app-tower-defense');
        const all = { muzzleFlash: true, projectileTrails: true, impactEffects: true, groundMarks: true, freezeTint: true, bloodMoon: true };
        if (host) (globalThis as { ng?: Ng }).ng?.getComponent(host).engine?.applyVfxSettings({ ...all, ...spec.vfx });
      }
      if (spec.enemy) {
        const path = g.__load.state().paths[0].map(([lat, lon]) => ({ lat, lon }));
        g.__load.emit({ type: 'debug:spawn-enemy', enemyType: spec.enemy, count: 1, path, start: 'portal' });
      }
      const actMs = performance.now() - start;
      await new Promise<void>((resolve) => {
        const frame = () => {
          const now = performance.now();
          gaps.push(now - last);
          if (held()) heldMs += now - last;
          intro ||= !!document.querySelector('app-boss-intro .card');
          last = now;
          if (gl) {
            const r0 = performance.now();
            gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
            reads.push(performance.now() - r0);
          }
          if (now - start < ms) requestAnimationFrame(frame);
          else resolve();
        };
        requestAnimationFrame(frame);
      });
      const max = (a: number[]) => Math.round(Math.max(0, ...a));
      return {
        actMs: Math.round(actMs),
        maxGapMs: max(gaps),
        heldMs: Math.round(heldMs),
        over50: gaps.filter((x) => x > 50).length,
        maxReadMs: max(reads),
        frames: gaps.length,
        enemies: g.__load.state().enemies,
        intro,
        newPrograms: (() => {
          const now = names(programs());
          const left = [...before];
          const added: Record<string, number> = {};
          for (const n of now) {
            const k = left.indexOf(n);
            if (k >= 0) left.splice(k, 1);
            else added[n] = (added[n] ?? 0) + 1;
          }
          return added;
        })(),
      };
    },
    [spec, WINDOW_MS] as const,
  );
  if (spec.wave) await page.locator('.td-wave-btn').click();
  const result = await running;
  console.log('RESULT ' + JSON.stringify({ case: name, ...result }));
}

/** The towers in turn, each the first of its type on the map: the longest frame interval while it goes up */
const TOWER_TYPES = argument('towers', '') ? argument('towers', '').split(',') : ['archer', 'dual-gatling', 'cannon', 'magic', 'rocket', 'ice', 'fire', 'tentacle', 'poison', 'lightning', 'chaos', 'bastion', 'sentinel', 'chainsaw', 'shawarma', 'research-center', 'missile-silo'];
async function measureTowers(): Promise<void> {
  const results = await page.evaluate(async ([types, ms]) => {
    interface Load {
      emit(c: unknown): void;
      ping(): Promise<unknown>;
      groundAt(lat: number, lon: number): number | null;
      state(): { paths: [number, number][][]; towers: number };
    }
    const load = (globalThis as unknown as { __load: Load }).__load;
    load.emit({ type: 'debug:add-credits', amount: 10_000_000 });
    load.emit({ type: 'debug:complete-all-research' });
    const spots: { lat: number; lon: number }[] = [];
    for (const distance of [18, 26, 34, 42]) {
      for (const path of load.state().paths) {
        for (let i = 3; i < path.length - 3; i += 3) {
          const [lat, lon] = path[i];
          const [nLat, nLon] = path[i + 1];
          const dLat = nLat - lat;
          const dLon = (nLon - lon) * Math.cos((lat * Math.PI) / 180);
          const len = Math.hypot(dLat, dLon) || 1;
          for (const side of [1, -1]) {
            const off = (distance / 111_320) * side;
            spots.push({ lat: lat - (dLon / len) * off, lon: lon + ((dLat / len) * off) / Math.cos((lat * Math.PI) / 180) });
          }
        }
      }
    }
    interface Ng { getComponent(e: Element): { engine?: { getRenderer(): { info: { programs: { name: string }[] } } } } }
    const host = document.querySelector('app-tower-defense');
    const renderer = host && (globalThis as unknown as { ng?: Ng }).ng?.getComponent(host).engine?.getRenderer();
    // A program without a name goes by the start of its key (its shader)
    const programNames = () => (renderer?.info.programs ?? []).map((p) => p.name || `[${(p as unknown as { cacheKey: string }).cacheKey.slice(0, 40).replace(/\s+/g, ' ')}]`);
    const out: Record<string, unknown> = {};
    let next = 0;
    for (const typeId of types) {
      const before = load.state().towers;
      let placed = false;
      while (!placed && next < spots.length) {
        const spot = spots[next++];
        const height = load.groundAt(spot.lat, spot.lon);
        if (height === null) continue;
        const gaps: number[] = [];
        const known = programNames();
        let last = performance.now();
        const start = last;
        let done = false;
        const frame = () => {
          const now = performance.now();
          gaps.push(now - last);
          last = now;
          if (!done) requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
        load.emit({ type: 'command:place-tower', position: { lat: spot.lat, lon: spot.lon, height }, typeId });
        await load.ping();
        await new Promise((r) => setTimeout(r, 100));
        placed = load.state().towers > before;
        if (placed) await new Promise((r) => setTimeout(r, ms));
        done = true;
        if (placed) {
          const left = [...known];
          const added: string[] = [];
          for (const n of programNames()) {
            const k = left.indexOf(n);
            if (k >= 0) left.splice(k, 1);
            else added.push(n);
          }
          out[`${typeId}#${Object.keys(out).length}`] = { ms: Math.round(Math.max(0, ...gaps)), programs: added.join(' ') };
        }
        void start;
      }
      if (!placed) out[typeId] = 'no spot';
    }
    return out;
  }, [TOWER_TYPES, 2500] as const);
  console.log('RESULT ' + JSON.stringify({ case: 'towers', ...results }));
}

const profiler = process.argv.includes('--profile') ? await FrameProfiler.attach(page, Number(argument('long', '100'))) : null;
await measure('day');
await profiler?.start();
for (const name of ORDER) {
  if (name === 'towers') await measureTowers();
  else await measure(name);
}
if (profiler) console.log(await profiler.stop(Number(argument('lines', '18'))));
// --keys <name>: the cache keys of the programs of a material name (or starting so), to see what tells two apart
const KEYS = argument('keys', '');
if (KEYS) {
  const keys = await page.evaluate((name) => {
    interface Ng { getComponent(e: Element): { engine?: { getRenderer(): { info: { programs: { name: string; cacheKey: string }[] } } } } }
    const host = document.querySelector('app-tower-defense');
    const r = (globalThis as unknown as { ng: Ng }).ng.getComponent(host!).engine!.getRenderer();
    return r.info.programs.filter((p) => p.name === name || p.cacheKey.startsWith(name)).map((p) => p.cacheKey);
  }, KEYS);
  for (const k of keys) console.log('KEY ' + k);
}
await browser.close();
