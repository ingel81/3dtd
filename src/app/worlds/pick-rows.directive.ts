import { Directive, ElementRef, Injector, afterNextRender, inject, output } from '@angular/core';

/** A row of a world's list that picks (a place, a map); its pick opens under it */
const ROW = '[data-pick-row]';

/** Where a key moves from row `at` of `n` */
const STEPS: Readonly<Record<string, (at: number, n: number) => number>> = {
  ArrowDown: (at) => at + 1,
  ArrowUp: (at) => at - 1,
  Home: () => 0,
  End: (_, n) => n - 1,
};

/**
 * The keys and the scrolling of a world menu's list, whose picked row opens
 * with its Start under it (docs/WORLDS_NAVIGATION_PLAN.md, 3.1): Up and
 * Down (Home, End) move to the next row and pick it, Enter plays the row
 * (picking it first); after a pick by key or click the opened row is
 * scrolled whole into the list's view, the focus stays on the row. The row
 * picks by its own click handler, so the directive knows nothing of what it
 * picks.
 *
 * Usage: `<div class="wm-body" appPickRows (pickRowsPlay)="stage.start('maps')">` around rows marked
 * `data-pick-row`, each in a `.wm-item` that holds its opened part.
 */
@Directive({
  selector: '[appPickRows]',
  standalone: true,
  host: { '(keydown)': 'onKeyDown($event)', '(click)': 'onClick($event)' },
})
export class PickRowsDirective {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);
  /** Enter on a row: play its pick */
  readonly pickRowsPlay = output<void>();

  onKeyDown(event: KeyboardEvent): void {
    const row = this.rowOf(event.target);
    if (!row) return;
    if (event.key === 'Enter') {
      // Not the button's own click: a row not picked yet is picked, then played
      event.preventDefault();
      if (row.getAttribute('aria-expanded') !== 'true') row.click();
      this.pickRowsPlay.emit();
      return;
    }
    const step = STEPS[event.key];
    if (!step) return;
    // The arrows are spent on the list, also at its ends
    event.preventDefault();
    const rows = [...this.host.querySelectorAll<HTMLElement>(ROW)].filter((r) => r.getAttribute('aria-disabled') !== 'true');
    const to = rows[step(rows.indexOf(row), rows.length)];
    if (!to || to === row) return;
    to.focus();
    to.click();
  }

  onClick(event: Event): void {
    const row = this.rowOf(event.target);
    if (row) afterNextRender(() => this.reveal(row), { injector: this.injector });
  }

  /** The row with what opened under it, whole in the list's view (the least scroll that does it) */
  private reveal(row: HTMLElement): void {
    const item = row.closest<HTMLElement>('.wm-item') ?? row;
    item.scrollIntoView?.({ block: 'nearest' });
  }

  /** The row an event happened on (a click lands on its name), not a tool beside it or a button in its opened part */
  private rowOf(target: EventTarget | null): HTMLElement | null {
    const row = target instanceof Element ? target.closest<HTMLElement>(ROW) : null;
    return row && this.host.contains(row) ? row : null;
  }
}
