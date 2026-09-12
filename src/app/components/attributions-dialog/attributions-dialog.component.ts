import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { ATTRIBUTIONS } from '../../configs/attributions.config';
import { TdIconComponent } from '../icon/icon.component';

@Component({
  selector: 'app-attributions-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    TdIconComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './attributions-dialog.component.html',
  styleUrl: './attributions-dialog.component.scss',
  styles: `
    :host {
      ${TD_CSS_VARS}
    }
  `,
})
export class AttributionsDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<AttributionsDialogComponent>);
  readonly attributions = ATTRIBUTIONS;

  close(): void {
    this.dialogRef.close();
  }
}
