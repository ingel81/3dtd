// A running coop game (docs/PLAYTEST.md T6, T10, T34, T43, T48, T50, T62):
// the squad box and chat, gold between players, a guest that falls behind,
// game over and the next run, going on alone when the relay ends.
import { test, expect, expectNoDesync } from '../support/fixtures';
import { chatText, coopRoom, credits, devAction, freeze, shot, squadCredits, waveButton } from '../support/game';

test('squad box, chat, the ping hint and gold between players (T62, T50, T6)', async ({ duo, relay }, testInfo) => {
  const { host, guest } = await coopRoom(duo, { start: true });

  await test.step('T62 you first, the footer says what to do', async () => {
    await expect(guest.locator('app-coop-squad .sq').first()).toContainText('Bob');
    await expect(guest.locator('app-coop-squad .sq-foot')).toContainText(/Ready up for the next wave/);
  });

  await test.step('chat: Enter opens, Enter sends, the other side reads it', async () => {
    await host.keyboard.press('Enter');
    await host.locator('app-coop-chat input').fill('rockets on the corner');
    await host.locator('app-coop-chat input').press('Enter');
    await expect.poll(() => chatText(guest)).toMatch(/rockets on the corner/);
  });

  await test.step('T50 X shows the ping hint, Esc drops it', async () => {
    await guest.keyboard.press('x');
    await expect(guest.locator('app-coop-chat .armed')).toBeVisible();
    await shot(testInfo, guest, 'ping-armed');
    await guest.keyboard.press('Escape');
    await expect(guest.locator('app-coop-chat .armed')).toHaveCount(0);
  });

  await test.step('T6 the host sends 50 gold: it moves at the tick on both sides', async () => {
    const [hostBefore, guestBefore] = [await credits(host), await credits(guest)];
    await host.getByRole('button', { name: 'Send Bob credits' }).click();
    await host.locator('app-coop-squad .gift').getByRole('button', { name: '50', exact: true }).click();
    await expect.poll(() => credits(host)).toBe(hostBefore - 50);
    await expect.poll(() => credits(guest)).toBe(guestBefore + 50);
    await expect.poll(() => squadCredits(host, 'Bob')).toBe(guestBefore + 50);
    await expect.poll(() => chatText(guest)).toMatch(/Ann sent you 50 gold/);
  });
  expectNoDesync(relay);
});

test('a guest that falls behind is waited for, then the game goes on (T34)', async ({ duo, relay }, testInfo) => {
  const { host, guest } = await coopRoom(duo, { start: true });
  await host.keyboard.press('Space');
  await guest.keyboard.press('Space');
  await expect(waveButton(host)).toContainText(/left/i);
  const frozen = freeze(guest, 12_000);
  await expect(host.locator('app-coop-squad .sq-foot')).toContainText(/Waiting for Bob to catch up/, { timeout: 11_000 });
  await shot(testInfo, host, 'waiting');
  await frozen;
  // Caught up: the room goes on, nobody waits any more (in a wave the footer goes when nothing is to say)
  // Read at once: the footer can go between finding it and reading it
  const footerText = () => host.evaluate(() => document.querySelector('app-coop-squad .sq-foot')?.textContent ?? '');
  await expect.poll(footerText, { timeout: 60_000 }).not.toMatch(/catch up/);
  expect(relay.log()).toMatch(/waiting for Bob \(p\d+\) to catch up/);
  expectNoDesync(relay);
});

test('game over shows each player’s part; the host starts the next run on both (T43, T10)', async ({ duo, relay }, testInfo) => {
  const { host, guest } = await coopRoom(duo, { options: { Cheats: 'Host only' }, start: true });
  // The host's cheat takes the HQ's health to 0: the run ends at the next
  // step, on both sides (the first click adds 1000, each Shift+right-click takes 1000)
  await devAction(host, /Add 1000 HP/);
  const health = host.getByRole('button', { name: /Add 1000 HP/ });
  await health.click({ button: 'right', modifiers: ['Shift'] });
  await health.click({ button: 'right', modifiers: ['Shift'] });
  for (const page of [host, guest]) await expect(page.locator('.td-coop-summary')).toBeVisible({ timeout: 60_000 });
  await expect(host.locator('.td-coop-summary')).toContainText('Bob');
  await expect(guest.locator('.td-gameover-wait')).toContainText('The host starts the next run.');
  await shot(testInfo, guest, 'game-over-guest');
  await host.getByRole('button', { name: /restart/i }).click();
  for (const page of [host, guest]) await expect(page.locator('.td-coop-summary')).toHaveCount(0, { timeout: 60_000 });
  await expect(waveButton(guest)).toContainText(/wave 1/i);
  expectNoDesync(relay);
});

test('the relay ends in the game: going on alone works (T48)', async ({ duo, relay }, testInfo) => {
  const { host } = await coopRoom(duo, { options: { Cheats: 'Host only' }, start: true });
  await relay.stop();
  await expect(host.locator('app-coop-squad')).toContainText('OFFLINE', { timeout: 30_000 });
  await shot(testInfo, host, 'offline');
  await host.getByRole('button', { name: 'Continue alone' }).click();
  // Alone the commands act again: a cheat and a wave
  const before = await credits(host);
  await devAction(host, /Add 1000 credits/);
  await expect.poll(() => credits(host)).toBe(before + 1000);
  await host.keyboard.press('Space');
  await expect(waveButton(host)).toContainText(/left/i);
});
