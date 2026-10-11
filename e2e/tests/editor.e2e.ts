// The map editor (/editor, docs/LEVEL_EDITOR.md), no map session: a new map,
// a raised hill, an object (undo and redo), a road branching off the starter
// road, a spawn at its end, the check, saving, a reload that brings the map
// back, and deleting it again in the map browser.
import { test, expect, type Page } from '@playwright/test';
import { shot } from '../support/game';

/** Number in a text like "height 3.4 m" or "4 roads" */
function numberIn(text: string | null): number {
  const m = /-?\d+(?:\.\d+)?/.exec(text ?? '');
  if (!m) throw new Error(`No number in "${text}"`);
  return Number(m[0]);
}

async function heightAt(page: Page, x: number, y: number): Promise<number> {
  await page.mouse.move(x + 3, y);
  await page.mouse.move(x, y);
  // The status bar reads the pointer a few times a second
  await page.waitForTimeout(300);
  return numberIn(await page.locator('[data-test=height]').textContent());
}

test('builds, checks, saves and reloads a map in the editor', async ({ page }, testInfo) => {
  test.setTimeout(5 * 60_000);
  await page.addInitScript(() => localStorage.setItem('td_seen_version', '9999.0.0'));
  page.on('pageerror', (e) => console.log(`pageerror: ${e.message}`));
  await page.goto('/editor');

  const name = `E2E map ${Date.now()}`;
  await page.locator('[data-test=new-map]').click();
  await page.locator('[data-test=new-name]').fill(name);
  await page.locator('[data-test=create-map]').click();
  await expect(page.locator('[data-test=map-name]')).toHaveText(name);
  await expect(page).toHaveURL(/\/editor\?map=e2e-map-/);
  const viewport = page.locator('[data-test=viewport]');
  const box = (await viewport.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.waitForTimeout(800);

  // Terrain: hold the raise brush
  await page.keyboard.press('2');
  const before = await heightAt(page, cx, cy);
  // Held until the ground rose: a page still loading textures draws few frames
  await page.mouse.down();
  await expect.poll(async () => numberIn(await page.locator('[data-test=height]').textContent()), { timeout: 15_000 }).toBeGreaterThan(before + 1);
  await page.mouse.up();
  await shot(testInfo, page, 'raised');

  // Objects: place one, undo, redo
  await page.keyboard.press('5');
  await page.locator('[data-asset="tree-oak"]').click();
  await page.mouse.click(cx - 140, cy + 90);
  await expect(page.locator('[data-test=objects]')).toHaveText('1 objects');
  await page.keyboard.press('Control+z');
  await expect(page.locator('[data-test=objects]')).toHaveText('0 objects');
  await page.keyboard.press('Control+y');
  await expect(page.locator('[data-test=objects]')).toHaveText('1 objects');

  // Paths: a road off the starter road, three clicks and Enter
  await page.keyboard.press('6');
  const roads = numberIn(await page.locator('[data-test=roads]').textContent());
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(400);
  await page.mouse.click(cx + 60, cy + 150);
  await page.waitForTimeout(400);
  await page.mouse.click(cx + 180, cy + 250);
  await page.keyboard.press('Enter');
  await expect.poll(async () => numberIn(await page.locator('[data-test=roads]').textContent())).toBeGreaterThan(roads);

  // A spawn at the end of the new road
  await page.keyboard.press('7');
  await page.mouse.click(cx + 180, cy + 250);
  await expect(page.locator('[data-spawn]')).toHaveCount(2);

  // Check: every spawn reaches the HQ
  await page.locator('[data-test=check]').click();
  await expect(page.locator('[data-code="spawn-unreachable"], [data-code="spawn-off-path"], [data-code="hq-off-path"]')).toHaveCount(0);
  await shot(testInfo, page, 'checked');

  // Save, reload: the map comes back as it was
  await page.keyboard.press('Control+s');
  await expect(page.locator('[data-test=save-state]')).toHaveText('Saved');
  const roadsSaved = await page.locator('[data-test=roads]').textContent();
  await page.reload();
  await expect(page.locator('[data-test=map-name]')).toHaveText(name);
  await expect(page.locator('[data-test=objects]')).toHaveText('1 objects');
  await page.keyboard.press('7');
  await expect(page.locator('[data-spawn]')).toHaveCount(2);
  await expect(page.locator('[data-test=roads]')).toHaveText(roadsSaved!);
  await shot(testInfo, page, 'reloaded');

  // Back in the browser the map is listed with its picture; delete it
  await page.locator('[data-test=back]').click();
  const row = page.locator('.mb-row', { hasText: name });
  await expect(row).toBeVisible();
  await expect(row.locator('img')).toBeVisible();
  await row.click();
  await page.getByRole('button', { name: 'Delete', exact: true }).first().click();
  await page.locator('.td-banner').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.locator('.mb-row', { hasText: name })).toHaveCount(0);
});
