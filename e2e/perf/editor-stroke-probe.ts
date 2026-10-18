// Frames that stand while a brush is held in the editor: a shipped map opened, then per case a stroke with the real
// pointer (a small circle round the middle of the view), the frame intervals during the stroke and the seconds after
// it (p50, p95, max, the frames over 50 ms), with --profile where each long frame's main-thread time went.
//
//   npx ng build --configuration development --output-path <dir>; node e2e/perf/serve.mjs <dir>/browser <port> --isolate
//   node e2e/perf/editor-stroke-probe.ts --url http://localhost:<port> [--map demo-valley] [--cases raise,paint,biome]
//     [--quality ultra] [--stroke 3.2] [--settle 1500] [--repeat 1] [--profile] [--long 50] [--headed]
import { chromium } from '@playwright/test';
import { FrameProfiler } from './frame-profile.ts';

function argument(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

const URL_BASE = argument('url', 'http://localhost:4200');
const MAP = argument('map', 'demo-valley');
const QUALITY = argument('quality', 'ultra');
const STROKE_S = Number(argument('stroke', '3.2'));
const SETTLE_MS = Number(argument('settle', '1500'));
const REPEAT = Number(argument('repeat', '1'));
const LONG_MS = Number(argument('long', '50'));
const HEADED = process.argv.includes('--headed');

/** Per case: the tool, its mode button and the settings parts patched (as a panel would) */
const CASES: Record<string, { tool: string; mode?: string; patch: Record<string, unknown> }> = {
  raise: { tool: 'terrain', mode: 'raise', patch: { brush: { radius: 90, strength: 1 } } },
  smooth: { tool: 'terrain', mode: 'smooth', patch: { brush: { radius: 60, strength: 1 } } },
  paint: { tool: 'paint', patch: { brush: { radius: 40, strength: 1 }, paint: { layer: 1, erase: false } } },
  biome: { tool: 'landscape', mode: 'biome', patch: { brush: { radius: 60, strength: 1 }, landscape: { biome: 'forest' } } },
  meadow: { tool: 'landscape', mode: 'biome', patch: { brush: { radius: 60, strength: 1 }, landscape: { biome: 'meadow' } } },
  conifer: { tool: 'landscape', mode: 'biome', patch: { brush: { radius: 60, strength: 1 }, landscape: { biome: 'conifer' } } },
  mountain: { tool: 'landscape', mode: 'mountain', patch: { brush: { radius: 80, strength: 1 } } },
  scatter: { tool: 'objects', mode: 'scatter', patch: { brush: { radius: 30, strength: 1 } } },
};
const ORDER = argument('cases', 'raise,paint,biome,mountain').split(',');

const browser = await chromium.launch({
  headless: !HEADED,
  args: ['--window-size=1600,1000', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit'],
});
const [W, H] = argument('size', '1600x900').split('x').map(Number);
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: Number(argument('dpr', '1')) });
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('console', (m) => {
  if (/DBG|STROKE/.test(m.text())) console.log('console', m.text());
});
await page.addInitScript((quality) => {
  localStorage.setItem('td_render_quality_v1', JSON.stringify({ setting: quality, auto: null, overrides: {}, plantMotion: 'full' }));
  localStorage.setItem('td_seen_version', '9999.0.0');
  localStorage.setItem('td_onboarding_v2', JSON.stringify({ done: true, completed: [] }));
  localStorage.setItem('3dtd-editor-tour', 'done');
  // The editor page hands its session here (editor-page.component.ts), with or without `ng`
  (globalThis as { __editorProbe?: unknown }).__editorProbe = true;
}, QUALITY);
// --shaders: per program the first call that waits for its link (the GPU process compiles it then), over 20 ms
if (process.argv.includes('--shaders')) {
  await page.addInitScript(() => {
    const proto = WebGL2RenderingContext.prototype;
    const names = new WeakMap<WebGLProgram, string>();
    const waited = new WeakSet<WebGLProgram>();
    const attach = proto.attachShader;
    const source = new WeakMap<WebGLShader, string>();
    const shaderSource = proto.shaderSource;
    proto.shaderSource = function (shader, src) {
      source.set(shader, src);
      return shaderSource.call(this, shader, src);
    };
    proto.attachShader = function (program, shader) {
      const src = source.get(shader) ?? '';
      const name = /#define SHADER_NAME (\S+)/.exec(src)?.[1] ?? '';
      const defs = (/vec4 linearToOutputTexel/.test(src) && /sRGBTransferOETF\( value \)/.test(src) ? 'SRGB_OUT ' : '') + (src.match(/#define (USE_\w+|\w*INSTANC\w*|DEPTH_PACKING \d|TONE_MAPPING|NUM_\w+ [1-9]\d*)/g) ?? []).map((d) => d.slice(8)).join(' ');
      names.set(program, `${names.get(program) ?? ''}${name}[${src.length}] ${defs} | `);
      return attach.call(this, program, shader);
    };
    for (const fn of ['getProgramParameter', 'getUniformLocation', 'getActiveUniform', 'getProgramInfoLog'] as const) {
      const orig = proto[fn] as (...a: unknown[]) => unknown;
      (proto as unknown as Record<string, unknown>)[fn] = function (this: WebGL2RenderingContext, program: WebGLProgram, ...rest: unknown[]) {
        if (waited.has(program)) return orig.call(this, program, ...rest);
        waited.add(program);
        const t = performance.now();
        const out = orig.call(this, program, ...rest);
        const ms = performance.now() - t;
        if (ms > 20) console.log(`SHADER ${ms.toFixed(0)} ms ${fn} ${names.get(program)}`);
        return out;
      };
    }
  });
  page.on('console', (m) => {
    if (m.text().startsWith('SHADER')) console.log(m.text().slice(0, 400));
  });
}
// --syncs: WebGL calls that waited for the GPU process over 8 ms, with where they came from
if (process.argv.includes('--syncs')) {
  await page.addInitScript(() => {
    const proto = WebGL2RenderingContext.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
    for (const fn of ['getParameter', 'getError', 'readPixels', 'getShaderParameter', 'getExtension', 'clientWaitSync', 'getBufferSubData', 'getSyncParameter', 'getQueryParameter', 'finish', 'checkFramebufferStatus', 'getContextAttributes', 'isContextLost']) {
      const orig = proto[fn];
      if (!orig) continue;
      proto[fn] = function (this: unknown, ...a: unknown[]) {
        const t = performance.now();
        const out = orig.apply(this, a);
        const ms = performance.now() - t;
        if (ms > 8) console.log(`SYNC ${ms.toFixed(0)} ms ${fn}(${String(a[0])}) ${new Error().stack?.split('\n').slice(2, 9).map((l) => l.trim().replace(/^at /, '').replace(/\(?http:\/\/[^/]+\//, '(')).join(' < ')}`);
        return out;
      };
    }
  });
  page.on('console', (m) => {
    if (m.text().startsWith('SYNC')) console.log(m.text().slice(0, 600));
  });
}
const t0 = Date.now();
await page.goto(`${URL_BASE}/editor?map=${encodeURIComponent(MAP)}`);
await page.waitForFunction(
  () => {
    const session = (globalThis as unknown as { __editorProbe?: { view?: { viewShown(): boolean } } }).__editorProbe;
    try {
      return !!session?.view?.viewShown();
    } catch {
      return false;
    }
  },
  null,
  { timeout: 300_000 },
);
console.log(`opened in ${((Date.now() - t0) / 1000).toFixed(1)} s, gpu ${await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2');
  const ext = gl?.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl!.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
})}`);
// The view's warm-ups run in idle moments after it shows
await page.waitForTimeout(Number(argument('warm', '15000')));

// --look x,y (map metres) --dist --yaw --pitch (degrees): the orbit camera's pose, as a scene's
const LOOK = argument('look', '');
if (LOOK) {
  const [x, y] = LOOK.split(',').map(Number);
  await page.evaluate(
    ([x, y, dist, yaw, pitch]) => {
      const session = (globalThis as unknown as { __editorProbe: unknown }).__editorProbe as {
        doc: { terrain: unknown };
        viewHost: { viewport: { controller: { goal: { target: { set(x: number, y: number, z: number): void } }; setGoal(s: unknown): void; snap(): void; saveGoal(): { target: unknown } } } };
      };
      const c = session.viewHost.viewport.controller;
      const g = c.saveGoal() as { target: { set(x: number, y: number, z: number): void } };
      g.target.set(-x, 5, y);
      c.setGoal({ ...g, distance: dist, yaw: (yaw * Math.PI) / 180, pitch: (pitch * Math.PI) / 180 });
      c.snap();
    },
    [x, y, Number(argument('dist', '140')), Number(argument('yaw', '0')), Number(argument('pitch', '35'))],
  );
  await page.waitForTimeout(3000);
}
const canvas = page.locator('app-editor-page canvas').first();
const box = (await canvas.boundingBox())!;
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;
await page.mouse.move(cx, cy);

// --trace <file>: a Chrome trace of the first case's stroke (main thread, GPU process, V8 and GC)
const TRACE = argument('trace', '');
const profiler = process.argv.includes('--profile') ? await FrameProfiler.attach(page, LONG_MS) : null;
const pct = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
const rows: Record<string, unknown>[] = [];
for (const name of ORDER) {
  const c = CASES[name];
  if (!c) throw new Error(`no case ${name}`);
  await page.locator(`[data-tool=${c.tool}]`).click();
  if (c.mode) await page.locator(`[data-mode=${c.mode}]`).click();
  await page.evaluate((patch) => {
    const session = (globalThis as unknown as { __editorProbe: { tools: { settings: Record<string, { (): unknown; set(v: unknown): void }> } } }).__editorProbe;
    const settings = session.tools.settings;
    for (const [key, value] of Object.entries(patch)) settings[key].set({ ...(settings[key]() as object), ...(value as object) });
  }, c.patch);
  await page.mouse.move(cx, cy);
  await page.waitForTimeout(800);
  for (let r = 0; r < REPEAT; r++) {
    await profiler?.start();
    if (TRACE && rows.length === 0) {
      await browser.startTracing(page, {
        path: TRACE,
        categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.frame', 'v8', 'disabled-by-default-v8.gc', 'gpu', 'gpu.service', 'blink', 'toplevel', 'cc', 'viz', 'benchmark'],
      });
    }
    await page.evaluate(() => {
      const w = globalThis as unknown as { __stroke: { gaps: number[]; on: boolean; split: number } };
      const s = { gaps: [] as number[], on: true, split: 0 };
      w.__stroke = s;
      let last = 0;
      const tick = (t: number) => {
        if (!s.on) return;
        if (last) s.gaps.push(t - last);
        last = t;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.mouse.down();
    const start = Date.now();
    // A small circle round the middle: the brush keeps moving as a hand does
    while (Date.now() - start < STROKE_S * 1000) {
      const a = ((Date.now() - start) / 1000) * 2;
      await page.mouse.move(cx + Math.cos(a) * 40, cy + Math.sin(a) * 25);
      await page.waitForTimeout(16);
    }
    await page.evaluate(() => {
      const s = (globalThis as unknown as { __stroke: { gaps: number[]; split: number } }).__stroke;
      s.split = s.gaps.length;
    });
    await page.mouse.up();
    await page.waitForTimeout(SETTLE_MS);
    const { gaps, split } = await page.evaluate(() => {
      const s = (globalThis as unknown as { __stroke: { gaps: number[]; on: boolean; split: number } }).__stroke;
      s.on = false;
      return { gaps: s.gaps, split: s.split };
    });
    const stats = (g: number[]) => {
      const sorted = [...g].sort((a, b) => a - b);
      return { n: g.length, p50: +pct(sorted, 0.5).toFixed(1), p95: +pct(sorted, 0.95).toFixed(1), max: Math.round(sorted.at(-1) ?? 0), over50: g.filter((x) => x > 50).length };
    };
    const row = {
      case: name,
      held: stats(gaps.slice(0, split)),
      after: stats(gaps.slice(split)),
      long: gaps.flatMap((g, k) => (g > LONG_MS ? [`${k < split ? 'h' : 'a'}${k}:${Math.round(g)}`] : [])).join(' '),
    };
    if (TRACE && rows.length === 0) await browser.stopTracing();
    rows.push(row);
    console.log(JSON.stringify(row));
    if (profiler) console.log(await profiler.stop(Number(argument('lines', '22')), process.argv.includes('--total')));
    await page.waitForTimeout(1000);
  }
}
console.log('RESULT ' + JSON.stringify(rows));
await browser.close();
