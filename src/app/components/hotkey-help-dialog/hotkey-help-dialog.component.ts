import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { HOTKEY_HELP } from '../../services/hotkey-map';
import { TdIconComponent } from '../icon/icon.component';
import { HOTKEY_HELP_TITLE_ID } from './open-hotkey-help-dialog';

/**
 * Keyboard shortcuts, read from HOTKEY_HELP next to the key mapping itself.
 * Opened through openHotkeyHelpDialog.
 */
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

  readonly titleId = HOTKEY_HELP_TITLE_ID;
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
