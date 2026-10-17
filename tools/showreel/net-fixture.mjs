// A scene's network as a fixture: plays the scene once against the real servers and writes every request that
// leaves the dev server, with its answer, into a HAR (zipped); a take then answers them from it
// (`net: 'fixtures/<x>.har.zip'` on the scene, Playwright's routeFromHAR) and refuses everything else.
//
//   node tools/showreel/net-fixture.mjs record --scenes tools/showreel/scenes/r4-k1.mjs --scene osm-make \
//        --url http://localhost:4352 --har <file>.har.zip [--overpass <answer.json>]
//   node tools/showreel/net-fixture.mjs check --scenes ... --scene osm-make[,next] --url ... --har <file> [--shots 1 --out <dir>]
//        [--keep <file>.3dtdmap]   (record or check: the map the scenes made, the newest own map, written out)
//
// record: --overpass answers the Overpass queries from a saved answer of the same box (the servers were down on
// 2026-10-16; the file is Overpass JSON as the query returned it), everything else is fetched live once.
// check: the scenes from the HAR alone (a request it lacks is refused and listed), a scene's `leave` followed onto
// the next one; --shots N takes a picture every N seconds. Headless, the take's window (--headless 2048x1152 --dpr 1.25).
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const argv = process.argv.slice(2);
const mode = argv[0];
const option = (name, fallback) => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 && argv[at + 1] && !argv[at + 1].startsWith('--') ? argv[at + 1] : fallback;
};

/** playwright-core from e2e/ of this checkout or of the main checkout (a worktree has none of its own) */
function playwright() {
  const common = execFileSync('git', ['-C', ROOT, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim();
  for (const dir of [join(ROOT, 'e2e/node_modules'), join(dirname(common), 'e2e/node_modules')]) {
    if (existsSync(join(dir, 'playwright-core'))) return createRequire(join(dir, 'x.js'))('playwright-core');
  }
  throw new Error('playwright-core not found (npm install in e2e/)');
}

/** A request that leaves the dev server */
const external = (url, base) => /^https?:/.test(url) && new URL(url).origin !== new URL(base).origin;

/** The page's address as the runner gives it: the hook on, the start menu skipped (not for a scene on the world menu) */
function pageUrl(base, page, noIntro, menu = false) {
  const url = new URL(page, base);
  url.searchParams.set('showreel', noIntro ? 'nointro' : '');
  if (!url.pathname.startsWith('/editor') && !menu) url.searchParams.set('menu', 'skip');
  return url.toString();
}

/** A HAR entry Playwright's routeFromHAR answers from (url, method and, for a POST, its body must match) */
function entry(request, status, headers, body) {
  const post = request.postData();
  const type = headers['content-type'] ?? 'application/octet-stream';
  return {
    startedDateTime: new Date().toISOString(),
    time: 0,
    request: {
      method: request.method(),
      url: request.url(),
      httpVersion: 'HTTP/1.1',
      headers: [],
      queryString: [],
      cookies: [],
      headersSize: -1,
      bodySize: post ? post.length : 0,
      ...(post ? { postData: { mimeType: request.headers()['content-type'] ?? 'application/x-www-form-urlencoded', text: post } } : {}),
    },
    response: {
      status,
      statusText: '',
      httpVersion: 'HTTP/1.1',
      // The answer as the page needs it cross-origin; the length and coding go, the body is stored plain
      headers: Object.entries(headers)
        .filter(([k]) => !['content-length', 'content-encoding', 'transfer-encoding', 'set-cookie'].includes(k))
        .concat(headers['access-control-allow-origin'] ? [] : [['access-control-allow-origin', '*']])
        .map(([name, value]) => ({ name, value })),
      cookies: [],
      content: { size: body.length, mimeType: type, text: body.toString('base64'), encoding: 'base64' },
      redirectURL: '',
      headersSize: -1,
      bodySize: body.length,
    },
    cache: {},
    timings: { send: 0, wait: 0, receive: 0 },
  };
}

/** The HAR zipped (Python's zipfile: no zip library in node), as routeFromHAR reads a .zip */
function writeHar(file, entries) {
  const har = { log: { version: '1.2', creator: { name: '3dtd showreel net-fixture', version: '1' }, pages: [], entries } };
  const dir = mkdtempSync(join(tmpdir(), '3dtd-har-'));
  const inner = join(dir, basename(file).replace(/\.zip$/, '').replace(/(\.har)?$/, '.har'));
  writeFileSync(inner, JSON.stringify(har));
  mkdirSync(dirname(file), { recursive: true });
  execFileSync('python', ['-I', '-c', 'import sys, zipfile\nwith zipfile.ZipFile(sys.argv[1], "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z: z.write(sys.argv[2], sys.argv[3])', file, inner, basename(inner)]);
  rmSync(dir, { recursive: true, force: true });
}

async function main() {
  if (mode !== 'record' && mode !== 'check') throw new Error('usage: net-fixture.mjs record|check --scenes <file> --scene <a[,b]> --url <dev server> --har <file>');
  const { SCENES } = await import(pathToFileURL(resolve(option('scenes', join(HERE, 'script.mjs')))).href);
  const names = option('scene', '').split(',').filter(Boolean);
  const scenes = names.map((n) => SCENES.find((s) => s.name === n) ?? (() => { throw new Error(`no scene ${n}`); })());
  const base = option('url', 'http://localhost:4200');
  const har = resolve(option('har', ''));
  const [w, h] = option('headless', '2048x1152').split('x').map(Number);
  const out = resolve(option('out', join(tmpdir(), '3dtd-net-fixture')));
  const every = Number(option('shots', 0));
  mkdirSync(out, { recursive: true });

  const { chromium } = playwright();
  const profile = mkdtempSync(join(tmpdir(), '3dtd-net-profile-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chrome',
    headless: true,
    viewport: { width: w, height: h },
    deviceScaleFactor: Number(option('dpr', 1.25)),
    args: ['--ignore-gpu-blocklist', '--use-angle=d3d11', '--autoplay-policy=no-user-gesture-required'],
  });
  // A scene on the world menu (start.menu) shows its globes as a take does
  const globe = scenes[0]?.start?.menu ? 'high' : 'off';
  await context.addInitScript((globeQuality) => {
    localStorage.setItem('td_render_quality_v1', JSON.stringify({ setting: 'ultra', auto: null }));
    localStorage.setItem('td_seen_version', '9999.0.0');
    localStorage.setItem('td_onboarding_v2', JSON.stringify({ done: true, completed: [] }));
    localStorage.setItem('td_globe_quality_v1', JSON.stringify(globeQuality));
  }, globe);

  const entries = [];
  const missing = [];
  if (mode === 'record') {
    const overpass = option('overpass', '') ? readFileSync(resolve(option('overpass', ''))) : null;
    await context.route((u) => external(u.href, base), async (route) => {
      const request = route.request();
      if (overpass && /overpass/.test(new URL(request.url()).host)) {
        entries.push(entry(request, 200, { 'content-type': 'application/json' }, overpass));
        return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: overpass });
      }
      // Overpass takes a minute for a large square: longer than Playwright's 30 s; a request that fails is
      // aborted as the network would (the app tries its next server) and not recorded
      const response = await route.fetch({ timeout: 240_000 }).catch((e) => {
        console.log(`  failed: ${request.method()} ${request.url().slice(0, 100)}: ${String(e.message).split(String.fromCharCode(10))[0]}`);
        return null;
      });
      if (!response) return route.abort().catch(() => undefined);
      const body = await response.body();
      if (!entries.some((e) => e.request.url === request.url() && e.request.method === request.method() && (e.request.postData?.text ?? null) === (request.postData() ?? null))) {
        entries.push(entry(request, response.status(), response.headers(), body));
      }
      return route.fulfill({ response, body });
    });
  } else {
    if (!existsSync(har)) throw new Error(`no HAR ${har}`);
    // What the HAR lacks falls back to this route (registered first, asked last): refused and listed
    await context.route((u) => external(u.href, base), (route) => {
      missing.push(`${route.request().method()} ${route.request().url().slice(0, 140)}`);
      return route.abort();
    });
    await context.routeFromHAR(har, { url: (u) => external(u.href, base), notFound: 'fallback' });
  }

  const page = context.pages()[0] ?? (await context.newPage());
  page.on('console', (m) => {
    if (m.text().includes('[showreel]') || m.text().includes('[OSM]') || m.type() === 'error') console.log(`  console: ${m.text().slice(0, 240)}`);
  });
  const leaveRedirect = async (route, request) => {
    if (!request.isNavigationRequest()) return route.continue();
    const u = new URL(request.url());
    u.searchParams.set('showreel', '');
    // As a take starts the next scene's page: without the start menu
    if (!u.pathname.startsWith('/editor')) u.searchParams.set('menu', 'skip');
    return route.fulfill({ status: 302, headers: { location: u.toString() } });
  };
  try {
    for (const [i, scene] of scenes.entries()) {
      if ((scene.page || scene.start?.menu) && i === 0) {
        await page.goto(pageUrl(base, scene.start?.menu ? '/' : scene.page, !!scene.noIntro, !!scene.start?.menu));
        await page.waitForFunction(() => !!window.__showreel, null, { timeout: 60_000 });
        await page.evaluate(() => window.__showreel.ready(180));
        await page.waitForTimeout(1500);
      }
      console.log(`scene ${scene.name}`);
      let done = false;
      let n = 0;
      const shots = (async () => {
        while (every && !done) {
          for (let t = 0; t < every * 1000 && !done; t += 100) await new Promise((r) => setTimeout(r, 100));
          if (!done) await page.screenshot({ path: join(out, `${scene.name}-${String(n++).padStart(2, '0')}.png`) }).catch(() => undefined);
        }
      })();
      const marks = await page.evaluate((s) => window.__showreel.run(s), { name: scene.name, steps: scene.steps }).finally(() => (done = true));
      await shots;
      const t0 = marks.find((x) => x.kind === 'scene-start')?.t ?? 0;
      console.log(`  ${marks.filter((x) => x.kind === 'step').map((x) => `${((x.t - t0) / 1000).toFixed(1)} ${x.label}`).join(', ')}; ${((marks.at(-1).t - t0) / 1000).toFixed(1)} s`);
      await page.screenshot({ path: join(out, `${scene.name}-end.png`) });
      if (scene.leave && i < scenes.length - 1) {
        const hooked = (u) => u.origin === new URL(base).origin && !u.searchParams.has('showreel') && !/\.[a-z0-9]+$/i.test(u.pathname);
        await page.route(hooked, leaveRedirect);
        const from = page.url();
        await Promise.all([
          page.waitForURL((u) => u.href !== from, { timeout: 30_000 }),
          page.evaluate((sel) => window.__showreel.run({ name: 'leave', steps: [{ do: 'click', sel, dur: 0.3 }] }), scene.leave).catch(() => []),
        ]);
        await page.unroute(hooked, leaveRedirect);
        await page.waitForFunction(() => !!window.__showreel, null, { timeout: 60_000 });
        await page.evaluate(() => window.__showreel.ready(180));
        await page.waitForTimeout(1500);
        console.log(`  left for ${page.url()}`);
      }
    }
    // --keep <file>: the newest own map (the OSM world the scenes made) written out as a map fixture
    const keep = option('keep', '');
    if (keep) {
      const file = await page.evaluate(() => window.__showreel.take.ownMap());
      if (!file) throw new Error('--keep: no own map in the store');
      writeFileSync(resolve(keep), Buffer.from(file.base64, 'base64'));
      console.log(`kept ${file.name} as ${resolve(keep)}`);
    }
  } finally {
    await context.close().catch(() => undefined);
    rmSync(profile, { recursive: true, force: true });
  }
  if (mode === 'record') {
    writeHar(har, entries);
    console.log(`${entries.length} answers in ${har}: ${[...new Set(entries.map((e) => new URL(e.request.url).host))].join(', ')}`);
  } else {
    console.log(missing.length ? `${missing.length} requests not in the HAR (refused):\n  ${missing.join('\n  ')}` : 'every request answered from the HAR');
    if (missing.length) process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
