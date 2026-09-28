// What some effects cost the frame (TODO F4): the range rings of all towers (three stencil passes each) and
// the orbital laser's column, each switched on and off in turns in one DevWorld tab on the GPU, frames
// uncapped. Prints the mean and median render time (the engine's render plus gl.finish) with and without;
// the difference is the effect's cost.
//
//   node e2e/perf/render-costs.ts --url http://localhost:4220 [--rounds 6] [--seconds 3]
//
// Serve a development build first (docs/E2E.md, coop bots). No map tiles, no relay, no dev server.
import { chromium, type Page } from '@playwright/test';

function argument(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

const URL_BASE = argument('url', 'http://localhost:4220');
const ROUNDS = Number(argument('rounds', '6'));
const SECONDS = Number(argument('seconds', '3'));
const GPU_ARGS = process.platform === 'win32'
  ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--enable-gpu', '--ignore-gpu-blocklist'];

async function gameReady(page: Page): Promise<void> {
  await page.waitForSelector('app-tower-defense', { timeout: 180_000 });
  await page.waitForSelector('td-loading-screen', { timeout: 60_000 }).catch(() => undefined);
  const end = Date.now() + 300_000;
  let gone = 0;
  while (gone < 4 && Date.now() < end) {
    gone = (await page.locator('td-loading-screen').count()) ? 0 : gone + 1;
    await page.waitForTimeout(500);
  }
  for (let i = 0; i < 20; i++) {
    const skip = page.getByRole('button', { name: /skip intro/i });
    if (!(await skip.count())) break;
    await skip.first().click().catch(() => undefined);
    await page.waitForTimeout(700);
  }
  await page.waitForTimeout(1000);
}

/**
 * Render times (ms) over `ms` of wall clock: the engine's render call with gl.finish() after it, so the
 * GPU's work lands in the number too. Installed once, it records while `__renderTimes` is an array.
 */
async function frames(page: Page, ms: number): Promise<number[]> {
  await page.evaluate(() => {
    const g = globalThis as unknown as { __renderTimes: number[] | null; __wrapped?: boolean };
    g.__renderTimes = [];
    if (g.__wrapped) return;
    g.__wrapped = true;
    const w = window as unknown as { ng: { getComponent(el: Element | null): { engineInit: { getEngine(): Record<string, unknown> } } } };
    const engine = w.ng.getComponent(document.querySelector('app-tower-defense')).engineInit.getEngine() as { render(): void; renderer: { getContext(): WebGL2RenderingContext } };
    const original = engine.render.bind(engine);
    engine.render = () => {
      const t = performance.now();
      original();
      engine.renderer.getContext().finish();
      g.__renderTimes?.push(performance.now() - t);
    };
  });
  await page.waitForTimeout(ms);
  return page.evaluate(() => {
    const g = globalThis as unknown as { __renderTimes: number[] | null };
    const out = g.__renderTimes ?? [];
    g.__renderTimes = null;
    return out;
  });
}

const stats = (xs: number[]) => {
  const sorted = [...xs].sort((a, b) => a - b);
  const mean = xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  return { mean: +mean.toFixed(2), median: +sorted[Math.floor(sorted.length / 2)].toFixed(2), p95: +sorted[Math.floor(sorted.length * 0.95)].toFixed(2), n: xs.length };
};

type Game = {
  gameState: {
    getEventBus(): { emit(e: Record<string, unknown>): void };
    setGameSpeed(v: number): void;
    towerManager: { getAll(): { id: string; position: { lat: number; lon: number } }[] };
    getHQPosition?(): { lat: number; lon: number } | null;
  };
  engineInit: { getEngine(): { towers: { towers: Map<string, { rangeIndicator?: { visible: boolean } }> } } | null };
};

async function main(): Promise<void> {
  const browser = await chromium.launch({
    headless: true,
    args: [...GPU_ARGS, '--disable-frame-rate-limit', '--disable-gpu-vsync', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'],
  });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
  await page.addInitScript(() => {
    localStorage.setItem('td_seen_version', '9999.0.0');
    localStorage.setItem('td_onboarding_v2', JSON.stringify({ done: true, completed: [] }));
  });
  await page.goto(`${URL_BASE}/?devworld`);
  await gameReady(page);

  // Let the bot build a defense, then hold the game so only the picture changes between turns
  await page.evaluate(() => {
    const w = window as unknown as { ng: { getComponent(el: Element | null): Game } };
    w.ng.getComponent(document.querySelector('app-tower-defense')).gameState.setGameSpeed(8);
  });
  for (let i = 0; i < 120; i++) {
    const towers = await page.evaluate(() => {
      const w = window as unknown as { ng: { getComponent(el: Element | null): Game } };
      return w.ng.getComponent(document.querySelector('app-tower-defense')).gameState.towerManager.getAll().length;
    });
    if (towers >= 12) break;
    await page.waitForTimeout(2000);
  }
  const setRings = (on: boolean) => page.evaluate((visible) => {
    const w = window as unknown as { ng: { getComponent(el: Element | null): Game } };
    const engine = w.ng.getComponent(document.querySelector('app-tower-defense')).engineInit.getEngine();
    let n = 0;
    for (const data of engine?.towers.towers.values() ?? []) if (data.rangeIndicator) { data.rangeIndicator.visible = visible; n++; }
    return n;
  }, on);

  await page.evaluate(() => {
    const w = window as unknown as { ng: { getComponent(el: Element | null): Game } };
    w.ng.getComponent(document.querySelector('app-tower-defense')).gameState.setGameSpeed(0);
  });
  const rings = await setRings(false);
  const off: number[] = [];
  const on: number[] = [];
  for (let r = 0; r < ROUNDS; r++) {
    await setRings(false);
    off.push(...await frames(page, SECONDS * 1000));
    await setRings(true);
    on.push(...await frames(page, SECONDS * 1000));
  }
  await setRings(false);
  console.log(JSON.stringify({ effect: `range rings of ${rings} towers`, off: stats(off), on: stats(on) }));

  // The orbital laser: its column while it burns, against the same game running without it
  const laserOff: number[] = [];
  const laserOn: number[] = [];
  for (let r = 0; r < ROUNDS; r++) {
    await page.evaluate(() => {
      const w = window as unknown as { ng: { getComponent(el: Element | null): Game } };
      w.ng.getComponent(document.querySelector('app-tower-defense')).gameState.setGameSpeed(1);
    });
    laserOff.push(...await frames(page, SECONDS * 1000));
    await page.evaluate(() => {
      const w = window as unknown as { ng: { getComponent(el: Element | null): Game } };
      const gs = w.ng.getComponent(document.querySelector('app-tower-defense')).gameState;
      const game = gs as unknown as {
        players: string[]; researchOf(p: string): { completeResearch(id: string): void };
        getCachedPaths(): Map<string, { lat: number; lon: number; height?: number }[]>;
      };
      const bus = gs.getEventBus();
      for (const p of game.players) game.researchOf(p).completeResearch('orbital-laser');
      const path = [...game.getCachedPaths().values()][0];
      const target = path[Math.floor(path.length / 2)];
      bus.emit({ type: 'debug:ready-ability', abilityId: 'orbital-laser' });
      bus.emit({ type: 'command:use-ability', abilityId: 'orbital-laser', target: { lat: target.lat, lon: target.lon, height: target.height ?? 0 } });
    });
    await page.waitForTimeout(300);
    const burning = await page.evaluate(() => {
      const w = window as unknown as { ng: { getComponent(el: Element | null): { gameState: { abilityOf(p: string): { pending?: unknown[] }; players: string[] } } } };
      const gs = w.ng.getComponent(document.querySelector('app-tower-defense')).gameState;
      return gs.players.reduce((n, p) => n + (gs.abilityOf(p).pending?.length ?? 0), 0);
    });
    if (r === 0) console.log(`laser strikes under way: ${burning}`);
    laserOn.push(...await frames(page, SECONDS * 1000));
    await page.waitForTimeout(6000);
  }
  console.log(JSON.stringify({ effect: 'orbital laser column', off: stats(laserOff), on: stats(laserOn) }));
  await browser.close();
}

void main();
