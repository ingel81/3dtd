import type { MatDialog, MatDialogRef } from '@angular/material/dialog';
import type { HotkeyHelpDialogComponent } from './hotkey-help-dialog.component';
import { lazyDialog } from '../../utils/lazy-dialog';

export const HOTKEY_HELP_TITLE_ID = 'td-hotkey-help-title';

const open = lazyDialog<HotkeyHelpDialogComponent>(
  () => import('../reference-dialogs').then((m) => m.HotkeyHelpDialogComponent),
);

/**
 * Opens the shortcut overview (H or ?). Esc, H, ? and the backdrop close it.
 * Loads with the other reference-dialogs as one chunk on the first open.
 */
export function openHotkeyHelpDialog(dialog: MatDialog): Promise<MatDialogRef<HotkeyHelpDialogComponent>> {
  return open(dialog, {
    panelClass: 'td-dialog-panel',
    width: 'min(460px, 92vw)',
    maxWidth: '92vw',
    ariaLabelledBy: HOTKEY_HELP_TITLE_ID,
    autoFocus: 'dialog',
  });
}
