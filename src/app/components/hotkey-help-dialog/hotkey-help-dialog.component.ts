import { Component, ChangeDetectionStrategy, computed, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { hotkeyHelp } from '../../services/hotkey-map';
import { injectT } from '../../i18n/i18n.service';
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
})
export class HotkeyHelpDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<HotkeyHelpDialogComponent>);

  readonly titleId = HOTKEY_HELP_TITLE_ID;
  protected readonly t = injectT();
  readonly groups = computed(() => hotkeyHelp(this.t()));

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
