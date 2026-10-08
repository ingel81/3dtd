// How long a jump in the replay takes (TODO E80): a DevWorld tab of a production build plays one wave of many enemies
// with towers along the routes, opens its replay and jumps to a few points of it, forward and back. Each jump is timed
// from the drag on the bar until the simulation stands at its target (the build with keyframes shows "Jumping ..." while
// it runs; the one without blocks the simulation's worker, so a call to it answers only after the jump).
//
//   node e2e/perf/serve.mjs <dist dir> 4260 --isolate
//   node e2e/perf/replay-seek.ts --url http://localhost:4260 [--enemies 3000] [--browser chromium] [--headed]
import { chromium, firefox, type Page } from '@playwright/test';

function argument(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

const URL_BASE = argument('url', 'http://localhost:4260');
const ENEMIES = Number(argument('enemies', '3000'));
const BROWSER = argument('browser', 'chromium');
const HEADED = process.argv.includes('--headed');
/** Where to jump, as shares of the wave: far forward first (the keyframes are taken on the way), then back and forth */
const JUMPS = argument('jumps', '0.9,0.5,0.8,0.3').split(',').map(Number);

type Load = {
  emit(e: unknown): void;
  speed(v: number): void;
  ping(): Promise<unknown>;
  groundAt(lat: number, lon: number): number | null;
  state(): { enemies: number; towers: number; phase: string; gameTimeMs: number; paths: [number, number][][] };
};
const load = (page: Page) => ({
  emit: (c: Record<string, unknown>) => page.evaluate((x) => (globalThis as unknown as { __load: Load }).__load.emit(x), c),
  state: () => page.evaluate(() => (globalThis as unknown as { __load: Load }).__load.state()),
  speed: (v: number) => page.evaluate((x) => (globalThis as unknown as { __load: Load }).__load.speed(x), v),
  ping: () => page.evaluate(() => (globalThis as unknown as { __load: Load }).__load.ping()),
  groundAt: (lat: number, lon: number) => page.evaluate(([a, b]) => (globalThis as unknown as { __load: Load }).__load.groundAt(a, b), [lat, lon]),
});

const browser = await (BROWSER === 'firefox' ? firefox : chromium).launch({ headless: !HEADED });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
await context.addInitScript(() => {
  localStorage.setItem('3dtd-tile-credentials', JSON.stringify({ tileProvider: 'cesium', cesiumIonToken: 'devworld' }));
});
const page = await context.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`${URL_BASE}/?devworld&bot=manual&menu=skip`);
await page.waitForFunction(() => '__load' in globalThis, null, { timeout: 300_000 });
// No start menu (&menu=skip): the HUD comes once the place stands
await page.waitForSelector('app-quick-actions', { timeout: 300_000 }).catch(() => undefined);
for (const name of [/^close$/i, /skip intro/i]) {
  const button = page.getByRole('button', { name });
  await button.first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined);
  if (await button.count()) await button.first().click().catch(() => undefined);
}
await page.waitForTimeout(4000);
const game = load(page);
const build = await (await fetch(`${URL_BASE}/build-info.json`)).json().catch(() => null);
console.log('BUILD', JSON.stringify(build));

await game.emit({ type: 'debug:add-credits', amount: 1_000_000 });
await game.emit({ type: 'debug:add-health', amount: 1_000_000 });
const { paths } = await game.state();
const types = ['archer', 'cannon', 'ice', 'fire', 'lightning', 'rocket', 'magic', 'poison'];
let placed = 0;
for (const path of paths) {
  for (let i = 3; i < path.length - 3 && placed < 40; i += 2) {
    const [lat, lon] = path[i];
    const [nlat, nlon] = path[i + 1];
    const k = Math.cos((lat * Math.PI) / 180);
    const dLat = nlat - lat;
    const dLon = (nlon - lon) * k;
    const len = Math.hypot(dLat, dLon) || 1;
    for (const side of [1, -1]) {
      const off = (20 / 111_320) * side;
      const at = { lat: lat - (dLon / len) * off, lon: lon + ((dLat / len) * off) / k };
      const height = await game.groundAt(at.lat, at.lon);
      if (height !== null) await game.emit({ type: 'command:place-tower', position: { ...at, height }, typeId: types[placed++ % types.length] });
    }
  }
}
await page.waitForTimeout(3000);
console.log(`towers ${(await game.state()).towers}`);

// One wave of many enemies at once (no spawn floor), weak enough that the towers finish it
const entries = Array.from({ length: ENEMIES }, (_, i) => ({ enemyType: ['zombie', 'rat', 'skeleton', 'spider'][i % 4], speed: 2, health: 400 }));
await game.speed(4);
await game.emit({ type: 'command:start-wave', config: { schedule: { entries, baseDelay: 2, spawnMode: 'each', spawnFloor: false } } });
let peak = 0;
for (let s = 0; s < 1800; s++) {
  await page.waitForTimeout(1000);
  const st = await game.state();
  peak = Math.max(peak, st.enemies);
  if (s % 10 === 0) console.log(`  wave: ${st.enemies} alive (peak ${peak}), phase ${st.phase}, game ${Math.round(st.gameTimeMs / 1000)} s`);
  if (s > 5 && st.phase !== 'wave') break;
}
await game.speed(1);

const replay = page.getByRole('button', { name: /^Replay wave/ });
await replay.first().waitFor({ state: 'visible', timeout: 60_000 });
await replay.first().click();
await page.waitForSelector('input.td-replay-scrub', { timeout: 60_000 });
await page.waitForTimeout(2000);
const max = Number(await page.locator('input.td-replay-scrub').getAttribute('max'));
console.log(`replay open, wave ${Math.round(max / 1000)} s long, peak ${peak} enemies alive`);

const rows: { to: number; ms: number }[] = [];
for (const share of JUMPS) {
  const t0 = Date.now();
  await page.locator('input.td-replay-scrub').evaluate((el, value) => {
    const input = el as HTMLInputElement;
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, Math.round(max * share));
  // The build without keyframes answers the call after the jump; the one with them shows its progress from the next
  // packet on until done (a jump of one slice shows none)
  await game.ping();
  await page.waitForSelector('.td-replay-seeking', { timeout: 1000 }).catch(() => undefined);
  await page.waitForFunction(() => document.querySelector('.td-replay-seeking') === null, null, { timeout: 300_000, polling: 50 });
  const ms = Date.now() - t0;
  rows.push({ to: share, ms });
  console.log(`JUMP to ${Math.round(share * 100)} %: ${ms} ms`);
  await page.waitForTimeout(1500);
}
console.log('RESULT ' + JSON.stringify({ build, browser: BROWSER, enemies: ENEMIES, peak, waveMs: max, jumps: rows }));
await browser.close();
