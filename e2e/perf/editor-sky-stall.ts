// The editor's sky changes (TODO E177): how long the picture stands after a click on Day, Dusk, Night, Overcast or a
// weather, and how many programs three built for it. A new small map from a template (city: street lamps, so the night
// lights its point lights), the view warmed up, then each change with frames timed for a few seconds after it.
//
//   npx ng serve --port <port>   (or node e2e/perf/serve.mjs <dist dir> <port>)
//   node e2e/perf/editor-sky-stall.ts --url http://localhost:<port> [--template city] [--open-at Day] [--settle 4000] [--headed]
import { chromium } from '@playwright/test';

function argument(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

const URL_BASE = argument('url', 'http://localhost:4200');
const TEMPLATE = argument('template', 'city');
const SETTLE_MS = Number(argument('settle', '4000'));
const HEADED = process.argv.includes('--headed');
const STEPS: { label: string; group: 'Sky' | 'Weather'; text: string }[] = [
  { label: 'night', group: 'Sky', text: 'Night' },
  { label: 'day', group: 'Sky', text: 'Day' },
  { label: 'night again', group: 'Sky', text: 'Night' },
  { label: 'dusk', group: 'Sky', text: 'Dusk' },
  { label: 'overcast', group: 'Sky', text: 'Overcast' },
  { label: 'rain', group: 'Weather', text: 'Rain' },
  { label: 'clear', group: 'Weather', text: 'Clear' },
  { label: 'day again', group: 'Sky', text: 'Day' },
];

const browser = await chromium.launch({
  headless: !HEADED,
  args: ['--window-size=1600,1000', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.addInitScript(() => {
  localStorage.setItem('td_seen_version', '9999.0.0');
  localStorage.setItem('3dtd-editor-tour', 'done');
});
await page.goto(`${URL_BASE}/editor`);
await page.locator('[data-test=new-map]').click();
await page.locator('[data-test=new-name]').fill(`Sky probe ${Date.now()}`);
await page.getByRole('radio', { name: /Small/ }).click();
await page.locator(`[data-template="${TEMPLATE}"]`).click();
await page.locator('[data-test=create-map]').click();
await page.locator('[data-test=map-name]').waitFor({ timeout: 180_000 }).catch(async (e) => {
  await page.screenshot({ path: 'probe-fail.png' });
  throw e;
});
// The view's warm-ups run in idle moments after it shows (editor-viewport.ts warmUpView)
await page.waitForTimeout(15_000);
await page.keyboard.press('8');
await page.waitForTimeout(1500);
// --open-at day: the map saved under that sky and opened anew, so the view warms up for it (a day map with lamps)
const OPEN_AT = argument('open-at', '');
if (OPEN_AT) {
  await page.locator('[aria-labelledby=ep-sky]').getByRole('radio', { name: OPEN_AT, exact: true }).click();
  await page.waitForTimeout(1000);
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(2000);
  await page.reload();
  await page.locator('[data-test=map-name]').waitFor({ timeout: 180_000 });
  await page.waitForTimeout(15_000);
  await page.keyboard.press('8');
  await page.waitForTimeout(1500);
}

type Probe = { programs(): number; start(): void; stop(): { longest: number; stalled: number; frames: number; long: number[][] } };
await page.evaluate(() => {
  const shell = (globalThis as unknown as { ng: { getComponent(e: Element): { session: { viewport: { renderer: { info: { programs?: unknown[] } } } } } } }).ng.getComponent(
    document.querySelector('app-editor-shell')!,
  );
  let gaps: number[] = [];
  let at: number[] = [];
  let last = 0;
  let t0 = 0;
  let on = false;
  const tick = (t: number) => {
    if (!on) return;
    if (last) {
      gaps.push(t - last);
      at.push(last - t0);
    }
    last = t;
    requestAnimationFrame(tick);
  };
  const probe: Probe = {
    programs: () => shell.session.viewport.renderer.info.programs?.length ?? 0,
    start: () => {
      gaps = [];
      at = [];
      last = 0;
      t0 = performance.now();
      on = true;
      requestAnimationFrame(tick);
    },
    stop: () => {
      on = false;
      return {
        longest: Math.round(Math.max(0, ...gaps)),
        // Time in frames longer than 50 ms: what the eye sees as standing
        stalled: Math.round(gaps.filter((g) => g > 50).reduce((a, b) => a + b, 0)),
        frames: gaps.length,
        // Each long frame: when it began after the click and how long it stood (ms)
        long: gaps.flatMap((g, k) => (g > 50 ? [[Math.round(at[k]), Math.round(g)]] : [])),
      };
    },
  };
  (globalThis as unknown as { __skyProbe: Probe }).__skyProbe = probe;
});

const rows: Record<string, unknown>[] = [];
for (const step of STEPS) {
  const group = step.group === 'Sky' ? page.locator('[aria-labelledby=ep-sky]') : page.getByRole('radiogroup', { name: 'Weather' });
  const before = await page.evaluate(() => (globalThis as unknown as { __skyProbe: Probe }).__skyProbe.programs());
  await page.evaluate(() => (globalThis as unknown as { __skyProbe: Probe }).__skyProbe.start());
  await group.getByRole('radio', { name: step.text, exact: true }).click();
  await page.waitForTimeout(SETTLE_MS);
  const frames = await page.evaluate(() => (globalThis as unknown as { __skyProbe: Probe }).__skyProbe.stop());
  const after = await page.evaluate(() => (globalThis as unknown as { __skyProbe: Probe }).__skyProbe.programs());
  const row = { step: step.label, ...frames, programs: after - before };
  rows.push(row);
  console.log(JSON.stringify(row));
}
const shot = argument('shot', '');
if (shot) await page.screenshot({ path: shot });
console.log('RESULT ' + JSON.stringify(rows));
await browser.close();
