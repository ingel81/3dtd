// The single player game on the run's host page, out of any room (docs/PLAYTEST.md
// M5 and a smoke run of the basics): build, a wave, a dialog, the replay, a
// new place. The dice changes the place in the game: no new map session.
import { test, expect } from '../support/fixtures';
import { buildArcher, clearWave, credits, devAction, gameMenu, gameReady, openGameMenu, runState, shot, waveButton } from '../support/game';

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
    // Escape leaves the build mode; with none left it opens the game menu, which then goes again
    await page.keyboard.press('Escape');
    const menu = page.getByRole('dialog', { name: 'Menu' });
    // The menu opens with an animation: wait for it a moment before closing it
    if (await menu.waitFor({ state: 'visible', timeout: 2000 }).then(() => true, () => false)) await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
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

test('M5 a new place starts the pressure loop at ×1.00 and counts only its own waves', async ({ duo, relay: _relay }, testInfo) => {
  const page = duo.host;
  // The loop's factor R in "Why this wave" (wave debugger), null while no wave is explained
  const loop = async () => {
    const r = (await page.locator('.budget-grid').innerText().catch(() => '')).match(/\bR (\d+(?:\.\d+)?)/);
    return r ? Number(r[1]) : null;
  };
  // A fresh run: the page played the coop tests' waves before, clean ones the loop would count
  await page.getByRole('button', { name: 'Random city' }).click();
  await page.waitForTimeout(3000);
  await gameReady(page);
  // The wave debug window with its "why"
  await devAction(page, 'Wave spawner');
  for (let i = 0; i < 3; i++) await page.keyboard.press('+');
  await page.keyboard.press('Space');
  await expect.poll(loop, { timeout: 30_000 }).toBe(1);
  await shot(testInfo, page, 'm5-new-place');
  await clearWave(page);

  // One warm-up wave the loop does not count (BUDGET_REGULATOR_START), then the waves it measures. The cap follows
  // the loop (CAP_FOLLOWS_REGULATOR), so capped waves move it too; how far depends on what slips through between two
  // "Kill all" on a short route, so only its bounds are checked
  for (let wave = 2; wave <= 7; wave++) {
    await page.keyboard.press('Space');
    await expect(waveButton(page)).toContainText(/left/i);
    await clearWave(page);
  }
  await page.keyboard.press('Space');
  const regulator = () => page.evaluate(() => {
    const w = window as unknown as { ng: { getComponent(el: Element | null): Record<string, never> } };
    const source = (w.ng.getComponent(document.querySelector('app-tower-defense')) as never as {
      facade: { waveDirector: { source: { pressure: { status: { samples: number; meanPressure: number | null; lastStep: string } } } } };
    }).facade.waveDirector.source;
    return source.pressure.status;
  });
  await expect.poll(async () => (await regulator()).samples).toBe(6);
  const r = await loop();
  expect(r).not.toBeNull();
  expect(r!).toBeGreaterThanOrEqual(0.5);
  expect(r!).toBeLessThanOrEqual(2.5);
  await shot(testInfo, page, 'm5-held');
  await clearWave(page);
});

test('S1 a save comes back as it was, from its slot and from its file, while a run is under way', async ({ duo, relay: _relay }, testInfo) => {
  const page = duo.host;
  const menu = gameMenu(page);
  const confirm = async (label: string) => {
    const button = menu.getByRole('button', { name: label, exact: true });
    if (await button.waitFor({ timeout: 3000 }).then(() => true, () => false)) await button.click();
  };

  await test.step('save into slot 1', async () => {
    expect(await buildArcher(page), 'a tower stands').toBe(true);
    await openGameMenu(page);
    await menu.getByRole('menuitem', { name: 'Save game' }).click();
    await menu.locator('.mp-slot').first().click();
    await confirm('Overwrite');
    await expect(menu.locator('.mp-status')).toContainText('Saved.');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
  });
  const saved = await runState(page);

  await test.step('another tower, then slot 1 loads the run as it was', async () => {
    expect(await buildArcher(page)).toBe(true);
    await openGameMenu(page);
    await menu.getByRole('menuitem', { name: 'Load game' }).click();
    await menu.locator('.mp-slot-row', { hasNot: page.getByText('Autosave') }).first().locator('.mp-slot').click();
    await confirm('Load');
    await expect(menu).toHaveCount(0, { timeout: 120_000 });
    await expect.poll(() => runState(page), { timeout: 120_000 }).toEqual(saved);
  });

  await test.step('the file of slot 1 loads it too (the question before Pick file kept the file input)', async () => {
    await openGameMenu(page);
    await menu.getByRole('menuitem', { name: 'Load game' }).click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      menu.locator('.mp-slot-row', { hasNot: page.getByText('Autosave') }).first().locator('.mp-slot-tool').first().click(),
    ]);
    const file = testInfo.outputPath(download.suggestedFilename());
    await download.saveAs(file);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    expect(await buildArcher(page)).toBe(true);
    await openGameMenu(page);
    await menu.getByRole('menuitem', { name: 'Load game' }).click();
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      (async () => {
        await menu.getByRole('button', { name: 'Load from a file' }).click();
        await confirm('Pick file');
      })(),
    ]);
    await chooser.setFiles(file);
    await expect(menu).toHaveCount(0, { timeout: 120_000 });
    await expect.poll(() => runState(page), { timeout: 120_000 }).toEqual(saved);
  });
});
