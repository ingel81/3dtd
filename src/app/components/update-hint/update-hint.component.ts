import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  NgZone,
  TemplateRef,
  ViewChild,
  ViewContainerRef,
  afterRenderEffect,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Overlay, type OverlayRef } from '@angular/cdk/overlay';
import { TemplatePortal } from '@angular/cdk/portal';
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
 * The chip sits in the CDK overlay above every dialog, anchored where this
 * component stands: the location dialog is modal and opens on the first
 * start, and its backdrop swallowed the click on "Restart now" (seen with
 * 0.5.0-beta.2 offering 0.5.0).
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
  // In the overlay the chip is outside the game's host, so it brings the theme along
  styles: `
    .uh {
    }
  `,
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

  /** Static: there before the first render, whenever the bridge reports */
  @ViewChild('chip', { static: true }) private chip?: TemplateRef<unknown>;
  private readonly overlay = inject(Overlay);
  private readonly anchor = inject(ElementRef<HTMLElement>);
  private readonly viewContainer = inject(ViewContainerRef);
  private overlayRef: OverlayRef | null = null;

  constructor() {
    const bridge = this.bridge;
    if (!bridge) return;
    const zone = inject(NgZone);
    // The preload calls back outside Angular's zone
    const unsubscribe = bridge.onUpdateReady((update) => zone.run(() => this.update.set(update)));
    // After render: the template holding the chip exists by then, also when the
    // bridge hands over an update that was ready before the page loaded
    afterRenderEffect(() => {
      const chip = this.chip;
      if (chip && this.update() && !this.hidden()) this.show(chip);
      else this.overlayRef?.detach();
    });
    inject(DestroyRef).onDestroy(() => {
      unsubscribe();
      this.overlayRef?.dispose();
    });
  }

  /** Into the overlay, its top right corner on this component's */
  private show(chip: TemplateRef<unknown>): void {
    this.overlayRef ??= this.overlay.create({
      positionStrategy: this.overlay
        .position()
        .flexibleConnectedTo(this.anchor)
        .withPositions([{ originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'top' }])
        .withFlexibleDimensions(false)
        .withPush(false),
      scrollStrategy: this.overlay.scrollStrategies.reposition(),
    });
    // Above the dialogs, also those opened later (styles.scss)
    this.overlayRef.hostElement.classList.add('td-update-hint-host');
    if (!this.overlayRef.hasAttached()) this.overlayRef.attach(new TemplatePortal(chip, this.viewContainer));
  }

  restart(): void {
    this.bridge?.installUpdateNow();
  }

  hide(): void {
    this.hidden.set(true);
  }
}
