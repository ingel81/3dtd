/**
 * The small dialogs a player opens on demand, behind one module path.
 *
 * Their openers import the components from here, so the three arrive as one
 * lazy chunk. Imported one by one they would each split the code they share
 * with the game into chunks of its own, which saved raw bytes but next to no
 * transfer. The location dialog is larger and stays a chunk of its own.
 */
export { DamageMatrixDialogComponent } from './damage-matrix-dialog/damage-matrix-dialog.component';
export { AttributionsDialogComponent } from './attributions-dialog/attributions-dialog.component';
export { HotkeyHelpDialogComponent } from './hotkey-help-dialog/hotkey-help-dialog.component';
