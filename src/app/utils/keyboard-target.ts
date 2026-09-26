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

/** Keys a focused control uses itself: Tab moves the focus on, Enter presses it. */
const CONTROL_KEYS = new Set(['Tab', 'Enter']);

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

  constructor(doc: Document) {
    doc.addEventListener('pointerdown', () => { this.pointerAt = performance.now(); }, true);
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
}

let origin: FocusOrigin | null = null;

/** The page's FocusOrigin, set up on first use */
function pageFocusOrigin(): FocusOrigin | null {
  if (typeof document === 'undefined') return null;
  origin ??= new FocusOrigin(document);
  return origin;
}

/** Set up the focus tracking early, before the first click the game keys may care about */
export function trackFocusOrigin(): void {
  pageFocusOrigin();
}

/**
 * True when Tab or Enter belongs to the focused control and not to a game
 * key (the coop keys: Tab opens the dock, Enter the chat). Only a control
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
