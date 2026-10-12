// Screenshots of the start menu over the globe while a place loads: loading plate, descent, loaded; then the
// loaded menu at smaller window sizes. One map session.
//   node e2e/perf/menu-shots.ts --url http://localhost:4322 --out <dir>
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

function argument(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}
const URL_BASE = argument('url', 'http://localhost:4322');
const OUT = argument('out', 'shots');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: false,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'],
});
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await context.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`${URL_BASE}/?l=${argument('place', '48.7758,9.1829')}`);

let n = 0;
const shot = async (name: string) => {
  const file = `${OUT}/${String(++n).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: file });
  console.log('shot', file);
};

await page.waitForSelector('app-main-menu', { timeout: 120_000 });
await page.waitForTimeout(2500);
await shot('menu-start');

// Every second: the plate's lines, a shot whenever what it says changes kind
const seen = new Set<string>();
const end = Date.now() + 240_000;
while (Date.now() < end) {
  const state = await page.evaluate(() => {
    const plate = document.querySelector('app-menu-loading');
    const text = plate?.textContent ?? '';
    return {
      plate: !!plate,
      tiles: /Tiles \d+/.test(text),
      descent: /Loading the descent/.test(text),
      problem: !!plate?.querySelector('.ml-problem'),
      play: !!document.querySelector('[data-entry="play"]:not([disabled])'),
    };
  });
  const kind = !state.plate ? 'loaded' : state.problem ? 'problem' : state.descent ? 'descent' : state.tiles ? 'tiles' : 'loading';
  if (!seen.has(kind)) {
    seen.add(kind);
    await shot(`plate-${kind}`);
  }
  if (kind === 'loaded') break;
  await page.waitForTimeout(250);
}
await page.waitForTimeout(3000);
await shot('menu-loaded-1920x1080');
for (const [w, h] of [[1366, 768], [1280, 720]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(1500);
  await shot(`menu-loaded-${w}x${h}`);
}
await browser.close();
