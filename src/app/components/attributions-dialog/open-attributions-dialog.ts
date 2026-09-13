import type { MatDialog, MatDialogRef } from '@angular/material/dialog';
import type { AttributionsDialogComponent } from './attributions-dialog.component';
import { lazyDialog } from '../../utils/lazy-dialog';

const open = lazyDialog<AttributionsDialogComponent>(
  () => import('../reference-dialogs').then((m) => m.AttributionsDialogComponent),
);

/** Opens the credits; loads with the other reference-dialogs as one chunk. */
export function openAttributionsDialog(dialog: MatDialog): Promise<MatDialogRef<AttributionsDialogComponent>> {
  return open(dialog, { panelClass: 'td-dialog-panel' });
}
