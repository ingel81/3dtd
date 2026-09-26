// The coop lobby (docs/PLAYTEST.md T36, T47, T54, T56, T58, T63, T65, D47):
// the entry dock, what the host sees while a guest comes, the host's rights,
// a guest following the host to a new place.
import { test, expect } from '../support/fixtures';
import { DEFAULT_PLACE, chatText, coopRoom, gameReady, inviteLink, joinByCode, openDock, openRoom, roomCode, shot } from '../support/game';

test('the entry dock: no scrolling sideways, no focus left on the coop button (T54, T63)', async ({ duo, relay: _relay }, testInfo) => {
  const page = duo.host;
  await openDock(page);
  const body = page.locator('app-coop-dock .body');
  await expect(body).toBeVisible();
  expect(await body.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '');
  expect(focused).not.toMatch(/coop/i);
  await expect(page.getByRole('button', { name: 'Host a room' })).toBeVisible();
  await shot(testInfo, page, 'entry');

  await test.step('U5 Tab walks the controls of the dock and leaves it open; Esc closes it', async () => {
    await page.locator('app-coop-dock .field input').click();
    for (let i = 0; i < 3; i++) await page.keyboard.press('Tab');
    await expect(page.locator('app-coop-dock')).toBeVisible();
    expect(await page.evaluate(() => !!document.activeElement?.closest('app-coop-dock'))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.locator('app-coop-dock')).toHaveCount(0);
  });
});

test('the host sees a guest come by the invite link and load; name, options, kick and lock (D47, T56, T58, T36)', async ({ duo, relay: _relay }, testInfo) => {
  const { host, guest } = duo;
  await openRoom(host);
  const code = await roomCode(host);

  await test.step('D47 the guest joins at once; its row says it loads the map, then the chat says it stands', async () => {
    // An invite link loads the page: a map session more
    await guest.goto(await inviteLink(host));
    const row = host.locator('app-coop-dock .row-lane', { hasText: 'Bob' });
    await expect(row.locator('.doing')).toContainText(/loading the map/i, { timeout: 60_000 });
    await expect(host.locator('app-coop-dock .status')).toContainText(/Waiting for Bob to load the map/);
    await shot(testInfo, host, 'guest-loading');
    await gameReady(guest);
    await expect.poll(() => chatText(host), { timeout: 60_000 }).toMatch(/Bob's map stands/);
    const chat = await chatText(host);
    expect(chat).toMatch(/Bob joined/);
    expect(chat).toMatch(/Bob is loading the map/);
  });

  await test.step('T56 T58 the own name is a field; options open for the host, a toggle for the guest', async () => {
    await expect(host.locator('app-coop-dock .name-edit input')).toBeVisible();
    await expect(host.locator('app-coop-dock .sets')).toBeVisible();
    await openDock(guest);
    await expect(guest.locator('app-coop-dock .toggle-label')).toContainText(/show all/i);
    await shot(testInfo, host, 'lobby-host');
    await shot(testInfo, guest, 'lobby-guest');
  });

  await test.step('T36 the host takes the guest out, then closes the room', async () => {
    await host.getByRole('button', { name: 'Take Bob out of the room' }).click();
    await expect(guest.locator('app-coop-dock')).toContainText('The host took you out of the room.');
    // The lock, not the public listing beside it
    const lock = host.getByRole('button', { name: /^(Open to new players|Locked)$/ });
    await lock.click();
    await expect(lock).toContainText('Locked');
    await joinByCode(guest, code);
    await expect(guest.locator('app-coop-dock')).toContainText('The host closed the room to new players.');
  });
});

test('a guest follows the host to a new place in the page and keeps its lane (T65, D47)', async ({ duo, relay: _relay }, testInfo) => {
  const { host, guest } = await coopRoom(duo);
  const lane = (await host.locator('app-coop-dock .row-lane', { hasText: 'Bob' }).locator('.lane b').innerText()).match(/Spawn \d/)?.[0] ?? '';
  // The host's dice changes the place in the game; the guest goes there in the page, no reload (no map session more)
  await guest.evaluate(() => { (window as unknown as { samePage?: boolean }).samePage = true; });
  await host.getByRole('button', { name: 'Random location' }).click();
  await expect.poll(() => chatText(host), { timeout: 120_000 }).toMatch(/Bob is loading the map/);
  await gameReady(host);
  await gameReady(guest);
  const row = host.locator('app-coop-dock .row-lane', { hasText: 'Bob' });
  await expect(row).toBeVisible({ timeout: 120_000 });
  await expect(row.locator('.lane b')).toContainText(lane, { timeout: 120_000 });
  expect(await chatText(host)).not.toMatch(/Bob left|Bob reloads/);
  expect(await guest.evaluate(() => (window as unknown as { samePage?: boolean }).samePage)).toBe(true);
  await shot(testInfo, host, 'after-new-place');
});

test('an invite link without a map key shows the token screen with the room (T47)', async ({ browser }, testInfo) => {
  // No map key, no tiles: no map session
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/?l=${DEFAULT_PLACE}&room=ABC123&nokey`);
  await expect(page.locator('.token-coop')).toContainText('ABC123', { timeout: 60_000 });
  await shot(testInfo, page, 'nokey');
  await context.close();
});
