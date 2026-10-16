// Showreel runner: plays the scenes of script.mjs in a real Chrome on the dev server and records the screen
// (ddagrab, hevc_nvenc) and the game's own sound (the page's `__showreel` hook, a development build only).
// Afterwards it lines the sound up with the picture by the white flash and click at each page's start and
// writes the scene marks in video time. See README.md.
//
// Two ways to record:
//   takes      --scene a[,b]: each scene on its own, from its fixed start (take.mjs), into takes/<scene>/<time>/
//   programme  everything, or --from/--to a stretch, one page after another in one browser (scenes that build
//              on the one before and have no start of their own yet)
//
//   node tools/showreel/run.mjs --scene proof-game --headless --url http://localhost:4307   one take, headless
//   node tools/showreel/run.mjs --record --scene ember-flyover --display DISPLAY2            one take on the display, queued
//   node tools/showreel/run.mjs --url http://localhost:4200 --out <dir>            the whole programme, recorded
//   node tools/showreel/run.mjs --from dv-sculpt --to dv-night ...                 a stretch of the programme
//   node tools/showreel/run.mjs --finish <run folder>                            align and mix a run that stopped early
//   node tools/showreel/run.mjs --check <take folder>                            check a take again (check.mjs)
//   node tools/showreel/run.mjs --list                                             the scenes and their lengths
//   node tools/showreel/run.mjs --displays                                         the displays Windows has
//
// Options: --display DISPLAY2 (default: the primary), --quality ultra|high (default ultra), --output-idx N (ddagrab output, default: found by a test
// colour), --dpr 1 (device scale factor), --cq 18, --chroma 420|444, --headless [WxH] (no window: takes record
// the page's screencast, the programme records nothing; --sound records the pages' sound, --verify plays step by step and logs what each changed, --verify-only a,b only those scenes; --shots N takes a picture every N seconds), --rehearse (play, record nothing), --record (on the display, queued: this checkout built and served on --port 4307 under the lock; --url <server> plays a running server instead, --bundle <dir> or --no-build an existing build), --takes <dir> (default tmp/showreel/takes of the main checkout), --check-browser (print Chrome's flags and translate pref), --playwright <dir> (where playwright-core lies, default e2e/node_modules of this checkout or
// of the main checkout).
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { alignRun, chooseDisplay, displays, keepDisplayOn, recordDisplay } from './capture.mjs';
import { HERE, fetchSound, launch, logConsole, logView, pageUrl, startSound, verifySteps } from './browser.mjs';
import { checkAndIndex } from './check.mjs';
import { recordTakes } from './take.mjs';
import { recordSlot, waitQuiet } from './quiet.mjs';
import { BUNDLE, buildBundle, serveBundle } from './bundle.mjs';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const option = (name, fallback) => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 && argv[at + 1] && !argv[at + 1].startsWith('--') ? argv[at + 1] : fallback;
};

// --script <file>: another programme (a probe), default script.mjs beside this file
const scriptAt = option('script', '') ? resolve(option('script', '')) : join(HERE, 'script.mjs');
const { SCENES, TAKES = [] } = await import(pathToFileURL(scriptAt).href);

/** The programme's scenes to play: all, or --from a / --to b; each with the page it needs (the last one named before it) */
function chosenScenes() {
  let page = null;
  const withPage = SCENES.map((s) => {
    if (s.page) page = s.page;
    const scene = { ...s, needs: page };
    // A scene that ends on another page (it leaves by the app's own link, or opens another map in the editor):
    // the scenes after it need that page when a run starts there
    if (s.arrives) page = s.arrives;
    return scene;
  });
  const only = option('scene', '');
  const from = option('from', '');
  if (only) {
    // --list with --scene: those scenes
    const names = only.split(',');
    return [...withPage, ...TAKES].filter((s) => names.includes(s.name));
  }
  // --to <scene>: the programme up to that scene (with --from: a stretch of it)
  const to = option('to', '');
  const end = to ? withPage.findIndex((s) => s.name === to) : withPage.length - 1;
  if (end < 0) throw new Error(`no scene ${to}`);
  if (from) {
    const at = withPage.findIndex((s) => s.name === from);
    if (at < 0) throw new Error(`no scene ${from}`);
    return withPage.slice(at, end + 1);
  }
  return withPage.slice(0, end + 1);
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

/** --headless [WxH]: the size, '' for headless without one (a take then takes its scene's window), null on a display */
function headlessSize() {
  if (!flag('headless')) return null;
  return option('headless', '');
}

async function main() {
  const finishing = option('finish', '');
  if (finishing) {
    alignRun(resolve(finishing));
    return;
  }
  const checking = option('check', '');
  if (checking) {
    const verdict = checkAndIndex(resolve(checking));
    console.log(`${verdict.status}${verdict.reasons.length ? `: ${verdict.reasons.join('; ')}` : ''}`);
    return;
  }
  if (flag('displays')) {
    console.table(displays());
    return;
  }
  // --scene a,b: one take per scene, each from its own start in a fresh browser (take.mjs)
  const only = option('scene', '');
  if (only && !flag('list')) {
    // --record: on the real display, one recording at a time (quiet.mjs): this checkout built first (while
    // nobody records), then in the queue, then the build served on the recording port under the lock
    let slot = null;
    let served = null;
    let base = option('url', 'http://localhost:4200');
    if (flag('record')) {
      if (flag('headless')) throw new Error('--record records on the display; leave out --headless');
      if (!option('url', '')) {
        await waitQuiet('the build for the recording');
        const dir = option('bundle', '') || (flag('no-build') ? join(BUNDLE, 'browser') : buildBundle());
        slot = await recordSlot(only);
        served = await serveBundle(dir, Number(option('port', 4307))).catch((e) => {
          slot.release();
          throw e;
        });
        base = served.url;
      } else slot = await recordSlot(only);
    }
    let failed;
    try {
      failed = await recordTakes(only.split(','), [...SCENES, ...TAKES], {
        base,
        slotHeld: !!slot,
        headless: headlessSize(),
        rehearse: flag('rehearse'),
        verify: flag('verify'),
        takes: option('takes', ''),
        display: option('display', ''),
        quality: option('quality', ''),
        dpr: option('dpr', ''),
        outputIdx: option('output-idx', ''),
        cq: Number(option('cq', 18)),
        chroma: option('chroma', '420'),
        dcomp: flag('dcomp'),
        playwrightDir: option('playwright', ''),
      });
    } finally {
      await served?.close();
      slot?.release();
    }
    if (failed) process.exitCode = 1;
    return;
  }
  const scenes = chosenScenes();
  if (flag('list')) {
    for (const s of [...scenes, ...(only ? [] : TAKES)]) {
      const start = s.start ? `start ${s.start.editor ?? s.start.save ?? s.start.game}` : (s.needs ?? '');
      console.log(`${s.name.padEnd(28)} ${String(Math.round(stepSeconds(s.steps))).padStart(4)} s  ${start}`);
    }
    console.log(`about ${Math.round(scenes.reduce((n, s) => n + stepSeconds(s.steps), 0))} s of steps, plus loading`);
    return;
  }

  const base = option('url', 'http://localhost:4200');
  const headless = headlessSize();
  // --headless --sound (development): the pages' sound recorded and saved, no screen capture
  const rehearse = flag('rehearse') || (headless !== null && !flag('sound'));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const out = resolve(option('out', join(tmpdir(), '3dtd-showreel')), stamp);
  mkdirSync(out, { recursive: true });
  console.log(`showreel: ${scenes.length} scenes from ${base}, ${rehearse ? 'rehearsal' : 'recording'}, files in ${out}`);

  // The window: fullscreen on the chosen display, a fresh profile, sound without a gesture
  const display = headless !== null ? null : chooseDisplay(option('display', ''));
  if (display) console.log(`display ${display.name} ${display.width}x${display.height} at ${display.x},${display.y}`);
  const browser = await launch({
    display,
    size: headless !== null ? (headless || '1600x900').split('x').map(Number) : null,
    dpr: option('dpr', ''),
    quality: option('quality', 'ultra'),
    dcomp: flag('dcomp'),
    playwrightDir: option('playwright', ''),
  });
  const { page } = browser;
  const problems = [];
  // The director's upload step: a local file into a file input
  await page.exposeFunction('__showreelUpload', (sel, file) => page.setInputFiles(sel, file));
  logConsole(page, problems);

  if (flag('check-browser')) {
    // The flags Chrome got and the translate pref it holds, without playing anything
    await page.goto('chrome://version');
    console.log(`command line: ${await page.locator('#command_line').innerText()}`);
    await page.goto('chrome://prefs-internals');
    const prefs = JSON.parse(await page.locator('pre').first().innerText());
    console.log(`translate: ${JSON.stringify(prefs.translate)}, intl: ${JSON.stringify(prefs.intl)}`);
    await browser.close();
    return;
  }

  // A recording on the display waits its turn (quiet.mjs); a headless run waits while one records
  const slot = !rehearse && display ? await recordSlot(`programme ${scenes[0]?.name ?? ''}`) : null;
  let recorder = null;
  // The monitors stay on while a run records (they went off with nobody there and the capture froze)
  const letDisplaySleep = display ? keepDisplayOn() : () => undefined;
  if (!rehearse && display) {
    recorder = await recordDisplay(page, display, join(out, 'video.mkv'), {
      stamp,
      outputIdx: option('output-idx', ''),
      cq: Number(option('cq', 18)),
      chroma: option('chroma', '420'),
    });
  }
  const capture = recorder?.capture ?? null;

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
    s.file = await fetchSound(page, join(out, `sound-${String(segments.length).padStart(2, '0')}.webm`));
    segments.push(s);
    save();
  };

  /** The page's sound and its sync mark into the open segment */
  const soundOn = async () => Object.assign(segment, await startSound(page));

  /**
   * A page of the programme: load it, wait for its map, start its sound, flash. An intro page (`intro` on the
   * scene) starts its sound and flashes while the map loads, so neither eats the intro flight that starts as the
   * map stands; its scene starts right then and waits for the flight itself (game stage, act intro)
   */
  const openPage = async (target, intro = false, noIntro = false, clean = false) => {
    await closeSegment();
    const url = pageUrl(base, target, opened, intro, noIntro, clean);
    console.log(`page ${url}${intro ? ' (intro)' : ''}`);
    await page.goto(url);
    await page.waitForFunction(() => !!window.__showreel, null, { timeout: 60_000 });
    if (recorder) await recorder.onScreen();
    segment = { url, kind: null };
    if (intro && !rehearse) await soundOn();
    segment.kind = await page.evaluate(() => window.__showreel.ready(180));
    if (!intro) {
      // Let the first frames settle (shaders, the intro's first moves)
      await page.waitForTimeout(1500);
      if (!rehearse) await soundOn();
    }
    await logView(page);
    save();
  };

  /**
   * The scene's last click leaves the page by the app's own address change (the pause menu's Edit this map):
   * the page's sound is kept before, the new address gets the hook's `showreel` on the way (a redirect of the
   * navigation, so the app's link stays as it is), and the page that comes is waited for like a loaded one
   */
  const leavePage = async (scene) => {
    await closeSegment();
    const from = page.url();
    const origin = new URL(base).origin;
    const hooked = (u) => u.origin === origin && !u.searchParams.has('showreel') && !/\.[a-z0-9]+$/i.test(u.pathname);
    const redirect = (route, request) => {
      if (!request.isNavigationRequest()) return route.continue();
      const u = new URL(request.url());
      u.searchParams.set('showreel', '');
      return route.fulfill({ status: 302, headers: { location: u.toString() } });
    };
    await page.route(hooked, redirect);
    try {
      // The click's own marks go with the old page (its clock and sound are closed): none kept
      await Promise.all([
        page.waitForURL((u) => u.href !== from, { timeout: 30_000 }),
        page.evaluate((s) => window.__showreel.run(s), { name: `${scene.name}:leave`, steps: [{ do: 'click', sel: scene.leave, dur: 0.3 }] }).catch(() => []),
      ]);
      await page.waitForFunction(() => !!window.__showreel, null, { timeout: 60_000 });
    } finally {
      await page.unroute(hooked, redirect);
    }
    console.log(`page ${page.url()} (left ${scene.name})`);
    if (recorder) await recorder.onScreen();
    segment = { url: page.url(), kind: null };
    segment.kind = await page.evaluate(() => window.__showreel.ready(180));
    await page.waitForTimeout(1500);
    if (!rehearse) await soundOn();
    await logView(page);
    save();
  };

  let current = null;
  let failure = null;
  try {
    // --verify-only: nothing after the last scene asked for
    const asked = option('verify-only', '').split(',').filter(Boolean);
    const last = asked.length ? Math.max(...asked.map((n) => scenes.findIndex((x) => x.name === n))) : scenes.length - 1;
    for (const scene of scenes.slice(0, last + 1)) {
      if (!display) await waitQuiet(`the rehearsal before ${scene.name}`);
      const target = scene.page ?? (current === null ? scene.needs : null);
      if (target) {
        await openPage(target, !!scene.intro && target === scene.page, !!scene.noIntro, !!scene.clean);
        current = target;
      }
      if (!target && !segment) throw new Error(`scene ${scene.name} has no page to play on`);
      console.log(`scene ${scene.name}`);
      // --verify (development): each step on its own, then a picture and what it changed in the open map
      // --verify-only a,b: those scenes step by step, the ones before them played through at speed (the editor's
      // scenes build on the map the ones before left)
      const stepwise = asked.length ? asked.includes(scene.name) : flag('verify');
      const playing = stepwise
        ? verifySteps(page, out, scene).then(() => [])
        : page.evaluate((s) => window.__showreel.run(s), { name: scene.name, steps: scene.steps });
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
      await logView(page);
      marks.push(...run.map((m) => ({ ...m, segment: segments.length })));
      save();
      const list = await page.evaluate(() => window.__showreel.opened.slice());
      if (list.length) opened = list[list.length - 1];
      if (scene.leave) await leavePage(scene);
    }
    await closeSegment();
  } catch (e) {
    // What was recorded so far still makes a preview: the open page's sound too, if the page still answers
    failure = e;
    console.error(`run stopped: ${e.message}`);
    await closeSegment().catch((err) => console.error(`  the open page's sound is lost: ${err.message.split('\n')[0]}`));
  } finally {
    letDisplaySleep();
    const stopped = capture ? await capture.stop() : null;
    if (stopped && stopped.code !== 0) console.log(`ffmpeg ended with ${stopped.code}:\n${stopped.log}`);
    save();
    recorder?.release();
    await browser.close();
    slot?.release();
  }

  if (rehearse || !capture) {
    writeFileSync(join(out, 'marks.json'), JSON.stringify({ pages: segments, marks, problems }, null, 2));
    console.log(`${rehearse ? 'rehearsal' : 'sound only'} done, marks in ${join(out, 'marks.json')}`);
  } else if (segments.length) {
    alignRun(out);
  }
  if (failure) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
