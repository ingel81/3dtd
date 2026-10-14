// The desktop app (desktop/, docs/ELECTRON_DESKTOP_PLAN.md) and the map
// editor's test window: the editor's "Test map" and bot check open the game
// with window.open under one name (MAP_TEST_WINDOW), taken blank in the click
// and sent to the game after the save. The app drops every
// other window on its own origin; this one it opens with the main window's
// settings (sandbox, isolation, preload), a second test reuses it, the bot's
// result reaches the editor through window.opener, and Quit in the test
// window closes only that window.
//
// Needs the desktop build: npm ci in desktop/ and the web build copied in
// (npx ng build, then node desktop/scripts/copy-web.js); skipped without it.
// The app runs with its own user data folder, so it neither touches the
// installed app's settings nor waits for its single-instance lock.
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = fileURLToPath(new URL('../../desktop', import.meta.url));
const built = existsSync(path.join(desktop, 'node_modules', 'electron', 'dist')) && existsSync(path.join(desktop, 'app', 'index.html'));
const TEST_WINDOW = '3dtd-map-test';

/** The Electron binary of desktop/ (its package exports the path) */
const electronPath = () => createRequire(path.join(desktop, 'package.json'))('electron') as string;

test.skip(!built, 'no desktop build (desktop/node_modules and desktop/app)');

test('the desktop app opens the editor\'s test window, hardened and reused', async () => {
  test.setTimeout(3 * 60_000);
  const userData = mkdtempSync(path.join(tmpdir(), '3dtd-desktop-e2e-'));
  let app: ElectronApplication | null = null;
  try {
    app = await electron.launch({ executablePath: electronPath(), args: [desktop, `--user-data-dir=${userData}`], cwd: desktop });
    expect(await app.evaluate(({ app: a }) => a.getPath('userData'))).toBe(userData);
    const main = await app.firstWindow();
    await main.waitForLoadState('domcontentloaded');
    const windows = () => app!.windows().length;

    // Any other window on the app's origin is dropped
    await main.evaluate(() => void window.open(`${location.origin}/editor`, '_blank'));
    await main.waitForTimeout(1500);
    expect(windows()).toBe(1);

    // The test window opens with the app's settings: sandboxed page, the preload's bridge
    const opened = app.waitForEvent('window');
    await main.evaluate((name) => void window.open(`${location.origin}/editor?probe=1`, name), TEST_WINDOW);
    const child: Page = await opened;
    await child.waitForLoadState('domcontentloaded');
    expect(await child.evaluate(() => window.name)).toBe(TEST_WINDOW);
    expect(await child.evaluate(() => typeof (window as unknown as { require?: unknown }).require)).toBe('undefined');
    expect(await child.evaluate(() => typeof (window as unknown as { desktop?: unknown }).desktop)).toBe('object');
    const prefs = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((w: { webContents: { getLastWebPreferences(): Record<string, unknown> | null } }) => {
        const p = w.webContents.getLastWebPreferences();
        return { sandbox: p?.sandbox, contextIsolation: p?.contextIsolation, nodeIntegration: p?.nodeIntegration };
      }),
    );
    expect(prefs).toEqual(Array(2).fill({ sandbox: true, contextIsolation: true, nodeIntegration: false }));

    // A second test reuses the window: it loads again (a fresh page without the mark), no third window
    await child.evaluate(() => ((window as unknown as { mark: boolean }).mark = true));
    await main.evaluate((name) => void window.open(`${location.origin}/editor?probe=2`, name), TEST_WINDOW);
    const marked = () => child.evaluate(() => (window as unknown as { mark?: boolean }).mark === true).catch(() => true);
    await expect.poll(marked).toBe(false);
    expect(windows()).toBe(2);

    // The bot's result goes back to the editor through window.opener
    await main.evaluate(() => {
      (window as unknown as { got: unknown }).got = null;
      window.addEventListener('message', (e) => ((window as unknown as { got: unknown }).got = e.data));
    });
    await child.evaluate(() => window.opener?.postMessage({ type: '3dtd-map-trial', ok: true }, location.origin));
    await expect.poll(() => main.evaluate(() => (window as unknown as { got: unknown }).got)).toEqual({ type: '3dtd-map-trial', ok: true });

    // Quit in the game menu of the test window closes that window only
    await child.evaluate(() => (window as unknown as { desktop: { quit(): void } }).desktop.quit());
    await expect.poll(windows).toBe(1);
    expect(await main.evaluate(() => document.readyState)).toBe('complete');

    // The editor's way (openTestWindow): the window taken blank within the click, sent to the game once the map is
    // saved; taken again with an empty address it stays as it is
    const blank = app.waitForEvent('window');
    await main.evaluate((name) => void ((window as unknown as { test: Window | null }).test = window.open('', name)), TEST_WINDOW);
    const fresh: Page = await blank;
    const blankMark = () => fresh.evaluate(() => (window as unknown as { mark?: boolean }).mark === true).catch(() => true);
    await fresh.evaluate(() => ((window as unknown as { mark: boolean }).mark = true));
    await main.evaluate(() => void ((window as unknown as { test: Window }).test.location.href = `${location.origin}/editor?probe=3`));
    // The game page replaced the blank one (the app may route the address on, so the mark tells it)
    await expect.poll(blankMark).toBe(false);
    await fresh.waitForLoadState('domcontentloaded');
    expect(await fresh.evaluate(() => [location.protocol, window.name])).toEqual([new URL(await main.evaluate(() => location.href)).protocol, TEST_WINDOW]);
    await fresh.evaluate(() => ((window as unknown as { mark: boolean }).mark = true));
    await main.evaluate((name) => void window.open('', name), TEST_WINDOW);
    await main.waitForTimeout(1000);
    expect(await fresh.evaluate(() => (window as unknown as { mark?: boolean }).mark)).toBe(true);
    expect(windows()).toBe(2);
    await fresh.evaluate(() => (window as unknown as { desktop: { quit(): void } }).desktop.quit());
    await expect.poll(windows).toBe(1);
  } finally {
    await app?.close().catch(() => undefined);
    rmSync(userData, { recursive: true, force: true });
  }
});
