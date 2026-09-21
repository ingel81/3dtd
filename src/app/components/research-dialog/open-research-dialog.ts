import type { Injector } from '@angular/core';
import type { MatDialog, MatDialogRef } from '@angular/material/dialog';
import type { ResearchDialogComponent } from './research-dialog.component';
import { lazyDialog } from '../../utils/lazy-dialog';

export const RESEARCH_DIALOG_TITLE_ID = 'td-research-dialog-title';
export const RESEARCH_DIALOG_DESC_ID = 'td-research-dialog-desc';

/**
 * Wide enough for the deepest chain of the tree without scrolling sideways.
 * Has to be set in the dialog config: the overlay pane of MatDialog is capped
 * at 560px by its class, only the inline style of the config lifts that.
 */
const DIALOG_WIDTH = 'min(1180px, 94vw)';

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
    panelClass: 'td-dialog-panel',
    width: DIALOG_WIDTH,
    maxWidth: '94vw',
    ariaLabelledBy: RESEARCH_DIALOG_TITLE_ID,
    ariaDescribedBy: RESEARCH_DIALOG_DESC_ID,
    autoFocus: 'dialog',
    injector,
  });
}
