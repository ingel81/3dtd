// The showreel's Chrome and what the runners do on its pages (run.mjs the programme, take.mjs one scene per
// take, fixtures.mjs the start states): a fresh profile, Playwright from the e2e folder, the page's sound and its
// sync mark, the editor map's fingerprint. See README.md.
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { toFlac } from './capture.mjs';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '../..');

/** The main checkout (a worktree shares its git folder): where tmp/showreel and e2e/node_modules live */
export function mainCheckout() {
  try {
    const common = execFileSync('git', ['-C', ROOT, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim();
    return dirname(common);
  } catch {
    return ROOT;
  }
}

/** The showreel's working folder (fixtures, takes, the edit, the record queue): tmp/showreel of the main checkout */
export const DATA = join(mainCheckout(), 'tmp/showreel');

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

export function playwright(dir = '') {
  const candidates = [dir, join(ROOT, 'e2e/node_modules'), join(mainCheckout(), 'e2e/node_modules')];
  for (const d of candidates.filter(Boolean)) {
    if (existsSync(join(d, 'playwright-core'))) return createRequire(join(d, 'x.js'))('playwright-core');
  }
  throw new Error(`playwright-core not found in ${candidates.join(', ')} (npm install in e2e/, or --playwright <dir>)`);
}

/**
 * Chrome on a fresh profile: fullscreen (kiosk) on `display`, or headless at `size` ([w, h] CSS px). `quality`
 * the render quality (not Auto: Auto plays custom maps a level lower, render-quality.ts resolveLevel); `seed`
 * replaces Math.random with a seeded one in every page, so particles and scatter come out the same per take;
 * `globe` the menu globes' quality ('off' outside the menu scenes: the globes would draw behind every load).
 * Returns the context, its first page and `close()`, which also deletes the profile.
 */
export async function launch({ display = null, size = null, dpr = '', quality = 'ultra', seed = null, globe = 'off', dcomp = false, playwrightDir = '' } = {}) {
  const headless = !display;
  const profile = mkdtempSync(join(tmpdir(), '3dtd-showreel-profile-'));
  // No "Translate this page?" bubble in the picture: off in the profile as well as by feature flag
  mkdirSync(join(profile, 'Default'), { recursive: true });
  writeFileSync(join(profile, 'Default', 'Preferences'), JSON.stringify(PREFERENCES));
  const { chromium } = playwright(playwrightDir);
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
  if (dpr && !headless) args.push(`--force-device-scale-factor=${dpr}`);
  // Kiosk fills the display the window opens on; no size given, since Chrome reads it in scaled pixels (125 %)
  if (display) args.push(`--window-position=${display.x},${display.y}`, '--kiosk');
  // Without DirectComposition: twice the capture froze some three minutes in on the last frame while the page
  // played on (GDI still saw it): Chrome had moved its picture to a plane the desktop duplication does not see
  if (display && !dcomp) args.push('--disable-direct-composition');
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chrome',
    headless,
    viewport: headless ? { width: size[0], height: size[1] } : null,
    // Headless stands in for the display's scaling with --dpr
    ...(headless && dpr ? { deviceScaleFactor: Number(dpr) } : {}),
    ignoreDefaultArgs: ['--enable-automation'],
    acceptDownloads: true,
    args,
  });
  await context.addInitScript(
    ([level, seeded, globeQuality]) => {
      localStorage.setItem('td_render_quality_v1', JSON.stringify({ setting: level, auto: null }));
      localStorage.setItem('td_seen_version', '9999.0.0');
      localStorage.setItem('td_onboarding_v2', JSON.stringify({ done: true, completed: [] }));
      localStorage.setItem('td_globe_quality_v1', JSON.stringify(globeQuality));
      if (seeded !== null) {
        // mulberry32: the page's Math.random the same every take (the sim keeps its own random source)
        let a = seeded >>> 0;
        Math.random = () => {
          a = (a + 0x6d2b79f5) >>> 0;
          let t = a;
          t = Math.imul(t ^ (t >>> 15), t | 1);
          t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      }
    },
    [quality, seed, globe],
  );
  const page = context.pages()[0] ?? (await context.newPage());
  return {
    context,
    page,
    profile,
    async close() {
      await context.close().catch(() => undefined);
      rmSync(profile, { recursive: true, force: true });
    },
  };
}

/** The address of a page: the runner's server, the hook asked for, the game without its start menu */
export function pageUrl(base, page, opened = '', intro = false, noIntro = false, clean = false) {
  const url = new URL(page === 'opened' ? opened : page, base);
  // An intro page: the hook hides the game's HUD from the first frame (showreel.ts, sr-hud-off); a no-intro page
  // starts in the game view without the intro flight; a clean page has no HUD from the first frame either
  url.searchParams.set('showreel', intro ? 'intro' : noIntro ? 'nointro' : clean ? 'clean' : '');
  if (!url.pathname.startsWith('/editor')) url.searchParams.set('menu', 'skip');
  return url.toString();
}

/** The page's console into the runner's log; page errors also into `problems` */
export function logConsole(page, problems) {
  page.on('console', (m) => {
    if (m.text().includes('[showreel]')) console.log(`  ${m.text()}`);
    // The page's own errors (a view that never gets ready says why here)
    else if (m.type() === 'error') console.log(`  console error: ${m.text().slice(0, 300)}`);
  });
  page.on('pageerror', (e) => {
    problems.push(e.message);
    console.log(`  page error: ${e.message.slice(0, 300)}`);
  });
}

/** The page's sound recording and its sync mark: white for 120 ms and a click into the sound */
export async function startSound(page) {
  const audio = await page.evaluate(() => window.__showreel.audio.start());
  await page.waitForTimeout(300);
  const syncWall = Date.now();
  const sync = await page.evaluate(() => window.__showreel.sync());
  await page.waitForTimeout(300);
  return { audio, syncWall, sync };
}

/** The page's sound recording ended and written to `file` (.webm, and the .flac beside it, which is returned) */
export async function fetchSound(page, file) {
  await page.evaluate(() => window.__showreel.audio.stop());
  const length = await page.evaluate(() => window.__showreel.audio.length());
  let b64 = '';
  for (let o = 0; o < length; o += 4 << 20) b64 += await page.evaluate(([at, n]) => window.__showreel.audio.piece(at, n), [o, 4 << 20]);
  writeFileSync(file, Buffer.from(b64, 'base64'));
  return toFlac(file);
}

/** What the page draws at: CSS size, pixel ratio and the largest canvas's drawing buffer and its CSS size */
export async function logView(page) {
  const view = await page.evaluate(() => {
    const canvas = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return {
      css: `${innerWidth}x${innerHeight}`,
      dpr: devicePixelRatio,
      buffer: canvas ? `${canvas.width}x${canvas.height} for ${canvas.clientWidth}x${canvas.clientHeight} css` : 'no canvas',
    };
  });
  console.log(`  view ${view.css} css, dpr ${view.dpr}, drawing buffer ${view.buffer}`);
  return view;
}

/** A short fingerprint of the editor's map (heights, layers, water, objects, roads, rivers, sky), null in the game */
export function fingerprint(page) {
  return page.evaluate(() => {
    const el = document.querySelector('app-editor-page');
    const doc = el && window.ng?.getComponent(el)?.session?.doc;
    if (!doc) return null;
    const t = doc.terrain;
    let sum = 0;
    for (let i = 0; i < t.grid.heights.length; i += 7) sum += t.grid.heights[i];
    const mask = (b) => (b?.mask ? b.mask.reduce((n, v) => n + (v > 127 ? 1 : 0), 0) : 0);
    const splat = t.splat?.maps ?? [];
    let paint = 0;
    for (const a of splat) for (let i = 0; i < a.length; i += 97) paint += a[i];
    return {
      heights: Math.round(sum),
      paint,
      layers: t.layers.length,
      water: mask(t.water) + (t.waterBodies ?? []).reduce((n, b) => n + mask(b), 0),
      bodies: (t.waterBodies ?? []).length,
      objects: doc.objects.length,
      objectSum: Math.round(doc.objects.reduce((n, o) => n + o.x * 3 + o.y * 7 + o.scale * 100 + (o.rotation ?? 0) * 10, 0)),
      nodes: doc.paths.nodes.length,
      nodeSum: Math.round(doc.paths.nodes.reduce((n, o) => n + o.x * 3 + o.y * 7, 0)),
      edges: doc.paths.edges.length,
      rivers: (t.rivers ?? []).map((r) => Math.round(r.points.reduce((n, q) => n + q.x * 3 + q.y * 7, 0))).join('/'),
      spawns: doc.spawns.length,
      hq: `${Math.round(doc.hq.x)},${Math.round(doc.hq.y)}`,
      env: JSON.stringify(doc.environment).length + ':' + doc.environment.sky + ':' + (doc.environment.weather ?? '') + ':' + (doc.environment.skyImage ?? ''),
    };
  });
}

/** Steps one by one with a picture and the map's change after each, into <out>/verify.txt and verify/ */
export async function verifySteps(page, out, scene) {
  mkdirSync(join(out, 'verify'), { recursive: true });
  // Where the HQ stands (map metres): spots given from it can be planned on the map
  const start = await fingerprint(page);
  if (start) writeFileSync(join(out, 'verify.txt'), `# ${scene.name} hq ${start.hq}\n`, { flag: 'a' });
  for (let i = 0; i < scene.steps.length; i++) {
    const step = scene.steps[i];
    const before = await fingerprint(page);
    await page.evaluate((s) => window.__showreel.run(s), { name: `${scene.name}#${i}`, steps: [step] });
    await page.waitForTimeout(400);
    const after = await fingerprint(page);
    // Counts with their change (objects +75), the rest by name
    const changed = before && after
      ? Object.keys(after).filter((k) => after[k] !== before[k]).map((k) => (typeof after[k] === 'number' && k !== 'heights' && k !== 'paint' && !k.endsWith('Sum') ? `${k}${after[k] > before[k] ? '+' : ''}${after[k] - before[k]}` : k))
      : [];
    const what = [step.do, step.name, step.sel, step.label].filter(Boolean).join(' ');
    const shot = `${scene.name}-${String(i).padStart(2, '0')}.png`;
    await page.screenshot({ path: join(out, 'verify', shot) });
    const line = `${scene.name.padEnd(20)} ${String(i).padStart(2)} ${what.slice(0, 60).padEnd(60)} ${changed.join(',') || '-'}`;
    console.log(`  ${line}`);
    writeFileSync(join(out, 'verify.txt'), `${line}\n`, { flag: 'a' });
  }
}
