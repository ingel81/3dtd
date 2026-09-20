import type { MatDialog, MatDialogRef } from '@angular/material/dialog';
import type { RunsDialogComponent } from './runs-dialog.component';
import { lazyDialog } from '../../utils/lazy-dialog';

const open = lazyDialog<RunsDialogComponent>(
  () => import('./runs-dialog.component').then((m) => m.RunsDialogComponent),
);

/** Opens the list of kept runs (docs/RUN_LOG.md). */
export function openRunsDialog(dialog: MatDialog): Promise<MatDialogRef<RunsDialogComponent>> {
  return open(dialog, { panelClass: 'td-dialog-panel' });
}
