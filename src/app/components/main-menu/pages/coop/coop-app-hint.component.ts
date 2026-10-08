import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { APP_DOWNLOADS } from '../../../../coop/coop-access';

/**
 * Coop in a browser on the site (E114, D52, D59): it is played in the
 * desktop app, so the menu's Coop page only points there, with the
 * downloads; opened from an invite link it names the room to join in the
 * app. The button for the player's system comes first.
 */
@Component({
  selector: 'app-coop-app-hint',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="mp-sec">
      <h3 class="mp-label">Co-op runs in the desktop app</h3>
      <p class="note">
        The browser version is for a quick look, solo. Co-op, with online lobbies and games on the same network,
        lives in the free desktop app for Windows and Linux.
      </p>
      @if (roomCode(); as code) {
        <p class="note invite">You were invited to room <b>{{ code }}</b>. In the app, open Coop and join with this code.</p>
      }
      <div class="mp-actions mp-actions-start">
        @for (download of downloads; track download.url; let first = $first) {
          <a [class]="first ? 'btn-primary' : 'btn-secondary'" [href]="download.url" target="_blank" rel="noopener">{{ download.label }}</a>
        }
      </div>
      <a class="link all" [href]="allDownloads" target="_blank" rel="noopener">All downloads and release notes</a>
    </section>
  `,
  styleUrl: './coop-app-hint.component.scss',
})
export class CoopAppHintComponent {
  /** The room of the invite link this page was opened with, null without one */
  readonly roomCode = input<string | null>(null);

  protected readonly downloads = appDownloads(typeof navigator === 'undefined' ? '' : navigator.userAgent);
  protected readonly allDownloads = APP_DOWNLOADS.all;
}

/** Both downloads, the one for the player's system first (Linux by the user agent, Windows otherwise) */
export function appDownloads(userAgent: string): { label: string; url: string }[] {
  const windows = { label: 'Download for Windows', url: APP_DOWNLOADS.windows };
  const linux = { label: 'Download for Linux', url: APP_DOWNLOADS.linux };
  return /Linux/.test(userAgent) && !/Android/.test(userAgent) ? [linux, windows] : [windows, linux];
}
