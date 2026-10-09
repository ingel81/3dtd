/** Id of the button's frame; a new button replaces the one before. */
export const COPY_BUTTON_ID = 'td-copy-result';

/** Where the frame stands: the top centre, as the cell report panel. Its look is the td-overlay strip. */
const FRAME_STYLE = [
  'position: fixed', 'top: 120px', 'left: 50%', 'transform: translateX(-50%)', 'z-index: 1000',
  'padding: 10px 12px',
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
  frame.className = 'td-overlay';
  frame.style.cssText = FRAME_STYLE;
  const button = doc.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.className = 'td-btn-primary td-btn-sm';
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
