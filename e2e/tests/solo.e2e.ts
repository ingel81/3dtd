// The single player game on the run's host page, out of any room (docs/PLAYTEST.md
// M5 and a smoke run of the basics): build, a wave, a dialog, the replay, a
// new place. The dice changes the place in the game: no new map session.
import { test, expect } from '../support/fixtures';
import { clearWave, credits, devAction, gameReady, shot, waveButton } from '../support/game';

test('smoke: build a tower, play a wave, open a dialog, watch the replay', async ({ duo, relay: _relay }, testInfo) => {
  const page = duo.host;

  await test.step('build an archer tower: a click on the map where one fits', async () => {
    const before = await credits(page);
    let built = false;
    for (let r = 90; r <= 390 && !built; r += 60) {
      for (let a = 0; a < 360 && !built; a += 45) {
        const x = Math.round(650 + r * Math.cos((a * Math.PI) / 180));
        const y = Math.round(470 + r * 0.8 * Math.sin((a * Math.PI) / 180));
        await page.keyboard.press('1');
        await page.mouse.move(x, y);
        await page.waitForTimeout(200);
        await page.mouse.click(x, y);
        await page.waitForTimeout(700);
        built = (await credits(page)) < before;
      }
    }
    await page.keyboard.press('Escape');
    expect(built, 'a tower stands').toBe(true);
    await shot(testInfo, page, 'tower');
  });

  await test.step('a wave starts and ends by itself at 4x (no cheat: a wave with one offers no replay)', async () => {
    const speed = page.locator('.speed-btn');
    for (let i = 0; i < 3 && !/4x/.test(await speed.innerText()); i++) await speed.click();
    await expect(speed).toContainText(/4x/);
    await page.keyboard.press('Space');
    await expect(waveButton(page)).toContainText(/left/i);
    await expect(waveButton(page)).not.toContainText(/left/i, { timeout: 5 * 60_000 });
    for (let i = 0; i < 3 && !/1x/.test(await speed.innerText()); i++) await speed.click();
  });

  // (Q opens research only with a Research Center standing; the smoke run builds none)
  await test.step('a dialog opens and closes: the key overview (H)', async () => {
    await page.keyboard.press('h');
    await expect(page.locator('mat-dialog-container')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('mat-dialog-container')).toHaveCount(0);
  });

  await test.step('the replay of the last wave opens and closes', async () => {
    await page.getByRole('button', { name: /Replay wave \d+/ }).click();
    await expect(page.locator('app-replay-bar, .td-replay-bar').first()).toBeVisible({ timeout: 60_000 });
    await shot(testInfo, page, 'replay');
    await page.keyboard.press('Escape');
    await expect(page.locator('app-replay-bar, .td-replay-bar')).toHaveCount(0, { timeout: 30_000 });
  });
});

test('M5 a new place starts the pressure loop at ×1.00, it opens over clean waves', async ({ duo, relay: _relay }, testInfo) => {
  const page = duo.host;
  const why = async () => (await page.locator('body').innerText()).match(/Pressure loop[^\n]*/)?.[0] ?? '';
  // A fresh run: the page played the coop tests' waves before, clean ones the loop would count
  await page.getByRole('button', { name: 'Random location' }).click();
  await page.waitForTimeout(3000);
  await gameReady(page);
  // The wave debug window with its "why"
  await devAction(page, 'Wave spawner');
  for (let i = 0; i < 3; i++) await page.keyboard.press('+');
  await page.keyboard.press('Space');
  await expect.poll(why, { timeout: 30_000 }).toMatch(/collecting \(0 of \d waves\), at ×1\.00/);
  await shot(testInfo, page, 'm5-new-place');
  await clearWave(page);

  // Four warm-up waves the loop does not count (PRESSURE_WARMUP_WAVES), then three it needs (PRESSURE_MIN_SAMPLES)
  for (let wave = 2; wave <= 7; wave++) {
    await page.keyboard.press('Space');
    await expect(waveButton(page)).toContainText(/left/i);
    await clearWave(page);
  }
  await page.keyboard.press('Space');
  await expect.poll(why).toMatch(/opened to ×1\.\d\d/);
  await shot(testInfo, page, 'm5-opened');
  await clearWave(page);
});
