/**
 * True while keys go into a text field, a select or an editable element.
 * Game shortcuts must not interfere with typing (location search, token setup,
 * debug inputs).
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable === true;
}
