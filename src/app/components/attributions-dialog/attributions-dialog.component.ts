import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { ATTRIBUTIONS } from '../../configs/attributions.config';
import { TdIconComponent } from '../icon/icon.component';
import { LEGAL_URL } from '../../utils/public-url';
import { ATTRIBUTIONS_TITLE_ID } from './open-attributions-dialog';
import { injectT } from '../../i18n/i18n.service';

@Component({
  selector: 'app-attributions-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    TdIconComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './attributions-dialog.component.html',
  styleUrl: './attributions-dialog.component.scss',
})
export class AttributionsDialogComponent {
  protected readonly t = injectT();
  private readonly dialogRef = inject(MatDialogRef<AttributionsDialogComponent>);
  readonly attributions = ATTRIBUTIONS;
  /** Imprint and privacy notice of the project, on the public site */
  readonly legalUrl = LEGAL_URL;
  readonly titleId = ATTRIBUTIONS_TITLE_ID;

  close(): void {
    this.dialogRef.close();
  }
}
