import { DestroyRef, Directive, ElementRef, afterNextRender, inject } from '@angular/core';
import { focusedByKeyboard, trackFocusOrigin } from '../utils/keyboard-target';

/** The items of a group: its radios, tabs or menu entries */
const ITEM_SELECTOR = '[role="radio"], [role="tab"], [role="menuitem"]';

/** A menu entry only takes the focus; Enter or a click acts */
const IS_MENU_ITEM = (item: HTMLElement) => item.getAttribute('role') === 'menuitem';

/** An item that is the group's choice */
const CHOSEN = (item: HTMLElement) =>
  item.getAttribute('aria-checked') === 'true' || item.getAttribute('aria-selected') === 'true';

/**
 * Arrow keys for a radio group or a tab list (WAI-ARIA): the group is one
 * Tab stop, on its choice (roving tabindex); Left/Up and Right/Down move to
 * the previous or next item and choose it, wrapping, Home and End to the
 * first and last. An item with `aria-disabled="true"` is skipped. The item
 * chooses by its own click handler, so the directive needs no knowledge of
 * what the group sets.
 *
 * The arrows are spent on the group: they reach no window listener, so the
 * camera does not pan while the player picks with them. Only on an item the
 * keyboard focused: a radio clicked with the mouse keeps the focus in
 * Chrome, and the arrows then still pan the camera (utils/keyboard-target.ts:
 * a clicked control takes no game key).
 *
 * A menu (`role="menu"` around `role="menuitem"` buttons, the main menu's
 * list) moves the focus only, and with any focus: the menu owns the
 * keyboard while it stands, no camera pans behind it.
 *
 * Usage: `<div role="radiogroup" tdRovingGroup>` around `role="radio"` buttons.
 */
@Directive({
  selector: '[tdRovingGroup]',
  standalone: true,
  host: { '(keydown)': 'onKeyDown($event)' },
})
export class RovingGroupDirective {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  constructor() {
    // Whether the keyboard or the pointer focused an item, from the first click on
    trackFocusOrigin();
    // The Tab stop follows the choice, whoever changes it (a click, a key, the game)
    const observer = new MutationObserver(() => this.updateTabStops());
    afterNextRender(() => {
      this.updateTabStops();
      observer.observe(this.host, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['aria-checked', 'aria-selected', 'aria-disabled'],
      });
    });
    inject(DestroyRef).onDestroy(() => observer.disconnect());
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const items = this.items();
    const from = items.indexOf(event.target as HTMLElement);
    if (from < 0) return;
    const menu = IS_MENU_ITEM(items[from]);
    if (!menu && !focusedByKeyboard(event.target as HTMLElement)) return;
    const usable = items.filter((item) => item.getAttribute('aria-disabled') !== 'true');
    if (usable.length === 0) return;

    let next: HTMLElement | undefined;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = this.step(items, from, 1, usable);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = this.step(items, from, -1, usable);
        break;
      case 'Home':
        next = usable[0];
        break;
      case 'End':
        next = usable[usable.length - 1];
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (!next || next === event.target) return;
    next.focus();
    if (!menu && !CHOSEN(next)) next.click();
  }

  /** The next usable item from `from` in `direction`, wrapping */
  private step(items: HTMLElement[], from: number, direction: 1 | -1, usable: HTMLElement[]): HTMLElement | undefined {
    for (let i = 1; i <= items.length; i++) {
      const item = items[(from + direction * i + items.length) % items.length];
      if (usable.includes(item)) return item;
    }
    return undefined;
  }

  private items(): HTMLElement[] {
    return Array.from(this.host.querySelectorAll<HTMLElement>(ITEM_SELECTOR));
  }

  /** The choice is the Tab stop, the first usable item without one */
  private updateTabStops(): void {
    const items = this.items();
    const stop = items.find(CHOSEN) ?? items.find((item) => item.getAttribute('aria-disabled') !== 'true') ?? items[0];
    for (const item of items) {
      const tabIndex = item === stop ? '0' : '-1';
      if (item.getAttribute('tabindex') !== tabIndex) item.setAttribute('tabindex', tabIndex);
    }
  }
}
