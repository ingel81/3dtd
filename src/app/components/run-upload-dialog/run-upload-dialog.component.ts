import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';

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
        <h2 class="td-dlg-title" [id]="titleId">Help improve 3DTD?</h2>
      </header>
      <div class="td-dlg-body">
        <p class="td-text">
          May the game send the log of this coop game to the coop server? It holds the names in the game, the
          place you played with its address, and every move and number of the run.
        </p>
        <p class="td-text">
          It is used only to find errors and to improve the game, and deleted after 90 days. It helps a lot.
        </p>
        <p class="td-note">You can change this later under Runs.</p>
      </div>
      <footer class="td-dlg-foot">
        <button class="td-btn-secondary" type="button" (click)="answer(false)">No</button>
        <button class="td-btn-primary" type="button" (click)="answer(true)">Yes, send it</button>
      </footer>
    </div>
  `,
  styleUrl: './run-upload-dialog.component.scss',
})
export class RunUploadDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<RunUploadDialogComponent, boolean>);
  readonly titleId = TITLE_ID;

  answer(yes: boolean): void {
    this.dialogRef.close(yes);
  }
}

/** Ask the player; resolves with the answer, false when the dialog is closed without one */
export function askRunUpload(dialog: MatDialog): Promise<boolean> {
  const ref = dialog.open<RunUploadDialogComponent, void, boolean>(RunUploadDialogComponent, {
    panelClass: 'td-dialog-panel',
    ariaLabelledBy: TITLE_ID,
    disableClose: true,
  });
  return new Promise((resolve) => ref.afterClosed().subscribe((yes) => resolve(yes === true)));
}
