// The room options at work (docs/PLAYTEST.md T59 to T61, D38): cheats by
// rule, pause by rule, how the next wave starts.
import { test, expect, expectNoDesync } from '../support/fixtures';
import { clearWave, coopRoom, credits, devAction, openRoom, paused, shot, squadCredits, waveButton } from '../support/game';

test('cheats for the host only, pause for the host only, the host starts the waves', async ({ duo, relay }, testInfo) => {
  const { host, guest } = await coopRoom(duo, { options: { Cheats: 'Host only', 'Next wave': 'Host starts' }, start: true });

  await test.step('T59 the host cheat acts on both, the guest cheat on none', async () => {
    await expect(host.locator('app-coop-squad .chip', { hasText: 'CHEATS ON' })).toBeVisible();
    const hostBefore = await credits(host);
    await devAction(host, /Add 1000 credits/);
    await expect.poll(() => credits(host)).toBe(hostBefore + 1000);
    await expect.poll(() => squadCredits(guest, 'Ann')).toBe(hostBefore + 1000);
    const guestBefore = await credits(guest);
    await devAction(guest, /Add 1000 credits/);
    await guest.waitForTimeout(2000);
    expect(await credits(guest)).toBe(guestBefore);
    expect(await squadCredits(host, 'Bob')).toBe(guestBefore);
    await shot(testInfo, host, 't59-host');
  });

  await test.step('T60 the guest cannot pause, the host pauses both', async () => {
    await expect(guest.locator('.pause-btn')).toHaveAttribute('aria-disabled', 'true');
    await guest.locator('.pause-btn').click({ force: true });
    await guest.waitForTimeout(1500);
    expect(await paused(host)).toBe(false);
    await host.locator('.pause-btn').click();
    await expect.poll(() => paused(guest)).toBe(true);
    await host.locator('.pause-btn').click();
    await expect.poll(() => paused(guest)).toBe(false);
  });

  await test.step('T61 the host button starts the wave, the guest button readies', async () => {
    await expect(waveButton(host)).toContainText(/Start wave 1/i);
    await expect(waveButton(guest)).toContainText(/Ready for wave 1/i);
    await shot(testInfo, host, 't61-host-starts');
    await waveButton(host).click();
    await expect(waveButton(guest)).toContainText(/left/i);
  });
  expectNoDesync(relay);
});

test('anyone pauses, the next wave comes by itself after 10 s', async ({ duo, relay }, testInfo) => {
  const { host, guest } = await coopRoom(duo, { options: { Cheats: 'Host only', Pause: 'Anyone', 'Next wave': 'Auto 10 s' }, start: true });

  await test.step('T60 anyone: the guest pauses and resumes both', async () => {
    await guest.locator('.pause-btn').click();
    await expect.poll(() => paused(host)).toBe(true);
    await guest.locator('.pause-btn').click();
    await expect.poll(() => paused(host)).toBe(false);
  });

  await test.step('T61 all ready starts wave 1; after it the next counts down and comes by itself', async () => {
    await host.keyboard.press('Space');
    await guest.keyboard.press('Space');
    await expect(waveButton(host)).toContainText(/left/i);
    await clearWave(host);
    await expect(waveButton(guest)).toContainText(/\d+\s*s/);
    await shot(testInfo, guest, 't61-auto-guest');
    await expect(waveButton(guest)).toContainText(/Wave 2/i, { timeout: 30_000 });
    await expect(waveButton(guest)).toContainText(/left/i);
  });
  expectNoDesync(relay);
});

test('with pause off nobody pauses, the host neither', async ({ duo, relay }) => {
  const { host, guest } = await coopRoom(duo, { options: { Pause: 'Off' }, start: true });
  for (const page of [host, guest]) {
    await expect(page.locator('.pause-btn')).toHaveAttribute('aria-disabled', 'true');
    await page.locator('.pause-btn').click({ force: true });
    await page.keyboard.press('p');
    await page.waitForTimeout(1500);
    expect(await paused(host)).toBe(false);
    expect(await paused(guest)).toBe(false);
  }
  expectNoDesync(relay);
});

test.describe('a relay without cheats', () => {
  test.use({ relayCheats: false });

  test('T59 the cheat choices of the room are off', async ({ duo, relay: _relay }, testInfo) => {
    await openRoom(duo.host);
    const group = duo.host.locator('app-coop-dock').getByRole('radiogroup', { name: 'Cheats' });
    await expect(group.getByRole('radio', { name: 'Host only' })).toBeDisabled();
    await expect(group.getByRole('radio', { name: 'Everyone' })).toBeDisabled();
    await shot(testInfo, duo.host, 't59-no-cheats');
  });
});
