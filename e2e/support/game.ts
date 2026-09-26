// Helpers of the end-to-end tests (docs/E2E.md): open the running dev game
// ready to play, a coop room with players and options, the relay, reading
// the HUD. Every player is a browser context of its own (its own
// localStorage, its own window).
import { expect, type Browser, type Page, type TestInfo } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Stuttgart centre: streets all round, quick tiles */
export const DEFAULT_PLACE = '48.7758,9.1829';
const REPO = fileURLToPath(new URL('../../', import.meta.url));
const RELAY_PORT = 3003;

// === The game ===

export interface OpenOptions {
  /** "lat,lon" */
  place?: string;
  /** After the place, e.g. "&room=ABC123" */
  query?: string;
  /** Into localStorage before the game starts */
  storage?: Record<string, string>;
  /** Wait for the loading screen to go and skip the intro (default) */
  ready?: boolean;
}

/**
 * A page of the game at a place, as a returning player who saw this
 * version's news and all tips, in a context of its own.
 */
export async function openGame(browser: Browser, options: OpenOptions = {}): Promise<Page> {
  const { place = DEFAULT_PLACE, query = '', storage = {}, ready = true } = options;
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  await page.addInitScript((extra) => {
    localStorage.setItem('td_seen_version', '9999.0.0');
    localStorage.setItem('td_onboarding_v2', JSON.stringify({ done: true, completed: [] }));
    for (const [key, value] of Object.entries(extra)) localStorage.setItem(key, value);
  }, storage);
  await page.goto(`/?l=${place}${query}`);
  if (ready) await gameReady(page);
  return page;
}

/**
 * Wait until the loading screen is gone for good (a change of place shows it
 * more than once), then skip the intro flight until its button is gone.
 */
export async function gameReady(page: Page): Promise<void> {
  await page.waitForSelector('td-loading-screen', { timeout: 30_000 }).catch(() => undefined);
  const end = Date.now() + 300_000;
  let gone = 0;
  while (gone < 4 && Date.now() < end) {
    gone = (await page.locator('td-loading-screen').count()) ? 0 : gone + 1;
    await page.waitForTimeout(500);
  }
  expect(gone, 'the loading screen went').toBeGreaterThanOrEqual(4);
  for (let i = 0; i < 10; i++) {
    if (!(await page.getByRole('button', { name: /skip intro/i }).count())) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(700);
  }
  await page.waitForTimeout(1000);
}

/** The player's credits as the header has them (its exact screen reader text) */
export async function credits(page: Page): Promise<number> {
  const text = await page.locator('.stat.credits .sr-only').innerText();
  return Number(text.replace(/[^0-9-]/g, ''));
}

/** The developer menu open, then its button `name` (an aria-label, e.g. "Kill all enemies") */
export async function devAction(page: Page, name: string | RegExp): Promise<void> {
  const toggle = page.getByRole('button', { name: 'Developer options' });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await page.getByRole('button', { name }).click();
}

/** The wave button of the sidebar */
export function waveButton(page: Page) {
  return page.locator('.td-wave-btn');
}

/** Whether the pause button stands pressed */
export async function paused(page: Page): Promise<boolean> {
  return (await page.locator('.pause-btn').getAttribute('aria-pressed')) === 'true';
}

/** Kill the running wave off until its button no longer counts enemies left */
export async function clearWave(page: Page): Promise<void> {
  for (let i = 0; i < 40 && /left/i.test(await waveButton(page).innerText()); i++) {
    await devAction(page, 'Kill all enemies');
    await page.waitForTimeout(1200);
  }
  await expect(waveButton(page)).not.toContainText(/left/i);
}

/** A screenshot into the report */
export async function shot(testInfo: TestInfo, page: Page, name: string): Promise<void> {
  await testInfo.attach(name, { body: await page.screenshot(), contentType: 'image/png' });
}

/**
 * Stop the page's JavaScript for `ms` (the debugger pauses it, as a stalled
 * or hidden tab would stand), then let it run on: its game falls behind the
 * room (review R2).
 */
export async function freeze(page: Page, ms: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Debugger.enable');
  await cdp.send('Debugger.pause');
  await new Promise((resolve) => setTimeout(resolve, ms));
  await cdp.send('Debugger.resume');
  await cdp.send('Debugger.disable');
  await cdp.detach();
}

// === The relay ===

export interface Relay {
  logPath: string;
  log(): string;
  stop(): Promise<void>;
}

export async function relayUp(): Promise<boolean> {
  try {
    return (await fetch(`http://localhost:${RELAY_PORT}/`)).ok;
  } catch {
    return false;
  }
}

/** `npm run coop-server` (with --no-cheats where `cheats` is false); none may run on its port */
export async function startRelay({ cheats = true } = {}): Promise<Relay> {
  // The last test's relay may still be going down
  for (let i = 0; i < 30 && (await relayUp()); i++) await new Promise((r) => setTimeout(r, 500));
  if (await relayUp()) throw new Error(`A relay runs on port ${RELAY_PORT} already; stop it first`);
  const child: ChildProcess = spawn(`npm run coop-server${cheats ? '' : ' -- --no-cheats'}`, { cwd: REPO, shell: true, stdio: 'ignore' });
  for (let i = 0; i < 50 && !(await relayUp()); i++) await new Promise((r) => setTimeout(r, 200));
  if (!(await relayUp())) throw new Error('The relay did not start');
  const logPath = newestRelayLog();
  return {
    logPath,
    log: () => readFileSync(logPath, 'utf8'),
    stop: () => new Promise<void>((resolve) => {
      // npm under a shell: take the whole tree down
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']).on('exit', () => resolve());
      else { child.kill('SIGINT'); resolve(); }
    }),
  };
}

function newestRelayLog(): string {
  const dir = join(REPO, 'logs');
  const logs = readdirSync(dir).filter((f) => f.startsWith('coop_') && f.endsWith('.log'))
    .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
  return join(dir, logs[0].f);
}

// === Coop ===

export interface Room {
  code: string;
  host: Page;
  guest: Page;
}

/**
 * A coop room of the run's two players (fixtures.ts `duo`): the host opens
 * it from the dock, the guest joins by the code (no reload where both stand
 * on the same place) and readies up. `options` ({ Cheats: 'Host only' }, the
 * labels of the dock) are set before; `start` starts the match and waits for
 * the squad box on both sides.
 */
export async function coopRoom({ host, guest }: { host: Page; guest: Page }, { options = {}, start = false }: {
  options?: Record<string, string>;
  start?: boolean;
} = {}): Promise<Room> {
  await openRoom(host);
  const code = await roomCode(host);
  await joinByCode(guest, code);
  // One name per player in the room table, with a lane or without
  await expect(host.locator('app-coop-room-table .who')).toHaveCount(2, { timeout: 120_000 });
  for (const [label, choice] of Object.entries(options)) await setOption(host, label, choice);
  await guest.getByRole('button', { name: 'Ready up' }).click({ timeout: 120_000 });
  if (start) {
    await host.getByRole('button', { name: 'Start match' }).click({ timeout: 30_000 });
    for (const page of [host, guest]) await page.locator('app-coop-squad .squad').waitFor({ timeout: 60_000 });
    await host.waitForTimeout(2000);
  }
  return { code, host, guest };
}

/** Open the dock: the coop button of the header, in a room or not */
export async function openDock(page: Page): Promise<void> {
  if (await page.locator('app-coop-dock').count()) return;
  await page.getByRole('button', { name: /^Coop/ }).first().click();
  await page.locator('app-coop-dock').waitFor();
}

/** Guest: join the room `code` from the dock */
export async function joinByCode(page: Page, code: string): Promise<void> {
  await openDock(page);
  await page.locator('app-coop-dock input.codein').fill(code);
  // The Join beside the code field, not one of an open room's rows
  await page.locator('app-coop-dock .code-row').getByRole('button', { name: 'Join', exact: true }).click();
}

/**
 * After a test: out of the room, the dock and the developer menu closed, a
 * message at the top dismissed, so the next test finds the page as a fresh
 * one would look (the page stays: no new map session).
 */
export async function tidyUp(page: Page): Promise<void> {
  const notice = page.getByRole('button', { name: 'Close the message' });
  if (await notice.count()) await notice.click();
  await leaveRoom(page);
  const dev = page.getByRole('button', { name: 'Developer options' });
  if ((await dev.getAttribute('aria-expanded')) === 'true') await dev.click();
  if (await notice.count()) await notice.click();
}

/** Out of the room, the dock closed: the page is a single player game again */
export async function leaveRoom(page: Page): Promise<void> {
  if (await page.getByRole('button', { name: /^Coop room/ }).count()) {
    await openDock(page);
    await page.locator('app-coop-dock .foot').getByRole('button', { name: /^(Leave|Cancel)$/ }).click();
  }
  const close = page.getByRole('button', { name: 'Close the coop dock' });
  if (await close.count()) await close.click();
  await expect(page.getByRole('button', { name: /^Coop room/ })).toHaveCount(0);
}

/** Host: open a room from the dock */
export async function openRoom(page: Page): Promise<void> {
  await openDock(page);
  await page.getByRole('button', { name: 'Host a room' }).click();
}

/** Host: the invite link, as the dock's button copies it */
export async function inviteLink(page: Page): Promise<string> {
  await openDock(page);
  await page.getByRole('button', { name: 'Copy the invite link' }).first().click();
  return page.evaluate(() => navigator.clipboard.readText());
}

/** The room code in the dock */
export async function roomCode(page: Page): Promise<string> {
  return (await page.locator('app-coop-dock .code b').innerText({ timeout: 60_000 })).trim();
}

/** Host, lobby: set an option of the room by its labels in the dock ("Pause", "Anyone") */
export async function setOption(page: Page, label: string, choice: string): Promise<void> {
  const dock = page.locator('app-coop-dock');
  if (!(await dock.locator('.sets').count())) await dock.locator('.sec-toggle').click();
  await dock.getByRole('radiogroup', { name: label }).getByRole('radio', { name: choice }).click();
  await page.waitForTimeout(500);
}

/** A player's credits as the squad box shows them */
export async function squadCredits(page: Page, name: string): Promise<number> {
  const text = await page.locator('app-coop-squad .sq', { hasText: name }).locator('.credits').innerText();
  return Number(text.replace(/[^0-9]/g, ''));
}

/**
 * The chat of the dock (lobby) or the game, as text; '' while neither shows
 * (a change of place hides the whole UI). Read at once, no waiting.
 */
export async function chatText(page: Page): Promise<string> {
  return page.evaluate(() =>
    (document.querySelector('app-coop-dock .chat') ?? document.querySelector('app-coop-chat'))?.textContent ?? '');
}
