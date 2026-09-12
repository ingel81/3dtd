/** Input types that take typed text; the others (checkbox, range, button, ...) leave keys to the game. */
const TEXT_INPUT_TYPES = new Set([
  'text', 'search', 'number', 'email', 'password', 'url', 'tel',
  'date', 'datetime-local', 'month', 'time', 'week',
]);

/**
 * True while keys go into a text field, a select or an editable element.
 * Game shortcuts must not interfere with typing (location search, token setup,
 * debug inputs). A focused checkbox or slider does not count: after a click on
 * one the game keys keep working.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input') return TEXT_INPUT_TYPES.has((el as HTMLInputElement).type);
  return tag === 'textarea' || tag === 'select' || el.isContentEditable === true;
}
