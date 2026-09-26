import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { openWhatsNewDialog } from '../../components/whats-new-dialog/open-whats-new-dialog';
import { BUILD_VERSION } from '../../configs/build-info.config';
import { CHANGELOG_RELEASES } from '../../configs/changelog.config';
import { releasesToAnnounce, SEEN_VERSION_KEY, seenVersion } from './whats-new';
import { readText, writeText } from '../../utils/storage';

/**
 * "What's new": on demand from the sidebar, and once after an update, web
 * and desktop alike. Remembers the version shown in localStorage, so a player
 * sees each release's notes once, skipped updates included, and a first
 * visit sees none.
 */
@Injectable({ providedIn: 'root' })
export class WhatsNewService {
  private readonly dialog = inject(MatDialog);

  /** Every release, the current one on top. */
  open(): void {
    void openWhatsNewDialog(this.dialog);
  }

  /** Call once the game is up; opens the notes if this version is new to the player. */
  showAfterUpdate(): void {
    const fresh = releasesToAnnounce(seenVersion({ getItem: readText }), BUILD_VERSION, CHANGELOG_RELEASES);
    // Storage blocked: no way to tell an update from a first visit
    if (!writeText(SEEN_VERSION_KEY, BUILD_VERSION)) return;
    if (fresh.length > 0) void openWhatsNewDialog(this.dialog, { fresh });
  }
}
