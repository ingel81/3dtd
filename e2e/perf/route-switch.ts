// Whether the next world shows the routes of the one before (TODO E266): opens a custom map by link, notes its routes
// (the spawns' cached paths, the route animation's lines), then plays another map in the page (Built Worlds, the map,
// Play: no reload) and samples every 100 ms until the new map stands and some seconds after: the cached paths the
// game holds, the routes the world builds its cells and key on, the routes sent to the simulation (the mirror's) and
// the animation's lines in the new world's scene. A path or a line of the map before in the new world is the old
// route again. Exits with 1 when one shows.
//
//   npx ng serve --port <port>
//   node e2e/perf/route-switch.ts --url http://localhost:<port> [--maps demo-valley,ruined-city] [--after 8000] [--headed]
//
// Reads the services through the dev build's `ng` (the game component's facade); the custom maps must be released
// (CUSTOM_MAPS_RELEASED, a local switch), as for world-switch.ts.
import { chromium } from '@playwright/test';

function argument(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

const URL_BASE = argument('url', 'http://localhost:4200');
const [FROM, TO] = argument('maps', 'demo-valley,ruined-city').split(',');
const AFTER_MS = Number(argument('after', '8000'));
const HEADED = process.argv.includes('--headed');

const browser = await chromium.launch({ headless: !HEADED, args: ['--enable-unsafe-swiftshader', '--window-size=1280,720'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript('window.__name = (fn) => fn');
await page.addInitScript(() => {
  localStorage.setItem('td_seen_version', '9999.0.0');
  localStorage.setItem('td_onboarding_v2', JSON.stringify({ done: true, completed: [] }));
});

const NAMES = new Map<string, string>(
  ((await (await fetch(`${URL_BASE}/maps/index.json`)).json()) as { maps: { id: string; name: string }[] }).maps.map((m) => [m.id, m.name]),
);

interface Routes {
  /** The game component in front: a number the probe gives it on first sight */
  game: number | null;
  map: string | null;
  /** Each cached path as its first and last point, lat,lon to 6 places */
  paths: string[];
  /** The animation's lines in this world's scene, as their first point in local metres */
  lines: string[];
  /** The animation's lines outside this world's scene */
  elsewhere: number;
  /** The routes the world builds its cells and key on (MainWorldService.routes), as `paths` */
  world: string[];
  /** The routes the simulation was sent, as the mirror has them, as `paths` */
  sim: string[];
}

/** What the game in front holds of its routes */
function routes(): Promise<Routes> {
  return page.evaluate(() => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const w = window as any;
    const el = document.querySelector('app-tower-defense');
    const c = el && w.ng ? w.ng.getComponent(el) : null;
    const map = document.querySelector('.td-map-attribution')?.textContent?.split(' by ')[0]?.trim() ?? null;
    if (!c) return { game: null, map, paths: [], lines: [], elsewhere: 0, world: [], sim: [] };
    w.__games ??= new WeakMap();
    w.__gameCount ??= 0;
    if (!w.__games.has(c)) w.__games.set(c, ++w.__gameCount);
    const viz = c.facade?.vizFacade;
    const at = (p: { lat: number; lon: number }) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
    const sig = (p: any[]) => `${at(p[0])}>${at(p.at(-1))}`;
    const paths = [...(viz?.pathRoute?.cachedPaths?.values() ?? [])].map(sig);
    const world = (viz?.world?.routes?.() ?? []).map(sig);
    const sim = [...(c.facade?.mirror?.paths?.values() ?? [])].map(sig);
    const overlay = c.engine?.getOverlayGroup?.() ?? null;
    const lines: string[] = [];
    let elsewhere = 0;
    for (const route of viz?.routeAnimation?.animatedRoutes ?? []) {
      if (overlay && route.mainLine.parent === overlay) {
        const start = route.mainLine.geometry.attributes.instanceStart;
        lines.push(`${start.getX(0).toFixed(1)},${start.getY(0).toFixed(1)},${start.getZ(0).toFixed(1)}`);
      } else {
        elsewhere++;
      }
    }
    return { game: w.__games.get(c), map, paths, lines, elsewhere, world, sim };
  });
}

async function stands(map: string): Promise<void> {
  await page.locator('.td-map-attribution', { hasText: NAMES.get(map) ?? map }).waitFor({ timeout: 300_000 });
  await page.waitForFunction(() => !document.querySelector('app-menu-loading') && !document.querySelector('app-main-menu'), null, {
    timeout: 300_000,
    polling: 200,
  });
}

await page.goto(`${URL_BASE}/?world=map:${FROM}&menu=skip`);
await stands(FROM);
// The start show has run its route animation by now, and the routes stand
await page.waitForFunction(() => {
  const w = window as any;
  const c = w.ng.getComponent(document.querySelector('app-tower-defense'));
  return (c?.facade?.vizFacade?.pathRoute?.cachedPaths?.size ?? 0) > 0;
}, null, { timeout: 120_000, polling: 500 });
const before = await routes();
console.log(`${FROM}: game ${before.game}, ${before.paths.length} paths, ${before.lines.length} animation lines`);

await page.getByRole('button', { name: 'Built Worlds', exact: true }).first().click();
await page.getByText(NAMES.get(TO) ?? TO, { exact: true }).first().click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: 'Play', exact: true }).last().click();

const oldPaths = new Set(before.paths);
const oldLines = new Set(before.lines);
const stale: string[] = [];
let stoodAt = 0;
const t0 = Date.now();
const standing = stands(TO).then(() => (stoodAt = Date.now()));
for (;;) {
  const now = await routes();
  const ms = Date.now() - t0;
  if (now.game !== null && now.game !== before.game) {
    const paths = now.paths.filter((p) => oldPaths.has(p));
    const lines = now.lines.filter((l) => oldLines.has(l));
    const world = now.world.filter((p) => oldPaths.has(p));
    const sim = now.sim.filter((p) => oldPaths.has(p));
    if (paths.length || lines.length || world.length || sim.length) {
      stale.push(`${ms} ms: old paths ${paths.length} of ${now.paths.length} cached, ${world.length} of ${now.world.length} in the world's ` +
        `routes, ${sim.length} of ${now.sim.length} sent to the simulation; ${lines.length} old of ${now.lines.length} animation lines`);
    }
  }
  if (stoodAt && Date.now() - stoodAt > AFTER_MS) break;
  await page.waitForTimeout(100);
}
await standing;
const after = await routes();
console.log(`${TO}: game ${after.game}, stood ${stoodAt - t0} ms after Play, ${after.paths.length} paths, ${after.lines.length} animation lines, ` +
  `${after.world.length} world routes, ${after.sim.length} sent to the simulation`);
for (const line of stale.length > 10 ? [...stale.slice(0, 5), '...', ...stale.slice(-5)] : stale) console.log(`  OLD ${line}`);
if (stale.length > 10) console.log(`  ${stale.length} samples with old routes`);
console.log(`page errors: ${errors.length}`);
for (const e of errors) console.log('[pageerror]', e);
await browser.close();
if (stale.length) {
  console.log(`STALE: ${FROM}'s routes in ${TO} in ${stale.length} samples`);
  process.exit(1);
}
console.log('clean: no route of the map before in the new one');
