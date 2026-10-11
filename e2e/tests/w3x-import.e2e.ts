// The Warcraft 3 import in the editor (docs/W3X_IMPORT.md), no map session: a synthetic .w3x built while the test
// runs (src/test/w3x-synthetic-map.ts, nothing of anyone else's in the repo) through "Import file", its options and
// report, "Open the map", "Test map" and a wave in the game; Cancel ending a running import; and, where tmp/wc3/
// holds them, the real test maps (skipped without).
import { test, expect, type Browser, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { gameReady, shot, waveButton } from '../support/game';

type Fixtures = typeof import('../../src/test/w3x-synthetic-map') & typeof import('../../src/test/w3x-fixtures');

/**
 * The specs' map builder (src/test/), bundled for this run: the repository's TypeScript is no module this
 * package's loader reads by itself
 */
async function fixtures(): Promise<Fixtures> {
  const out = await build({
    stdin: {
      contents: "export { buildSyntheticMap } from './w3x-synthetic-map'; export { findTestMap } from './w3x-fixtures';",
      resolveDir: resolve(dirname(fileURLToPath(import.meta.url)), '../../src/test'),
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    logLevel: 'silent',
  });
  return (await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`)) as Fixtures;
}

const { buildSyntheticMap, findTestMap } = await fixtures();

const REAL_MAPS = ['Mafa-Td-Queen-v14.6.w3x', 'Green TD.w3x', 'Green Circle TD Mega 2025.w3x'];

/** The editor in a context of its own, as a returning player, collecting page errors */
async function openEditor(browser: Browser, errors: string[]): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem('td_seen_version', '9999.0.0');
    localStorage.setItem('td_onboarding_v2', JSON.stringify({ done: true, completed: [] }));
    localStorage.setItem('td_globe_quality_v1', '"off"');
    localStorage.setItem('3dtd-editor-tour', 'done');
  });
  await page.goto('/editor');
  return page;
}

/** Picks a .w3x in "Import file" and waits for the options */
async function pick(page: Page, name: string, bytes: Uint8Array): Promise<void> {
  await page.locator('[data-test=import-input]').setInputFiles({ name, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) });
  await expect(page.locator('[data-test=import-panel]')).toBeVisible();
  await expect(page.locator('[data-test=w3x-import]')).toBeVisible();
}

test('imports a Reforged Lua map, opens it and plays a wave on it', async ({ browser }, testInfo) => {
  test.setTimeout(6 * 60_000);
  const errors: string[] = [];
  const page = await openEditor(browser, errors);
  await pick(page, 'lane-test.w3x', buildSyntheticMap({ reforged: true, lua: true }));

  // 16 m a tile: the 12-tile playable area becomes a map of 192 m
  const panel = page.locator('[data-test=import-panel]');
  await panel.locator('input[type=number]').first().fill('16');
  await page.locator('[data-test=w3x-import]').click();
  await expect(page.locator('[data-test=open-imported]')).toBeVisible({ timeout: 60_000 });
  await expect(panel).toContainText('Lane Test');
  await expect(panel).toContainText('to 192 x 192 m');
  await expect(panel).toContainText(/Roads from the map script .*1 spawns/);
  await shot(testInfo, page, 'report');

  await page.locator('[data-test=open-imported]').click();
  await page.waitForURL(/\/editor\?map=/);
  await expect(page.locator('[data-test=map-name]')).toHaveText(/Lane Test/);

  const [game] = await Promise.all([page.context().waitForEvent('page'), page.locator('[data-test=test-play]').click()]);
  game.on('pageerror', (e) => errors.push(e.message));
  await expect(game).toHaveURL(/world=map(:|%3A)lane-test/);
  await gameReady(game);
  await waveButton(game).click();
  await expect(waveButton(game)).toContainText(/left/i);
  // The wave walks the imported road to the HQ and ends
  await expect(waveButton(game)).not.toContainText(/left/i, { timeout: 4 * 60_000 });
  await shot(testInfo, game, 'wave');
  expect(errors).toEqual([]);
  await page.context().close();
});

test('Cancel ends a running import and keeps nothing', async ({ browser }) => {
  test.setTimeout(3 * 60_000);
  const errors: string[] = [];
  const page = await openEditor(browser, errors);
  await pick(page, 'cancel-test.w3x', buildSyntheticMap());
  // The importer's worker script comes late (the editor runs no other worker): the import stays running until Cancel
  let held = 0;
  await page.route(/\/worker-[^/]*\.js(\?|$)/, async (route) => {
    held++;
    await new Promise((r) => setTimeout(r, 8000));
    await route.continue().catch(() => undefined);
  });
  await page.locator('[data-test=w3x-import]').click();
  const panel = page.locator('[data-test=import-panel]');
  const cancel = panel.getByRole('button', { name: 'Cancel' });
  await expect(cancel).toBeVisible();
  await cancel.click();
  await expect(panel).toHaveCount(0);
  // Long after the worker would have answered: the map did not come into the list
  await page.waitForTimeout(10_000);
  await expect(page.locator('[data-map]').first()).toBeVisible();
  await expect(page.locator('[data-map]', { hasText: 'Lane Test' })).toHaveCount(0);
  expect(held, 'the worker script was asked for').toBeGreaterThan(0);
  expect(errors).toEqual([]);
  await page.context().close();
});

for (const file of REAL_MAPS) {
  const path = findTestMap(existsSync, file);
  test(`imports the test map ${file} and opens it`, async ({ browser }, testInfo) => {
    test.skip(!path, `${file} is not in tmp/wc3/`);
    test.setTimeout(3 * 60_000);
    const errors: string[] = [];
    const page = await openEditor(browser, errors);
    await pick(page, basename(path!), new Uint8Array(readFileSync(path!)));
    await page.locator('[data-test=w3x-import]').click();
    await expect(page.locator('[data-test=open-imported]')).toBeVisible({ timeout: 120_000 });
    await expect(page.locator('[data-test=import-panel]')).toContainText(/\d+ spawns/);
    await shot(testInfo, page, 'report');
    await page.locator('[data-test=open-imported]').click();
    await page.waitForURL(/\/editor\?map=/);
    await expect(page.locator('[data-test=map-name]')).not.toBeEmpty();
    expect(errors).toEqual([]);
    await page.context().close();
  });
}
