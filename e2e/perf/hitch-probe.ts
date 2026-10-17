// Hitches in a game on a shipped map (TODO E215): how long the picture stands after the first switch of sky, weather
// or fog, and after the first boss on the map. Per case the longest frame interval in the seconds after it, the
// slowest one-pixel read back (it waits for the GPU process, where ANGLE builds a program's shaders on its first
// draw while the page runs on) and the programs three built for it.
//
//   npx ng serve --port <port>   (or node e2e/perf/serve.mjs <dist dir> <port>)
//   node e2e/perf/hitch-probe.ts --url http://localhost:<port> [--map autumn-keep] [--cases night,rain,herbert] [--headed]
import { chromium } from '@playwright/test';

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
const CASES: Record<string, { env?: Record<string, unknown>; enemy?: string; wave?: number }> = {
  night: { env: { sky: 'night', sunElevation: 30, moonlight: 1 } },
  day: { env: {} },
  dusk: { env: { sky: 'dusk', sunElevation: 8 } },
  overcast: { env: { sky: 'overcast' } },
  rain: { env: { weather: 'rain', weatherStrength: 1 } },
  snow: { env: { weather: 'snow', weatherStrength: 1 } },
  fog: { env: { weather: 'fog', weatherStrength: 1 } },
  storm: { env: { skyImage: 'thunderstorm', sky: 'overcast', weather: 'rain', weatherStrength: 1 } },
  herbert: { enemy: 'herbert' },
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
      let last = performance.now();
      const start = last;
      let intro = false;
      if (spec.env) view.setEnvironment({ ...g.__mapBase, ...spec.env });
      if (spec.enemy) {
        const path = g.__load.state().paths[0].map(([lat, lon]) => ({ lat, lon }));
        g.__load.emit({ type: 'debug:spawn-enemy', enemyType: spec.enemy, count: 1, path, start: 'portal' });
      }
      const actMs = performance.now() - start;
      await new Promise<void>((resolve) => {
        const frame = () => {
          const now = performance.now();
          gaps.push(now - last);
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

await measure('day');
for (const name of ORDER) await measure(name);
const KEYS = argument('keys', '');
if (KEYS) {
  const keys = await page.evaluate((name) => {
    interface Ng { getComponent(e: Element): { engine?: { getRenderer(): { info: { programs: { name: string; cacheKey: string }[] } } } } }
    const host = document.querySelector('app-tower-defense');
    const r = (globalThis as unknown as { ng: Ng }).ng.getComponent(host!).engine!.getRenderer();
    return r.info.programs.filter((p) => p.name === name).map((p) => p.cacheKey);
  }, KEYS);
  for (const k of keys) console.log('KEY ' + k);
}
await browser.close();
