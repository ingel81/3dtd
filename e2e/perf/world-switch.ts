// Whether a world opened in the page frees the one before (docs/WORLDS_NAVIGATION_PLAN.md, phase 2): opens a custom
// map by link, then switches N times between two maps in the page (Esc, New game, Maps, Play: no reload) and prints,
// after each switch and a forced GC, the JS heap, the live web workers, the live WebGL contexts, the listeners on
// window and document, the open intervals and the GPU resources of the game's renderer. A leak shows as a stair.
//
//   node e2e/perf/world-switch.ts --url http://localhost:4336 [--switches 10] [--maps demo-valley,mountain-pass]
//                                 [--headed] [--trace]
//
// --trace prints where each WebGL context still alive at the end was made.
//
// Headless by default (Chrome draws WebGL in software then). The custom maps need no tile key, but the menu shows
// them only once they are released (CUSTOM_MAPS_RELEASED, a local switch for this run). Measure a production build
// (ng build, public/maps copied into it, node e2e/perf/serve.mjs dist/3DTD/browser <port> --isolate): the dev
// build's DI debugging (Angular's injector profiler) keeps every game component it saw. Geometries and textures
// need the dev build's `ng` and read -1 in production.
import { chromium } from '@playwright/test';

function argument(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

const URL_BASE = argument('url', 'http://localhost:4336');
const SWITCHES = Number(argument('switches', '10'));
const MAPS = argument('maps', 'demo-valley,mountain-pass').split(',');
const HEADED = process.argv.includes('--headed');
const TRACE = process.argv.includes('--trace');

interface Sample {
  step: number;
  map: string | null;
  heapMB: number;
  workers: number;
  contexts: number;
  windowListeners: number;
  documentListeners: number;
  intervals: number;
  games: number;
  canvases: number;
  geometries: number;
  textures: number;
}

const browser = await chromium.launch({
  headless: !HEADED,
  args: ['--js-flags=--expose-gc', '--enable-precise-memory-info', '--enable-unsafe-swiftshader', '--window-size=1280,720'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));

// tsx keeps function names with an `__name` helper the page does not have; without it the counters below never install
await page.addInitScript('window.__name = (fn) => fn');
// Counts what a teardown must give back: workers made and ended, WebGL contexts made and lost,
// listeners on window and document added and removed, intervals set and cleared
await page.addInitScript(() => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const live = { workers: new Set<Worker>(), contexts: new Set<any>(), window: 0, document: 0, intervals: new Set<number>() };
  (window as any).__leaks = live;
  const NativeWorker = window.Worker;
  (window as any).Worker = class extends NativeWorker {
    constructor(url: string | URL, options?: WorkerOptions) {
      super(url, options);
      live.workers.add(this);
    }
    override terminate(): void {
      live.workers.delete(this);
      super.terminate();
    }
  };
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
    const ctx = (getContext as any).call(this, type, ...rest);
    if (ctx && (type === 'webgl2' || type === 'webgl') && !live.contexts.has(ctx)) {
      live.contexts.add(ctx);
      // Where it was made, for --trace
      ctx.__madeAt = (new Error().stack ?? '').split(String.fromCharCode(10)).slice(2, 7).join(' | ');
    }
    return ctx;
  } as typeof getContext;
  const count = (target: EventTarget, key: 'window' | 'document') => {
    const add = target.addEventListener.bind(target);
    const remove = target.removeEventListener.bind(target);
    const seen = new Set<string>();
    const id = (type: string, fn: unknown, options: unknown) =>
      `${type}|${(fn as { __id?: number }).__id ??= Math.random()}|${typeof options === 'boolean' ? options : !!(options as { capture?: boolean })?.capture}`;
    target.addEventListener = (type: string, fn: any, options?: any) => {
      if (fn) {
        const key2 = id(type, fn, options);
        if (!seen.has(key2)) {
          seen.add(key2);
          live[key]++;
        }
      }
      return add(type, fn, options);
    };
    target.removeEventListener = (type: string, fn: any, options?: any) => {
      if (fn) {
        const key2 = id(type, fn, options);
        if (seen.delete(key2)) live[key]--;
      }
      return remove(type, fn, options);
    };
  };
  count(window, 'window');
  count(document, 'document');
  const setInterval = window.setInterval.bind(window);
  const clearInterval = window.clearInterval.bind(window);
  (window as any).setInterval = (fn: TimerHandler, ms?: number, ...args: unknown[]) => {
    const handle = setInterval(fn, ms, ...args);
    live.intervals.add(handle);
    return handle;
  };
  (window as any).clearInterval = (handle?: number) => {
    if (handle !== undefined) live.intervals.delete(handle);
    clearInterval(handle);
  };
});

/** The game component through the dev build's `ng`; null in a production build */
const GAME = `(() => { const el = document.querySelector('app-tower-defense'); return el && window.ng ? window.ng.getComponent(el) : null; })()`;

/** The shipped maps' names, which the credit line shows once a map stands */
const NAMES = new Map<string, string>(
  ((await (await fetch(`${URL_BASE}/maps/index.json`)).json()) as { maps: { id: string; name: string }[] }).maps.map((m) => [m.id, m.name]),
);

/** The map stands: its credit line shows, nothing loads, no menu over it (menu=skip starts the game) */
async function worldStands(map: string): Promise<void> {
  const name = NAMES.get(map) ?? map;
  await page.locator('.td-map-attribution', { hasText: name }).waitFor({ timeout: 300_000 });
  await page.waitForFunction(() => !document.querySelector('app-menu-loading') && !document.querySelector('app-main-menu'), null, {
    timeout: 300_000,
    polling: 500,
  });
  // A few seconds on the new world: its models and textures decoded, the old one's freed
  await page.waitForTimeout(3000);
}

/** Another map through the menu, as a player: Esc, New game, Maps, Play */
async function playMap(map: string): Promise<void> {
  const menu = page.locator('app-main-menu');
  await page.mouse.move(650, 600);
  for (let i = 0; i < 10 && !(await menu.count()); i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
  }
  await menu.getByRole('menuitem', { name: /^New game/i }).first().click();
  await menu.getByRole('tab', { name: 'Maps' }).click();
  await menu.locator(`app-map-picker [data-map="${map}"]`).getByRole('button', { name: 'Play' }).click();
}

async function sample(step: number): Promise<Sample> {
  return page.evaluate(async ({ step, game }) => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const gc = (window as any).gc as () => void;
    for (let k = 0; k < 6; k++) {
      gc();
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const live = (window as any).__leaks;
    const c = eval(game);
    const memory = c?.engine?.getRenderer?.().info.memory ?? { geometries: -1, textures: -1 };
    return {
      step,
      map: document.querySelector('.td-map-attribution')?.textContent?.split(' by ')[0]?.trim() ?? null,
      heapMB: Math.round((performance as any).memory.usedJSHeapSize / 104857.6) / 10,
      workers: live.workers.size,
      contexts: [...live.contexts].filter((ctx: any) => !ctx.isContextLost()).length,
      windowListeners: live.window,
      documentListeners: live.document,
      intervals: live.intervals.size,
      games: document.querySelectorAll('app-tower-defense').length,
      canvases: document.querySelectorAll('canvas').length,
      geometries: memory.geometries,
      textures: memory.textures,
    };
  }, { step, game: GAME });
}

await page.goto(`${URL_BASE}/?world=map:${MAPS[0]}&menu=skip`);
await worldStands(MAPS[0]);
// Set once: a reload would lose it
await page.evaluate(() => ((window as unknown as { __samePage: boolean }).__samePage = true));
const samples = [await sample(0)];
const address = new URL(page.url());
console.log(`address after the start: ${address.pathname}${address.search}`);
for (let step = 1; step <= SWITCHES; step++) {
  const map = MAPS[step % MAPS.length];
  await playMap(map);
  await worldStands(map);
  samples.push(await sample(step));
  console.log(JSON.stringify(samples.at(-1)));
}
console.table(samples);
const samePage = await page.evaluate(() => (window as unknown as { __samePage?: boolean }).__samePage === true);
console.log(`same page throughout (no reload): ${samePage}, page errors: ${errors.length}`);
for (const e of errors) console.log('[pageerror]', e);
if (TRACE) {
  const made = await page.evaluate(() =>
    [...(window as unknown as { __leaks: { contexts: Set<{ isContextLost(): boolean; __madeAt: string }> } }).__leaks.contexts]
      .filter((ctx) => !ctx.isContextLost())
      .map((ctx) => ctx.__madeAt),
  );
  for (const at of made) console.log('[live context]', at);
}
await browser.close();
