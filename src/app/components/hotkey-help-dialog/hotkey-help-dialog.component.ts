import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { HOTKEY_HELP } from '../../services/hotkey-map';
import { TdIconComponent } from '../icon/icon.component';

const TITLE_ID = 'td-hotkey-help-title';

/** Opens the shortcut overview (H or ?). Esc, H, ? and the backdrop close it. */
export function openHotkeyHelpDialog(dialog: MatDialog): MatDialogRef<HotkeyHelpDialogComponent> {
  return dialog.open(HotkeyHelpDialogComponent, {
    panelClass: 'td-dialog-panel',
    width: 'min(460px, 92vw)',
    maxWidth: '92vw',
    ariaLabelledBy: TITLE_ID,
    autoFocus: 'dialog',
  });
}

/** Keyboard shortcuts, read from HOTKEY_HELP next to the key mapping itself. */
@Component({
  selector: 'app-hotkey-help-dialog',
  standalone: true,
  imports: [MatDialogModule, TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './hotkey-help-dialog.component.html',
  styleUrl: './hotkey-help-dialog.component.scss',
  styles: `
    :host {
      ${TD_CSS_VARS}
    }
  `,
})
export class HotkeyHelpDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<HotkeyHelpDialogComponent>);

  readonly titleId = TITLE_ID;
  readonly groups = HOTKEY_HELP;

  constructor() {
    // The game keys are off while a dialog is open, so the key that opened
    // the overview has to close it here.
    this.dialogRef.keydownEvents()
      .pipe(takeUntilDestroyed())
      .subscribe((event) => {
        if (event.ctrlKey || event.altKey || event.metaKey) return;
        if (event.key === 'h' || event.key === 'H' || event.key === '?') {
          event.preventDefault();
          this.close();
        }
      });
  }

  close(): void {
    this.dialogRef.close();
  }
}
