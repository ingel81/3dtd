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
