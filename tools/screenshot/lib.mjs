// Open the running dev game (npm start, http://localhost:4200) in a browser of
// its own, ready to play: no "What's new", no first-run tips, intro skipped.
// Headed: the photorealistic tiles need a real GPU context (tools/google3d
// found the same), and a window of its own is never a hidden tab that Chrome
// freezes.
import { chromium } from 'playwright';

export const GAME_URL = process.env.GAME_URL ?? 'http://localhost:4200';
/** Stuttgart centre: a place with streets all round and quick tiles */
export const DEFAULT_PLACE = '48.7758,9.1829';

/** A browser; close it with browser.close() */
export function launch() {
  return chromium.launch({ headless: false, args: ['--window-size=1920,1080'] });
}

/**
 * A page of the game at `place` ("lat,lon") with `query` after it (e.g.
 * "&room=ABC123"), in a context of its own (its own localStorage: a second
 * player). `storage` goes into localStorage before the game starts.
 */
export async function openGame(browser, { place = DEFAULT_PLACE, query = '', viewport = { width: 1920, height: 1000 }, storage = {} } = {}) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.addInitScript((extra) => {
    // A returning player who saw this version's news and all tips
    localStorage.setItem('td_seen_version', '9999.0.0');
    localStorage.setItem('td_onboarding_v2', JSON.stringify({ done: true, completed: [] }));
    for (const [key, value] of Object.entries(extra)) localStorage.setItem(key, value);
  }, storage);
  await page.goto(`${GAME_URL}/?l=${place}${query}`);
  await gameReady(page);
  return page;
}

/** Wait for the loading screen to go, then skip the intro flight */
export async function gameReady(page) {
  await page.waitForSelector('td-loading-screen', { timeout: 30_000 }).catch(() => undefined);
  await page.waitForSelector('td-loading-screen', { state: 'detached', timeout: 300_000 });
  await page.waitForTimeout(2000);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1500);
}

/** `argv` after the script: `--out file.png` and the like, as an object */
export function args(argv = process.argv.slice(2)) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? true : argv[++i];
  }
  return out;
}
