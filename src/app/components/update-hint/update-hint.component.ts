import { ChangeDetectionStrategy, Component, DestroyRef, NgZone, computed, inject, signal } from '@angular/core';
import { TdIconComponent } from '../icon/icon.component';
import { readDesktopBridge, type DesktopUpdate } from '../../core/desktop-bridge';
import { parseReleaseBody } from '../../utils/changelog';

/** Items of the release notes the hint lists; the rest shows in "What's new" after the restart. */
const NOTE_ITEMS = 3;

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
  /** The first items of the update's release notes, "New" first as written. */
  readonly noteItems = computed(() => {
    const items = parseReleaseBody(this.update()?.notes ?? '').flatMap((group) => group.items);
    return { shown: items.slice(0, NOTE_ITEMS), more: items.length > NOTE_ITEMS };
  });

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
