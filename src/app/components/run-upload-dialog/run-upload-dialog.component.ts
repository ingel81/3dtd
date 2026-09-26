import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { TdIconComponent } from '../icon/icon.component';

const TITLE_ID = 'td-run-upload-title';

/**
 * Asked once after the first coop game on a relay that collects run logs
 * (TODO E38): may this player's run log go to the relay? Closes with true or
 * false; the Runs dialog changes the answer later.
 */
@Component({
  selector: 'app-run-upload-dialog',
  standalone: true,
  imports: [MatDialogModule, TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="run-upload-dialog">
      <div class="dialog-header">
        <td-icon class="header-icon" name="filing" [size]="18"></td-icon>
        <h2 [id]="titleId">Help improve 3DTD?</h2>
      </div>
      <div class="dialog-content">
        <p>
          May the game send the log of this coop game to the coop server? It holds the names in the game, the
          place you played with its address, and every move and number of the run.
        </p>
        <p>
          It is used only to find errors and to improve the game, and deleted after 90 days. It helps a lot.
        </p>
        <p class="dim">You can change this later under Runs.</p>
      </div>
      <div class="dialog-footer">
        <button class="btn" type="button" (click)="answer(false)">No</button>
        <button class="btn primary" type="button" (click)="answer(true)">Yes, send it</button>
      </div>
    </div>
  `,
  styles: `
    :host {
      ${TD_CSS_VARS}
    }
    .run-upload-dialog {
      width: 420px;
      max-width: 90vw;
      background: var(--td-panel-main);
      border: 1px solid var(--td-frame-dark);
      color: var(--td-text-primary);
      font-family: var(--td-font-body);
    }
    .dialog-header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 16px;
      border-bottom: 1px solid var(--td-frame-dark);
    }
    .header-icon { color: var(--td-gold); }
    h2 { margin: 0; font-size: 14px; font-weight: 600; color: var(--td-gold); }
    .dialog-content { padding: 4px 16px; font-size: 13px; line-height: 1.5; }
    .dim { color: var(--td-text-secondary); }
    .dialog-footer {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 10px 16px 14px;
    }
    .btn {
      padding: 5px 12px;
      background: var(--td-panel-secondary);
      border: 1px solid var(--td-frame-dark);
      color: var(--td-text-primary);
      font: inherit;
      font-size: 12px;
      cursor: pointer;
    }
    .btn.primary { background: var(--td-gold); color: var(--td-panel-shadow); border-color: var(--td-gold); font-weight: 600; }
  `,
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
