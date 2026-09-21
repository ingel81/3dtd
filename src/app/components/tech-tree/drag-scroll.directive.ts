import { Directive, ElementRef, inject } from '@angular/core';

/**
 * Drag to pan a scrollable box, with the scrollbars still there.
 *
 * On a graph that outgrows its frame, reaching for a scrollbar in two
 * directions is worse than pulling the thing itself. Sits next to the tech
 * tree because that is what needs it, and it stays a plain directive so the
 * hero tree gets it by putting the attribute on its own frame.
 *
 * A drag that moved more than a few pixels swallows the click that follows it,
 * otherwise panning across a node would activate it.
 *
 * The pointer is captured only once that threshold is passed, never on the
 * press itself: a capture retargets every later pointer event to this element,
 * and the click born from pointerup along with them, so capturing early makes
 * every button inside unclickable.
 */
@Directive({
  selector: '[tdDragScroll]',
  standalone: true,
  host: {
    '(pointerdown)': 'onDown($event)',
    '(pointermove)': 'onMove($event)',
    '(pointerup)': 'onUp($event)',
    '(pointercancel)': 'onUp($event)',
    '(click)': 'onClick($event)',
    '[style.cursor]': 'panning ? "grabbing" : "grab"',
    // Only the pan is ours; a plain press has to stay a click.
    '[style.touch-action]': '"none"',
  },
})
export class DragScrollDirective {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected panning = false;
  private pointerId: number | null = null;
  private startX = 0;
  private startY = 0;
  private scrollX = 0;
  private scrollY = 0;
  /** Set once a drag passed the threshold, read and cleared by the next click. */
  private dragged = false;

  /** Below this a drag is a click with a shaky hand, not a pan. */
  private static readonly THRESHOLD_PX = 4;

  protected onDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    this.pointerId = event.pointerId;
    this.panning = true;
    this.dragged = false;
    this.startX = event.clientX;
    this.startY = event.clientY;
    this.scrollX = this.host.nativeElement.scrollLeft;
    this.scrollY = this.host.nativeElement.scrollTop;
  }

  protected onMove(event: PointerEvent): void {
    if (!this.panning || event.pointerId !== this.pointerId) return;
    const dx = event.clientX - this.startX;
    const dy = event.clientY - this.startY;
    if (
      !this.dragged &&
      (Math.abs(dx) > DragScrollDirective.THRESHOLD_PX || Math.abs(dy) > DragScrollDirective.THRESHOLD_PX)
    ) {
      // Now it is a pan, so hold the pointer until it is let go.
      this.dragged = true;
      this.host.nativeElement.setPointerCapture(event.pointerId);
    }
    this.host.nativeElement.scrollLeft = this.scrollX - dx;
    this.host.nativeElement.scrollTop = this.scrollY - dy;
  }

  protected onUp(event: PointerEvent): void {
    if (event.pointerId !== this.pointerId) return;
    this.panning = false;
    this.pointerId = null;
    if (this.host.nativeElement.hasPointerCapture(event.pointerId)) {
      this.host.nativeElement.releasePointerCapture(event.pointerId);
    }
  }

  protected onClick(event: MouseEvent): void {
    if (!this.dragged) return;
    // The pan ended on a node: that is not a pick.
    event.preventDefault();
    event.stopPropagation();
    this.dragged = false;
  }
}
