// The collapse variants side by side (TODO E259, ruin-damage.ts): on a destructible map the same buildings fall in
// each variant from the same side ("Fell now", "Mend", the next variant, "Fell now"), the camera at a game
// distance looking at each. Records each fall as the page paints it (the screencast, each frame with its time) and
// makes a clip of it with ffmpeg, at the frames' own times;
// prints per fall the longest frame and the frames over --long ms, and the programs three built before the first
// fall and after the last (the variants are a uniform: none should come).
//
//   npx ng serve --port <port>
//   node e2e/perf/collapse-probe.ts --url http://localhost:<port> --out <dir> [--map ruined-city]
//        [--ids o4,o1:1:80,o8:auto (id, the side to look from in sixths of a turn or side on to its fall from its left or right, auto or autor, the distance)]
//        [--variants auto,tip,cave-in] [--distance 70] [--up 38] [--headed] [--no-video]
//        [--shots <dir>: a still of each building at stage 2 and fallen, for the floors inside] [--scan <dir>]
//        [--cpu: a CPU profile of each fall's first second] [--list-damage: the ruins' shadow programs and meshes]
//        [--attribs: the programs' attribute slots against the GPU's limit]
//   A baseline (perf-run.ts): --no-vsync (default: the display's rate), --user-data <dir>, --json <file>: each fall's
//   frames (with --no-video: the screencast costs frames)
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FrameReport, USER_DATA, frameWindow, vsyncArgs, vsyncOn } from './perf-run.ts';

function argument(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

const URL_BASE = argument('url', 'http://localhost:4200');
const MAP = argument('map', 'ruined-city');
const OUT = argument('out', 'tmp/collapse-clips');
const IDS = argument('ids', 'o4').split(',');
const VARIANTS = argument('variants', 'auto').split(',');
const DISTANCE = Number(argument('distance', '70'));
const UP = Number(argument('up', '38'));
const SIDE = Number(argument('side', '0.6'));
const LONG_MS = Number(argument('long', '33'));
const FALL_MS = Number(argument('fall', '6500'));
const SHOTS = argument('shots', '');
const VIDEO = !process.argv.includes('--no-video');
const HEADED = process.argv.includes('--headed');
const SIZE = { width: 1280, height: 720 };

mkdirSync(OUT, { recursive: true });
const LAUNCH = { headless: !HEADED, args: ['--enable-gpu', '--ignore-gpu-blocklist', `--window-size=${SIZE.width},${SIZE.height + 80}`, ...vsyncArgs(true)] };
const persistent = USER_DATA ? await chromium.launchPersistentContext(USER_DATA, { ...LAUNCH, viewport: SIZE, deviceScaleFactor: 1 }) : null;
const browser = persistent ? null : await chromium.launch(LAUNCH);
const context = persistent ?? (await browser!.newContext({ viewport: SIZE, deviceScaleFactor: 1 }));
const page = persistent?.pages()[0] ?? (await context.newPage());
const report = new FrameReport();
const cdp = await context.newCDPSession(page);
/** The frames of the clip being recorded: file and the time it was painted (s) */
let frames: { file: string; at: number }[] | null = null;
let frameDir = '';
cdp.on('Page.screencastFrame', (e: { data: string; sessionId: number; metadata: { timestamp?: number } }) => {
  void cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId });
  if (!frames) return;
  const file = join(frameDir, `f${String(frames.length).padStart(5, '0')}.jpg`);
  writeFileSync(file, Buffer.from(e.data, 'base64'));
  frames.push({ file, at: e.metadata.timestamp ?? Date.now() / 1000 });
});
/** Records what the page paints until `stop` comes back, into a clip `name` */
const record = async (name: string): Promise<() => Promise<void>> => {
  if (!VIDEO) return async () => undefined;
  frameDir = join(OUT, `frames-${name}`);
  mkdirSync(frameDir, { recursive: true });
  frames = [];
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: SIZE.width, maxHeight: SIZE.height, everyNthFrame: 1 });
  return async () => {
    await cdp.send('Page.stopScreencast');
    const list = frames!;
    frames = null;
    if (list.length < 2) return;
    // Each frame as long as until the next: the clip runs at the page's own pace
    const lines = ['ffconcat version 1.0'];
    for (let k = 0; k < list.length; k++) {
      lines.push(`file '${list[k].file.replace(/\\/g, '/')}'`);
      lines.push(`duration ${(k + 1 < list.length ? list[k + 1].at - list[k].at : 1 / 30).toFixed(4)}`);
    }
    const concat = join(frameDir, 'list.txt');
    writeFileSync(concat, lines.join('\n'));
    const out = join(OUT, `${name}.mp4`);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', concat, '-r', '30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', out]);
    rmSync(frameDir, { recursive: true, force: true });
    console.log(`clip ${out}`);
  };
};
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('console', (m) => {
  if (m.type() === 'error' || /shader|program/i.test(m.text())) console.log('console', m.type(), m.text().slice(0, 400));
});
await page.addInitScript(() => {
  localStorage.setItem('td_render_quality_v1', JSON.stringify({ setting: 'high', auto: null, overrides: {}, plantMotion: 'full' }));
  localStorage.setItem('td_seen_version', '9999.0.0');
  localStorage.setItem('td_onboarding_v2', JSON.stringify({ done: true, completed: [] }));
  localStorage.setItem('td_globe_quality_v1', '"off"');
});
/** Opens the map (from save `resume`) and waits until it stands, the intro skipped */
const open = async (resume = ''): Promise<void> => {
  await page.goto(`${URL_BASE}/?world=map:${MAP}&menu=skip${resume ? `&resume=${resume}` : ''}`);
  await page.waitForSelector('app-quick-actions', { timeout: 300_000 });
  const skip = page.getByRole('button', { name: /skip intro|intro überspringen/i });
  await skip.waitFor({ timeout: 8000 }).catch(() => undefined);
  for (let i = 0; i < 10 && (await skip.count()); i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(700);
  }
  await page.waitForFunction(() => '__worldDamage' in globalThis, null, { timeout: 60_000 });
  await page.waitForTimeout(3000);
};
await open();
// --continue: the buildings ruined first (the first fallen, the others holed), saved, and the save loaded: the
// ruins stand at the load and its warm-up, as a Continue brings them
if (process.argv.includes('--continue')) {
  await page.evaluate((ids) => {
    const g = globalThis as unknown as { __worldDamage: { structures(): { id: string }[]; setStage(i: number, s: number): void } };
    ids.forEach((id, k) => g.__worldDamage.setStage(g.__worldDamage.structures().findIndex((s) => s.id === id), k ? 2 : 3));
  }, IDS.map((spec) => spec.split(':')[0]));
  await page.waitForTimeout(6000);
  const saved = await page.evaluate(async () => {
    const g = globalThis as unknown as { ng: { getComponent(e: Element): { saveGame: { save(slot: string, name?: string): Promise<{ ok: boolean; reason?: string }> } } } };
    const r = await g.ng.getComponent(document.querySelector('app-tower-defense')!).saveGame.save('slot-5', 'collapse probe');
    return r.ok ? 'ok' : r.reason;
  });
  console.log(`saved with ruins: ${saved}; loading the save`);
  await open('slot-5');
}

/** The page's helpers: the camera on a structure, its stage, the variant, the frames since a mark */
await page.evaluate(() => {
  interface V { x: number; y: number; z: number; set(x: number, y: number, z: number): V }
  const g = globalThis as unknown as {
    ng: { getComponent(e: Element): { presentation: { host: { engine: Record<string, unknown> } }; engine: { getRenderer(): { info: { programs: unknown[] | null } } } } };
    __worldDamage: { structures(): { id: string; lat: number; lon: number; height: number; radius: number }[]; setStage(i: number, s: number): void; collapse?(v?: string): string };
    __probe: unknown;
  };
  const component = g.ng.getComponent(document.querySelector('app-tower-defense')!);
  const engine = component.presentation.host.engine;
  const frames: number[] = [];
  let last = performance.now();
  const tick = (now: number) => {
    frames.push(now - last);
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  g.__probe = {
    index: (id: string) => g.__worldDamage.structures().findIndex((s) => s.id === id),
    look: (id: string, distance: number, up: number, side: number) => {
      const s = g.__worldDamage.structures().find((x) => x.id === id)!;
      const sync = engine['sync'] as { geoToLocalSimpleInto(lat: number, lon: number, h: number, out: V): V };
      const ground = (engine['getTerrainHeightAtGeo'] as (lat: number, lon: number) => number | null).call(engine, s.lat, s.lon) ?? 0;
      const at = sync.geoToLocalSimpleInto(s.lat, s.lon, ground, { x: 0, y: 0, z: 0, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this; } });
      const rig = engine['cameraRig'] as { setLocalPosition(...a: number[]): void };
      const y = at.y;
      rig.setLocalPosition(at.x + distance * Math.cos(side), y + up, at.z + distance * Math.sin(side), at.x, y + s.height * 0.45, at.z);
    },
    stage: (id: string, stage: number) => g.__worldDamage.setStage(g.__worldDamage.structures().findIndex((s) => s.id === id), stage),
    collapse: (v: string) => g.__worldDamage.collapse?.(v) ?? 'tip',
    mark: () => frames.length,
    frames: (from: number) => frames.slice(from),
    programs: () => ((component.engine.getRenderer().info.programs ?? []) as { name: string; cacheKey: string }[]).map((p) => p.name || p.cacheKey),
  };
});

interface Probe {
  index(id: string): number;
  look(id: string, distance: number, up: number, side: number): void;
  stage(id: string, stage: number): void;
  collapse(v: string): string;
  mark(): number;
  frames(from: number): number[];
  programs(): string[];
}
const call = <K extends keyof Probe>(name: K, ...args: Parameters<Probe[K]>): Promise<ReturnType<Probe[K]>> =>
  page.evaluate(([n, a]) => ((globalThis as unknown as { __probe: Record<string, (...x: unknown[]) => unknown> }).__probe[n as string](...(a as unknown[]))), [name, args] as const) as Promise<ReturnType<Probe[K]>>;

const programsBefore = await call('programs');
if (process.argv.includes('--list-damage')) {
  console.log(await page.evaluate(() => {
    interface O { name: string; parent: O | null; visible: boolean; castShadow: boolean; customDepthMaterial?: { customProgramCacheKey(): string; side: number }; material?: { side: number }; traverse(f: (o: O) => void): void }
    const g = globalThis as unknown as { ng: { getComponent(e: Element): { presentation: { host: { engine: { scene: O } } } } } };
    const out: string[] = [];
    g.ng.getComponent(document.querySelector('app-tower-defense')!).presentation.host.engine.scene.traverse((o) => {
      const key = o.customDepthMaterial?.customProgramCacheKey?.() ?? '';
      if (!key.startsWith('damage-depth')) return;
      const chain: string[] = [];
      for (let p: O | null = o.parent; p; p = p.parent) chain.push(p.name || '?');
      out.push(`${key} vis ${o.visible} cast ${o.castShadow} side ${o.material?.side}/${o.customDepthMaterial!.side} in ${chain.join('<')}`);
    });
    return out.join('\n');
  }));
}
if (process.argv.includes('--list-damage')) console.log(`damage programs before: ${programsBefore.filter((p) => p.includes('damage-depth')).map((p) => p.slice(-75)).join(' | ')}`);
for (const spec of IDS) {
  const [id, sixth, far] = spec.split(':');
  let side = sixth && !sixth.startsWith('auto') ? (Number(sixth) * Math.PI) / 3 : SIDE;
  if (sixth?.startsWith('auto')) {
    // Side on to the fall, a little from the front: where it falls from its ruin's impact (map dx, dy; scene -dx, dy)
    await call('stage', id, 2);
    await page.waitForTimeout(1500);
    const hit = await page.evaluate((i) => (globalThis as unknown as { __worldDamage: { structures(): { id: string }[]; impact(n: number): { dx: number; dy: number } | null } }).__worldDamage.impact(
      (globalThis as unknown as { __worldDamage: { structures(): { id: string }[] } }).__worldDamage.structures().findIndex((s) => s.id === i)), id);
    // auto from its left, autor from its right
    if (hit) side = Math.atan2(hit.dy, -hit.dx) + (sixth === 'autor' ? -Math.PI / 2 + 0.4 : Math.PI / 2 - 0.4);
    await call('stage', id, 0);
  }
  const distance = far ? Number(far) : DISTANCE;
  const up = (UP * distance) / DISTANCE;
  if ((await call('index', id)) < 0) {
    console.log(`no structure ${id}`);
    continue;
  }
  // --scan <dir>: the building from six sides first, to find one where nothing stands in front
  if (argument('scan', '')) {
    mkdirSync(argument('scan', ''), { recursive: true });
    for (let k = 0; k < 6; k++) {
      await call('look', id, distance, up, (k * Math.PI) / 3);
      await page.waitForTimeout(600);
      await page.screenshot({ path: join(argument('scan', ''), `${id}-side${k}.png`), clip: { x: 0, y: 48, width: 980, height: 672 } });
    }
  }
  await call('look', id, distance, up, side);
  await call('stage', id, 0);
  // What the camera now sees comes in first (models, their levels)
  await page.waitForTimeout(4000);
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await call('stage', id, 2);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(SHOTS, `${id}-stage2.png`) });
    await call('collapse', 'tip');
    await call('stage', id, 3);
    await page.waitForTimeout(FALL_MS);
    await page.screenshot({ path: join(SHOTS, `${id}-fallen.png`) });
    await call('stage', id, 0);
    await page.waitForTimeout(1500);
  }
  for (const v of VARIANTS) {
    await call('collapse', v);
    await page.waitForTimeout(500);
    const stop = await record(`${id}-${v}`);
    await page.waitForTimeout(300);
    const mark = await call('mark');
    // --cpu: a CPU profile of the first second of the fall, its heaviest functions (self time)
    const profiling = process.argv.includes('--cpu');
    if (profiling) {
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
      await cdp.send('Profiler.start');
    }
    await call('stage', id, 3);
    if (profiling) {
      await page.waitForTimeout(1000);
      const { profile } = (await cdp.send('Profiler.stop')) as { profile: { nodes: { id: number; callFrame: { functionName: string; url: string; lineNumber: number } }[]; samples: number[]; timeDeltas: number[] } };
      const self = new Map<number, number>();
      profile.samples.forEach((n, k) => self.set(n, (self.get(n) ?? 0) + (profile.timeDeltas[k] ?? 0)));
      const byName = new Map<string, number>();
      for (const node of profile.nodes) {
        const f = node.callFrame;
        const key = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber}`;
        byName.set(key, (byName.get(key) ?? 0) + (self.get(node.id) ?? 0) / 1000);
      }
      console.log([...byName].sort((x, y) => y[1] - x[1]).slice(0, 14).map(([k, ms]) => `  ${ms.toFixed(1)} ms ${k}`).join('\n'));
    }
    await page.waitForTimeout(profiling ? FALL_MS - 1000 : FALL_MS);
    const frames = await call('frames', mark);
    const long = frames.filter((f) => f > LONG_MS);
    report.add(frameWindow(`${id} ${v}`, frames));
    console.log(`${id} ${v}: ${frames.length} frames, longest ${Math.max(...frames).toFixed(1)} ms, over ${LONG_MS} ms: ${long.length} [${long.map((f) => f.toFixed(0)).join(' ')}]`);
    await stop();
    await call('stage', id, 0);
    await page.waitForTimeout(1200);
  }
}
// --attribs: the attribute slots of the programs three built (each mat4 four), the most first, against the GPU's limit
if (process.argv.includes('--attribs')) {
  console.log(await page.evaluate(() => {
    interface P { name: string; cacheKey: string; program: WebGLProgram }
    const g = globalThis as unknown as { ng: { getComponent(e: Element): { engine: { getRenderer(): { getContext(): WebGL2RenderingContext; info: { programs: P[] | null } } } } } };
    const renderer = g.ng.getComponent(document.querySelector('app-tower-defense')!).engine.getRenderer();
    const gl = renderer.getContext();
    const rows = (renderer.info.programs ?? []).map((p) => {
      const n = gl.getProgramParameter(p.program, gl.ACTIVE_ATTRIBUTES) as number;
      let used = 0;
      for (let k = 0; k < n; k++) {
        const a = gl.getActiveAttrib(p.program, k)!;
        used += (a.type === gl.FLOAT_MAT4 ? 4 : a.type === gl.FLOAT_MAT3 ? 3 : 1) * a.size;
      }
      return { used, name: p.name || p.cacheKey.slice(-50) };
    });
    rows.sort((x, y) => y.used - x.used);
    return `max attribs ${gl.getParameter(gl.MAX_VERTEX_ATTRIBS)}; most used: ${rows.slice(0, 6).map((r) => `${r.used} ${r.name}`).join(' | ')}`;
  }));
}
const programsAfter = await call('programs');
const added = programsAfter.filter((p) => !programsBefore.includes(p));
if (process.argv.includes('--list-damage')) {
  const wall = (l: string[]) => l.filter((p) => p.includes('damage-depth'));
  const fresh = wall(added)[0];
  for (const old of wall(programsBefore)) {
    if (!fresh) break;
    const x = old.split(',');
    const y = fresh.split(',');
    console.log(`diff warmed/new: ${x.map((v, k) => (v === y[k] ? null : `${k}:${v}/${y[k]}`)).filter(Boolean).join(' ')} (lengths ${x.length}/${y.length})`);
  }
}
console.log(`programs: ${programsBefore.length} before the first fall, ${programsAfter.length} after the last; new: ${added.map((p) => p.slice(-110)).join(' | ')}`);
await report.write('collapse-probe', URL_BASE, vsyncOn(true), { map: MAP });
await context.close();
await browser?.close();

