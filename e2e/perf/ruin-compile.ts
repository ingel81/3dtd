// The ruins' shader programs on a destructible map (TODO E274): how long their compile takes, and the first hit
// on a building just after the game stands.
//
//   --mode compile: once the game stands (and the background is done), every ruin material (the meshes that carry
//     `aDamage`, in the scene or waiting out of it) and its shadow twin compiled anew (a define of their own, so no
//     program comes from a cache) and linked, the link status asked of each, so the time is the whole compile on
//     this GPU; per program and in all
//   --mode hit: --after ms after ready a building is struck (a debug hit of half its HP, so it shows as a ruin with
//     holes at once): the frames of the next 4 s, the longest, those over 33 ms and when; the ruin programs built
//     after the hit (none once the background built them) and each program whose first use took over 8 ms, with
//     the parameters it differs in from its kind's; --cpu: the heaviest call chains of the longest frame
//
//   npx ng serve --port <port>
//   node e2e/perf/ruin-compile.ts --url http://localhost:<port> [--map ruined-city] [--mode compile|hit] [--after 500]
//        [--id o4] [--settle 15000] [--cpu]
import { chromium } from '@playwright/test';

function argument(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

const URL_BASE = argument('url', 'http://localhost:4200');
const MAP = argument('map', 'ruined-city');
const MODE = argument('mode', 'compile');
const AFTER = Number(argument('after', '500'));
const ID = argument('id', 'o4');
const SETTLE = Number(argument('settle', '15000'));
const CPU = process.argv.includes('--cpu');

const browser = await chromium.launch({ headless: false, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1280,800'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('console', (m) => {
  if (/\[Warmup\]|Shader Error/.test(m.text())) console.log('console', m.text().slice(0, 300));
});
await page.addInitScript(() => {
  localStorage.setItem('td_seen_version', '9999.0.0');
  localStorage.setItem('td_onboarding_v2', JSON.stringify({ done: true, completed: [] }));
  localStorage.setItem('td_globe_quality_v1', '"off"');
});
const t0 = Date.now();
await page.goto(`${URL_BASE}/?world=map:${MAP}&menu=skip`);
await page.waitForFunction(() => performance.getEntriesByName('load:ready').length > 0, null, { timeout: 300_000 });
const ready = await page.evaluate(() => performance.getEntriesByName('load:ready')[0].startTime);
console.log(`ready at ${ready.toFixed(0)} ms (${((Date.now() - t0) / 1000).toFixed(1)} s from the link)`);

if (MODE === 'hit') {
  await page.waitForTimeout(AFTER);
  const cdp = CPU ? await page.context().newCDPSession(page) : null;
  if (cdp) {
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
    await cdp.send('Profiler.start');
  }
  const result = await page.evaluate(async ([id]) => {
    const g = globalThis as unknown as {
      __worldDamage: { structures(): { id: string; lat: number; lon: number }[]; hit(lat: number, lon: number, reach: number, amount: number): void; hp(i: number): { max: number } | null };
      ng: { getComponent(e: Element): { engine: { getRenderer(): { info: { programs: { name: string; cacheKey: string; usedTimes: number }[] | null } } } } };
    };
    const renderer = g.ng.getComponent(document.querySelector('app-tower-defense')!).engine.getRenderer();
    const known = new Set(renderer.info.programs ?? []);
    // Each program's first use that took long, with the time after the hit
    const slow: string[] = [];
    const wrapped = new WeakSet<object>();
    interface P { name: string; cacheKey: string; getUniforms: () => unknown; getAttributes: () => unknown }
    const programList = (renderer.info.programs ?? []) as unknown as P[];
    programList.push = function (this: P[], ...items: P[]) {
      const n = Array.prototype.push.apply(this, items);
      wrap();
      return n;
    };
    const wrap = () => {
      for (const p of programList) {
        if (wrapped.has(p)) continue;
        wrapped.add(p);
        for (const k of ['getUniforms', 'getAttributes'] as const) {
          const orig = p[k];
          p[k] = function (this: unknown) {
            const t = performance.now();
            const r = orig.call(this);
            const ms = performance.now() - t;
            if (ms > 8) {
              slow.push(`${(t - t0).toFixed(0)} ms: ${k} ${ms.toFixed(0)} ms ${p.name} ... ${p.cacheKey.slice(-90).replace(/\s+/g, ' ')}`);
              // Against the programs of the same material kind: which parameter made this one new
              for (const o of programList) {
                if (o === p || o.cacheKey.slice(-40) !== p.cacheKey.slice(-40)) continue;
                const a = o.cacheKey.split(',');
                const b = p.cacheKey.split(',');
                const diffs: string[] = [];
                for (let i = 0; i < Math.max(a.length, b.length) && diffs.length < 6; i++) if (a[i] !== b[i]) diffs.push(`#${i}: ${String(a[i]).slice(0, 40)} -> ${String(b[i]).slice(0, 40)}`);
                slow.push(`   beside ${o.name}: ${diffs.join(' | ')}`);
              }
            }
            return r;
          };
        }
      }
    };
    const list = g.__worldDamage.structures();
    const index = list.findIndex((s) => s.id === id);
    const s = list[index];
    const frames: number[] = [];
    const at: number[] = [];
    const t0 = performance.now();
    let last = performance.now();
    let on = true;
    const tick = (now: number) => {
      frames.push(now - last);
      at.push(now - t0);
      last = now;
      if (on) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    g.__worldDamage.hit(s.lat, s.lon, 2, Math.round((g.__worldDamage.hp(index)?.max ?? 1000) / 2));
    await new Promise((r) => setTimeout(r, 4000));
    on = false;
    const fresh = (renderer.info.programs ?? []).filter((p) => !known.has(p) && p.cacheKey.endsWith('-damage')).map((p) => p.name);
    return { frames, at, fresh, slow };
  }, [ID] as const);
  const long = result.frames.map((f, i) => [f, result.at[i]]).filter(([f]) => f > 33);
  console.log(`first hit ${AFTER} ms after ready: ${result.frames.length} frames, longest ${Math.max(...result.frames).toFixed(1)} ms, over 33 ms: ${long.length} [${long.map(([f, t]) => `${f.toFixed(0)} ending ${t.toFixed(0)} ms after the hit`).join(', ')}]`);
  console.log(`ruin programs built after the hit: ${result.fresh.length} ${result.fresh.join(', ')}`);
  for (const f of result.slow) console.log(`  slow first use at ${f}`);
  if (cdp) {
    const { profile } = (await cdp.send('Profiler.stop')) as { profile: { nodes: { id: number; callFrame: { functionName: string; url: string; lineNumber: number } }[]; samples: number[]; timeDeltas: number[]; startTime: number } };
    // Self time per function within the longest frame's window
    const [worst, end] = long.reduce((a, b) => (b[0] > a[0] ? b : a), [0, 0]);
    const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    const parent = new Map<number, number>();
    for (const n of profile.nodes as { id: number; children?: number[] }[]) for (const c of n.children ?? []) parent.set(c, n.id);
    const name = (id: number) => {
      const f = byId.get(id)!.callFrame;
      return `${f.functionName || '(anon)'}:${f.lineNumber}`;
    };
    const self = new Map<string, number>();
    let t = 0;
    // Sample times are relative to the profile start, the frames to the hit (just after the start): close enough
    for (let i = 0; i < profile.samples.length; i++) {
      t += profile.timeDeltas[i] / 1000;
      if (t < end - worst - 50 || t > end + 50) continue;
      const n = byId.get(profile.samples[i])!;
      const chain: string[] = [];
      for (let id: number | undefined = n.id; id !== undefined && chain.length < 9; id = parent.get(id)) chain.push(name(id));
      const key = chain.join(' < ');
      self.set(key, (self.get(key) ?? 0) + profile.timeDeltas[i] / 1000);
    }
    for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${v.toFixed(1)} ms  ${k}`);
  }
} else {
  await page.waitForTimeout(SETTLE);
  const result = await page.evaluate(() => {
    interface M { defines?: Record<string, unknown>; needsUpdate: boolean }
    interface O { isMesh?: boolean; geometry?: { getAttribute(n: string): unknown }; material: M; customDepthMaterial?: M; parent: O | null; traverse(f: (o: O) => void): void }
    const g = globalThis as unknown as { ng: { getComponent(e: Element): { engine: { getRenderer(): Record<string, unknown> }; presentation: { host: { engine: Record<string, unknown> } } } } };
    const component = g.ng.getComponent(document.querySelector('app-tower-defense')!);
    const engine = component.presentation.host.engine;
    const renderer = component.engine.getRenderer() as unknown as {
      compile(o: unknown, c: unknown, s?: unknown): void; getContext(): WebGL2RenderingContext; info: { programs: { program: WebGLProgram }[] | null };
    };
    const scene = engine['scene'] as O;
    const camera = engine['camera'];
    const world = engine['world'] as Record<string, unknown>;
    const view = world['view'] as { parked?: { mesh: O }[] | null } | null;
    const meshes = new Set<O>();
    scene.traverse((o) => { if (o.isMesh && o.geometry?.getAttribute('aDamage')) meshes.add(o); });
    for (const p of view?.parked ?? []) meshes.add(p.mesh);
    const mark = `${Math.random()}`.slice(2, 8);
    const materials = new Set<M>();
    for (const m of meshes) {
      materials.add(m.material);
      if (m.customDepthMaterial) materials.add(m.customDepthMaterial);
    }
    for (const mat of materials) {
      mat.defines = { ...(mat.defines ?? {}), E274_MEASURE: mark };
      mat.needsUpdate = true;
    }
    const gl = renderer.getContext();
    const before = new Set((renderer.info.programs ?? []).map((p) => p.program));
    const t = performance.now();
    for (const m of meshes) renderer.compile(m, camera, scene);
    // The shadow twins as meshes of their own (the depth materials as plain materials: their programs, not the pass's)
    for (const m of meshes) {
      if (!m.customDepthMaterial) continue;
      const twin = Object.assign(Object.create(Object.getPrototypeOf(m)), m, { material: m.customDepthMaterial, parent: null });
      renderer.compile(twin, camera, scene);
    }
    const fresh = (renderer.info.programs ?? []).filter((p) => !before.has(p.program));
    for (const p of fresh) gl.getProgramParameter(p.program, gl.LINK_STATUS);
    const ms = performance.now() - t;
    for (const mat of materials) {
      delete mat.defines!['E274_MEASURE'];
      mat.needsUpdate = true;
    }
    return { meshes: meshes.size, materials: materials.size, programs: fresh.length, ms };
  });
  console.log(`ruins: ${result.meshes} meshes, ${result.materials} materials, ${result.programs} programs compiled and linked in ${result.ms.toFixed(0)} ms (${(result.ms / Math.max(1, result.programs)).toFixed(1)} ms each)`);
}
await browser.close();
