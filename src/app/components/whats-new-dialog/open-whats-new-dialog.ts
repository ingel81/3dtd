import type { MatDialog, MatDialogRef } from '@angular/material/dialog';
import type { WhatsNewDialogComponent } from './whats-new-dialog.component';
import type { ChangelogRelease } from '../../utils/changelog';
import { lazyDialog } from '../../utils/lazy-dialog';

export const WHATS_NEW_TITLE_ID = 'td-whats-new-title';

export interface WhatsNewDialogData {
  /** The releases new to the player; the others fold away under "Earlier versions". */
  fresh: ChangelogRelease[];
}

const open = lazyDialog<WhatsNewDialogComponent, WhatsNewDialogData>(
  () => import('../reference-dialogs').then((m) => m.WhatsNewDialogComponent),
);

/**
 * Opens "What's new": every release, or with `data` the fresh ones first.
 * Loads with the other reference-dialogs as one chunk.
 */
export function openWhatsNewDialog(
  dialog: MatDialog,
  data?: WhatsNewDialogData,
): Promise<MatDialogRef<WhatsNewDialogComponent>> {
  return open(dialog, {
    data,
    panelClass: 'td-dialog-panel',
    ariaLabelledBy: WHATS_NEW_TITLE_ID,
    autoFocus: 'dialog',
  });
}
