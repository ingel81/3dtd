// One scene per take (run.mjs --scene a,b): each scene from its own fixed start in a fresh browser, so it can be
// recorded again on its own and the cut picks a take per scene. See README.md, "Takes".
//
//   start   what the scene starts on: { menu: true } (the app's world menu with its globes), { editor: 'fixtures/x.3dtdmap' | '<shipped id>' } (the editor on an own copy),
//           { game: '<shipped id>' | 'fixtures/x.3dtdmap', save?: 'fixtures/x.3dtdsave' } (the game; a map file is
//           stored as an own map first; from a save in the app's own format),
//   net     'fixtures/x.har.zip': outside requests answered from a recorded HAR, every other outside one aborted
//           or none: the scene's own `page` (a fly-over, the programme's scenes that load their page)
//   env     the environment, set before the first frame and checked: window 'WxH', dpr, quality, seed, sky (a
//           MapEnvironment patch: time of day, weather, sky image), camera { eye, look }, ui, routes, los,
//           healthBars, markers (spawn and HQ signs), globe (menu globes 'high'|'low'|'off'), credits (the HUD's sum), floor (camera metres over the
//           ground), sound (whether the take must have sound; default: game scenes)
//
// A take: load, start, environment, the page settled (no requests, the renderer's programs, geometries and
// textures unchanged: grass, shadows and textures in), 1 s still, the sync flash and click, the steps, 1 s still.
// Files in takes/<scene>/<time>/: video.mkv, sound.flac (and sound.wav on the video's time line), marks.json,
// meta.json (commits, fixture hash, environment, duration, the camera's height over ground and water per frame),
// check.json and sheet.jpg (check.mjs); the take's line in takes/<scene>/index.json.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { alignRun, chooseDisplay, duration, keepDisplayOn, recordDisplay, startScreencast } from './capture.mjs';
import { DATA, ROOT, fetchSound, launch, logConsole, logView, pageUrl, verifySteps } from './browser.mjs';
import { checkAndIndex, indexLine } from './check.mjs';
import { recordSlot, waitQuiet } from './quiet.mjs';

/** What a take's environment is when the scene says nothing */
const DEFAULT_ENV = { window: '1600x900', quality: 'ultra', seed: 1, floor: 3 };

/** Seconds the picture stays still before the sync flash and after the last step: room for the cut */
const STILL_S = 1;

/** A fixture is a file (`fixtures/x...`), else a shipped map's id */
const isFile = (spec) => /[\\/]/.test(spec) || /\.[a-z0-9]+$/i.test(spec);

/** A fixture's path: `fixtures/x` in the working folder, a shipped map by its id */
export function fixturePath(spec) {
  if (isFile(spec)) return resolve(DATA, spec);
  return join(ROOT, 'public/maps', `${spec}.3dtdmap`);
}

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

/** The commit of `path` in this checkout and whether it has changes not committed */
function commitOf(path) {
  const git = (...args) => execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' }).trim();
  try {
    return { commit: git('log', '-1', '--format=%h %s', '--', path), dirty: git('status', '--porcelain', '--', path).length > 0 };
  } catch {
    return { commit: null, dirty: null };
  }
}

/** Where a scene starts: the editor, the game or its own page */
function startOf(scene) {
  if (scene.start?.menu) return { kind: 'menu', page: '/' };
  if (scene.start?.editor) return { kind: 'editor', map: scene.start.editor };
  if (scene.start?.game) return { kind: 'game', map: scene.start.game, save: scene.start.save ?? null };
  if (scene.page) return { kind: 'page', page: scene.page };
  throw new Error(`scene ${scene.name} builds on the one before it: give it a start (script.mjs, start) to take it alone`);
}

/** The env's setup as director steps (marks dropped): UI, overlays, sky, the camera's first pose */
function setupSteps(kind, env) {
  const steps = [];
  if (env.ui !== undefined) steps.push({ do: 'ui', on: env.ui });
  if (kind === 'editor') {
    if (env.markers !== undefined) steps.push({ do: 'act', name: 'overlay', on: env.markers });
  } else {
    if (env.markers !== undefined) steps.push({ do: 'markers', on: env.markers });
    if (env.routes !== undefined) steps.push({ do: 'act', name: 'routes', on: env.routes });
    if (env.healthBars !== undefined) steps.push({ do: 'act', name: 'healthBars', on: env.healthBars });
    if (env.los !== undefined) steps.push({ do: 'act', name: 'los', on: env.los });
    // The editor's sky goes into the map before it opens (importMap), the game's onto the view
    if (env.sky) steps.push({ do: 'act', name: 'environment', patch: env.sky });
  }
  if (env.camera) steps.push({ do: 'shot', dur: 0, keys: [env.camera, env.camera] });
  return steps;
}

/** Where the page differs from the env asked for (the take stops there: a start that is not the scene's) */
function differences(kind, env, state, headless) {
  const off = [];
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (headless && env.window && state.window !== env.window) off.push(`window ${state.window}, asked ${env.window}`);
  if (env.dpr && Math.abs(state.dpr - Number(env.dpr)) > 0.01) off.push(`pixel ratio ${state.dpr}, asked ${env.dpr}`);
  if (env.quality && JSON.parse(state.quality ?? '{}').setting !== env.quality) off.push(`quality ${state.quality}, asked ${env.quality}`);
  if (state.floor !== env.floor) off.push(`camera floor ${state.floor}, asked ${env.floor}`);
  for (const key of ['ui', 'markers', ...(kind === 'game' ? ['routes', 'healthBars', 'credits'] : [])]) {
    if (env[key] !== undefined && state[key] !== env[key]) off.push(`${key} ${state[key]}, asked ${env[key]}`);
  }
  for (const [key, value] of Object.entries(env.sky ?? {})) {
    if (!same(state.environment?.[key], value)) off.push(`sky ${key} ${JSON.stringify(state.environment?.[key])}, asked ${JSON.stringify(value)}`);
  }
  return off;
}

/**
 * Until nothing more comes in: no request open for a second, the renderer's programs, geometries and textures
 * unchanged for 1.5 s (grass chunks, shadow maps, textures, shaders), the editor idle. Gives up after
 * `timeoutS` and says what still changed.
 */
async function settle(page, open, timeoutS = 90) {
  const start = Date.now();
  let last = null;
  let since = Date.now();
  let quietSince = Date.now();
  for (;;) {
    const now = Date.now();
    const state = await page.evaluate(() => ({ renderer: window.__showreel.take.renderer(), busy: window.__showreel.take.state().busy ?? null }));
    const sig = `${state.renderer}|${state.busy}`;
    if (sig !== last) {
      last = sig;
      since = now;
    }
    if (open.size) quietSince = now;
    if (now - since >= 1500 && now - quietSince >= 1000 && !state.busy) return { ok: true, seconds: +((now - start) / 1000).toFixed(1), renderer: state.renderer };
    if (now - start > timeoutS * 1000) {
      console.log(`  not settled after ${timeoutS} s: renderer ${state.renderer}, ${open.size} requests open, busy ${state.busy}`);
      return { ok: false, seconds: timeoutS, renderer: state.renderer, open: [...open].slice(0, 5), busy: state.busy };
    }
    await page.waitForTimeout(250);
  }
}

/** One take of `scene`: its folder, or null for a rehearsal */
async function recordTake(scene, opts) {
  const env = { ...DEFAULT_ENV, ...(scene.env ?? {}) };
  const start = startOf(scene);
  const takes = opts.takes ? resolve(opts.takes) : join(DATA, 'takes');
  const id = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const recording = !opts.rehearse && !opts.verify;
  const out = join(takes, scene.name, id);
  mkdirSync(out, { recursive: true });
  const headless = opts.headless !== null;
  const display = headless ? null : chooseDisplay(opts.display);
  const size = headless ? (opts.headless || env.window).split('x').map(Number) : null;
  console.log(`take ${scene.name} ${id}: ${start.kind} ${start.map ?? start.page}${start.save ? ` from ${start.save}` : ''}, ${headless ? `headless ${size.join('x')}` : display.name}${recording ? '' : ', rehearsal'}`);

  // The file the scene starts from: the editor's map, the game's save (a shipped map's game needs none)
  const fixture = start.kind === 'editor' ? fixturePath(start.map) : start.save ? fixturePath(start.save) : isFile(start.map ?? '') ? fixturePath(start.map) : null;
  if (fixture && !existsSync(fixture)) throw new Error(`no fixture ${fixture} (node tools/showreel/fixtures.mjs makes the generated ones)`);

  // A recording on the display waits its turn: one at a time (run.mjs --record holds the slot for all its
  // scenes); headless work waits while someone records (quiet.mjs)
  const slot = recording && display && !opts.slotHeld ? await recordSlot(`${scene.name} ${id}`) : null;
  if (!display) await waitQuiet(`the take of ${scene.name}`);
  const browser = await launch({
    display, size, dpr: opts.dpr || env.dpr || '', quality: opts.quality || env.quality, seed: env.seed,
    globe: env.globe ?? (start.kind === 'menu' ? 'high' : 'off'), dcomp: opts.dcomp, playwrightDir: opts.playwrightDir,
  });
  const { page } = browser;
  const problems = [];
  logConsole(page, problems);
  await page.exposeFunction('__showreelUpload', (sel, file) => page.setInputFiles(sel, file));
  // `net`: the scene's outside requests answered from a recorded HAR (an OSM world without Overpass), the rest
  // of the outside aborted; at the context, so the page's workers are answered too
  if (scene.net) {
    const har = fixturePath(scene.net);
    if (!existsSync(har)) throw new Error(`no HAR ${har}`);
    await browser.context.routeFromHAR(har, { notFound: 'abort', url: /^https?:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/ });
  }
  const open = new Set();
  page.on('request', (r) => {
    // data: and blob: never end as requests do
    if (/^https?:/.test(r.url())) open.add(r);
  });
  page.on('requestfinished', (r) => open.delete(r));
  page.on('requestfailed', (r) => open.delete(r));
  const hook = () => page.waitForFunction(() => !!window.__showreel, null, { timeout: 60_000 });
  const letDisplaySleep = display ? keepDisplayOn() : () => undefined;
  let recorder = null;
  let capture = null;
  const run = { captureStartedAt: null, pages: [], marks: [], problems };
  let failure = null;
  let settled = null;
  let state = null;
  let cameraRows = [];
  try {
    if (recording && display) {
      recorder = await recordDisplay(page, display, join(out, 'video.mkv'), { stamp: id, outputIdx: opts.outputIdx, cq: opts.cq, chroma: opts.chroma });
      capture = recorder.capture;
    }
    // The start: the map stored and opened in the editor, the game on its map (and its save), or the scene's page
    if (start.kind === 'editor') {
      await page.goto(pageUrl(opts.base, '/editor'));
      await hook();
      await page.evaluate(() => window.__showreel.ready(120));
      const mapId = await page.evaluate(([b64, sky]) => window.__showreel.take.importMap(b64, sky), [readFileSync(fixture).toString('base64'), env.sky ?? null]);
      await page.goto(pageUrl(opts.base, `/editor?map=${encodeURIComponent(mapId)}`));
      await hook();
      await page.evaluate(() => window.__showreel.ready(120));
      await page.evaluate(() => window.__showreel.run({ name: 'start', steps: [{ do: 'act', name: 'viewReady', timeout: 120 }] }));
    } else if (start.kind === 'game') {
      // A map file (an own map, e.g. a generated OSM world): stored through the editor first, then played by its id
      let mapId = start.map;
      if (isFile(start.map)) {
        await page.goto(pageUrl(opts.base, '/editor'));
        await hook();
        await page.evaluate(() => window.__showreel.ready(120));
        mapId = await page.evaluate((b64) => window.__showreel.take.importMap(b64), readFileSync(fixturePath(start.map)).toString('base64'));
      }
      await page.goto(pageUrl(opts.base, `/?world=map:${encodeURIComponent(mapId)}`, '', false, true));
      await hook();
      await page.evaluate(() => window.__showreel.ready(180));
      if (start.save) {
        const loaded = await page.evaluate(([b64, name]) => window.__showreel.take.loadSave(b64, name), [readFileSync(fixture).toString('base64'), start.save.split(/[\\/]/).pop()]);
        if (!loaded.ok) throw new Error(`the save did not load: ${loaded.reason}`);
      }
    } else if (start.kind === 'menu') {
      // The app's start as a player sees it: the world menu with its globes (no menu=skip)
      const url = new URL('/', opts.base);
      url.searchParams.set('showreel', '');
      await page.goto(url.toString());
      await hook();
      await page.evaluate(() => window.__showreel.ready(120));
    } else {
      await page.goto(pageUrl(opts.base, scene.page, '', false, !!scene.noIntro, !!scene.clean));
      await hook();
      await page.evaluate(() => window.__showreel.ready(180));
    }
    if (recorder) await recorder.onScreen();
    const kind = await page.evaluate(() => window.__showreel.ready(60));
    // The environment, then the page checked against it
    await page.evaluate((m) => window.__showreel.take.floor(m), env.floor);
    await page.evaluate((s) => window.__showreel.run(s), { name: 'start', steps: setupSteps(kind, env) });
    if (kind === 'game' && env.credits !== undefined) await page.evaluate((v) => window.__showreel.take.setCredits(v), env.credits);
    state = await page.evaluate(() => window.__showreel.take.state());
    const off = differences(kind, env, state, headless);
    if (off.length) throw new Error(`the start is not the scene's: ${off.join('; ')}`);
    settled = await settle(page, open);
    if (!settled.ok) problems.push(`not settled: renderer ${settled.renderer}`);
    const view = await logView(page);

    if (opts.verify) {
      await verifySteps(page, out, scene);
      return null;
    }
    if (recording && headless) {
      capture = await startScreencast(page, join(out, 'video.mkv'));
    }
    const segment = { url: page.url(), kind, view };
    if (recording) segment.audio = await page.evaluate(() => window.__showreel.audio.start());
    await page.evaluate(() => window.__showreel.camera.start());
    if (capture) {
      await capture.started;
      run.captureStartedAt = capture.startedAt;
    }
    // Still, the sync flash (a click into the sound in its first frame), the steps, still
    const now = () => page.evaluate(() => performance.now());
    run.marks.push({ t: await now(), kind: 'mark', scene: scene.name, label: 'head', segment: 0 });
    await page.waitForTimeout(STILL_S * 1000);
    if (recording) {
      segment.syncWall = Date.now();
      segment.sync = await page.evaluate(() => window.__showreel.sync());
    }
    console.log(`scene ${scene.name}`);
    const marks = await page.evaluate((s) => window.__showreel.run(s), { name: scene.name, steps: scene.steps });
    run.marks.push(...marks.map((m) => ({ ...m, segment: 0 })));
    run.marks.push({ t: await now(), kind: 'mark', scene: scene.name, label: 'tail', segment: 0 });
    await page.waitForTimeout(STILL_S * 1000);
    run.marks.push({ t: await now(), kind: 'mark', scene: scene.name, label: 'end', segment: 0 });
    cameraRows = await page.evaluate(() => window.__showreel.camera.stop());
    if (recording) segment.file = await fetchSound(page, join(out, 'sound.webm'));
    run.pages.push(segment);
  } catch (e) {
    failure = e;
    console.error(`take stopped: ${e.message}`);
  } finally {
    letDisplaySleep();
    const stopped = capture ? await capture.stop() : null;
    if (stopped && stopped.code !== 0) console.log(`ffmpeg ended with ${stopped.code}:\n${stopped.log}`);
    writeFileSync(join(out, 'run.json'), JSON.stringify(run, null, 2));
    recorder?.release();
    await browser.close();
    slot?.release();
  }

  const meta = {
    scene: scene.name,
    take: id,
    at: new Date().toISOString(),
    app: commitOf('src'),
    script: commitOf('tools/showreel'),
    start,
    fixture: fixture ? { file: fixture, sha256: sha256(fixture) } : null,
    environment: env,
    state,
    settled,
    capture: capture ? { kind: display ? 'ddagrab' : 'screencast', framesSent: capture.frames ?? null } : null,
    steps: scene.steps,
    problems,
    failure: failure?.message ?? null,
  };
  if (failure || !recording) {
    writeFileSync(join(out, 'meta.json'), JSON.stringify(meta, null, 2));
    if (!recording) writeFileSync(join(out, 'marks.json'), JSON.stringify({ marks: run.marks, problems }, null, 2));
    if (failure) {
      indexLine(join(takes, scene.name), { id, at: meta.at, status: 'red', reasons: [`stopped: ${failure.message}`], warnings: [] });
      throw failure;
    }
    console.log(`rehearsal done: ${out}`);
    return null;
  }

  // Picture and sound lined up (alignRun: the flash in the video, the click in the sound), then the camera log
  // on the video's clock
  const lined = alignRun(out);
  const page0 = lined.pages[0];
  const toVideo = (t) => +(page0.flashAt + (t - page0.sync.t) / 1000).toFixed(3);
  meta.duration = +duration(join(out, 'video.mkv')).toFixed(3);
  meta.camera = {
    floor: env.floor,
    // [video s, eye height, ground, water or null] per frame; x, y and the look in the full rows of camera.json
    frames: cameraRows.map((r) => [toVideo(r[0]), r[3], r[4], r[5]]),
  };
  writeFileSync(join(out, 'camera.json'), JSON.stringify(cameraRows.map((r) => [toVideo(r[0]), ...r.slice(1)])));
  writeFileSync(join(out, 'meta.json'), JSON.stringify(meta, null, 2));
  const verdict = checkAndIndex(out);
  console.log(`take ${scene.name} ${id}: ${verdict.status}${verdict.reasons.length ? ` (${verdict.reasons.join('; ')})` : ''}`);
  return out;
}

/** Takes of the named scenes, one after another; true when one failed */
export async function recordTakes(names, all, opts) {
  let failed = false;
  for (const name of names) {
    const scene = all.find((s) => s.name === name);
    if (!scene) throw new Error(`no scene ${name}`);
    try {
      await recordTake(scene, opts);
    } catch (e) {
      console.error(`${name}: ${e.message}`);
      failed = true;
    }
  }
  return failed;
}
