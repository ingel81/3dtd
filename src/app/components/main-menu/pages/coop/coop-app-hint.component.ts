import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { APP_DOWNLOADS } from '../../../../coop/coop-access';
import { injectT } from '../../../../i18n/i18n.service';

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
    <section class="td-group">
      <h3 class="td-section">{{ t().coop.app.title }}</h3>
      <p class="td-note">{{ t().coop.app.about }}</p>
      @if (roomCode(); as code) {
        <p class="td-note">{{ t().coop.app.invited.before }} <b class="td-code">{{ code }}</b>{{ t().coop.app.invited.after }}</p>
      }
      <div class="td-actions is-start">
        @for (download of downloads; track download.url; let first = $first) {
          <a [class]="first ? 'td-btn-primary' : 'td-btn-secondary'" [href]="download.url" target="_blank" rel="noopener">{{ t().coop.app.downloadFor[download.os] }}</a>
        }
      </div>
      <p class="td-note"><a class="td-link" [href]="allDownloads" target="_blank" rel="noopener">{{ t().coop.app.allDownloads }}</a></p>
    </section>
  `,
  host: { class: 'td-stack is-loose' },
})
export class CoopAppHintComponent {
  /** The room of the invite link this page was opened with, null without one */
  readonly roomCode = input<string | null>(null);
  protected readonly t = injectT();

  protected readonly downloads = appDownloads(typeof navigator === 'undefined' ? '' : navigator.userAgent);
  protected readonly allDownloads = APP_DOWNLOADS.all;
}

/** Both downloads, the one for the player's system first (Linux by the user agent, Windows otherwise) */
export function appDownloads(userAgent: string): { os: 'windows' | 'linux'; url: string }[] {
  const windows = { os: 'windows' as const, url: APP_DOWNLOADS.windows };
  const linux = { os: 'linux' as const, url: APP_DOWNLOADS.linux };
  return /Linux/.test(userAgent) && !/Android/.test(userAgent) ? [linux, windows] : [windows, linux];
}
