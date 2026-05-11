import {
  Directive,
  ElementRef,
  HostListener,
  Injector,
  OnDestroy,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  ConnectedPosition,
  Overlay,
  OverlayPositionBuilder,
  OverlayRef,
  ScrollStrategyOptions,
} from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { TdTooltipContentComponent } from './td-tooltip-content.component';
import { TdTooltipData } from './tooltip-data.types';

/**
 * Show-delay (ms) — matches MatTooltip default for muscle memory consistency.
 */
const SHOW_DELAY = 200;
const HIDE_DELAY = 80;

const POSITION_PRESETS: Record<string, ConnectedPosition[]> = {
  left: [
    { originX: 'start', originY: 'center', overlayX: 'end', overlayY: 'center', offsetX: -8 },
    { originX: 'end', originY: 'center', overlayX: 'start', overlayY: 'center', offsetX: 8 },
  ],
  right: [
    { originX: 'end', originY: 'center', overlayX: 'start', overlayY: 'center', offsetX: 8 },
    { originX: 'start', originY: 'center', overlayX: 'end', overlayY: 'center', offsetX: -8 },
  ],
  above: [
    { originX: 'center', originY: 'top', overlayX: 'center', overlayY: 'bottom', offsetY: -8 },
    { originX: 'center', originY: 'bottom', overlayX: 'center', overlayY: 'top', offsetY: 8 },
  ],
  below: [
    { originX: 'center', originY: 'bottom', overlayX: 'center', overlayY: 'top', offsetY: 8 },
    { originX: 'center', originY: 'top', overlayX: 'center', overlayY: 'bottom', offsetY: -8 },
  ],
};

/**
 * Rich tooltip directive — opens a CDK overlay hosting `<td-tooltip-content>`
 * when the host element receives mouseenter/focus, dismisses on mouseleave/blur.
 *
 * Replaces `[matTooltip]`/`matTooltipClass` for cases where structured markup
 * is needed (Tower-Cards, Enemy-Cards, …). MatTooltip remains the right choice
 * for plain string hints elsewhere.
 *
 * Usage: `<button [tdRichTooltip]="towerTooltipData(tower)" tdRichTooltipPosition="left">…`
 */
@Directive({
  selector: '[tdRichTooltip]',
  standalone: true,
})
export class TdRichTooltipDirective implements OnDestroy {
  private readonly overlay = inject(Overlay);
  private readonly positionBuilder = inject(OverlayPositionBuilder);
  private readonly scrollStrategies = inject(ScrollStrategyOptions);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  readonly tdRichTooltip = input.required<TdTooltipData | null>();
  readonly tdRichTooltipPosition = input<'left' | 'right' | 'above' | 'below'>('left');
  readonly tdRichTooltipDisabled = input<boolean>(false);

  private overlayRef: OverlayRef | null = null;
  private showTimer: ReturnType<typeof setTimeout> | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  // Allow component to react to data changes if open
  private readonly visibleData = signal<TdTooltipData | null>(null);
  private readonly _ = computed(() => {
    const data = this.tdRichTooltip();
    if (this.overlayRef && data) {
      this.visibleData.set(data);
    }
  });

  @HostListener('mouseenter')
  @HostListener('focus')
  onShow(): void {
    if (this.tdRichTooltipDisabled() || !this.tdRichTooltip()) return;
    this.cancelHide();
    if (this.overlayRef || this.showTimer) return;
    this.showTimer = setTimeout(() => {
      this.showTimer = null;
      this.openOverlay();
    }, SHOW_DELAY);
  }

  @HostListener('mouseleave')
  @HostListener('blur')
  @HostListener('document:click', ['$event'])
  onHide(event?: MouseEvent): void {
    // For document:click: only hide if click was outside host
    if (event && event.type === 'click') {
      if (this.host.nativeElement.contains(event.target as Node)) return;
    }
    this.cancelShow();
    if (!this.overlayRef) return;
    if (this.hideTimer) return;
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      this.closeOverlay();
    }, HIDE_DELAY);
  }

  ngOnDestroy(): void {
    this.cancelShow();
    this.cancelHide();
    this.closeOverlay();
  }

  private openOverlay(): void {
    const data = this.tdRichTooltip();
    if (!data) return;

    const positions = POSITION_PRESETS[this.tdRichTooltipPosition()] ?? POSITION_PRESETS['left'];
    const positionStrategy = this.positionBuilder
      .flexibleConnectedTo(this.host)
      .withPositions(positions)
      .withFlexibleDimensions(false)
      // Push overlay back into the viewport when an edge would clip it.
      // Needed for tooltips on host elements near the top of the screen
      // (e.g. enemy-group rows at the very top of the sidebar) where the
      // ~300px tall card would otherwise overflow above the viewport.
      .withPush(true);

    this.overlayRef = this.overlay.create({
      positionStrategy,
      scrollStrategy: this.scrollStrategies.reposition(),
      hasBackdrop: false,
      panelClass: 'td-rich-tooltip-panel',
    });

    const portal = new ComponentPortal(TdTooltipContentComponent, null, this.injector);
    const ref = this.overlayRef.attach(portal);
    ref.setInput('data', data);
    this.visibleData.set(data);
  }

  private closeOverlay(): void {
    if (!this.overlayRef) return;
    this.overlayRef.dispose();
    this.overlayRef = null;
    this.visibleData.set(null);
  }

  private cancelShow(): void {
    if (this.showTimer !== null) {
      clearTimeout(this.showTimer);
      this.showTimer = null;
    }
  }

  private cancelHide(): void {
    if (this.hideTimer !== null) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }
}
