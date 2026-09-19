import { ChangeDetectionStrategy, Component, DestroyRef, NgZone, inject, signal } from '@angular/core';
import { TdIconComponent } from '../icon/icon.component';
import { readDesktopBridge, type DesktopUpdate } from '../../core/desktop-bridge';

/**
 * Desktop build only: a downloaded update and a way to install it now. The
 * update installs anyway when the player quits; the hint says so and offers
 * a restart, which ends the game under way. Not modal, it never stops a
 * wave; the player can hide it. In a browser there is no bridge and the
 * component renders nothing.
 *
 * The one place the game knows it may run as a desktop app, see
 * docs/ELECTRON_DESKTOP_PLAN.md (E32).
 */
@Component({
  selector: 'app-update-hint',
  standalone: true,
  imports: [TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './update-hint.component.html',
  styleUrl: './update-hint.component.scss',
})
export class UpdateHintComponent {
  private readonly bridge = readDesktopBridge();
  readonly update = signal<DesktopUpdate | null>(null);
  readonly hidden = signal(false);

  constructor() {
    const bridge = this.bridge;
    if (!bridge) return;
    const zone = inject(NgZone);
    // The preload calls back outside Angular's zone
    const unsubscribe = bridge.onUpdateReady((update) => zone.run(() => this.update.set(update)));
    inject(DestroyRef).onDestroy(unsubscribe);
  }

  restart(): void {
    this.bridge?.installUpdateNow();
  }

  hide(): void {
    this.hidden.set(true);
  }
}
