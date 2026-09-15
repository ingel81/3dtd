import { afterEach, describe, expect, it, vi } from 'vitest';
import { COPY_BUTTON_ID, showCopyButton } from './copy-result-button';

/**
 * The button `__corridor.probeLod()` shows when the clipboard refused its
 * report (DevTools had the focus): one click copies and it goes away.
 */
describe('showCopyButton', () => {
  const writeText = vi.fn<(text: string) => Promise<void>>();

  afterEach(() => {
    document.getElementById(COPY_BUTTON_ID)?.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    writeText.mockReset();
  });

  /** Click the button and let its copy settle. */
  async function click(frame: HTMLElement): Promise<void> {
    frame.querySelector('button')!.click();
    await Promise.resolve();
    await Promise.resolve();
  }

  it('shows one button at the top centre that copies on a click and goes away', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: writeText.mockResolvedValue(undefined) } });
    showCopyButton('old');
    const frame = showCopyButton('{"report":1}');

    expect(document.querySelectorAll(`#${COPY_BUTTON_ID}`)).toHaveLength(1);
    expect(frame.style.position).toBe('fixed');
    expect(frame.querySelector('button')!.textContent).toBe('Ergebnis kopieren');

    await click(frame);

    expect(writeText).toHaveBeenCalledWith('{"report":1}');
    expect(document.getElementById(COPY_BUTTON_ID)).toBeNull();
  });

  it('puts the text in the console and says so where the clipboard refuses even then', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: writeText.mockRejectedValue(new Error('not allowed')) } });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const frame = showCopyButton('{"report":1}');

    await click(frame);

    expect(log).toHaveBeenCalledWith('{"report":1}');
    expect(frame.querySelector('button')!.textContent).toBe('Kopieren abgelehnt: Ergebnis steht in der Konsole');
    expect(document.getElementById(COPY_BUTTON_ID)).toBe(frame);
  });
});
