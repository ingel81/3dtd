import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { TdIconComponent } from '../icon/icon.component';
import { CHANGELOG_RELEASES } from '../../configs/changelog.config';
import { BUILD_VERSION } from '../../configs/build-info.config';
import { WHATS_NEW_TITLE_ID, type WhatsNewDialogData } from './open-whats-new-dialog';

/** The full changelog on GitHub, for everything before the releases the game carries. */
const CHANGELOG_URL = 'https://github.com/ingel81/3dtd/blob/main/CHANGELOG.md';

/**
 * "What's new": CHANGELOG.md, newest release first, the version this game
 * runs marked. From the version in the sidebar footer it lists every
 * release; once after an update (WhatsNewService) the ones new to the player,
 * the rest folded under "Earlier versions".
 */
@Component({
  selector: 'app-whats-new-dialog',
  standalone: true,
  imports: [MatDialogModule, NgTemplateOutlet, TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './whats-new-dialog.component.html',
  styleUrl: './whats-new-dialog.component.scss',
  styles: `
    :host {
      ${TD_CSS_VARS}
    }
  `,
})
export class WhatsNewDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<WhatsNewDialogComponent>);
  /** After an update the releases new to the player, otherwise every one. */
  readonly releases =
    inject<WhatsNewDialogData | null>(MAT_DIALOG_DATA, { optional: true })?.fresh ?? CHANGELOG_RELEASES;
  /** Folded under "Earlier versions"; empty when every release is listed. */
  readonly earlier = CHANGELOG_RELEASES.filter((r) => !this.releases.includes(r));
  readonly current = BUILD_VERSION.replace(/^v/, '');
  readonly changelogUrl = CHANGELOG_URL;
  readonly titleId = WHATS_NEW_TITLE_ID;

  close(): void {
    this.dialogRef.close();
  }
}
