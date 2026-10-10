import {
  ComponentRef,
  Directive,
  ElementRef,
  HostListener,
  Injector,
  OnDestroy,
  effect,
  inject,
  input,
} from '@angular/core';
import {
  ConnectedPosition,
  Overlay,
  OverlayPositionBuilder,
  OverlayRef,
  ScrollStrategyOptions,
} from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { AriaDescriber } from '@angular/cdk/a11y';
import { focusIsQuiet, focusedByKeyboard, trackFocusOrigin } from '../../utils/keyboard-target';
import { tooltipText } from './tooltip-text';
import { TdTooltipContentComponent } from './td-tooltip-content.component';
import { TdTooltipData } from './tooltip-data.types';

/**
 * Show-delay (ms) — matches MatTooltip default for muscle memory consistency.
 */
const SHOW_DELAY = 200;
const HIDE_DELAY = 80;

const POSITION_PRESETS: Record<string, ConnectedPosition[]> = {
  // Left of a sidebar card: clear of the sidebar's gutter (14px) as well
  left: [
    { originX: 'start', originY: 'center', overlayX: 'end', overlayY: 'center', offsetX: -24 },
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
 * when the host element receives mouseenter/focus, dismisses on mouseleave/blur
 * and on Escape. Open, it follows its data: new data redraws the card, null or
 * disabled closes it. Its text also describes the host for screen readers
 * (aria-describedby to a visually hidden copy, as MatTooltip does).
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
  private readonly ariaDescriber = inject(AriaDescriber);
  /** The text the host is described with now, null without one */
  private described: string | null = null;

  readonly tdRichTooltip = input.required<TdTooltipData | null>();
  readonly tdRichTooltipPosition = input<'left' | 'right' | 'above' | 'below'>('left');
  readonly tdRichTooltipDisabled = input<boolean>(false);

  private overlayRef: OverlayRef | null = null;
  private contentRef: ComponentRef<TdTooltipContentComponent> | null = null;
  private showTimer: ReturnType<typeof setTimeout> | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Whether the host has the keyboard's focus, for Escape
    trackFocusOrigin();
    // An open card shows what its host shows now (a countdown, a state)
    effect(() => {
      const data = this.tdRichTooltip();
      const disabled = this.tdRichTooltipDisabled();
      this.describe(data && !disabled ? tooltipText(data) : null);
      if (!this.contentRef) return;
      if (!data || disabled) this.closeOverlay();
      else this.contentRef.setInput('data', data);
    });
  }

  /** Focus opens the card, not a focus given back quietly (a menu closing, focusQuietly) */
  @HostListener('focus')
  onFocus(): void {
    if (!focusIsQuiet(this.host.nativeElement)) this.onShow();
  }

  @HostListener('mouseenter')
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
    this.describe(null);
  }

  private describe(text: string | null): void {
    if (text === this.described) return;
    const host = this.host.nativeElement;
    if (this.described) this.ariaDescriber.removeDescription(host, this.described);
    this.described = text;
    if (text) this.ariaDescriber.describe(host, text);
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

    // Escape closes the card (keydown on body, before the game's window listener). It is
    // spent on the card only when the keyboard is on the host: a card the pointer opened
    // leaves that Escape to the game too (the pointer resting on the NEXT box or an ability
    // button while the player lets the hero or a tower go, or opens the menu).
    this.overlayRef.keydownEvents().subscribe((event) => {
      if (event.key !== 'Escape' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const host = this.host.nativeElement;
      if (document.activeElement === host && focusedByKeyboard(host)) {
        event.preventDefault();
        event.stopPropagation();
      }
      this.cancelHide();
      this.closeOverlay();
    });

    const portal = new ComponentPortal(TdTooltipContentComponent, null, this.injector);
    this.contentRef = this.overlayRef.attach(portal);
    this.contentRef.setInput('data', data);
  }

  private closeOverlay(): void {
    if (!this.overlayRef) return;
    this.overlayRef.dispose();
    this.overlayRef = null;
    this.contentRef = null;
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
