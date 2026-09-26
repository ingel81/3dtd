import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * A click on an upgrade tile it cannot buy says why (upgradeclick, playtest
 * 517 and 518): the tower and research panels mark such a tile
 * aria-disabled, never disabled, because a disabled button swallows the
 * click before the handler. TowerUpgradeService and its specs say why;
 * this holds that the click reaches them.
 */
describe('Upgrade tiles take the click they cannot buy', () => {
  const PANELS = [
    'src/app/components/game-sidebar/tower-panel/tower-panel.component.html',
    'src/app/components/game-sidebar/research-panel/research-panel.component.html',
  ];

  /** The start tags of the upgrade tiles in `path` */
  const tiles = (path: string): string[] =>
    readFileSync(resolve(path), 'utf8').match(/<button\b[^>]*class="td-upgrade-tile"[^>]*>/g) ?? [];

  it.each(PANELS)('%s: every tile binds the click and aria-disabled, none disabled', (path) => {
    const found = tiles(path);
    expect(found.length).toBeGreaterThan(0);
    for (const tag of found) {
      expect(tag).toContain('(click)="onUpgradeTower(');
      // A partner's tower in coop is read only (TODO E39)
      expect(tag).toMatch(/\[attr\.aria-disabled\]="refused( \|\| viewOnly\(\))?"/);
      expect(tag).not.toMatch(/\s\[?(attr\.)?disabled\]?[\s=>]/);
    }
  });

  it('the browser hands a click on an aria-disabled button on, and swallows it on a disabled one', () => {
    const clicks: string[] = [];
    for (const kind of ['aria-disabled', 'disabled']) {
      const button = document.createElement('button');
      button.setAttribute(kind, 'true');
      button.addEventListener('click', () => clicks.push(kind));
      document.body.appendChild(button);
      button.click();
      button.remove();
    }
    expect(clicks).toEqual(['aria-disabled']);
  });
});
