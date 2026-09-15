/** Id of the button's frame; a new button replaces the one before. */
export const COPY_BUTTON_ID = 'td-copy-result';

/** Glass frame at the top centre, as the cell report panel (cell-report-panel.component.scss, `.crp`). */
const FRAME_STYLE = [
  'position: fixed', 'top: 120px', 'left: 50%', 'transform: translateX(-50%)', 'z-index: 1000',
  'padding: 10px 12px', 'border-radius: 4px',
  'background: var(--td-glass-tint, rgba(20, 24, 22, 0.85))',
  'backdrop-filter: blur(8px) saturate(1.1)',
  'border: 1px solid var(--td-frame-mid, #4a544d)',
  'box-shadow: var(--td-shadow-soft, none), inset 0 1px 0 rgba(122, 133, 128, 0.33)',
].join('; ');

/** The panel's gold button (`.crp-btn-gold`). */
const BUTTON_STYLE = [
  'padding: 5px 14px', 'border: 1px solid rgba(26, 20, 10, 0.8)', 'border-radius: 2px',
  'background: linear-gradient(180deg, var(--td-gold-light, #d9bc68), var(--td-gold, #c9a227) 55%, var(--td-gold-dark, #8a6d1a))',
  'box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.25)',
  'color: #1a140a', 'font: 700 11px var(--td-font-mono, monospace)', 'letter-spacing: 0.06em',
  'text-transform: uppercase', 'cursor: pointer',
].join('; ');

/**
 * A button at the top centre of the page that copies `text` on one click
 * and goes away, in the look of the cell report panel. For
 * `__corridor.probeLod()`: typing in DevTools takes the page's focus, and
 * the clipboard refuses without it; the click on the button gives it back.
 * Where the clipboard refuses even then, the text goes to the console and
 * the button says so. One at a time: a new one replaces the last.
 */
export function showCopyButton(text: string, label = 'Ergebnis kopieren', doc: Document = document): HTMLElement {
  doc.getElementById(COPY_BUTTON_ID)?.remove();
  const frame = doc.createElement('div');
  frame.id = COPY_BUTTON_ID;
  frame.style.cssText = FRAME_STYLE;
  const button = doc.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.style.cssText = BUTTON_STYLE;
  button.addEventListener('click', async (event) => {
    // Not a click on the map
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      frame.remove();
    } catch {
      console.log(text);
      button.textContent = 'Kopieren abgelehnt: Ergebnis steht in der Konsole';
    }
  });
  frame.append(button);
  doc.body.append(frame);
  return frame;
}
