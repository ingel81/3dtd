import type { Injector } from '@angular/core';
import type { MatDialog, MatDialogRef } from '@angular/material/dialog';
import type { CoopDialogComponent } from './coop-dialog.component';
import { lazyDialog } from '../../utils/lazy-dialog';

const open = lazyDialog<CoopDialogComponent>(
  () => import('./coop-dialog.component').then((m) => m.CoopDialogComponent),
);

/**
 * Opens the coop dialog (docs/COOP_PLAN.md, C4). `injector` is the game's:
 * CoopService lives in the game component's scope.
 */
export function openCoopDialog(dialog: MatDialog, injector: Injector): Promise<MatDialogRef<CoopDialogComponent>> {
  return open(dialog, { panelClass: 'td-dialog-panel', ariaLabelledBy: 'td-coop-dialog-title', injector });
}
