// The towers' line-of-sight cube on a custom map (docs/RENDER_DENSITY_PLAN.md, decision 5): per map a fixed set of
// tower tips around the HQ, each cube rendered from several game camera poses. Prints and writes per pose the cube's
// main-thread time (TowerShadowMapper.update), its GPU time (timer query around the six faces), draw calls and
// triangles, and how many tips read the same cube bytes as from the first pose: a cube that does not depend on the
// game camera reads the same everywhere.
//
//   node e2e/perf/render-density.ts --serve --port 4446      (the production build and the map files, own shell)
//   node e2e/perf/los-cube.ts [--port 4446] [--maps ruined-city] [--own <dir>/<id>.3dtdmap,...] [--range 60]
//        [--tips 24] [--json tmp/los-cube.json] [--quality high] [--shots <dir>]
//
// Poses: `game` over the HQ as one plays (90 m up, 110 m back), `top` the whole map from its south edge, `away` low
// over the map's north edge looking out of it (the tips 1 km and more behind the camera). `--shots`: the first three
// tips' cubes as a cross of their six faces (TowerShadowMapper.getFaceImageData, near dark, far light) per pose.
import { chromium, type Page } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { seedMap, vsyncArgs } from './perf-run.ts';

function argument(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

const ROOT = resolve(import.meta.dirname, '../..');
const PORT = Number(argument('port', '4446'));
const MAPS = argument('maps', 'ruined-city').split(',').filter(Boolean);
const OWN = argument('own', '').split(',').filter(Boolean);
const RANGE = Number(argument('range', '60'));
const TIPS = Number(argument('tips', '24'));
const QUALITY = argument('quality', 'high');
const JSON_OUT = argument('json', join(ROOT, 'tmp/los-cube.json'));
const SHOTS = argument('shots', '');
const BASE = `http://127.0.0.1:${PORT}`;

interface Args { range: number; tips: number; shots: boolean }

/** In the page: the cube for every tip from every pose */
async function measure(args: Args): Promise<unknown> {
  type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const P = (globalThis as Any).__mapPreview;
  const renderer = P.renderer;
  const camera = P.camera;
  const controls = P.controls;
  const view = P.view;
  const mapper = P.losCube();
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const nextFrame = () => new Promise<number>((r) => requestAnimationFrame(r));
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  camera.fov = 60;
  camera.updateProjectionMatrix();
  controls.enableDamping = false;
  const hq = view.doc.hq as { x: number; y: number };
  const half = Math.max(view.doc.terrain?.width ?? 0, view.doc.terrain?.depth ?? 0) / 2 || 600;
  const lift = (x: number, y: number, h: number) => [-x, view.heightAt(x, y) + h, y];
  // Tips on a spiral round the HQ, 20 m to about 400 m out, 6 m over the ground
  const tips: number[][] = [];
  for (let k = 0; k < args.tips; k++) {
    const r = 20 + (380 * k) / Math.max(1, args.tips - 1);
    const a = k * 2.39996;
    const x = Math.max(-half + 10, Math.min(half - 10, hq.x + Math.cos(a) * r));
    const y = Math.max(-half + 10, Math.min(half - 10, hq.y + Math.sin(a) * r));
    tips.push(lift(x, y, 6));
  }
  const poses: Record<string, number[]> = {
    game: [hq.x, hq.y - 110, 90, hq.x, hq.y, 0],
    top: [0, -half * 1.15, half * 0.9, 0, 0, 0],
    away: [hq.x, half - 20, 35, hq.x, half + 600, 0],
  };
  const hash = (faces: readonly Uint8Array[]) => {
    let h = 0x811c9dc5;
    for (const f of faces) for (let i = 0; i < f.length; i += 4) h = Math.imul(h ^ (f[i] | (f[i + 1] << 8) | (f[i + 2] << 16) | (f[i + 3] << 24)), 16777619);
    return (h >>> 0).toString(16);
  };
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? null;
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const out: Record<string, Any> = {};
  let first: Uint8Array[][] | null = null;
  for (const [name, c] of Object.entries(poses)) {
    const eye = lift(c[0], c[1], c[2]);
    const at = lift(c[3], c[4], c[5]);
    camera.position.set(eye[0], eye[1], eye[2]);
    controls.target.set(at[0], at[1], at[2]);
    controls.update();
    // The object layer takes its levels for this pose and its bands settle (lod-fade.ts)
    await wait(3000);
    const cpu: number[] = [];
    const queries: (WebGLQuery | null)[] = [];
    const calls: number[] = [];
    const triangles: number[] = [];
    const faces: Uint8Array[][] = [];
    const crosses: string[] = [];
    for (const [k, t] of tips.entries()) {
      mapper.invalidate();
      renderer.info.autoReset = false;
      renderer.info.reset();
      const q = ext ? gl.createQuery() : null;
      if (q) gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      const t0 = performance.now();
      mapper.update(new camera.position.constructor(t[0], t[1], t[2]), args.range, view.losBlockers);
      cpu.push(performance.now() - t0);
      if (q) gl.endQuery(ext.TIME_ELAPSED_EXT);
      queries.push(q);
      calls.push(renderer.info.render.calls);
      triangles.push(renderer.info.render.triangles);
      renderer.info.autoReset = true;
      faces.push(mapper.readFacesToCpu().map((f: Uint8Array) => f.slice()));
      if (args.shots && k < 3) {
        // +x, -x, +y, -y, +z, -z laid out as a cross, 256 px a face
        const at = [[2, 1], [0, 1], [1, 0], [1, 2], [1, 1], [3, 1]];
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 768;
        const ctx = canvas.getContext('2d')!;
        const face = document.createElement('canvas');
        for (let f = 0; f < 6; f++) {
          const img = mapper.getFaceImageData(f) as ImageData;
          face.width = img.width;
          face.height = img.height;
          face.getContext('2d')!.putImageData(img, 0, 0);
          ctx.drawImage(face, at[f][0] * 256, at[f][1] * 256, 256, 256);
        }
        crosses.push(canvas.toDataURL('image/png'));
      }
      await nextFrame();
    }
    for (let k = 0; k < 10; k++) await nextFrame();
    const gpu: number[] = [];
    for (const q of queries) {
      if (!q) continue;
      if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) && !gl.getParameter(ext.GPU_DISJOINT_EXT)) gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(q);
    }
    // Texels that read otherwise than from the first pose
    let sameTips = 0;
    let differ = 0;
    let texels = 0;
    faces.forEach((f, k) => {
      if (!first) return;
      let d = 0;
      for (let s = 0; s < 6; s++) {
        const a = f[s];
        const b = first[k][s];
        for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) d++;
        texels += a.length / 4;
      }
      if (!d) sameTips++;
      differ += d;
    });
    first ??= faces;
    out[name] = {
      cpuMs: { median: median(cpu), mean: sum(cpu) / cpu.length, max: Math.max(...cpu) },
      gpuMs: gpu.length ? { median: median(gpu), mean: sum(gpu) / gpu.length, max: Math.max(...gpu) } : null,
      calls: { median: median(calls), max: Math.max(...calls) },
      triangles: { median: median(triangles), max: Math.max(...triangles) },
      hashes: faces.map(hash),
      crosses,
      sameAsFirst: name === 'game' ? null : { tips: sameTips, of: tips.length, texelShare: texels ? differ / texels : 0 },
    };
  }
  return out;
}

const GPU_ARGS = process.platform === 'win32' ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--enable-gpu', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ headless: false, args: ['--window-size=1600,1000', ...vsyncArgs(false), ...GPU_ARGS] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const page: Page = await ctx.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message.slice(0, 200)));
await page.addInitScript(() => {
  localStorage.setItem('td_seen_version', '9999.0.0');
  localStorage.setItem('td_onboarding_v2', JSON.stringify({ done: true, completed: [] }));
});
await page.goto(`${BASE}/build-info.json`);
const maps: { id: string; own: boolean }[] = MAPS.map((id) => ({ id, own: false }));
for (const file of OWN) {
  await seedMap(page, file);
  maps.push({ id: basename(file, '.3dtdmap'), own: true });
}
const runs: unknown[] = [];
for (const map of maps) {
  await page.goto(`${BASE}/map-preview?map=${map.id}${map.own ? '&own' : ''}&quality=${QUALITY}&clean`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (globalThis as { __mapPreview?: { isReady(): boolean } }).__mapPreview?.isReady(), null, { timeout: 180_000 });
  await page.waitForTimeout(2000);
  const result = (await page.evaluate(measure, { range: RANGE, tips: TIPS, shots: !!SHOTS })) as Record<string, Record<string, unknown>>;
  for (const [pose, r] of Object.entries(result)) {
    const crosses = (r['crosses'] as string[]) ?? [];
    if (SHOTS && !existsSync(SHOTS)) mkdirSync(SHOTS, { recursive: true });
    crosses.forEach((url, k) => writeFileSync(join(SHOTS, `${map.id}-tip${k}-${pose}.png`), Buffer.from(url.split(',')[1], 'base64')));
    delete r['crosses'];
  }
  runs.push({ map: map.id, quality: QUALITY, range: RANGE, ...result });
  for (const [pose, r] of Object.entries(result)) {
    const f = (v: unknown) => (typeof v === 'number' ? v.toFixed(2) : '-');
    const cpu = r['cpuMs'] as Record<string, number>;
    const gpu = r['gpuMs'] as Record<string, number> | null;
    const same = r['sameAsFirst'] as { tips: number; of: number; texelShare: number } | null;
    console.log(`${map.id} ${pose}: cpu ${f(cpu.median)} / ${f(cpu.max)} ms, gpu ${f(gpu?.median)} / ${f(gpu?.max)} ms, calls ${(r['calls'] as Record<string, number>).median}, tris ${(r['triangles'] as Record<string, number>).median}${same ? `, same as game ${same.tips}/${same.of} (${(same.texelShare * 100).toFixed(3)} % texels differ)` : ''}`);
  }
}
mkdirSync(dirname(JSON_OUT), { recursive: true });
writeFileSync(JSON_OUT, JSON.stringify({ date: new Date().toISOString(), runs }, null, 1));
await browser.close();
console.log(`written ${JSON_OUT}`);
