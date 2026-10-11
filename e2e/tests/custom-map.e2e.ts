// Custom maps in the game (docs/CUSTOM_MAP_WORLD.md), no map session: the shipped demo valley by link, a tower
// built and a wave played; the expert bot's trial of the map (?bot=trial) passing; the editor's "Test map" opening
// the game on the map it shows; a save and its load, a wave's replay, a building of a destructible map falling and
// standing again, coop on an own map a guest gets over the relay. Each test has pages of its own.
import { test, expect, type Browser, type Page } from '@playwright/test';
import { expectNoDesync } from '../support/fixtures';
import {
  buildArcher, credits, gameMenu, gameReady, inviteLink, openGameMenu, openRoom, relayQuery, runState, shot, startRelay, waveButton,
} from '../support/game';

const MAP = 'demo-valley';

/** A page of the game in a context of its own, as a returning player (`name` in coop), collecting page errors */
async function openPage(browser: Browser, errors: string[], name = ''): Promise<Page> {
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((coopName) => {
    localStorage.setItem('td_seen_version', '9999.0.0');
    localStorage.setItem('td_onboarding_v2', JSON.stringify({ done: true, completed: [] }));
    localStorage.setItem('td_globe_quality_v1', '"off"');
    if (coopName) localStorage.setItem('3dtd-coop-name', coopName);
  }, name);
  return page;
}

/** A yes of a question in the menu, when it comes within a moment */
async function confirmIfAsked(page: Page, label: string): Promise<void> {
  const button = gameMenu(page).getByRole('button', { name: label, exact: true });
  if (await button.waitFor({ timeout: 3000 }).then(() => true, () => false)) await button.click();
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

test('a save on a custom map comes back as it was, on the map', async ({ browser }) => {
  test.setTimeout(6 * 60_000);
  const errors: string[] = [];
  const page = await openPage(browser, errors);
  await page.goto(`/?world=map:${MAP}`);
  await gameReady(page);
  const menu = gameMenu(page);

  expect(await buildArcher(page), 'a tower stands').toBe(true);
  await openGameMenu(page);
  await menu.getByRole('menuitem', { name: 'Save game' }).click();
  await menu.locator('.mp-slot').first().click();
  await confirmIfAsked(page, 'Overwrite');
  await expect(menu.locator('.mp-status')).toContainText('Saved.');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  const saved = await runState(page);

  expect(await buildArcher(page), 'a second tower').toBe(true);
  await openGameMenu(page);
  await menu.getByRole('menuitem', { name: 'Load game' }).click();
  await menu.locator('.mp-slot-row', { hasNot: page.getByText('Autosave') }).first().locator('.mp-slot').click();
  await confirmIfAsked(page, 'Load');
  await expect(menu).toHaveCount(0, { timeout: 120_000 });
  await expect.poll(() => runState(page), { timeout: 120_000 }).toEqual(saved);
  // Still the map: its credit line, its link
  await expect(page.locator('.td-map-attribution')).toContainText('Demo');
  expect(page.url()).toMatch(new RegExp(`world=map(:|%3A)${MAP}`));
  expect(errors).toEqual([]);
  await page.context().close();
});

test('the replay of a wave on a custom map opens and closes', async ({ browser }, testInfo) => {
  test.setTimeout(8 * 60_000);
  const errors: string[] = [];
  const page = await openPage(browser, errors);
  await page.goto(`/?world=map:${MAP}`);
  await gameReady(page);
  expect(await buildArcher(page), 'a tower stands').toBe(true);
  const speed = page.locator('.speed-btn');
  for (let i = 0; i < 3 && !/4x/.test(await speed.innerText()); i++) await speed.click();
  await page.keyboard.press('Space');
  await expect(waveButton(page)).toContainText(/left/i);
  await expect(waveButton(page)).not.toContainText(/left/i, { timeout: 5 * 60_000 });
  await page.getByRole('button', { name: /Replay wave \d+/ }).click();
  await expect(page.locator('app-replay-bar, .td-replay-bar').first()).toBeVisible({ timeout: 60_000 });
  await shot(testInfo, page, 'replay');
  await page.keyboard.press('Escape');
  await expect(page.locator('app-replay-bar, .td-replay-bar')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator('.td-map-attribution')).toContainText('Demo');
  expect(errors).toEqual([]);
  await page.context().close();
});

/** `__worldDamage` of a destructible world in development (presentation/world-damage-presenter.ts) */
interface WorldDamageHook {
  structures(): { id: string; lat: number; lon: number; hp: number }[];
  hit(lat: number, lon: number, reach?: number, amount?: number): void;
}

test('a building of a destructible map falls to a hit and stands again after a restart', async ({ browser }) => {
  test.setTimeout(5 * 60_000);
  const errors: string[] = [];
  const page = await openPage(browser, errors);
  // The ruined city says its buildings fall (gameplay.destructible, TODO E131)
  await page.goto('/?world=map:ruined-city');
  await gameReady(page);
  await page.waitForFunction(
    () => ((globalThis as { __worldDamage?: WorldDamageHook }).__worldDamage?.structures().length ?? 0) > 0,
    null,
    { timeout: 60_000 },
  );
  // The hit goes through the simulation; its fallen set comes back with a packet
  const id = await page.evaluate(() => {
    const damage = (globalThis as unknown as { __worldDamage: WorldDamageHook }).__worldDamage;
    const s = damage.structures()[0];
    damage.hit(s.lat, s.lon, 0.5, 1e6);
    return s.id;
  });
  const hpOf = (i: string) => page.evaluate((x) =>
    (globalThis as unknown as { __worldDamage: WorldDamageHook }).__worldDamage.structures().find((s) => s.id === x)!.hp, i);
  await expect.poll(() => hpOf(id), { timeout: 30_000 }).toBe(0);

  // Restart here: a new run stands every structure up again
  await openGameMenu(page);
  await page.locator('app-main-menu [data-entry="restart"]').click();
  await confirmIfAsked(page, 'Restart');
  await expect.poll(() => hpOf(id), { timeout: 60_000 }).toBeGreaterThan(0);
  expect(errors).toEqual([]);
  await page.context().close();
});

test('coop on an own map: a guest without it gets the map over the relay, both play a wave', async ({ browser }, testInfo) => {
  test.setTimeout(12 * 60_000);
  const errors: string[] = [];
  const relay = await startRelay();
  try {
    const host = await openPage(browser, errors, 'Ann');
    // An own copy of the demo valley: the guest has the shipped one, not this
    await host.goto('/editor');
    await host.locator(`[data-map="${MAP}"]`).first().click();
    await host.locator('[data-test=open-map]').click();
    await host.waitForURL(/\/editor\?map=/);
    const copy = new URL(host.url()).searchParams.get('map')!;
    expect(copy).not.toBe(MAP);

    await host.goto(`/?world=map:${copy}${relayQuery()}`);
    await gameReady(host);
    await openRoom(host);
    let invite = await inviteLink(host);
    if (relayQuery() && !invite.includes('relay=')) invite += relayQuery();

    const guest = await openPage(browser, errors, 'Bob');
    await guest.goto(invite);
    // The map comes in pieces over the relay, the page loads anew on it and joins again
    await expect(host.locator('app-coop-room-table .who')).toHaveCount(2, { timeout: 180_000 });
    await gameReady(guest);
    await expect(guest).toHaveURL(new RegExp(`world=map(:|%3A)${copy}`));
    await guest.getByRole('button', { name: 'Ready up' }).click({ timeout: 120_000 });
    await host.getByRole('button', { name: 'Start match' }).click({ timeout: 30_000 });
    const anyway = host.locator('app-coop-dock').getByRole('button', { name: 'Start anyway' });
    if (await anyway.waitFor({ timeout: 3000 }).then(() => true, () => false)) await anyway.click();
    for (const page of [host, guest]) await page.locator('app-coop-squad .squad').waitFor({ timeout: 90_000 });
    await shot(testInfo, guest, 'guest-on-map');

    await host.keyboard.press('Space');
    await guest.keyboard.press('Space');
    await expect(waveButton(host)).toContainText(/left/i, { timeout: 60_000 });
    await expect(waveButton(host)).not.toContainText(/left/i, { timeout: 6 * 60_000 });
    await shot(testInfo, host, 'host-after-wave');
    expectNoDesync(relay);
    expect(errors).toEqual([]);
    await host.context().close();
    await guest.context().close();
  } finally {
    await relay.stop();
    await testInfo.attach('relay.log', { body: relay.log(), contentType: 'text/plain' });
  }
});
