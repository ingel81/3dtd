import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { TdIconComponent } from '../icon/icon.component';
import { UIStore } from '../../store/ui.store';
import { GameStore } from '../../store/game.store';
import { CoopService } from '../../services/coop.service';
import { WhatsNewService } from '../../services/onboarding/whats-new.service';
import { openAttributionsDialog } from '../attributions-dialog/open-attributions-dialog';
import { openHotkeyHelpDialog } from '../hotkey-help-dialog/open-hotkey-help-dialog';
import { readDesktopBridge } from '../../core/desktop-bridge';
import { BUILD_VERSION } from '../../configs/build-info.config';
import { ConfigService } from '../../core/services/config.service';

/**
 * The game menu (TODO A3): the gear in the sidebar footer and Esc, when Esc
 * has nothing else to do, open it. Fullscreen, the master volume, the notes of
 * this version, the map key, the keys, the credits and, in the desktop app
 * only, Quit. A
 * browser tab cannot close itself, so the web version has no Quit.
 *
 * Quit during a game asks first, in the menu itself: the game under way ends,
 * and in coop the room loses the player.
 *
 * Alone, the game pauses while the menu is open, as a game's menu does; it
 * goes on when the menu closes, unless it was paused before. In coop the
 * room's clock is everyone's, so it runs on.
 */
@Component({
  selector: 'app-game-menu',
  standalone: true,
  imports: [MatDialogModule, TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './game-menu.component.html',
  styleUrl: './game-menu.component.scss',
  styles: `
    :host {
      ${TD_CSS_VARS}
    }
  `,
})
export class GameMenuComponent {
  private readonly dialogRef = inject(MatDialogRef<GameMenuComponent>);
  private readonly dialog = inject(MatDialog);
  private readonly whatsNew = inject(WhatsNewService);
  private readonly bridge = readDesktopBridge();
  readonly ui = inject(UIStore);
  private readonly store = inject(GameStore);
  private readonly coop = inject(CoopService);
  private readonly config = inject(ConfigService);

  readonly version = BUILD_VERSION;
  /** Quit exists where the app can end itself: the desktop build from 0.5.1 on */
  readonly canQuit = typeof this.bridge?.quit === 'function';
  readonly fullscreen = signal(false);
  /** Quit was pressed during a game; the menu asks before it ends it */
  readonly confirmingQuit = signal(false);
  readonly inCoop = computed(() => this.coop.inGame());

  constructor() {
    void this.readFullscreen();
    if (!this.inCoop() && !this.store.paused()) {
      this.store.paused.set(true);
      inject(DestroyRef).onDestroy(() => this.store.paused.set(false));
    }
  }

  private async readFullscreen(): Promise<void> {
    if (typeof this.bridge?.isFullscreen === 'function') {
      this.fullscreen.set(await this.bridge.isFullscreen());
    } else {
      this.fullscreen.set(!!document.fullscreenElement);
    }
  }

  /** The app switches its window as F11 does; a browser takes the page to fullscreen */
  async toggleFullscreen(): Promise<void> {
    if (typeof this.bridge?.toggleFullscreen === 'function') {
      this.fullscreen.set(await this.bridge.toggleFullscreen());
      return;
    }
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      // Refused (an embedded frame, a browser setting): the state below says what is
    }
    this.fullscreen.set(!!document.fullscreenElement);
  }

  onVolume(event: Event): void {
    this.ui.masterVolume.set((event.target as HTMLInputElement).valueAsNumber / 100);
    this.ui.masterMuted.set(false);
  }

  toggleMute(): void {
    this.ui.masterMuted.update((muted) => !muted);
  }

  /** The key screen: swap or clear the Cesium ion token or Google Maps key */
  openMapKey(): void {
    this.dialogRef.close();
    this.config.setupRequested.set(true);
  }

  /** The other dialogs open on their own, the menu makes room */
  openWhatsNew(): void {
    this.dialogRef.close();
    this.whatsNew.open();
  }

  openKeys(): void {
    this.dialogRef.close();
    void openHotkeyHelpDialog(this.dialog);
  }

  openAttributions(): void {
    this.dialogRef.close();
    void openAttributionsDialog(this.dialog);
  }

  /** Straight out when nothing is at stake, otherwise ask first */
  quit(): void {
    if (!this.canQuit) return;
    const underWay = this.store.gameStarted() || this.store.towerCount() > 0 || this.inCoop();
    if (underWay && !this.confirmingQuit()) {
      this.confirmingQuit.set(true);
      return;
    }
    this.bridge?.quit?.();
  }

  cancelQuit(): void {
    this.confirmingQuit.set(false);
  }

  close(): void {
    this.dialogRef.close();
  }
}
