import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { injectT } from '../../i18n/i18n.service';

const TITLE_ID = 'td-run-upload-title';

/**
 * Asked once after the first coop game on a relay that collects run logs
 * (TODO E38): may this player's run log go to the relay? Closes with true or
 * false; the Runs dialog changes the answer later.
 */
@Component({
  selector: 'app-run-upload-dialog',
  standalone: true,
  imports: [MatDialogModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="td-dlg">
      <header class="td-dlg-head">
        <h2 class="td-dlg-title" [id]="titleId">{{ t().dialogs.upload.title }}</h2>
      </header>
      <div class="td-dlg-body">
        <p class="td-text">{{ t().dialogs.upload.ask }}</p>
        <p class="td-text">{{ t().dialogs.upload.use }}</p>
        <p class="td-note">{{ t().dialogs.upload.later }}</p>
      </div>
      <footer class="td-dlg-foot">
        <button class="td-btn-secondary" type="button" (click)="answer(false)">{{ t().dialogs.upload.no }}</button>
        <button class="td-btn-primary" type="button" (click)="answer(true)">{{ t().dialogs.upload.yes }}</button>
      </footer>
    </div>
  `,
  styleUrl: './run-upload-dialog.component.scss',
})
export class RunUploadDialogComponent {
  protected readonly t = injectT();
  private readonly dialogRef = inject(MatDialogRef<RunUploadDialogComponent, boolean>);
  readonly titleId = TITLE_ID;

  answer(yes: boolean): void {
    this.dialogRef.close(yes);
  }
}

/**
 * How long the question waits after the Game Over screen came up (TODO E144): its word slams in
 * (420 ms) and its panel rises (450 ms delay, 400 ms), then a moment to read it.
 */
export const RUN_UPLOAD_AFTER_GAME_OVER_MS = 1500;

/** Ask the player; resolves with the answer, false when the dialog is closed without one */
export function askRunUpload(dialog: MatDialog): Promise<boolean> {
  const ref = dialog.open<RunUploadDialogComponent, void, boolean>(RunUploadDialogComponent, {
    panelClass: 'td-dialog-panel',
    ariaLabelledBy: TITLE_ID,
    disableClose: true,
  });
  return new Promise((resolve) => ref.afterClosed().subscribe((yes) => resolve(yes === true)));
}
