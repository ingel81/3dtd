/** Input types that take typed text; the others (checkbox, range, button, ...) leave keys to the game. */
const TEXT_INPUT_TYPES = new Set([
  'text', 'search', 'number', 'email', 'password', 'url', 'tel',
  'date', 'datetime-local', 'month', 'time', 'week',
]);

/** Keys a focused slider moves its value with. */
const SLIDER_KEYS = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown',
]);

/**
 * True when the focused element takes `key` itself, so the game must leave
 * it alone: every key in a text field, a select or an editable element
 * (location search, token setup, debug inputs), and the slider keys on a
 * range input. A focused checkbox or button takes no key: after a click on
 * one the game keys keep working. On a slider only its own keys stop, the
 * arrows move the slider instead of the camera, Space still starts a wave.
 */
export function ownsKey(target: EventTarget | null, key: string): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input') {
    const type = (el as HTMLInputElement).type;
    return TEXT_INPUT_TYPES.has(type) || (type === 'range' && SLIDER_KEYS.has(key));
  }
  return tag === 'textarea' || tag === 'select' || el.isContentEditable === true;
}

/** Keys a focused control uses itself: Tab moves the focus on, Enter and Space press it (Space ticks a checkbox). */
const CONTROL_KEYS = new Set(['Tab', 'Enter', ' ']);

/** Elements that press or move on Enter and Tab */
const CONTROL_SELECTOR = 'button, a[href], summary, input, [role="button"], [role="radio"], [role="tab"], [role="menuitem"]';

/** A focus this soon after a pointer press came from the pointer, ms */
const POINTER_FOCUS_MS = 600;

/**
 * Where the focus came from: the element the keyboard (Tab, a script)
 * focused last, null when the pointer did. `:focus-visible` cannot tell:
 * Chrome turns it on for a clicked button at the first key press after the
 * click (tried 2026-09-26), so a click and then Enter would look like
 * keyboard use.
 */
export class FocusOrigin {
  private pointerAt = -Infinity;
  private byKeyboard: Element | null = null;
  /** A pointer pressed anywhere on the page since it loaded */
  private pointerSeen = false;

  constructor(doc: Document) {
    doc.addEventListener('pointerdown', () => {
      this.pointerAt = performance.now();
      this.pointerSeen = true;
    }, true);
    // A key press moves on from the last click: the next focus is the keyboard's
    doc.addEventListener('keydown', () => { this.pointerAt = -Infinity; }, true);
    doc.addEventListener('focusin', (event) => {
      this.byKeyboard = performance.now() - this.pointerAt < POINTER_FOCUS_MS ? null : (event.target as Element);
    }, true);
  }

  /** The keyboard focused `el`, not a pointer */
  byKeyboardFocus(el: Element): boolean {
    return el === this.byKeyboard;
  }

  /** The page has seen a pointer press: the player is on the map, not tabbing in from the address bar */
  pointerUsed(): boolean {
    return this.pointerSeen;
  }
}

let origin: FocusOrigin | null = null;

/** The page's FocusOrigin, set up on first use */
function pageFocusOrigin(): FocusOrigin | null {
  if (typeof document === 'undefined') return null;
  origin ??= new FocusOrigin(document);
  return origin;
}

/** The page has seen a pointer press since it loaded (FocusOrigin.pointerUsed) */
export function pointerUsedYet(): boolean {
  return pageFocusOrigin()?.pointerUsed() ?? false;
}

/** The keyboard (Tab, a script, an arrow key) focused `el`, not a pointer (FocusOrigin.byKeyboardFocus) */
export function focusedByKeyboard(el: Element): boolean {
  return pageFocusOrigin()?.byKeyboardFocus(el) ?? false;
}

/** Set up the focus tracking early, before the first click the game keys may care about */
export function trackFocusOrigin(): void {
  pageFocusOrigin();
}

/**
 * True when Tab, Enter or Space belongs to the focused control and not to a
 * game key (the coop keys: Tab opens the dock, Enter the chat; Space starts a
 * wave). Only a control
 * the player reached by keyboard counts: a button clicked with the mouse
 * keeps the focus, and the game keys keep working after the click, as
 * `ownsKey` wants.
 * @param byKeyboard whether the keyboard focused the element; the page's FocusOrigin by default
 */
export function controlTakesKey(
  target: EventTarget | null,
  key: string,
  byKeyboard: (el: Element) => boolean = (el) => pageFocusOrigin()?.byKeyboardFocus(el) ?? false,
): boolean {
  if (!CONTROL_KEYS.has(key)) return false;
  const el = target as Element | null;
  if (!el || typeof el.matches !== 'function' || !el.matches(CONTROL_SELECTOR)) return false;
  return byKeyboard(el);
}

/** Overlay panes that hold a tooltip and nothing the player works in */
const TOOLTIP_PANE = '.mat-mdc-tooltip-panel, .td-rich-tooltip-panel';

/**
 * True when Escape must reach the game before a matTooltip spends it. A
 * tooltip open under the pointer (a button just clicked, the mouse still on
 * it) takes Escape on body and stops it there, so the first press only
 * closed the tooltip; letting a tower or the hero go, or opening the menu,
 * took a second one. The game takes it first when a matTooltip shows, no
 * other overlay is open (a dialog, a menu or a select keeps its Escape) and
 * the keyboard is not on a tooltip's trigger: a tooltip the player tabbed to
 * is closed by Escape alone, as it must be. The tooltip still closes.
 */
export function escapeBelongsToGame(
  event: KeyboardEvent,
  doc: Document = document,
  byKeyboard: (el: Element) => boolean = focusedByKeyboard,
): boolean {
  if (event.key !== 'Escape' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  // Overlay panes keep their element after they detach: only filled ones count
  const panes = Array.from(doc.querySelectorAll('.cdk-overlay-pane')).filter((pane) => pane.childElementCount > 0);
  if (!panes.some((pane) => pane.matches('.mat-mdc-tooltip-panel'))) return false;
  if (!panes.every((pane) => pane.matches(TOOLTIP_PANE))) return false;
  const active = doc.activeElement;
  return !(active && active.matches('.mat-mdc-tooltip-trigger') && byKeyboard(active));
}
