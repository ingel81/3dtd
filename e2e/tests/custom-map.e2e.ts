// Custom maps in the game (docs/CUSTOM_MAP_WORLD.md), no map session: the shipped demo valley by link, a tower
// built and a wave played; the expert bot's trial of the map (?bot=trial) passing; the editor's "Test map" opening
// the game on the map it shows. Each test has a page of its own.
import { test, expect, type Browser, type Page } from '@playwright/test';
import { buildArcher, credits, gameReady, shot, waveButton } from '../support/game';

const MAP = 'demo-valley';

/** A page of the game in a context of its own, as a returning player, collecting page errors */
async function openPage(browser: Browser, errors: string[]): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem('td_seen_version', '9999.0.0');
    localStorage.setItem('td_onboarding_v2', JSON.stringify({ done: true, completed: [] }));
    localStorage.setItem('td_globe_quality_v1', '"off"');
  });
  return page;
}

test('plays the shipped demo valley: a tower, a wave, kills', async ({ browser }, testInfo) => {
  test.setTimeout(6 * 60_000);
  const errors: string[] = [];
  const page = await openPage(browser, errors);
  await page.goto(`/?world=map:${MAP}`);
  await gameReady(page);
  await expect(page.locator('.td-map-attribution')).toContainText('Demo');
  // The map from above in the corner; a click on it glides the camera there
  const minimap = page.locator('[data-test=world-minimap]');
  await expect(minimap).toBeVisible();
  await shot(testInfo, page, 'loaded');

  expect(await buildArcher(page), 'a tower stands').toBe(true);
  const before = await credits(page);
  await waveButton(page).click();
  await expect(waveButton(page)).toContainText(/left/i);
  // The wave walks the map's roads to the HQ; the tower earns a bounty on the way or the wave ends
  await expect.poll(async () => (await credits(page)) > before || !/left/i.test(await waveButton(page).innerText()), {
    timeout: 4 * 60_000,
    intervals: [2000],
  }).toBe(true);
  await shot(testInfo, page, 'wave');
  await minimap.click({ position: { x: 20, y: 20 } });
  await shot(testInfo, page, 'minimap-jump');
  expect(errors).toEqual([]);
  await page.context().close();
});

test('the bot holds the first waves of the demo valley (map trial)', async ({ browser }) => {
  test.setTimeout(8 * 60_000);
  const errors: string[] = [];
  const page = await openPage(browser, errors);
  // A trial skips the start menu and plays on its own at high speed
  await page.goto(`/?world=map:${MAP}&bot=trial&trialWaves=3`);
  const result = await page.waitForFunction(() => (window as { __mapTrial?: { outcome: string } }).__mapTrial ?? null, null, {
    timeout: 7 * 60_000,
    polling: 1000,
  });
  const trial = (await result.jsonValue()) as { outcome: string; wavesHeld: number; waves: number };
  expect(trial).toMatchObject({ outcome: 'passed', waves: 3, wavesHeld: 3 });
  expect(errors).toEqual([]);
  await page.context().close();
});

test("the editor's Test map opens the game on the map it shows", async ({ browser }) => {
  test.setTimeout(5 * 60_000);
  const errors: string[] = [];
  const page = await openPage(browser, errors);
  await page.goto(`/editor?map=${MAP}`);
  await expect(page.locator('[data-test=map-name]')).toHaveText(/Demo/);
  const [game] = await Promise.all([page.context().waitForEvent('page'), page.locator('[data-test=test-play]').click()]);
  game.on('pageerror', (e) => errors.push(e.message));
  await expect(game).toHaveURL(new RegExp(`world=map(:|%3A)${MAP}`));
  await gameReady(game);
  await expect(game.locator('app-quick-actions')).toBeVisible();
  expect(errors).toEqual([]);
  await page.context().close();
});
