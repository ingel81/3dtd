/**
 * Tab and Shift+Tab go round `controls` and nowhere else; from anywhere
 * outside them Tab comes back in. For bars that stay while the rest of the
 * HUD is hidden (photo mode, replay). Leaves a key that is not Tab, or one a
 * handler already took, alone.
 */
export function cycleTab(event: KeyboardEvent, controls: readonly HTMLElement[]): void {
  if (event.key !== 'Tab' || event.defaultPrevented || controls.length === 0) return;
  const at = controls.indexOf(document.activeElement as HTMLElement);
  const last = controls.length - 1;
  const next = event.shiftKey
    ? controls[at <= 0 ? last : at - 1]
    : controls[at < 0 || at === last ? 0 : at + 1];
  event.preventDefault();
  next.focus();
}

/** The focused element, null when nothing but the page has the focus. */
export function focusedElement(): HTMLElement | null {
  const el = document.activeElement;
  return el instanceof HTMLElement && el !== document.body ? el : null;
}
