// What some effects cost the frame (TODO F4): the range rings of all towers (three stencil passes each) and
// the orbital laser's column, each switched on and off in turns in one DevWorld tab on the GPU, frames
// uncapped. Prints the mean and median render time (the engine's render plus gl.finish) with and without;
// the difference is the effect's cost.
//
//   node e2e/perf/render-costs.ts --url http://localhost:4220 [--rounds 6] [--seconds 3]
//   node e2e/perf/render-costs.ts --url http://localhost:4200 --map [--place 48.7758,9.1829]
//
// Serve a development build first (docs/E2E.md, coop bots). No map tiles, no relay, no dev server.
// With --map the same over real tiles (the stencil against the tiles' depth): the running dev server
// with a tile key, a visible window (the tiles need the GPU), one map session; towers come by command
// along the route instead of from the bot.
import { chromium, type Page } from '@playwright/test';

function argument(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

const URL_BASE = argument('url', 'http://localhost:4220');
const ROUNDS = Number(argument('rounds', '6'));
const SECONDS = Number(argument('seconds', '3'));
const MAP = process.argv.includes('--map');
/** "lat,lon" of the map run; Stuttgart centre as in the E2E tests */
const PLACE = argument('place', '48.7758,9.1829');
const GPU_ARGS = process.platform === 'win32'
  ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--enable-gpu', '--ignore-gpu-blocklist'];

async function gameReady(page: Page): Promise<void> {
  await page.waitForSelector('app-tower-defense', { timeout: 180_000 });
  // No start menu (&menu=skip): the HUD comes once the place stands
  const end = Date.now() + 300_000;
  let shown = 0;
  while (shown < 4 && Date.now() < end) {
    shown = (await page.locator('app-quick-actions').count()) ? shown + 1 : 0;
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

/** The game component's engine (its tower renderer's range rings) */
interface Game {
  engineInit: { getEngine(): { towers: { towers: Map<string, { rangeIndicator?: { visible: boolean } }> } } | null };
}

/** The load handle the page sets up (GameLoopFacadeService.createLoadHandle): commands, speed, what the mirror says */
interface Load {
  emit(command: Record<string, unknown>): void;
  speed(value: number): void;
  groundAt(lat: number, lon: number): number | null;
  state(): { towers: number; paths: [number, number][][] };
}
const setSpeed = (page: Page, value: number) =>
  page.evaluate((v) => (globalThis as unknown as { __load: Load }).__load.speed(v), value);

async function main(): Promise<void> {
  const browser = await chromium.launch({
    headless: !MAP,
    args: [...GPU_ARGS, '--disable-frame-rate-limit', '--disable-gpu-vsync', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'],
  });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
  await page.addInitScript(() => {
    localStorage.setItem('td_seen_version', '9999.0.0');
    localStorage.setItem('td_onboarding_v2', JSON.stringify({ done: true, completed: [] }));
  });
  await page.goto(MAP ? `${URL_BASE}/?l=${PLACE}&menu=skip` : `${URL_BASE}/?devworld&menu=skip`);
  await gameReady(page);

  if (MAP) {
    // No bot on a map: towers beside the route by command, some fit, the rest the game refuses
    await page.evaluate(() => {
      const handle = (globalThis as unknown as { __load: Load }).__load;
      handle.emit({ type: 'debug:add-credits', amount: 20000 });
      const path = handle.state().paths[0];
      for (const f of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]) {
        const [lat, lon] = path[Math.floor(path.length * f)];
        for (const [dLat, dLon] of [[0.00012, 0], [-0.00012, 0], [0, 0.00016], [0, -0.00016]]) {
          const height = handle.groundAt(lat + dLat, lon + dLon) ?? 0;
          handle.emit({ type: 'command:place-tower', typeId: 'archer', position: { lat: lat + dLat, lon: lon + dLon, height } });
        }
      }
    });
  }

  // Let the bot build a defense, then hold the game so only the picture changes between turns
  await setSpeed(page, 8);
  for (let i = 0; i < (MAP ? 5 : 120); i++) {
    const towers = await page.evaluate(() => (globalThis as unknown as { __load: Load }).__load.state().towers);
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

  await setSpeed(page, 0);
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
    await setSpeed(page, 1);
    laserOff.push(...await frames(page, SECONDS * 1000));
    // Commands to the simulation (the research and the charge as cheats), which runs in its worker
    await page.evaluate(() => {
      const handle = (globalThis as unknown as { __load: Load }).__load;
      const path = handle.state().paths[0];
      const [lat, lon] = path[Math.floor(path.length / 2)];
      handle.emit({ type: 'debug:complete-all-research' });
      handle.emit({ type: 'debug:ready-ability', abilityId: 'orbital-laser' });
      handle.emit({ type: 'command:use-ability', abilityId: 'orbital-laser', target: { lat, lon, height: handle.groundAt(lat, lon) ?? 0 } });
    });
    await page.waitForTimeout(300);
    laserOn.push(...await frames(page, SECONDS * 1000));
    await page.waitForTimeout(6000);
  }
  console.log(JSON.stringify({ effect: 'orbital laser column', off: stats(laserOff), on: stats(laserOn) }));
  await browser.close();
}

void main();
