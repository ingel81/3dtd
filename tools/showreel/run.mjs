// Showreel runner: plays the scenes of script.mjs in a real Chrome on the dev server and records the screen
// (ddagrab, hevc_nvenc) and the game's own sound (the page's `__showreel` hook, a development build only).
// Afterwards it lines the sound up with the picture by the white flash and click at each page's start and
// writes the scene marks in video time. See README.md.
//
//   node tools/showreel/run.mjs --url http://localhost:4200 --out <dir>            the whole programme, recorded
//   node tools/showreel/run.mjs --scene harbor-flyover --rehearse                  one scene, nothing recorded
//   node tools/showreel/run.mjs --from editor-river                                from a scene to the end
//   node tools/showreel/run.mjs --list                                             the scenes and their lengths
//   node tools/showreel/run.mjs --displays                                         the displays Windows has
//
// Options: --display DISPLAY2 (default: the primary), --output-idx N (ddagrab output, default: found by a test
// colour), --dpr 1 (device scale factor), --cq 18, --chroma 420|444, --headless WxH (development: no window,
// no recording; --shots N takes a picture every N seconds), --playwright <dir> (where playwright-core lies, default e2e/node_modules of this checkout or
// of the main checkout).
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { SCENES } from './script.mjs';
import { detectClick, detectFlashes, displays, findOutput, mux, startCapture } from './capture.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const option = (name, fallback) => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 && argv[at + 1] && !argv[at + 1].startsWith('--') ? argv[at + 1] : fallback;
};

/** A test colour the page shows while the runner looks for its display */
const PROBE_COLOUR = [255, 0, 255];

function playwright() {
  const candidates = [option('playwright', ''), join(ROOT, 'e2e/node_modules')];
  try {
    // A worktree has no e2e/node_modules of its own: the main checkout's
    const common = execFileSync('git', ['-C', ROOT, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim();
    candidates.push(join(dirname(common), 'e2e/node_modules'));
  } catch {
    // not a git checkout
  }
  for (const dir of candidates.filter(Boolean)) {
    if (existsSync(join(dir, 'playwright-core'))) return createRequire(join(dir, 'x.js'))('playwright-core');
  }
  throw new Error(`playwright-core not found in ${candidates.join(', ')} (npm install in e2e/, or --playwright <dir>)`);
}

/** The scenes to play: all, --scene a,b, or --from a; each with the page it needs (the last one named before it) */
function chosenScenes() {
  let page = null;
  const withPage = SCENES.map((s) => {
    if (s.page) page = s.page;
    return { ...s, needs: page };
  });
  const only = option('scene', '');
  const from = option('from', '');
  if (only) {
    const names = only.split(',');
    const missing = names.filter((n) => !SCENES.some((s) => s.name === n));
    if (missing.length) throw new Error(`no scene ${missing.join(', ')}`);
    return withPage.filter((s) => names.includes(s.name));
  }
  if (from) {
    const at = withPage.findIndex((s) => s.name === from);
    if (at < 0) throw new Error(`no scene ${from}`);
    return withPage.slice(at);
  }
  return withPage;
}

/** Seconds a scene's steps take by their `dur` (par: the longest), a lower bound: loading and clicks add to it */
function stepSeconds(steps) {
  let total = 0;
  for (const s of steps) {
    if (s.do === 'par') total += Math.max(0, ...s.steps.map((x) => stepSeconds([x])));
    else if (s.do === 'seq') total += stepSeconds(s.steps);
    else total += Number(s.dur ?? 0);
  }
  return total;
}

/** The address of a page: the runner's server, the hook asked for, the game without its start menu */
function pageUrl(base, page, opened) {
  const url = new URL(page === 'opened' ? opened : page, base);
  url.searchParams.set('showreel', '');
  if (!url.pathname.startsWith('/editor')) url.searchParams.set('menu', 'skip');
  return url.toString();
}

async function main() {
  if (flag('displays')) {
    console.table(displays());
    return;
  }
  const scenes = chosenScenes();
  if (flag('list')) {
    for (const s of scenes) console.log(`${s.name.padEnd(28)} ${String(Math.round(stepSeconds(s.steps))).padStart(4)} s  ${s.needs ?? ''}`);
    console.log(`about ${Math.round(scenes.reduce((n, s) => n + stepSeconds(s.steps), 0))} s of steps, plus loading`);
    return;
  }

  const base = option('url', 'http://localhost:4200');
  const headless = option('headless', '');
  const rehearse = flag('rehearse') || !!headless;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const out = resolve(option('out', join(tmpdir(), '3dtd-showreel')), stamp);
  mkdirSync(out, { recursive: true });
  console.log(`showreel: ${scenes.length} scenes from ${base}, ${rehearse ? 'rehearsal' : 'recording'}, files in ${out}`);

  // The window: fullscreen on the chosen display, a fresh profile, sound without a gesture
  const display = headless ? null : (() => {
    const all = displays();
    const name = option('display', '');
    const d = name ? all.find((x) => x.name === name) : all[0];
    if (!d) throw new Error(`no display ${name}; have ${all.map((x) => x.name).join(', ')}`);
    return d;
  })();
  if (display) console.log(`display ${display.name} ${display.width}x${display.height} at ${display.x},${display.y}`);
  const [hw, hh] = headless ? headless.split('x').map(Number) : [0, 0];
  const profile = mkdtempSync(join(tmpdir(), '3dtd-showreel-profile-'));
  const { chromium } = playwright();
  const args = [
    '--autoplay-policy=no-user-gesture-required',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate,MediaRouter',
    '--hide-scrollbars',
    '--ignore-gpu-blocklist',
    '--use-angle=d3d11',
  ];
  const dpr = option('dpr', '');
  if (dpr) args.push(`--force-device-scale-factor=${dpr}`);
  if (display) args.push(`--window-position=${display.x},${display.y}`, `--window-size=${display.width},${display.height}`, '--kiosk');
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chrome',
    headless: !!headless,
    viewport: headless ? { width: hw, height: hh } : null,
    ignoreDefaultArgs: ['--enable-automation'],
    args,
  });
  const page = context.pages()[0] ?? (await context.newPage());
  const problems = [];
  page.on('pageerror', (e) => {
    problems.push(e.message);
    console.log(`  page error: ${e.message.slice(0, 300)}`);
  });
  await context.addInitScript(() => {
    localStorage.setItem('td_seen_version', '9999.0.0');
    localStorage.setItem('td_onboarding_v2', JSON.stringify({ done: true, completed: [] }));
    localStorage.setItem('td_globe_quality_v1', '"off"');
  });

  let capture = null;
  if (!rehearse) {
    // Which ddagrab output shows the window: a solid test colour, one frame of each output
    await page.setContent(`<body style="margin:0;background:rgb(${PROBE_COLOUR.join(',')});cursor:none"></body>`);
    await page.waitForTimeout(1500);
    let index = option('output-idx', '');
    if (index === '') {
      const found = findOutput(PROBE_COLOUR);
      console.log(`outputs: ${found.seen.map((s) => `${s.index}=rgb(${s.colour.join(',')})`).join('  ')}`);
      if (found.index === null) throw new Error('no ddagrab output shows the window; pass --output-idx');
      index = found.index;
    }
    console.log(`recording ddagrab output ${index}`);
    capture = startCapture(Number(index), join(out, 'video.mkv'), { cq: Number(option('cq', 18)), chroma: option('chroma', '420') });
    await capture.started;
  }

  const segments = [];
  const marks = [];
  let segment = null;
  let opened = '';

  /** End the page's sound recording and keep it */
  const closeSegment = async () => {
    if (!segment) return;
    const s = segment;
    segment = null;
    if (rehearse) return;
    await page.evaluate(() => window.__showreel.audio.stop());
    const length = await page.evaluate(() => window.__showreel.audio.length());
    let b64 = '';
    for (let o = 0; o < length; o += 4 << 20) b64 += await page.evaluate(([at, n]) => window.__showreel.audio.piece(at, n), [o, 4 << 20]);
    s.file = join(out, `sound-${String(segments.length).padStart(2, '0')}.webm`);
    writeFileSync(s.file, Buffer.from(b64, 'base64'));
    segments.push(s);
  };

  /** A page of the programme: load it, wait for its map, start its sound, flash */
  const openPage = async (target) => {
    await closeSegment();
    const url = pageUrl(base, target, opened);
    console.log(`page ${url}`);
    await page.goto(url);
    await page.waitForFunction(() => !!window.__showreel, null, { timeout: 60_000 });
    const kind = await page.evaluate(() => window.__showreel.ready(180));
    // Let the first frames settle (shaders, the intro's first moves)
    await page.waitForTimeout(1500);
    segment = { url, kind };
    if (!rehearse) {
      segment.audio = await page.evaluate(() => window.__showreel.audio.start());
      await page.waitForTimeout(300);
      segment.syncWall = Date.now();
      segment.sync = await page.evaluate(() => window.__showreel.sync());
      await page.waitForTimeout(300);
    }
  };

  let current = null;
  try {
    for (const scene of scenes) {
      const target = scene.page ?? (current === null ? scene.needs : null);
      if (target) {
        await openPage(target);
        current = target;
      }
      if (!target && !segment) throw new Error(`scene ${scene.name} has no page to play on`);
      console.log(`scene ${scene.name}`);
      const playing = page.evaluate((s) => window.__showreel.run(s), { name: scene.name, steps: scene.steps });
      // --shots N (development): a picture every N seconds of the scene
      const every = Number(option('shots', 0));
      let shot = 0;
      let done = false;
      const pictures = (async () => {
        if (!every) return;
        mkdirSync(join(out, 'shots'), { recursive: true });
        while (!done) {
          for (let waited = 0; waited < every * 1000 && !done; waited += 100) await new Promise((r) => setTimeout(r, 100));
          if (!done) await page.screenshot({ path: join(out, 'shots', `${scene.name}-${String(shot++).padStart(2, '0')}.png`) }).catch(() => undefined);
        }
      })();
      const run = await playing.finally(() => (done = true));
      await pictures;
      marks.push(...run.map((m) => ({ ...m, segment: segments.length })));
      const list = await page.evaluate(() => window.__showreel.opened.slice());
      if (list.length) opened = list[list.length - 1];
    }
    await closeSegment();
  } finally {
    const stopped = capture ? await capture.stop() : null;
    if (stopped && stopped.code !== 0) console.log(`ffmpeg ended with ${stopped.code}:\n${stopped.log}`);
    await context.close();
    rmSync(profile, { recursive: true, force: true });
  }

  if (rehearse) {
    writeFileSync(join(out, 'marks.json'), JSON.stringify({ marks, problems }, null, 2));
    console.log(`rehearsal done, marks in ${join(out, 'marks.json')}`);
    return;
  }

  // Picture and sound lined up: each page's flash in the video, its click in its sound file
  const video = join(out, 'video.mkv');
  console.log('finding the flashes in the video');
  const flashes = detectFlashes(video);
  const lined = segments.map((s, i) => {
    const expected = (s.syncWall - capture.startedAt) / 1000;
    const flash = flashes.map((f) => ({ ...f, off: Math.abs(f.start - expected) })).sort((a, b) => a.off - b.off)[0];
    const click = detectClick(s.file);
    if (!flash || flash.off > 5) console.log(`  page ${i}: no flash near ${expected.toFixed(2)} s, sound placed by the clock`);
    if (click === null) console.log(`  page ${i}: no click in ${s.file}, sound placed by the clock`);
    const flashAt = flash && flash.off <= 5 ? flash.start : expected;
    // Where the sound file starts on the video's time line: the click lies `click` seconds into it
    const clickAt = click ?? (s.sync.t - s.audio.startedAt) / 1000;
    return { ...s, flashAt, offset: flashAt - clickAt };
  });
  const timed = marks.map((m) => {
    const s = lined[m.segment];
    return { ...m, video: s ? +(s.flashAt + (m.t - s.sync.t) / 1000).toFixed(3) : null };
  });
  writeFileSync(join(out, 'marks.json'), JSON.stringify({ flashes, pages: lined, marks: timed, problems }, null, 2));
  console.log('mixing the preview');
  mux(video, lined.map((s) => ({ file: s.file, offset: s.offset })), join(out, 'sound.wav'), join(out, 'preview.mp4'));
  for (const m of timed.filter((x) => x.kind === 'scene-start' || x.kind === 'step')) {
    console.log(`  ${String(m.video?.toFixed(2)).padStart(8)} s  ${m.kind === 'step' ? '  ' : ''}${m.label}`);
  }
  console.log(`done: ${join(out, 'preview.mp4')}, marks.json, sound.wav, video.mkv`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
