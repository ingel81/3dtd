// What a world switch leaves behind: the DevWorld with many enemies, then the switch the game makes (a navigation in
// the same tab, location.assign), several times; after each the tab's renderer process memory (Windows private bytes)
// and the workers Chrome still holds. Chrome's back/forward cache is on as in a normal browser (Playwright turns it
// off by default); --no-bfcache turns it off.
//
//   node e2e/perf/mem-probe.ts --url http://localhost:4322 [--enemies 15000] [--switches 4] [--no-bfcache]
import { chromium, type CDPSession, type Page } from '@playwright/test';
import { execSync } from 'node:child_process';
import { placeTowers, routeSlices, spawnUpTo, startLoadWave, type LoadDriver } from '../../src/app/benchmark/load-scene.ts';

function argument(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}
const URL_BASE = argument('url', 'http://localhost:4322');
const ENEMIES = Number(argument('enemies', '15000'));
const SWITCHES = Number(argument('switches', '4'));
const BFCACHE = !process.argv.includes('--no-bfcache');
/** "lat,lon": every other round a real place over real tiles (the dev server's tile key, a visible window), no enemies there */
const PLACE = argument('place', '');

const browser = await chromium.launch({
  headless: !PLACE && !process.argv.includes('--dice'),
  ignoreDefaultArgs: BFCACHE ? ['--disable-back-forward-cache'] : [],
  args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling'],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
// Every worker the page makes and every terminate, for the log
await page.addInitScript(() => {
  const made: string[] = [];
  const ended: string[] = [];
  const Base = Worker;
  (globalThis as unknown as { __workers: unknown }).__workers = { made, ended };
  (globalThis as unknown as { Worker: unknown }).Worker = class extends Base {
    private readonly label: string;
    constructor(url: string | URL, options?: WorkerOptions) {
      super(url, options);
      this.label = String(url).split('/').pop()!.split('?')[0];
      made.push(this.label);
    }
    override terminate(): void {
      ended.push(this.label);
      super.terminate();
    }
  };
});
const cdp: CDPSession = await context.newCDPSession(page);
const browserCdp: CDPSession = await browser.newBrowserCDPSession();

type Load = { state(): { enemies: number; towers: number; phase: string; gameTimeMs: number; paths: [number, number][][] }; emit(c: unknown): void; groundAt(a: number, b: number): number | null; ping(): Promise<unknown> };
const load = <T>(page: Page, f: (l: Load, a: unknown) => T, arg?: unknown) =>
  page.evaluate(([src, a]) => new Function('l', 'a', `return (${src})(l, a)`)((globalThis as unknown as { __load: Load }).__load, a), [f.toString(), arg] as const) as Promise<Awaited<T>>;

async function ready(): Promise<void> {
  // A real place: past the intro, once its streets and routes stand
  const skip = page.getByRole('button', { name: /skip intro/i });
  await skip.first().waitFor({ state: 'visible', timeout: 120_000 }).then(() => skip.first().click()).catch(() => undefined);
  await page.waitForFunction(() => '__load' in globalThis, null, { timeout: 300_000 });
  await page.waitForFunction(() => {
    const l = (globalThis as unknown as { __load: Load }).__load;
    return l.state().paths.length > 0;
  }, null, { timeout: 300_000 });
  await page.waitForTimeout(2000);
}

/** Private bytes of every Chrome renderer process of this browser, MB, and the workers Chrome lists */
async function memory(label: string): Promise<void> {
  const info = (await browserCdp.send('SystemInfo.getProcessInfo' as never)) as unknown as { processInfo: { type: string; id: number }[] };
  const renderers = info.processInfo.filter((p) => p.type === 'renderer' || p.type === 'GPU').map((p) => p.id);
  const mb = renderers.map((id) => {
    try {
      const out = execSync(`powershell -NoProfile -Command "(Get-Process -Id ${id}).PrivateMemorySize64"`).toString().trim();
      return Math.round(Number(out) / 2 ** 20);
    } catch {
      return -1;
    }
  });
  const targets = (await browserCdp.send('Target.getTargets' as never)) as unknown as { targetInfos: { type: string; url: string }[] };
  const workers = targets.targetInfos.filter((t) => t.type === 'worker').map((t) => t.url.split('/').pop()?.split('?')[0]);
  console.log(`${label}: renderer+GPU MB ${JSON.stringify(mb)}, workers ${workers.length} ${JSON.stringify(workers)}`);
  // What the browser itself attributes, per document and worker, MB (needs cross-origin isolation; waits for a GC)
  const parts = await page.evaluate(async () => {
    const measure = (performance as unknown as { measureUserAgentSpecificMemory?(): Promise<{ bytes: number; breakdown: { bytes: number; types: string[]; attribution: { url: string; scope: string }[] }[] }> }).measureUserAgentSpecificMemory;
    if (!measure) return null;
    const result = await measure.call(performance);
    const by: Record<string, number> = {};
    for (const part of result.breakdown) {
      const key = part.attribution.map((a) => `${a.scope}:${a.url.split('/').pop()?.split('?')[0]}`).join('+') || part.types.join('+') || 'other';
      by[key] = (by[key] ?? 0) + Math.round(part.bytes / 2 ** 20);
    }
    return { total: Math.round(result.bytes / 2 ** 20), by };
  }).catch((e) => String(e));
  console.log('  measured ' + JSON.stringify(parts));
  console.log('  page workers ' + JSON.stringify(await page.evaluate(() => (globalThis as unknown as { __workers?: unknown }).__workers ?? null).catch(() => null)));
  // Which source each worker bundle is (dev chunk names say nothing): a marker from its code
  const sources = await page.evaluate(async () => {
    const urls = [...new Set(performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /worker-[^/]*\.js/.test(n)))];
    const out: Record<string, string> = {};
    for (const url of urls) {
      const text = await (await fetch(url)).text();
      const marks = ['GlobeRuntime', 'SimCore', 'heartbeat', 'DevWorld', 'w3x', 'terrain.worker'].filter((m) => text.includes(m));
      out[url.split('/').pop()!.split('?')[0]] = marks.join(',') || `${text.length} chars`;
    }
    return out;
  }).catch((e) => String(e));
  console.log('  sources ' + JSON.stringify(sources));
}

const devworld = `${URL_BASE}/?devworld&bot=manual&menu=skip`;

// --dice: a real place, then the world dice in the game N times (a place change without a reload: engine, tiles,
// simulation and the menu globe stay), memory after each
if (process.argv.includes('--dice')) {
  // --menu: through the start menu with its globe, which rises at every change of place
  const MENU = process.argv.includes('--menu');
  await page.goto(`${URL_BASE}/?l=${PLACE || '48.7758,9.1829'}&bot=manual${MENU ? '' : '&menu=skip'}`);
  if (MENU) {
    const play = page.locator('.mm-start').locator('[data-entry="play"], [data-entry="continue"]').first();
    await play.waitFor({ state: 'visible', timeout: 300_000 });
    await page.waitForTimeout(5000);
    await memory('menu');
    await play.click();
  }
  await ready();
  await page.waitForTimeout(15_000);
  await memory('place 0');
  for (let i = 1; i <= SWITCHES; i++) {
    const before = await page.evaluate(() => JSON.stringify((globalThis as unknown as { __load: Load }).__load.state().paths[0]?.[0] ?? null));
    await page.evaluate(() => {
      const ng = (globalThis as unknown as { ng: { getComponent(e: Element): { onWorldDice(): Promise<void> } } }).ng;
      void ng.getComponent(document.querySelector('app-tower-defense')!).onWorldDice();
    });
    await page.waitForFunction((b) => {
      const l = (globalThis as unknown as { __load: Load }).__load;
      const first = JSON.stringify(l.state().paths[0]?.[0] ?? null);
      return first !== b && first !== 'null';
    }, before, { timeout: 240_000 }).catch(() => console.log('no new routes in time'));
    await page.waitForTimeout(20_000);
    await memory(`place ${i}`);
  }
  await browser.close();
  process.exit(0);
}

// --benchmark: the in-game benchmark as the menu starts it, memory every 30 s while it runs
if (process.argv.includes('--benchmark')) {
  await page.goto(`${URL_BASE}/?devworld&bot=manual&benchmark`);
  const end = Date.now() + Number(argument('minutes', '12')) * 60_000;
  while (Date.now() < end) {
    await page.waitForTimeout(30_000);
    const enemies = await page.evaluate(() => (globalThis as unknown as { __load?: Load }).__load?.state().enemies ?? -1);
    await memory(`${Math.round((Date.now() - end) / 60_000 + Number(argument('minutes', '12')))} min, ${enemies} enemies`);
  }
  await browser.close();
  process.exit(0);
}
await page.goto(devworld);
await ready();
await memory('start');

for (let round = 0; round <= SWITCHES; round++) {
  const real = PLACE !== '' && round % 2 === 1;
  const driver: LoadDriver = {
    state: () => load(page, (l) => l.state()),
    emit: (command) => load(page, (l, c) => l.emit(c), command),
    groundAt: (lat, lon) => load(page, (l, a) => l.groundAt((a as number[])[0], (a as number[])[1]), [lat, lon]),
    fpsOver: async () => 60,
    wait: (ms) => page.waitForTimeout(ms),
    sync: async () => {
      await load(page, (l) => l.ping().then(() => true));
    },
    log: () => undefined,
  };
  const start = await driver.state();
  await driver.emit({ type: 'debug:add-credits', amount: 1_000_000 });
  await driver.emit({ type: 'debug:add-health', amount: 1_000_000 });
  if (!real) {
    await placeTowers(driver, start.paths, 20);
    await startLoadWave(driver);
    await spawnUpTo(driver, routeSlices(start.paths), ENEMIES, { slice: 0 }, 0.5, 1_000_000);
  }
  await page.waitForTimeout(real ? 15_000 : 3000);
  await memory(`round ${round}, ${(await driver.state()).enemies} enemies`);
  if (round === SWITCHES) break;
  // The switch as the game makes it (WorldChoiceService): a navigation in the same tab
  const next = PLACE !== '' && round % 2 === 0 ? `${URL_BASE}/?l=${PLACE}&bot=manual&menu=skip` : devworld;
  await page.evaluate((url) => location.assign(url), next);
  await ready();
  await page.waitForTimeout(3000);
  await memory(`after switch ${round + 1}`);
}
await browser.close();
