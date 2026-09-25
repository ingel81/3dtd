// Drive the running dev game (npm start, http://localhost:4200) from browsers
// of its own: screenshots and click-through checks without anyone at the
// screen, and in plain view for whoever watches. Headed Chromium from
// Playwright (not the user's Chrome): the photorealistic tiles need a real GPU
// context (tools/google3d found the same), and a window of its own is never a
// hidden tab that Chrome freezes. SLOWMO (ms, default 120) slows every action
// so it can be followed.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const GAME_URL = process.env.GAME_URL ?? 'http://localhost:4200';
/** Stuttgart centre: a place with streets all round and quick tiles */
export const DEFAULT_PLACE = '48.7758,9.1829';
const REPO = fileURLToPath(new URL('../../', import.meta.url));
const SLOWMO = Number(process.env.SLOWMO ?? 120);

/**
 * A browser window of its own, `slot` 0 on the left of the screen, 1 offset
 * right and down, so two players can be watched side by side. Close it with
 * browser.close().
 */
export function launch(slot = 0) {
  const x = slot * 520;
  const y = slot * 60;
  return chromium.launch({
    headless: false,
    slowMo: SLOWMO,
    args: [`--window-position=${x},${y}`, '--window-size=1920,1080'],
  });
}

/**
 * A page of the game at `place` ("lat,lon") with `query` after it (e.g.
 * "&room=ABC123"). `storage` goes into localStorage before the game starts.
 * A returning player who saw this version's news and all tips; the intro is
 * skipped once the loading screen is gone.
 */
export async function openGame(browser, { place = DEFAULT_PLACE, query = '', viewport = { width: 1600, height: 900 }, storage = {} } = {}) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.addInitScript((extra) => {
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

// === Relay ===

/** Whether a relay answers on `port` */
export async function relayUp(port = 3003) {
  try {
    return (await fetch(`http://localhost:${port}/`)).ok;
  } catch {
    return false;
  }
}

/**
 * Start `npm run coop-server` (with `--no-cheats` where `cheats` is false),
 * unless one runs already and `fresh` is not set. Returns stop() and the path
 * of its log (logs/coop_<start>.log).
 */
export async function startRelay({ cheats = true } = {}) {
  if (await relayUp()) throw new Error('A relay runs on port 3003 already; stop it first');
  const args = ['run', 'coop-server', ...(cheats ? [] : ['--', '--no-cheats'])];
  const child = spawn(`npm ${args.join(' ')}`, { cwd: REPO, shell: true, stdio: 'ignore' });
  for (let i = 0; i < 50 && !(await relayUp()); i++) await new Promise((r) => setTimeout(r, 200));
  const logPath = newestRelayLog();
  return {
    logPath,
    log: () => readFileSync(logPath, 'utf8'),
    stop: () => new Promise((resolve) => {
      // npm under a shell: take the whole tree down (Windows)
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']).on('exit', resolve);
      else { child.kill('SIGINT'); resolve(); }
    }),
  };
}

function newestRelayLog() {
  const dir = join(REPO, 'logs');
  const logs = readdirSync(dir).filter((f) => f.startsWith('coop_') && f.endsWith('.log'))
    .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
  return join(dir, logs[0].f);
}

// === Coop ===

/**
 * A coop room: the host opens it, each guest joins by the invite link and
 * readies up. `options` ({ Cheats: 'Host only', Pause: 'Anyone', ... }, the
 * labels of the dock) are set by the host before the guests ready up. With
 * `start` the host starts the match. Every player a browser window of its own.
 */
export async function coopRoom({ guests = ['Bob'], host = 'Ann', place, options = {}, start = false } = {}) {
  const hostBrowser = await launch(0);
  const hostPage = await openGame(hostBrowser, { place, storage: { '3dtd-coop-name': host } });
  await hostPage.getByRole('button', { name: 'Coop: play one map together' }).click();
  await hostPage.getByRole('button', { name: 'Open room' }).click();
  const code = (await hostPage.locator('app-coop-dock .code b').innerText({ timeout: 60_000 })).trim();
  const players = [];
  for (const [i, name] of guests.entries()) {
    const browser = await launch(i + 1);
    const page = await openGame(browser, { place, query: `&room=${code}`, storage: { '3dtd-coop-name': name } });
    players.push({ name, browser, page });
  }
  await hostPage.waitForFunction((n) => document.querySelectorAll('app-coop-dock .pl').length >= n, guests.length + 1, { timeout: 120_000 });
  for (const [label, choice] of Object.entries(options)) await setOption(hostPage, label, choice);
  for (const { page } of players) {
    await page.getByRole('button', { name: 'Ready up' }).click({ timeout: 30_000 });
  }
  if (start) {
    await hostPage.getByRole('button', { name: 'Start match' }).click({ timeout: 30_000 });
    await hostPage.locator('app-coop-squad .squad').waitFor({ timeout: 60_000 });
  }
  return {
    code,
    host: { name: host, browser: hostBrowser, page: hostPage },
    guests: players,
    all: () => [{ name: host, browser: hostBrowser, page: hostPage }, ...players],
    close: async () => {
      for (const p of players) await p.browser.close();
      await hostBrowser.close();
    },
  };
}

/** Host, lobby: set an option of the room by its labels in the dock ("Pause", "Anyone") */
export async function setOption(page, label, choice) {
  const dock = page.locator('app-coop-dock');
  if (!(await dock.locator('.sets').count())) await dock.locator('.sec-toggle').click();
  await dock.getByRole('radiogroup', { name: label }).getByRole('radio', { name: choice }).click();
  await page.waitForTimeout(500);
}

// === Game ===

/** The player's credits as the header has them (its exact screen reader text) */
export async function credits(page) {
  const text = await page.locator('.stat.credits .sr-only').innerText();
  return Number(text.replace(/[^0-9-]/g, ''));
}

/** The developer menu open, then its button `name` (an aria-label, e.g. "Kill all enemies") */
export async function devAction(page, name) {
  const toggle = page.getByRole('button', { name: 'Developer options' });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await page.getByRole('button', { name }).click();
}

/** The wave button of the sidebar: its visible text */
export function waveButton(page) {
  return page.locator('.td-wave-btn');
}

/** `argv` after the script: `--out file.png` and the like, as an object */
export function args(argv = process.argv.slice(2)) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? true : argv[++i];
  }
  return out;
}

/** A check's outcome, printed as one line and collected for the summary */
export function checker() {
  const results = [];
  return {
    results,
    check(id, ok, detail = '') {
      results.push({ id, ok, detail });
      console.log(`${ok ? 'OK  ' : 'FAIL'} ${id}${detail ? `: ${detail}` : ''}`);
    },
  };
}
