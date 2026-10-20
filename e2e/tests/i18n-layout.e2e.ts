// The layout in every language (TODO E245, docs/I18N_PLAN.md 7.4): German
// runs about a third longer than English. The globes, the world menus and
// their overlays, the start and pause menu with every page and tab, the
// dialogs out of Extras and the header, once per language and size. DevWorld
// for the game (`?devworld&bot=manual`), so no map session.
//
// Every element with text is measured: clipped (its text wider than its
// box where the box clips), off the screen, or a control (button, tab,
// radio, tag) whose own label runs onto a second line. Cut with an ellipsis
// is reported apart: the design lets long names give way at their end.
// Pictures and the report land in tmp/i18n-shots/<locale>/<size>/.
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = process.env['I18N_SHOTS_DIR'] ?? fileURLToPath(new URL('../../tmp/i18n-shots/', import.meta.url));
const LOCALES = (process.env['I18N_LOCALES'] ?? 'de,en').split(',');
const SIZES = [
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
] as const;

interface Finding {
  text: string;
  why: string;
  tag: string;
}

/** Runs in the page: what of the text on screen does not fit */
function probe(): Finding[] {
  const out: Finding[] = [];
  const seen = new Set<string>();
  for (const el of document.querySelectorAll('body *')) {
    if (!(el instanceof HTMLElement) || el.closest('.td-sr-only, .cdk-visually-hidden')) continue;
    const r = el.getBoundingClientRect();
    // Visually hidden for screen readers only (a 1 px clip)
    if (r.width <= 1 || r.height <= 1) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') continue;
    const texts = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent!.trim());
    if (!texts.length) continue;
    const text = el.textContent!.replace(/\s+/g, ' ').trim().slice(0, 90);
    const why: string[] = [];
    if (el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== 'visible') why.push(cs.textOverflow === 'ellipsis' ? 'ellipsis' : 'clip');
    if (r.right > innerWidth + 1 || r.left < -1) why.push('offscreen');
    const control = el.closest('button, [role="tab"], [role="radio"], .td-tag');
    if (control === el) {
      const range = document.createRange();
      const tops = new Set<number>();
      for (const node of texts) {
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) if (rect.width > 2) tops.add(Math.round(rect.top));
      }
      if (tops.size > 1) why.push('wraps');
    }
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const pcs = getComputedStyle(p);
      if (pcs.overflowX === 'visible' && pcs.overflowY === 'visible') continue;
      if (r.right > p.getBoundingClientRect().right + 2 && pcs.overflowX !== 'visible' && p.scrollWidth > p.clientWidth + 1) why.push('cut by a parent');
      break;
    }
    if (!why.length) continue;
    const key = `${text}|${why.join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
    out.push({ text, why: why.join(', '), tag: `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}` });
  }
  return out;
}

class Tour {
  readonly report: { label: string; found: Finding[] }[] = [];
  readonly failed: string[] = [];

  constructor(private readonly page: Page, readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  async check(label: string): Promise<void> {
    await this.page.waitForTimeout(450);
    await this.page.screenshot({ path: join(this.dir, `${label}.png`) });
    this.report.push({ label, found: await this.page.evaluate(probe) });
  }

  async step(name: string, body: () => Promise<void>): Promise<void> {
    try {
      await test.step(name, body);
    } catch (error) {
      this.failed.push(`${name}: ${String((error as Error)?.message ?? error).split('\n')[0]}`);
    }
  }
}

async function tabsThrough(tour: Tour, page: Page, scope: string, label: string): Promise<void> {
  const tabs = page.locator(`${scope} [role="tab"]`);
  for (let i = 1; i < (await tabs.count()); i++) {
    await tabs.nth(i).click();
    await tour.check(`${label}-tab${i}`);
  }
}

for (const locale of LOCALES) {
  for (const size of SIZES) {
    test(`layout in ${locale} at ${size.width}x${size.height}`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.addInitScript((loc) => {
        localStorage.setItem('td_seen_version', '9999.0.0');
        localStorage.setItem('td_onboarding_v2', JSON.stringify({ done: true, completed: [] }));
        localStorage.setItem('td_globe_quality_v1', JSON.stringify('off'));
        const raw = localStorage.getItem('td-ui-state');
        localStorage.setItem('td-ui-state', JSON.stringify({ ...(raw ? JSON.parse(raw) : {}), locale: loc }));
      }, locale);
      const tour = new Tour(page, join(OUT, locale, `${size.width}x${size.height}`));

      // --- The globes, the world menus, the overlays ---
      await tour.step('globes', async () => {
        await page.goto('/');
        await page.locator('.ws-root').waitFor({ timeout: 90_000 });
        await page.waitForTimeout(1500);
        await tour.check('01-globes');
      });
      for (const world of ['real', 'osm', 'maps']) {
        await tour.step(`world ${world}`, async () => {
          await page.locator(`.ws-card[data-world="${world}"]`).click();
          await tour.check(`02-world-${world}`);
          if (world === 'real') await tabsThrough(tour, page, '.wm-tabs', '02-world-real');
          await page.keyboard.press('Escape');
        });
      }
      for (const entry of ['settings', 'extras', 'load', 'coop']) {
        await tour.step(`overlay ${entry}`, async () => {
          await page.locator(`.ws-menu [data-entry="${entry}"]`).click();
          await tour.check(`03-overlay-${entry}`);
          if (entry === 'settings') await tabsThrough(tour, page, '.ws-dlg', '03-overlay-settings');
          await page.keyboard.press('Escape');
        });
      }

      // --- The game: start menu, HUD, pause menu, pages, dialogs ---
      const menu = page.locator('app-main-menu [role="dialog"]');
      await tour.step('start menu and HUD', async () => {
        await page.goto('/?devworld&bot=manual');
        await menu.waitFor({ timeout: 90_000 });
        await tour.check('10-start-loading');
        const play = menu.locator('[data-entry="play"]');
        await expect(play).toBeEnabled({ timeout: 120_000 });
        await page.locator('app-main-menu app-menu-loading').waitFor({ state: 'detached', timeout: 120_000 }).catch(() => undefined);
        await tour.check('11-start-ready');
        await play.click();
        await expect(menu).toBeHidden({ timeout: 30_000 });
        for (let i = 0; i < 8 && (await page.locator('app-intro-skip button').count()); i++) {
          await page.locator('app-intro-skip button').first().click().catch(() => undefined);
          await page.waitForTimeout(600);
        }
        await page.waitForTimeout(1500);
        await tour.check('12-hud');
      });
      await tour.step('pause menu', async () => {
        await page.mouse.move(Math.round(size.width / 3), 400);
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await page.keyboard.press('Escape');
        await expect(menu).toBeVisible({ timeout: 5000 });
        await tour.check('13-pause');
      });
      for (const entry of ['saves', 'settings', 'extras', 'coop']) {
        await tour.step(`page ${entry}`, async () => {
          await page.locator(`app-menu-home [data-entry="${entry}"]`).click();
          await tour.check(`14-page-${entry}`);
          if (entry === 'settings') await tabsThrough(tour, page, 'app-main-menu', '14-page-settings');
          if (entry === 'saves') {
            await page.locator('app-main-menu [data-tab="load"]').click();
            await tour.check('14-page-saves-load');
          }
          await page.locator('app-main-menu .mm-back').click();
        });
      }
      // The dialogs out of Extras: keyboard shortcuts, damage vs armor, attributions, runs
      const dialogs = [
        ['keys', 'section[aria-labelledby="td-extras-game"] button.td-row >> nth=1'],
        ['matrix', 'section[aria-labelledby="td-extras-game"] button.td-row >> nth=2'],
        ['attributions', 'section[aria-labelledby="td-extras-about"] button.td-row >> nth=0'],
        ['runs', 'section >> nth=0 >> button.td-row >> nth=2'],
      ] as const;
      for (const [name, row] of dialogs) {
        await tour.step(`dialog ${name}`, async () => {
          await page.locator('app-menu-home [data-entry="extras"]').click();
          await page.locator('app-extras-list').locator(row).click();
          await page.waitForTimeout(800);
          await tour.check(`15-dialog-${name}`);
          await page.keyboard.press('Escape');
          await page.waitForTimeout(400);
          await page.locator('app-main-menu .mm-back').click().catch(() => undefined);
        });
      }

      writeFileSync(join(tour.dir, 'report.json'), JSON.stringify({ failed: tour.failed, pages: tour.report }, null, 1));
      // Cut with an ellipsis is the design's way for long names; everything else must fit
      const broken = tour.report.flatMap((r) => r.found.filter((f) => f.why !== 'ellipsis').map((f) => `${r.label}: [${f.why}] ${f.tag} "${f.text}"`));
      expect(tour.failed, 'steps that did not run').toEqual([]);
      expect(broken, 'text that does not fit').toEqual([]);
    });
  }
}
