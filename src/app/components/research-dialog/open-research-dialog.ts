import type { Injector } from '@angular/core';
import type { MatDialog, MatDialogRef } from '@angular/material/dialog';
import type { ResearchDialogComponent } from './research-dialog.component';
import { lazyDialog } from '../../utils/lazy-dialog';

export const RESEARCH_DIALOG_TITLE_ID = 'td-research-dialog-title';
export const RESEARCH_DIALOG_DESC_ID = 'td-research-dialog-desc';

/**
 * The whole window. The tree is a map and gets dragged, so every pixel helps,
 * and a capped pane on a wide screen leaves a frame of wasted board around it.
 * Has to be set in the dialog config: the overlay pane of MatDialog is capped
 * at 560px by its class, only the inline style of the config lifts that. Fixed
 * rather than grown, so the graph stays the only thing that scrolls.
 */
const DIALOG_SIZE = { width: '100vw', height: '100vh' } as const;

const open = lazyDialog<ResearchDialogComponent>(
  () => import('./research-dialog.component').then((m) => m.ResearchDialogComponent),
);

/**
 * Opens the research tree. Esc closes it, the focus goes back to the button
 * that opened it.
 *
 * `injector` has to come from inside the game component: the dialog emits
 * commands through TowerDefenseFacadeService, which TowerDefenseComponent
 * provides rather than root, and an overlay is created outside that tree.
 */
export function openResearchDialog(
  dialog: MatDialog,
  injector: Injector,
): Promise<MatDialogRef<ResearchDialogComponent>> {
  return open(dialog, {
    panelClass: ['td-dialog-panel', 'td-research-panel'],
    width: DIALOG_SIZE.width,
    maxWidth: DIALOG_SIZE.width,
    height: DIALOG_SIZE.height,
    maxHeight: DIALOG_SIZE.height,
    ariaLabelledBy: RESEARCH_DIALOG_TITLE_ID,
    ariaDescribedBy: RESEARCH_DIALOG_DESC_ID,
    autoFocus: 'dialog',
    injector,
  });
}
