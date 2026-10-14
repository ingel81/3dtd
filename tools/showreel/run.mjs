// Showreel runner: plays the scenes of script.mjs in a real Chrome on the dev server and records the screen
// (ddagrab, hevc_nvenc) and the game's own sound (the page's `__showreel` hook, a development build only).
// Afterwards it lines the sound up with the picture by the white flash and click at each page's start and
// writes the scene marks in video time. See README.md.
//
//   node tools/showreel/run.mjs --url http://localhost:4200 --out <dir>            the whole programme, recorded
//   node tools/showreel/run.mjs --scene harbor-flyover --rehearse                  one scene, nothing recorded
//   node tools/showreel/run.mjs --from editor-river                                from a scene to the end
//   node tools/showreel/run.mjs --finish <run folder>                            align and mix a run that stopped early
//   node tools/showreel/run.mjs --list                                             the scenes and their lengths
//   node tools/showreel/run.mjs --displays                                         the displays Windows has
//
// Options: --display DISPLAY2 (default: the primary), --quality ultra|high (default ultra), --output-idx N (ddagrab output, default: found by a test
// colour), --dpr 1 (device scale factor), --cq 18, --chroma 420|444, --headless WxH (development: no window,
// no recording, --sound records the pages' sound; --shots N takes a picture every N seconds), --check-browser (print Chrome's flags and translate pref), --playwright <dir> (where playwright-core lies, default e2e/node_modules of this checkout or
// of the main checkout).
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { detectClick, detectFlashes, displays, findOutput, mux, raiseWindow, releaseWindow, startCapture, toFlac } from './capture.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// --script <file>: another programme (a probe), default script.mjs beside this file
const ROOT = resolve(HERE, '../..');
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const option = (name, fallback) => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 && argv[at + 1] && !argv[at + 1].startsWith('--') ? argv[at + 1] : fallback;
};

/** Playwright's disabled features (playwright-core chromiumSwitches.js) and Chrome's translate UI */
const DISABLED_FEATURES = [
  'AcceptCHFrame', 'AvoidUnnecessaryBeforeUnloadCheckSync', 'DestroyProfileOnBrowserClose', 'DialMediaRouteProvider',
  'GlobalMediaControls', 'HttpsUpgrades', 'LensOverlay', 'MediaRouter', 'PaintHolding', 'ThirdPartyStoragePartitioning',
  'Translate', 'TranslateUI', 'AutoDeElevate', 'RenderDocument',
];

/** The fresh profile's preferences: no translation, English only */
const PREFERENCES = {
  translate: { enabled: false },
  translate_blocked_languages: ['en', 'de'],
  intl: { accept_languages: 'en-US,en', selected_languages: 'en-US,en' },
};

const scriptAt = process.argv.includes('--script') ? resolve(process.argv[process.argv.indexOf('--script') + 1]) : join(HERE, 'script.mjs');
const { SCENES } = await import(pathToFileURL(scriptAt).href);

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
  const finishing = option('finish', '');
  if (finishing) {
    finish(resolve(finishing));
    return;
  }
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
  // --headless --sound (development): the pages' sound recorded and saved, no screen capture
  const rehearse = flag('rehearse') || (!!headless && !flag('sound'));
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
  // No "Translate this page?" bubble in the picture: off in the profile as well as by feature flag
  mkdirSync(join(profile, 'Default'), { recursive: true });
  writeFileSync(join(profile, 'Default', 'Preferences'), JSON.stringify(PREFERENCES));
  const { chromium } = playwright();
  const args = [
    '--autoplay-policy=no-user-gesture-required',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    '--no-first-run',
    '--no-default-browser-check',
    // Chrome takes the last --disable-features only, and this list comes after Playwright's: it repeats
    // Playwright's own (chromiumSwitches.js) and adds the translate bubble's
    `--disable-features=${DISABLED_FEATURES.join(',')}`,
    '--lang=en-US',
    '--accept-lang=en-US',
    '--hide-scrollbars',
    '--ignore-gpu-blocklist',
    '--use-angle=d3d11',
  ];
  const dpr = option('dpr', '');
  if (dpr && !headless) args.push(`--force-device-scale-factor=${dpr}`);
  // Kiosk fills the display the window opens on; no size given, since Chrome reads it in scaled pixels (125 %)
  if (display) args.push(`--window-position=${display.x},${display.y}`, '--kiosk');
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chrome',
    headless: !!headless,
    viewport: headless ? { width: hw, height: hh } : null,
    // Headless stands in for the display's scaling with --dpr
    ...(headless && dpr ? { deviceScaleFactor: Number(dpr) } : {}),
    ignoreDefaultArgs: ['--enable-automation'],
    args,
  });
  const page = context.pages()[0] ?? (await context.newPage());
  const problems = [];
  // The director's upload step: a local file into a file input
  await page.exposeFunction('__showreelUpload', (sel, file) => page.setInputFiles(sel, file));
  page.on('console', (m) => {
    if (m.text().includes('[showreel]')) console.log(`  ${m.text()}`);
  });
  page.on('pageerror', (e) => {
    problems.push(e.message);
    console.log(`  page error: ${e.message.slice(0, 300)}`);
  });
  // A quality level, not Auto: Auto plays custom maps a level lower (render-quality.ts resolveLevel). High and
  // Ultra cap the pixel ratio at 1.5 and 2 on custom maps, so 125 % Windows scaling renders at 1.25
  const quality = option('quality', 'ultra');
  await context.addInitScript((level) => {
    localStorage.setItem('td_render_quality_v1', JSON.stringify({ setting: level, auto: null }));
    localStorage.setItem('td_seen_version', '9999.0.0');
    localStorage.setItem('td_onboarding_v2', JSON.stringify({ done: true, completed: [] }));
    localStorage.setItem('td_globe_quality_v1', '"off"');
  }, quality);

  if (flag('check-browser')) {
    // The flags Chrome got and the translate pref it holds, without playing anything
    await page.goto('chrome://version');
    console.log(`command line: ${await page.locator('#command_line').innerText()}`);
    await page.goto('chrome://prefs-internals');
    const prefs = JSON.parse(await page.locator('pre').first().innerText());
    console.log(`translate: ${JSON.stringify(prefs.translate)}, intl: ${JSON.stringify(prefs.intl)}`);
    await context.close();
    rmSync(profile, { recursive: true, force: true });
    return;
  }

  let capture = null;
  /** The raised window's handle, topmost while the run lasts */
  let raised = 0;
  if (!rehearse && !headless) {
    // Which ddagrab output shows the window: a solid test colour, one frame of each output
    // A title only this window carries, to find it among the desktop's windows
    const token = `3DTD showreel ${stamp}`;
    await page.setContent(`<title>${token}</title><body style="margin:0;background:rgb(${PROBE_COLOUR.join(',')});cursor:none"></body>`);
    await page.waitForTimeout(1500);
    let index = option('output-idx', '');
    // A new window opens behind the foreground one (Windows' foreground lock, the user's maximised browser):
    // raised and topmost for the run, then the test colour; a few tries
    for (let attempt = 1; attempt <= 4; attempt++) {
      raised = raiseWindow(token) || raised;
      console.log(`window ${raised ? `raised (handle ${raised})` : 'not found'}, try ${attempt}`);
      await page.waitForTimeout(1200);
      if (index !== '') break;
      const found = findOutput(PROBE_COLOUR);
      console.log(`outputs: ${found.seen.map((s) => `${s.index}=rgb(${s.colour.join(',')})`).join('  ')}`);
      if (found.index !== null) {
        index = found.index;
        break;
      }
    }
    if (index === '') throw new Error('no ddagrab output shows the window; pass --output-idx');
    console.log(`recording ddagrab output ${index}`);
    capture = startCapture(Number(index), join(out, 'video.mkv'), { cq: Number(option('cq', 18)), chroma: option('chroma', '420') });
    await capture.started;
  }

  const segments = [];
  const marks = [];
  let segment = null;
  let opened = '';
  /** Everything the alignment needs, written after every page and scene: a crash keeps what was recorded */
  const save = () =>
    writeFileSync(
      join(out, 'run.json'),
      JSON.stringify({ captureStartedAt: capture?.startedAt ?? null, pages: segments, open: segment, marks, problems }, null, 2),
    );

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
    s.file = toFlac(s.file);
    segments.push(s);
    save();
  };

  /** What the page draws at: CSS size, pixel ratio and the largest canvas's drawing buffer and its CSS size */
  const logView = async () => {
    const view = await page.evaluate(() => {
      const canvas = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0];
      return {
        css: `${innerWidth}x${innerHeight}`,
        dpr: devicePixelRatio,
        buffer: canvas ? `${canvas.width}x${canvas.height} for ${canvas.clientWidth}x${canvas.clientHeight} css` : 'no canvas',
      };
    });
    console.log(`  view ${view.css} css, dpr ${view.dpr}, drawing buffer ${view.buffer}`);
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
    await logView();
    segment = { url, kind };
    if (!rehearse) {
      segment.audio = await page.evaluate(() => window.__showreel.audio.start());
      await page.waitForTimeout(300);
      segment.syncWall = Date.now();
      segment.sync = await page.evaluate(() => window.__showreel.sync());
      await page.waitForTimeout(300);
    }
    save();
  };

  let current = null;
  let failure = null;
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
      await logView();
      marks.push(...run.map((m) => ({ ...m, segment: segments.length })));
      save();
      const list = await page.evaluate(() => window.__showreel.opened.slice());
      if (list.length) opened = list[list.length - 1];
    }
    await closeSegment();
  } catch (e) {
    // What was recorded so far still makes a preview: the open page's sound too, if the page still answers
    failure = e;
    console.error(`run stopped: ${e.message}`);
    await closeSegment().catch((err) => console.error(`  the open page's sound is lost: ${err.message.split('\n')[0]}`));
  } finally {
    const stopped = capture ? await capture.stop() : null;
    if (stopped && stopped.code !== 0) console.log(`ffmpeg ended with ${stopped.code}:\n${stopped.log}`);
    save();
    try {
      releaseWindow(raised);
    } catch {
      // the window may be gone already
    }
    await context.close().catch(() => undefined);
    rmSync(profile, { recursive: true, force: true });
  }

  if (rehearse || !capture) {
    writeFileSync(join(out, 'marks.json'), JSON.stringify({ pages: segments, marks, problems }, null, 2));
    console.log(`${rehearse ? 'rehearsal' : 'sound only'} done, marks in ${join(out, 'marks.json')}`);
  } else if (segments.length) {
    finish(out);
  }
  if (failure) process.exitCode = 1;
}

/**
 * Picture and sound lined up for a run's folder: each page's flash in the video, its click in its sound file.
 * Reads run.json; without one (a run from before it) flashes and sound files pair up in order.
 */
function finish(out) {
  const video = join(out, 'video.mkv');
  if (!existsSync(video)) throw new Error(`no video.mkv in ${out}`);
  const state = existsSync(join(out, 'run.json'))
    ? JSON.parse(readFileSync(join(out, 'run.json'), 'utf8'))
    : { captureStartedAt: null, pages: [], marks: [], problems: [] };
  if (!state.pages.length) {
    state.pages = readdirSync(out)
      .filter((f) => /^sound-\d+\.webm$/.test(f))
      .sort()
      .map((f) => {
        const flac = join(out, f.replace('.webm', '.flac'));
        return { file: existsSync(flac) ? flac : toFlac(join(out, f)) };
      });
  }
  console.log(`finding the flashes in the video (${state.pages.length} pages)`);
  // The sync flash is white for 120 ms, 7 frames of the 60 fps capture; a page's white before it loads (a
  // navigation, Chrome's first blank page) is mostly a frame or two, so runs of 4 to 12 frames count
  const flashes = detectFlashes(video).filter((f) => f.frames >= 4 && f.frames <= 12);
  console.log(`  flashes at ${flashes.map((f) => f.start.toFixed(2)).join(', ')} s`);
  // Without the run's clock, the last flashes pair with the pages in order (an early white page is no page)
  const ordered = flashes.slice(-state.pages.length);
  const lined = state.pages.map((s, i) => {
    const expected = s.syncWall && state.captureStartedAt ? (s.syncWall - state.captureStartedAt) / 1000 : null;
    const flash =
      expected === null
        ? ordered[i]
        : flashes.map((f) => ({ ...f, off: Math.abs(f.start - expected) })).sort((a, b) => a.off - b.off).find((f) => f.off <= 5);
    const click = detectClick(s.file);
    if (!flash) console.log(`  page ${i}: no flash${expected === null ? '' : ` near ${expected.toFixed(2)} s`}, sound placed by the clock`);
    if (click === null) console.log(`  page ${i}: no click in ${s.file}, sound placed by the clock`);
    const flashAt = flash ? flash.start : (expected ?? 0);
    // Where the sound file starts on the video's time line: the click lies `click` seconds into it
    const clickAt = click ?? (s.sync && s.audio ? (s.sync.t - s.audio.startedAt) / 1000 : 0);
    return { ...s, flashAt, offset: flashAt - clickAt };
  });
  const timed = state.marks.length
    ? state.marks.map((m) => {
        const s = lined[m.segment];
        return { ...m, video: s?.sync ? +(s.flashAt + (m.t - s.sync.t) / 1000).toFixed(3) : null };
      })
    : lined.map((s, i) => ({ kind: 'scene-start', label: `page ${i}`, video: +s.flashAt.toFixed(3) }));
  writeFileSync(join(out, 'marks.json'), JSON.stringify({ flashes, pages: lined, marks: timed, problems: state.problems }, null, 2));
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
