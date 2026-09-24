import type { Injector } from '@angular/core';
import type { MatDialog, MatDialogRef } from '@angular/material/dialog';
import type { CoopDialogComponent } from './coop-dialog.component';
import { lazyDialog } from '../../utils/lazy-dialog';

const open = lazyDialog<CoopDialogComponent>(
  () => import('./coop-dialog.component').then((m) => m.CoopDialogComponent),
);

/** One coop dialog at a time: a second click finds the open one */
const DIALOG_ID = 'td-coop-dialog';

/** The coop dialogs open docked, see openCoopDialog */
const dockedRefs = new WeakSet<MatDialogRef<unknown>>();

/**
 * The open dialogs that own mouse and keyboard: all but the docked coop
 * lobby, beside which the map, the hotkeys and Esc (ending a placement) work.
 */
export function modalDialogCount(dialog: MatDialog): number {
  return dialog.openDialogs.filter((ref) => !dockedRefs.has(ref)).length;
}

/**
 * Opens the coop dialog (docs/COOP_PLAN.md, C4). `injector` is the game's:
 * CoopService lives in the game component's scope.
 *
 * Before the game (`docked`) it docks at the left without a veil, so the
 * host sets spawns, moves them or changes the place beside it and the map
 * goes to the room (User, 2026-09-24). In the game it is a dialog as usual.
 */
export async function openCoopDialog(
  dialog: MatDialog,
  injector: Injector,
  docked = false,
): Promise<MatDialogRef<CoopDialogComponent>> {
  const existing = dialog.getDialogById(DIALOG_ID) as MatDialogRef<CoopDialogComponent> | undefined;
  if (existing) return existing;
  const ref = await open(dialog, {
    id: DIALOG_ID,
    panelClass: docked ? ['td-dialog-panel', 'td-coop-docked'] : 'td-dialog-panel',
    ariaLabelledBy: 'td-coop-dialog-title',
    injector,
    data: { docked },
    // Docked: Esc is the game's (ending a placement), Close closes it; the
    // dialog keeps itself below the info overlay (CoopDialogComponent)
    ...(docked ? { hasBackdrop: false, position: { left: '12px', top: '64px' }, autoFocus: false, disableClose: true } : {}),
  });
  if (docked) dockedRefs.add(ref);
  return ref;
}
