// What the shots' light costs (TODO E242, docs/SHOT_LIGHTS.md): a custom map with many glowing towers firing at
// enemies they cannot kill, the shots' light switched on and off in turns in one tab (`__perf.shotLights`), the GPU
// time of every frame from the engine's timer query (`__perf.gpuFrames`). On a busy machine the absolute numbers
// drift; the pairs in turn and their median difference hold. Run it again on a free machine for the numbers in the doc.
//
//   npx ng build --configuration development --output-path <dir>   (ng.getComponent: the camera is set through it)
//   node e2e/perf/serve.mjs <dir>/browser <port>
//   node e2e/perf/shot-lights.ts --url http://localhost:<port> [--world harbor-town] [--quality high] [--night]
//        [--towers 24] [--mix dual-gatling:3,bastion,rocket,cannon,magic,chaos,fire,lightning] [--enemies 300] [--enemy-speed 0.3]
//        [--rounds 6] [--seconds 4] [--places 4,8,16,32] [--synthetic 32] [--shots <dir>] [--shot-count 3] [--view 110]
//        [--repeat 4] [--pairs 240] [--grid] [--pitch 35] [--focus 0] [--along 0.5] [--hero rune] [--clip <dir>]
//        [--headed] [--uncapped]
//
// --places measures each count of places once more against off (the level's cap set by hand, setMax); --shots
// writes a picture with and without the light (shot-lights-on.png, -off.png) of the measured view.
import { chromium, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { routeSlices, spawnUpTo, startLoadWave, towerSpots, type LoadDriver } from '../../src/app/benchmark/load-scene.ts';

function argument(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

const URL_BASE = argument('url', 'http://localhost:4263');
const WORLD = argument('world', 'harbor-town');
const QUALITY = argument('quality', 'high');
const NIGHT = process.argv.includes('--night');
const TOWERS = Number(argument('towers', '24'));
/** Tower kinds in turn, `kind:weight` repeats a kind */
const MIX = argument('mix', 'dual-gatling:3,bastion,rocket,cannon,magic,chaos,fire,lightning')
  .split(',').flatMap((e) => { const [kind, n] = e.split(':'); return Array<string>(Number(n ?? 1)).fill(kind); });
const ENEMIES = Number(argument('enemies', '300'));
/** Walking speed of the enemies, m/s: slow, so many stay in the towers' range for the whole measurement */
const ENEMY_SPEED = Number(argument('enemy-speed', '0.3'));
const ROUNDS = Number(argument('rounds', '6'));
const SECONDS = Number(argument('seconds', '4'));
const PLACES = argument('places', '').split(',').filter(Boolean).map(Number);
const SHOTS = argument('shots', '');
/** Frames for a clip, with and without the light in turn (`clip-on-0001.jpg` ...), SECONDS each: `--clip <dir>` */
const CLIP = argument('clip', '');
/** Pictures per state with --shots (a flash lasts some 60 ms: several catch it at different moments) */
const SHOT_COUNT = Number(argument('shot-count', '3'));
/**
 * The worst case on top of the scene: this many steady lights more, 12 m apart around the towers' middle, 24 m wide,
 * so every place is taken and each light covers ground in view (0: the scene's own lights only)
 */
const SYNTHETIC = Number(argument('synthetic', '0'));
/** Draws of the scene per timer query in the pairs: more lifts the light's share above the noise of a shared GPU */
const REPEAT = Number(argument('repeat', '4'));
/** Also measure the grid against every light per fragment (the cost the grid saves) */
const GRID = process.argv.includes('--grid');
/** Pairs per measurement, one per frame */
const PAIRS = Number(argument('pairs', '240'));
/** The camera's distance from the towers' middle, m, its angle down, degrees, and the towers it looks at (the first n, 0 all) */
const VIEW = Number(argument('view', '110'));
const PITCH = Number(argument('pitch', '35'));
/** Where along the first route the towers stand, its share from the spawn (0: from the start, the load scene's spots) */
const ALONG = Number(argument('along', '0'));
/** The hero hired, sent to the towers and loaded with this ammo (standard, explosive, rune); none without */
const HERO = argument('hero', '');
const FOCUS = Number(argument('focus', '0'));
const HEADED = process.argv.includes('--headed');
const UNCAPPED = process.argv.includes('--uncapped');
const GPU_ARGS = process.platform === 'win32'
  ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--enable-gpu', '--ignore-gpu-blocklist'];
const FOREGROUND_ARGS = [
  '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-background-timer-throttling',
  '--disable-features=CalculateNativeWinOcclusion',
];

interface Perf {
  shotLights(on?: boolean): { on: boolean; active: boolean; places: number; candidates: number; merged: number; shown: number; updateMs: number } | null;
  gpuFrames(ms: number): Promise<number[]>;
}
interface Load {
  state(): { enemies: number; towers: number; phase: string; gameTimeMs: number; paths: [number, number][][] };
  emit(c: unknown): void;
  ping(): Promise<unknown>;
  groundAt(lat: number, lon: number): number | null;
  speed(v: number): void;
}
interface G { __perf: Perf; __load: Load }

async function gameReady(page: Page): Promise<void> {
  await page.waitForSelector('app-tower-defense', { timeout: 180_000 });
  const end = Date.now() + 300_000;
  let shown = 0;
  while (shown < 4 && Date.now() < end) {
    shown = (await page.locator('app-quick-actions').count()) ? shown + 1 : 0;
    await page.waitForTimeout(500);
  }
  const whatsNew = page.getByRole('button', { name: /^close$/i });
  await whatsNew.first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined);
  if (await whatsNew.count()) await whatsNew.first().click().catch(() => undefined);
  const skip = page.getByRole('button', { name: /skip intro/i });
  await skip.first().waitFor({ state: 'visible', timeout: 30_000 }).catch(() => undefined);
  let quiet = 0;
  for (let i = 0; i < 60 && quiet < 6; i++) {
    if (await skip.count()) {
      quiet = 0;
      await skip.first().click().catch(() => undefined);
    } else {
      quiet++;
    }
    await page.waitForTimeout(500);
  }
  await page.waitForFunction(() => '__load' in globalThis && '__perf' in globalThis, null, { timeout: 60_000 });
  await page.waitForTimeout(1000);
}

const browser = await chromium.launch({
  headless: !HEADED,
  args: [...GPU_ARGS, ...FOREGROUND_ARGS, ...(UNCAPPED ? ['--disable-frame-rate-limit', '--disable-gpu-vsync'] : [])],
});
const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();
await page.addInitScript(() => ((globalThis as { __mapProbe?: unknown }).__mapProbe = true));
page.on('pageerror', (e) => console.log('pageerror', e.message));
// A shader that does not compile shows here (three logs the program's error)
page.on('console', (m) => {
  if (m.type() === 'error' && /WebGLProgram|shader/i.test(m.text())) console.log('shader error', m.text().slice(0, 600));
});
await page.goto(`${URL_BASE}/?world=map:${WORLD}&bot=manual&menu=skip&quality=${QUALITY}`);
await gameReady(page);
const gpu = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2');
  const info = gl?.getExtension('WEBGL_debug_renderer_info');
  return info ? String(gl!.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'unknown';
});
console.log(`GPU ${gpu}, ${WORLD}, quality ${QUALITY}${NIGHT ? ', night' : ''}`);

const driver: LoadDriver = {
  state: () => page.evaluate(() => (globalThis as unknown as G).__load.state()),
  emit: (command) => page.evaluate((c) => (globalThis as unknown as G).__load.emit(c), command),
  groundAt: (lat, lon) => page.evaluate(([a, b]) => (globalThis as unknown as G).__load.groundAt(a, b), [lat, lon]),
  fpsOver: (ms) => page.evaluate((span) => new Promise<number>((resolve) => {
    let frames = 0;
    const start = performance.now();
    const tick = (t: number) => {
      frames++;
      if (t - start < span) requestAnimationFrame(tick);
      else resolve((frames * 1000) / (t - start));
    };
    requestAnimationFrame(tick);
  }), ms),
  wait: (ms) => page.waitForTimeout(ms),
  sync: () => page.evaluate(async () => { await (globalThis as unknown as G).__load.ping(); }),
  log: (line) => console.log(line),
};

// Money and health, the towers along the first route's start in the mix's turn, a wave, enemies that do not die
const start = await driver.state();
await driver.emit({ type: 'debug:add-credits', amount: 10_000_000 });
await driver.emit({ type: 'debug:add-health', amount: 10_000_000 });
// Every tower unlocked (the gatling, the bastion and the rest wait for research)
await driver.emit({ type: 'debug:complete-all-research' });
await driver.sync();
/** Spots beside the first route from ALONG of its length on, both sides, near first */
function spotsAlong(path: [number, number][], along: number): { lat: number; lon: number }[] {
  const out: { lat: number; lon: number }[] = [];
  for (let i = Math.max(1, Math.floor(path.length * along)); i < path.length - 2; i += 2) {
    const p = path[i];
    const next = path[i + 1];
    const cos = Math.cos((p[0] * Math.PI) / 180);
    const dLat = next[0] - p[0];
    const dLon = (next[1] - p[1]) * cos;
    const len = Math.hypot(dLat, dLon) || 1;
    for (const distance of [14, 22]) {
      for (const side of [1, -1]) {
        const off = (distance / 111_320) * side;
        out.push({ lat: p[0] - (dLon / len) * off, lon: p[1] + ((dLat / len) * off) / cos });
      }
    }
  }
  return out;
}
let tried = 0;
for (const spot of ALONG > 0 ? spotsAlong(start.paths[0], ALONG) : towerSpots(start.paths)) {
  if (tried % 8 === 0 && (await driver.state()).towers >= TOWERS) break;
  const height = await driver.groundAt(spot.lat, spot.lon);
  if (height !== null) await driver.emit({ type: 'command:place-tower', position: { lat: spot.lat, lon: spot.lon, height }, typeId: MIX[tried % MIX.length] });
  tried++;
}
await driver.wait(3000);
const placed = await driver.state();
console.log(`towers ${placed.towers} of ${TOWERS}`);
if (HERO) {
  await driver.emit({ type: 'debug:ready-hero' });
  await driver.sync();
  const path = start.paths[0];
  const [lat, lon] = path[Math.floor(path.length * Math.max(ALONG, 0.05)) + 4];
  await driver.emit({ type: 'command:hero-move', target: { lat, lon } });
  await driver.emit({ type: 'command:hero-ammo', ammo: HERO });
}
await startLoadWave(driver);
const slices = routeSlices(start.paths);
await spawnUpTo(driver, slices, ENEMIES, { slice: 0 }, ENEMY_SPEED, 1_000_000_000);

// Built towers fire: the build time at speed 4, then back to 1
await page.evaluate(() => (globalThis as unknown as G).__load.speed(4));
await driver.wait(6000);
await page.evaluate(() => (globalThis as unknown as G).__load.speed(1));

// The camera over the towers, 45 degrees down from VIEW metres (the engine through Angular's dev handle)
await page.evaluate(([night, view, pitch, focus]) => {
  const w = window as unknown as { ng: { getComponent(el: Element | null): { engineInit: { getEngine(): unknown } } } };
  const engine = w.ng.getComponent(document.querySelector('app-tower-defense')).engineInit.getEngine() as {
    towers: { getAllMeshes(): { mesh: { position: { x: number; y: number; z: number } } }[] };
    cameraRig: { setLocalPosition(x: number, y: number, z: number, tx: number, ty: number, tz: number): void };
  };
  const all = engine.towers.getAllMeshes();
  const meshes = focus > 0 ? all.slice(0, focus) : all;
  let x = 0, y = 0, z = 0;
  for (const { mesh } of meshes) {
    x += mesh.position.x;
    y += mesh.position.y;
    z += mesh.position.z;
  }
  const n = Math.max(1, meshes.length);
  x /= n; y /= n; z /= n;
  const across = (view * Math.cos((pitch * Math.PI) / 180)) / Math.SQRT2;
  engine.cameraRig.setLocalPosition(x + across, y + view * Math.sin((pitch * Math.PI) / 180), z + across, x, y, z);
  (globalThis as unknown as { __shotCentre: number[] }).__shotCentre = [x, y, z];
  if (night) {
    const v = (globalThis as unknown as { __mapProbe: { env: object; setEnvironment(e: object): void } }).__mapProbe;
    v.setEnvironment({ ...v.env, sky: 'night', sunElevation: 2 });
  }
}, [NIGHT, VIEW, PITCH, FOCUS] as const);
await driver.wait(4000);

if (SYNTHETIC > 0) {
  await page.evaluate((n) => {
    const w = window as unknown as { ng: { getComponent(el: Element | null): { engineInit: { getEngine(): unknown } } } };
    const engine = w.ng.getComponent(document.querySelector('app-tower-defense')).engineInit.getEngine() as {
      shotLights: { addSource(s: { shotLights(l: { add(x: number, y: number, z: number, look: object): void }): void }): void };
    };
    const [x, y, z] = (globalThis as unknown as { __shotCentre: number[] }).__shotCentre;
    const side = Math.ceil(Math.sqrt(n));
    const look = { color: [1, 0.6, 0.3], intensity: 2, radius: 24 };
    engine.shotLights.addSource({
      shotLights: (l) => {
        for (let k = 0; k < n; k++) l.add(x + ((k % side) - side / 2) * 12, y + 4, z + (Math.floor(k / side) - side / 2) * 12, look);
      },
    });
  }, SYNTHETIC);
}

const setLights = (on: boolean) => page.evaluate((o) => (globalThis as unknown as G).__perf.shotLights(o), on);
const gpuFrames = (ms: number) => page.evaluate((m) => (globalThis as unknown as G).__perf.gpuFrames(m), ms);
const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? (s[Math.floor((s.length - 1) / 2)] + s[Math.ceil((s.length - 1) / 2)]) / 2 : NaN;
};
const p90 = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length * 0.9)] ?? NaN;

/** Pairs in turn (on-off, off-on, ...): the median of each phase's GPU frame times, the median of the pairs' differences */
async function compare(label: string): Promise<void> {
  const on: number[] = [];
  const off: number[] = [];
  const diffs: number[] = [];
  const shown: number[] = [];
  const cpu: number[] = [];
  for (let r = 0; r < ROUNDS; r++) {
    const order = r % 2 === 0 ? [true, false] : [false, true];
    const phase: Record<string, number> = {};
    for (const lit of order) {
      await setLights(lit);
      await driver.wait(300);
      const times = await gpuFrames(SECONDS * 1000);
      const stats = await setLights(lit);
      phase[String(lit)] = median(times);
      (lit ? on : off).push(...times);
      if (lit && stats) {
        shown.push(stats.shown);
        cpu.push(stats.updateMs);
      }
    }
    diffs.push(phase['true'] - phase['false']);
  }
  await setLights(true);
  console.log(`${label}: on ${median(on).toFixed(3)} ms (p90 ${p90(on).toFixed(3)}), off ${median(off).toFixed(3)} ms (p90 ${p90(off).toFixed(3)}), ` +
    `difference ${median(diffs).toFixed(3)} ms (pairs ${diffs.map((d) => d.toFixed(3)).join(', ')}), frames ${on.length}/${off.length}, ` +
    `lights shown ${shown.join('/')}, update ${median(cpu).toFixed(3)} ms main thread`);
}

/**
 * The scene drawn twice in a row in each of FRAMES frames, with the lights and without, the order turning each time,
 * each draw in a timer query of its own: both of a pair see the same load of the machine within a millisecond. The
 * median of the pairs' differences. Draws straight to the canvas, without the post passes (the light is in the
 * materials, the passes cost the same either way). Both draws see the lights of that frame: without them through
 * ShotLights.withoutLights, without the grid (every light in every cell) through withoutGrid.
 */
async function paired(label: string, places: number, grid = false): Promise<void> {
  const result = await page.evaluate(async ([max, frames, repeat, gridOnly]) => {
    const w = window as unknown as { ng: { getComponent(el: Element | null): { engineInit: { getEngine(): unknown } } } };
    const engine = w.ng.getComponent(document.querySelector('app-tower-defense')).engineInit.getEngine() as {
      renderer: { render(s: unknown, c: unknown): void; getContext(): WebGL2RenderingContext };
      getScene(): unknown;
      camera: unknown;
      shotLights: {
        setMax(n: number): void; withoutLights<T>(run: () => T): T; withoutGrid<T>(run: () => T): T;
        places: number; stats: { shown: number };
      };
    };
    const gl = engine.renderer.getContext();
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
    if (!ext) return null;
    const lights = engine.shotLights;
    const before = lights.places;
    lights.setMax(max);
    // The new count of places takes from the next frames on
    for (let f = 0; f < 10; f++) await new Promise((r) => requestAnimationFrame(r));
    const pending: { on: WebGLQuery; off: WebGLQuery }[] = [];
    // `on`: as the frame has it; else without the lights, or with gridOnly every light in every cell
    const draw = (on: boolean): WebGLQuery => {
      const q = gl.createQuery()!;
      const render = () => {
        gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
        for (let k = 0; k < repeat; k++) engine.renderer.render(engine.getScene(), engine.camera);
        gl.endQuery(ext.TIME_ELAPSED_EXT);
      };
      if (on) render();
      else if (gridOnly) lights.withoutGrid(render);
      else lights.withoutLights(render);
      return q;
    };
    let shown = 0;
    for (let f = 0; f < frames; f++) {
      await new Promise((r) => requestAnimationFrame(r));
      if (f % 2 === 0) {
        const on = draw(true);
        shown += lights.stats.shown;
        pending.push({ on, off: draw(false) });
      } else {
        const off = draw(false);
        const on = draw(true);
        shown += lights.stats.shown;
        pending.push({ on, off });
      }
    }
    lights.setMax(before);
    const diffs: number[] = [];
    const ons: number[] = [];
    const offs: number[] = [];
    for (let tries = 0; tries < 400 && pending.length; tries++) {
      await new Promise((r) => setTimeout(r, 20));
      while (pending.length && gl.getQueryParameter(pending[0].off, gl.QUERY_RESULT_AVAILABLE) && gl.getQueryParameter(pending[0].on, gl.QUERY_RESULT_AVAILABLE)) {
        const p = pending.shift()!;
        const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT) as boolean;
        const on = (gl.getQueryParameter(p.on, gl.QUERY_RESULT) as number) / 1e6 / repeat;
        const off = (gl.getQueryParameter(p.off, gl.QUERY_RESULT) as number) / 1e6 / repeat;
        gl.deleteQuery(p.on);
        gl.deleteQuery(p.off);
        if (disjoint) continue;
        ons.push(on);
        offs.push(off);
        diffs.push(on - off);
      }
    }
    return { diffs, ons, offs, shown: shown / frames };
  }, [places, PAIRS, REPEAT, grid] as const);
  if (!result || result.diffs.length === 0) {
    console.log(`${label}: no timer query`);
    return;
  }
  const q = (v: number[], f: number) => [...v].sort((a, b) => a - b)[Math.floor((v.length - 1) * f)];
  console.log(`${label}: draw with ${median(result.ons).toFixed(3)} ms, without ${median(result.offs).toFixed(3)} ms, ` +
    `difference median ${median(result.diffs).toFixed(3)} ms (quartiles ${q(result.diffs, 0.25).toFixed(3)} .. ${q(result.diffs, 0.75).toFixed(3)}), ` +
    `${result.diffs.length} pairs, ${result.shown.toFixed(1)} lights (per draw, ${REPEAT} draws per query)`);
}

const state = await setLights(true);
console.log(`shot lights ${JSON.stringify(state)}`);
await compare(`places ${state?.places ?? '?'} (level), frames in turn`);
await paired(`places ${state?.places ?? '?'} (level), pairs in one frame`, state?.places ?? 16);
for (const places of PLACES) await paired(`places ${places}, pairs in one frame`, places);
// What the grid saves: the same lights, each fragment reading its cell's against all of them
if (GRID) {
  for (const places of PLACES.length ? PLACES.filter((n) => n > 0) : [state?.places ?? 16]) {
    await paired(`places ${places}, grid against every light per fragment`, places, true);
  }
}

// The picture only: the game's interface hidden, the canvas shown
const pictureOnly = () => page.addStyleTag({ content: 'body * { visibility: hidden !important; } canvas { visibility: visible !important; }' });
if (SHOTS || CLIP) await pictureOnly();
if (CLIP) {
  mkdirSync(CLIP, { recursive: true });
  for (const lit of [true, false]) {
    await setLights(lit);
    const end = Date.now() + SECONDS * 1000;
    for (let k = 1; Date.now() < end; k++) {
      await page.screenshot({ path: join(CLIP, `clip-${lit ? 'on' : 'off'}-${String(k).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 88 });
    }
  }
  await setLights(true);
}
if (SHOTS) {
  mkdirSync(SHOTS, { recursive: true });
  for (const lit of [true, false]) {
    await setLights(lit);
    await driver.wait(400);
    for (let k = 0; k < SHOT_COUNT; k++) {
      await page.screenshot({ path: join(SHOTS, `shot-lights-${lit ? 'on' : 'off'}-${k + 1}.png`) });
      await driver.wait(170);
    }
  }
  await setLights(true);
}
await browser.close();
