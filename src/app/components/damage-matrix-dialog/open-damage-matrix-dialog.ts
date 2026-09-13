import type { MatDialog, MatDialogRef } from '@angular/material/dialog';
import type { TowerTypeId } from '../../configs/tower-types.config';
import type { DamageMatrixDialogComponent, DamageMatrixDialogData } from './damage-matrix-dialog.component';
import { lazyDialog } from '../../utils/lazy-dialog';

export const DAMAGE_MATRIX_TITLE_ID = 'td-damage-matrix-title';
export const DAMAGE_MATRIX_DESC_ID = 'td-damage-matrix-desc';

/**
 * Breit genug für alle fünf Rüstungsspalten ohne horizontales Scrollen. Muss als
 * Dialog-Config gesetzt werden: das Overlay-Pane von MatDialog ist per Klasse
 * auf 560px begrenzt, nur der Inline-Style der Config hebt das auf.
 */
const DIALOG_WIDTH = 'min(880px, 92vw)';

const open = lazyDialog<DamageMatrixDialogComponent, DamageMatrixDialogData>(
  () => import('../reference-dialogs').then((m) => m.DamageMatrixDialogComponent),
);

/**
 * Öffnet die Damage-vs-Armor-Tabelle. Esc schließt (MatDialog-Default),
 * der Fokus kehrt danach zum auslösenden Button zurück. Die Tabelle lädt
 * beim ersten Öffnen mit den anderen reference-dialogs als ein Chunk.
 */
export function openDamageMatrixDialog(
  dialog: MatDialog,
  towerId?: TowerTypeId,
): Promise<MatDialogRef<DamageMatrixDialogComponent>> {
  return open(dialog, {
    panelClass: 'td-dialog-panel',
    width: DIALOG_WIDTH,
    maxWidth: '92vw',
    ariaLabelledBy: DAMAGE_MATRIX_TITLE_ID,
    ariaDescribedBy: DAMAGE_MATRIX_DESC_ID,
    autoFocus: 'dialog',
    data: { towerId },
  });
}
