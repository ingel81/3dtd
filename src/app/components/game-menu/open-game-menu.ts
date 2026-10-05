import type { Injector } from '@angular/core';
import type { MatDialog, MatDialogRef } from '@angular/material/dialog';
import type { GameMenuComponent } from './game-menu.component';
import { lazyDialog } from '../../utils/lazy-dialog';

const open = lazyDialog<GameMenuComponent>(() => import('./game-menu.component').then((m) => m.GameMenuComponent));

/**
 * Opens the game menu (TODO A3) in the middle of the screen, as a game's Esc
 * menu does (User, 2026-09-27). Esc and the backdrop close it; it loads as a
 * small chunk of its own.
 *
 * `injector` is the caller's: the menu asks CoopService, which the game
 * component provides, not the root the dialog would otherwise sit on (without
 * it the dialog opened empty, only its backdrop showed).
 */
export function openGameMenu(dialog: MatDialog, injector: Injector): Promise<MatDialogRef<GameMenuComponent>> {
  return open(dialog, {
    injector,
    panelClass: 'td-dialog-panel',
    width: 'min(380px, 92vw)',
    ariaLabelledBy: 'td-game-menu-title',
    autoFocus: 'first-tabbable',
  });
}
