// The map editor (/editor, docs/LEVEL_EDITOR.md), no map session: a new map,
// a raised hill, an object (undo and redo), a road branching off the starter
// road, a spawn at its end, a mirrored object, a copied and placed piece, the
// check, saving, a reload that brings the map back, and deleting it again in
// the map browser. A second run builds a city from a template and tries the
// palette, the trial wave, a lasso, a group and the version list. A third
// runs the check's bot test on a fresh map, a fourth the first-run tour and
// the level guide.
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
  await page.addInitScript(() => {
    localStorage.setItem('td_seen_version', '9999.0.0');
    // The editor's first-run tour has its own test
    localStorage.setItem('3dtd-editor-tour', 'done');
  });
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

  // Symmetry: one click places the object and its mirror image
  await page.locator('[data-test=symmetry]').selectOption('x');
  await page.keyboard.press('5');
  await page.locator('[data-mode=place]').click();
  await page.mouse.click(cx - 200, cy - 60);
  await expect(page.locator('[data-test=objects]')).toHaveText('3 objects');
  await page.locator('[data-test=symmetry]').selectOption('none');

  // Copy a rectangle around the first tree and place it elsewhere
  await page.keyboard.press('0');
  await page.mouse.move(cx - 175, cy + 60);
  await page.mouse.down();
  await page.mouse.move(cx - 105, cy + 120, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.press('Control+c');
  await page.mouse.click(cx + 120, cy - 120);
  await expect(page.locator('[data-test=objects]')).toHaveText('4 objects');
  await shot(testInfo, page, 'symmetry-and-paste');

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
  await expect(page.locator('[data-test=objects]')).toHaveText('4 objects');
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

test('makes a map from a template and uses the pro tools on it', async ({ page }) => {
  test.setTimeout(4 * 60_000);
  await page.addInitScript(() => {
    localStorage.setItem('td_seen_version', '9999.0.0');
    // The editor's first-run tour has its own test
    localStorage.setItem('3dtd-editor-tour', 'done');
  });
  page.on('pageerror', (e) => console.log(`pageerror: ${e.message}`));
  await page.goto('/editor');

  const name = `E2E city ${Date.now()}`;
  await page.locator('[data-test=new-map]').click();
  await page.locator('[data-test=new-name]').fill(name);
  await page.getByRole('radio', { name: /Small/ }).click();
  await page.locator('[data-template=city]').click();
  await page.locator('[data-test=create-map]').click();
  await expect(page.locator('[data-test=map-name]')).toHaveText(name, { timeout: 60_000 });
  await expect.poll(async () => numberIn(await page.locator('[data-test=objects]').textContent())).toBeGreaterThan(100);
  const box = (await page.locator('[data-test=viewport]').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // The command palette starts the trial wave
  await page.keyboard.press('Control+k');
  await page.locator('[data-test=palette-field]').fill('trial wave');
  await page.keyboard.press('Enter');
  await expect(page.locator('.es-flash')).toContainText('Trial wave');

  // A lasso over the middle selects objects; Ctrl+G groups them
  await page.keyboard.press('5');
  await page.locator('[data-mode=select]').click();
  await page.keyboard.down('Alt');
  await page.mouse.move(cx - 220, cy - 160);
  await page.mouse.down();
  for (const [x, y] of [[cx + 220, cy - 160], [cx + 220, cy + 160], [cx - 220, cy + 160]]) await page.mouse.move(x, y, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await expect(page.locator('.es-flash')).toContainText('objects selected');
  await page.keyboard.press('Control+g');
  await expect(page.locator('.es-flash')).toContainText('Group g1');

  // A save lands in the version list
  await page.keyboard.press('Control+s');
  await expect(page.locator('[data-test=save-state]')).toHaveText('Saved');
  await page.keyboard.press('9');
  // The first save made the map, this one the group: both are versions
  await expect.poll(() => page.locator('[data-test=versions] .mp-version').count(), { timeout: 10_000 }).toBeGreaterThan(1);

  await page.locator('[data-test=back]').click();
  const row = page.locator('.mb-row', { hasText: name });
  await row.click();
  await page.getByRole('button', { name: 'Delete', exact: true }).first().click();
  await page.locator('.td-banner').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.locator('.mb-row', { hasText: name })).toHaveCount(0);
});

test("the check's bot test plays a fresh map in a new tab and reports back", async ({ page, context }) => {
  test.setTimeout(10 * 60_000);
  await page.addInitScript(() => {
    localStorage.setItem('td_seen_version', '9999.0.0');
    // The editor's first-run tour has its own test
    localStorage.setItem('3dtd-editor-tour', 'done');
  });
  await context.addInitScript(() => localStorage.setItem('td_seen_version', '9999.0.0'));
  await page.goto('/editor');
  const name = `E2E bot ${Date.now()}`;
  await page.locator('[data-test=new-map]').click();
  await page.locator('[data-test=new-name]').fill(name);
  await page.getByRole('radio', { name: /Small/ }).click();
  await page.locator('[data-test=create-map]').click();
  await expect(page.locator('[data-test=map-name]')).toHaveText(name, { timeout: 60_000 });
  await page.locator('[data-test=check]').click();
  const game = context.waitForEvent('page');
  await page.getByRole('button', { name: 'Bot test' }).click();
  // The game plays in its own tab; the result comes back to the check
  const tab = await game;
  await expect(page.locator('[data-test=bot-result]')).toContainText(/passed|failed|stuck/i, { timeout: 8 * 60_000 });
  await expect(page.locator('[data-test=bot-result]')).toContainText(/passed/i);
  await tab.close();
  await page.locator('[data-test=back]').click();
  await page.locator('.mb-row', { hasText: name }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).first().click();
  await page.locator('.td-banner').getByRole('button', { name: 'Delete', exact: true }).click();
});

test('the first-run tour leads through the editor and comes back from the help', async ({ page }) => {
  test.setTimeout(3 * 60_000);
  await page.addInitScript(() => {
    localStorage.setItem('td_seen_version', '9999.0.0');
    if (!sessionStorage.getItem('tour-test')) {
      localStorage.removeItem('3dtd-editor-tour');
      sessionStorage.setItem('tour-test', '1');
    }
  });
  await page.goto('/editor');
  const name = `E2E tour ${Date.now()}`;
  await page.locator('[data-test=new-map]').click();
  await page.locator('[data-test=new-name]').fill(name);
  await page.locator('[data-test=create-map]').click();
  const tour = page.locator('[data-test=tour]');
  await expect(tour).toHaveAttribute('data-step', 'view');
  await tour.getByRole('button', { name: 'Next' }).click();
  await expect(tour).toHaveAttribute('data-step', 'land');
  // Painting finishes the step by itself
  const box = (await page.locator('[data-test=viewport]').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
  await page.mouse.down();
  await expect(tour).toHaveAttribute('data-step', 'road', { timeout: 15_000 });
  await page.mouse.up();
  await tour.getByRole('button', { name: 'Next' }).click();
  await expect(tour).toHaveAttribute('data-step', 'markers');
  await tour.getByRole('button', { name: 'Next' }).click();
  await expect(tour).toHaveAttribute('data-step', 'check');
  await page.locator('[data-test=check]').click();
  await expect(tour).toHaveAttribute('data-step', 'trial');
  await tour.getByRole('button', { name: 'Skip the tour' }).click();
  await expect(tour).toHaveCount(0);
  // Not by itself again, but from the help; the help also has the level guide
  await page.reload();
  await expect(page.locator('[data-test=map-name]')).toHaveText(name);
  await expect(tour).toHaveCount(0);
  await page.locator('[data-test=help]').click();
  await page.locator('[data-test=help-guide]').click();
  await expect(page.locator('[data-topic=chokes]')).toBeVisible();
  await page.locator('[data-test=start-tour]').click();
  await expect(tour).toHaveAttribute('data-step', 'view');
  await tour.getByRole('button', { name: 'Skip the tour' }).click();
  await page.locator('[data-test=back]').click();
  await page.locator('.mb-row', { hasText: name }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).first().click();
  await page.locator('.td-banner').getByRole('button', { name: 'Delete', exact: true }).click();
});
