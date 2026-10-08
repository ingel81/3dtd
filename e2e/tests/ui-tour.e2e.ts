// The picture tour of the UI (docs/MAIN_MENU_UI_PLAN.md, Prüfung): menu,
// pages, HUD states, dialogs, coop dock, Game Over and a focus probe, once
// at 1600x900 and once at 1280x720. DevWorld (`?devworld&bot=manual`), so
// no map session; a page of its own per size, not `duo`.
//
// Numbered pictures land in tmp/ui-shots/after/<width>x<height>/NN-name.png.
// Every step runs on its own: one that fails is logged and the tour goes on.
// At the end tmp/ui-shots/after/missing.txt lists the failed steps of both
// sizes, and a size with failed steps fails its test.
import { test, expect, type Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../../tmp/ui-shots/after/', import.meta.url));
const VIEWPORTS = [
  { width: 1600, height: 900 },
  { width: 1280, height: 720 },
] as const;

/** The menu's pages with the dialog name each one gives the menu, and its entry in the list */
const PAGES = [
  { page: 'new-game', title: 'New game', entry: /^New game/i },
  { page: 'coop', title: 'Coop', entry: /^Coop/i },
  { page: 'save', title: 'Save game', entry: /^Save/i },
  { page: 'load', title: 'Load game', entry: /^Load/i },
  { page: 'settings', title: 'Settings', entry: /^Settings/i },
  { page: 'extras', title: 'Extras', entry: /^Extras/i },
] as const;

/** Pages a layer may leave out of its list (no run to save before the first one) */
const OPTIONAL_IN_START = new Set(['save']);

/** --td-focus-color, #D9BC68 */
const FOCUS_COLOR = 'rgb(217, 188, 104)';

/**
 * The failed steps of one size into missing-<size>.txt, then missing.txt
 * from the files of both sizes. A file each: a failed test restarts the
 * worker, and a list in memory would lose the other size.
 */
function writeMissing(size: string, failed: string[]): void {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `missing-${size}.txt`), failed.map((line) => `${line}\n`).join(''));
  const all = VIEWPORTS.map(({ width, height }) => join(OUT, `missing-${width}x${height}.txt`))
    .filter((file) => existsSync(file))
    .map((file) => readFileSync(file, 'utf8'))
    .join('');
  writeFileSync(join(OUT, 'missing.txt'), all);
}

type Comp = {
  store: { baseHealth(): number };
  uiStore: { coopDockOpen: { set(v: boolean): void } };
};

class Tour {
  private n = 0;
  readonly failed: string[] = [];
  /** Past Play: a failed step closes what it left open, back to the game */
  inGame = false;
  private readonly dir: string;

  constructor(private readonly page: Page, readonly size: string) {
    this.dir = join(OUT, size);
    mkdirSync(this.dir, { recursive: true });
  }

  /** A picture of the whole page, or of `target` */
  async shot(name: string, target?: ReturnType<Page['locator']>): Promise<void> {
    this.n += 1;
    const path = join(this.dir, `${String(this.n).padStart(2, '0')}-${name}.png`);
    if (target) await target.screenshot({ path });
    else await this.page.screenshot({ path });
  }

  /** Run `body`; a failure is logged and the tour goes on */
  async step(name: string, body: () => Promise<void>): Promise<void> {
    try {
      await test.step(name, body);
    } catch (error) {
      const line = `${this.size} ${name}: ${String((error as Error)?.message ?? error).split('\n')[0]}`;
      this.failed.push(line);
      console.warn(`[ui-tour] ${line}`);
      // A step that failed half way may leave a dialog open: the next starts from the game
      if (this.inGame) await toGame(this.page).catch(() => undefined);
    }
  }
}

// === The game ===

/** HQ health as the store has it */
function hqHealth(page: Page): Promise<number> {
  return page.evaluate(() => {
    const w = window as unknown as { ng: { getComponent(el: Element | null): unknown } };
    return (w.ng.getComponent(document.querySelector('app-tower-defense')) as Comp).store.baseHealth();
  });
}

/** Open the coop dock through the UI store (in a room the header chip would) */
function openDockByStore(page: Page): Promise<void> {
  return page.evaluate(() => {
    const w = window as unknown as { ng: { getComponent(el: Element | null): unknown } };
    (w.ng.getComponent(document.querySelector('app-tower-defense')) as Comp).uiStore.coopDockOpen.set(true);
  });
}

/** The menu, in whichever layer and on whichever page */
function menu(page: Page) {
  return page.locator('app-main-menu [role="dialog"]');
}

/** The menu showing `title` (the list is "Menu", a page its title) */
function menuNamed(page: Page, title: string) {
  return page.getByRole('dialog', { name: title, exact: true });
}

/** Back to the menu's list, from any page */
async function toMenuList(page: Page): Promise<void> {
  for (let i = 0; i < 4 && !(await menuNamed(page, 'Menu').isVisible()); i++) {
    const back = menu(page).getByRole('button', { name: 'Back' });
    if (await back.count()) await back.first().click();
    else break;
    await page.waitForTimeout(300);
  }
  await expect(menuNamed(page, 'Menu')).toBeVisible({ timeout: 5000 });
}

/** The pause menu with Esc, from the game (the focus off a clicked control first) */
async function openPause(page: Page): Promise<void> {
  if (await menu(page).isVisible()) return;
  await page.mouse.move(Math.round((page.viewportSize()?.width ?? 1600) / 3), 400);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Escape');
  await expect(menu(page)).toBeVisible({ timeout: 5000 });
}

/** Out of every menu and dialog, back to the game */
async function toGame(page: Page): Promise<void> {
  for (let i = 0; i < 6; i++) {
    const open = (await menu(page).isVisible()) || (await page.locator('mat-dialog-container').count()) > 0;
    if (!open) return;
    const cont = menuNamed(page, 'Menu').getByRole('button', { name: /^Continue/ });
    if (await cont.count()) await cont.first().click();
    else await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
  await expect(menu(page)).toBeHidden({ timeout: 3000 });
}

/** The developer menu open, then its button `name` (an aria-label) */
async function devButton(page: Page, name: RegExp) {
  const toggle = page.getByRole('button', { name: 'Developer options' });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  return page.getByRole('button', { name });
}

async function closeDev(page: Page): Promise<void> {
  const toggle = page.getByRole('button', { name: 'Developer options' });
  if ((await toggle.getAttribute('aria-expanded')) === 'true') await toggle.click();
}

/** Take HQ health down to about `share` of `max` with the +HP tile's right-click (-10 each) */
async function hqDownTo(page: Page, max: number, share: number): Promise<void> {
  const tile = await devButton(page, /^Add 1000 HP/);
  const target = Math.floor(max * share);
  for (let i = 0; i < 200; i++) {
    const hp = await hqHealth(page);
    if (hp <= target) break;
    await tile.click({ button: 'right' });
  }
  await closeDev(page);
}

async function runTour(page: Page, size: string): Promise<Tour> {
  const tour = new Tour(page, size);

  await page.addInitScript(() => {
    localStorage.setItem('td_seen_version', '9999.0.0');
    localStorage.setItem('td_onboarding_v2', JSON.stringify({ done: true, completed: [] }));
  });
  await page.goto('/?devworld&bot=manual');

  // --- Start menu ---
  await tour.step('start menu while loading', async () => {
    await expect(menu(page)).toBeVisible({ timeout: 60_000 });
    await tour.shot('start-loading');
  });

  await tour.step('start menu loaded', async () => {
    const play = menu(page).getByRole('button', { name: /^(Play|Continue)/ }).first();
    await expect(play).toBeEnabled({ timeout: 120_000 });
    await page.waitForTimeout(1500);
    await tour.shot('start-ready');
  });

  for (const p of PAGES) {
    await tour.step(`start page ${p.page}`, async () => {
      await toMenuList(page);
      const entry = menu(page).getByRole('button', { name: p.entry });
      if (!(await entry.count()) && OPTIONAL_IN_START.has(p.page)) return;
      await entry.first().click();
      await expect(menuNamed(page, p.title)).toBeVisible({ timeout: 5000 });
      await page.waitForTimeout(400);
      await tour.shot(`start-${p.page}`);
    });
  }

  await tour.step('start the game with Play', async () => {
    await toMenuList(page);
    await menu(page).getByRole('button', { name: /^(Play|Continue)/ }).first().click();
    await expect(menu(page)).toBeHidden({ timeout: 30_000 });
    for (let i = 0; i < 10; i++) {
      if (!(await page.getByRole('button', { name: /skip intro/i }).count())) break;
      await page.getByRole('button', { name: /skip intro/i }).click().catch(() => undefined);
      await page.waitForTimeout(700);
    }
    await page.waitForTimeout(1500);
  });
  tour.inGame = true;

  // --- HUD ---
  const max = await hqHealth(page).catch(() => 500);

  await tour.step('HUD full', async () => {
    await tour.shot('hud-full');
    await tour.shot('header', page.locator('app-game-header'));
    await tour.shot('sidebar', page.locator('app-game-sidebar aside'));
  });

  await tour.step('credits delta', async () => {
    const tile = await devButton(page, /^Add 1000 credits/);
    await tile.click();
    await page.waitForTimeout(150);
    await tour.shot('hud-credits-delta', page.locator('app-game-header'));
    await page.waitForTimeout(1000);
    await tile.click({ button: 'right' });
    await page.waitForTimeout(150);
    await tour.shot('hud-credits-loss', page.locator('app-game-header'));
    await closeDev(page);
  });

  await tour.step('wave running', async () => {
    await page.locator('.td-wave-btn').click();
    await page.waitForTimeout(6000);
    await tour.shot('hud-wave-running');
    await tour.shot('header-wave', page.locator('app-game-header'));
    const kill = await devButton(page, /^Kill all enemies/);
    for (let i = 0; i < 20 && /left/i.test(await page.locator('.td-wave-btn').innerText()); i++) {
      await kill.click();
      await page.waitForTimeout(1000);
    }
    await closeDev(page);
  });

  await tour.step('HQ below 30 %', async () => {
    await hqDownTo(page, max, 0.2);
    await page.waitForTimeout(500);
    await tour.shot('hud-hq-low', page.locator('app-game-header'));
  });

  await tour.step('HQ below 10 %', async () => {
    await hqDownTo(page, max, 0.07);
    await page.waitForTimeout(500);
    await tour.shot('hud-hq-critical', page.locator('app-game-header'));
    await tour.shot('hud-hq-critical-full');
  });

  // --- Quick bar ---
  await tour.step('quick bar layers', async () => {
    await page.getByRole('button', { name: 'Layers', exact: true }).click();
    await page.waitForTimeout(400);
    await tour.shot('quick-layers');
    await page.getByRole('button', { name: 'Layers', exact: true }).click();
  });

  await tour.step('quick bar developer menu', async () => {
    await devButton(page, /^Kill all enemies/);
    await page.waitForTimeout(400);
    await tour.shot('quick-dev');
    await closeDev(page);
  });

  await tour.step('quick bar settings button', async () => {
    await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
    await expect(menuNamed(page, 'Settings')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(400);
    await tour.shot('quick-settings');
    await toGame(page);
  });

  // --- Pause menu ---
  await tour.step('pause menu', async () => {
    await openPause(page);
    await expect(menuNamed(page, 'Menu')).toBeVisible();
    await page.waitForTimeout(400);
    await tour.shot('pause-home');
  });

  for (const p of PAGES) {
    await tour.step(`pause page ${p.page}`, async () => {
      await openPause(page);
      await toMenuList(page);
      await menu(page).getByRole('button', { name: p.entry }).first().click();
      await expect(menuNamed(page, p.title)).toBeVisible({ timeout: 5000 });
      await page.waitForTimeout(400);
      await tour.shot(`pause-${p.page}`);
    });
  }

  await tour.step('confirmation in the menu', async () => {
    await openPause(page);
    await toMenuList(page);
    await menu(page).getByRole('button', { name: /^Restart/ }).first().click();
    await page.waitForTimeout(400);
    await tour.shot('pause-confirm-restart');
    // Say no: the run goes on
    const no = menu(page).getByRole('button', { name: /^(Cancel|No|Keep playing|Back)$/ });
    if (await no.count()) await no.first().click();
    else await page.keyboard.press('Escape');
  });

  // --- Focus probe ---
  await tour.step('focus in the menu', async () => {
    await toGame(page);
    await openPause(page);
    await toMenuList(page);
    await page.keyboard.press('Tab');
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(300);
    await tour.shot('focus-menu');
    const ring = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return null;
      const s = getComputedStyle(el);
      return {
        tag: el.tagName,
        text: (el.textContent ?? '').trim().slice(0, 40),
        outlineStyle: s.outlineStyle,
        outlineWidth: parseFloat(s.outlineWidth) || 0,
        borderLeftWidth: parseFloat(s.borderLeftWidth) || 0,
        borderLeftColor: s.borderLeftColor,
      };
    });
    expect(ring, 'something has the focus').not.toBeNull();
    // A ring of 2px or more, or the menu item's 2px+ bar in the focus colour
    const outline = ring!.outlineStyle !== 'none' && ring!.outlineWidth >= 2;
    const bar = ring!.borderLeftWidth >= 2 && ring!.borderLeftColor === FOCUS_COLOR;
    expect(outline || bar, `visible focus on ${ring!.tag} "${ring!.text}": ${JSON.stringify(ring)}`).toBe(true);
    await toGame(page);
  });

  await tour.step('focus on a header button', async () => {
    await page.evaluate(() => (document.querySelector('app-game-header .action-btn') as HTMLElement | null)?.focus());
    // :focus-visible needs a key press after programmatic focus in Chrome
    await page.keyboard.press('Shift');
    await page.waitForTimeout(200);
    await tour.shot('focus-header', page.locator('app-game-header'));
    const width = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el ? parseFloat(getComputedStyle(el).outlineWidth) || 0 : 0;
    });
    expect(width, 'outline width of the focused header button').toBeGreaterThanOrEqual(2);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  });

  // --- Dialogs ---
  await tour.step('dialog keys (H)', async () => {
    await toGame(page);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('h');
    await expect(page.locator('mat-dialog-container')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(500);
    await tour.shot('dialog-keys');
    await page.keyboard.press('Escape');
    await expect(page.locator('mat-dialog-container')).toHaveCount(0, { timeout: 5000 });
  });

  for (const [name, label] of [
    ['whats-new', /what.s new/i],
    ['attributions', /attribution/i],
    ['runs', /^runs/i],
    ['damage-matrix', /damage/i],
  ] as const) {
    await tour.step(`dialog ${name} from Extras`, async () => {
      await openPause(page);
      await toMenuList(page);
      await menu(page).getByRole('button', { name: /^Extras/i }).first().click();
      await expect(menuNamed(page, 'Extras')).toBeVisible({ timeout: 5000 });
      await menu(page).getByRole('button', { name: label }).first().click();
      await expect(page.locator('mat-dialog-container')).toBeVisible({ timeout: 5000 });
      await page.waitForTimeout(600);
      await tour.shot(`dialog-${name}`);
      await page.keyboard.press('Escape');
      await expect(page.locator('mat-dialog-container')).toHaveCount(0, { timeout: 5000 });
      await toGame(page);
    });
  }

  // --- Coop dock ---
  await tour.step('coop dock', async () => {
    await toGame(page);
    await openDockByStore(page);
    await page.locator('app-coop-dock').waitFor({ timeout: 5000 });
    await page.waitForTimeout(500);
    await tour.shot('coop-dock');
    await page.getByRole('button', { name: 'Close the coop dock' }).click();
  });

  await tour.step('coop from the header', async () => {
    await page.getByRole('button', { name: /^Coop/ }).first().click();
    await page.waitForTimeout(600);
    await tour.shot('coop-header');
    await toGame(page);
    const close = page.getByRole('button', { name: 'Close the coop dock' });
    if (await close.count()) await close.click();
  });

  // --- Game Over, last: it ends the run ---
  await tour.step('game over', async () => {
    const tile = await devButton(page, /^Add 1000 HP/);
    await tile.click({ button: 'right', modifiers: ['Shift'] });
    await closeDev(page).catch(() => undefined);
    await expect(page.getByRole('dialog', { name: /game over/i })).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1500);
    await tour.shot('game-over');
  });

  return tour;
}

test.describe('UI picture tour', () => {
  for (const viewport of VIEWPORTS) {
    const size = `${viewport.width}x${viewport.height}`;
    test(`tour at ${size}`, async ({ browser }) => {
      test.setTimeout(15 * 60_000);
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      writeMissing(size, [`${size} tour did not finish`]);
      try {
        const tour = await runTour(page, size);
        writeMissing(size, tour.failed);
        expect(tour.failed, `steps that failed at ${size}`).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }
});
