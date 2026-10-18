import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserBack } from './browser-back.service';

/**
 * The browser's Back in the one window: the view shown last takes the step,
 * the page's entry comes back after each step; with no step left Back leaves.
 */
describe('BrowserBack', () => {
  afterEach(() => vi.restoreAllMocks());

  const back = () => window.dispatchEvent(new PopStateEvent('popstate'));

  it('asks the view shown last first, keeps one entry on top, and leaves when no view has a step', () => {
    const push = vi.spyOn(window.history, 'pushState');
    const leave = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    const backs = new BrowserBack();
    const game = vi.fn(() => true);
    let menuOpen = true;
    const stage = vi.fn(() => {
      const had = menuOpen;
      menuOpen = false;
      return had;
    });
    const offGame = backs.register(game);
    const offStage = backs.register(stage);
    // One entry on top of the page's own, however many views
    expect(push).toHaveBeenCalledTimes(1);

    back();
    expect(stage).toHaveBeenCalledTimes(1);
    expect(game).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledTimes(2);

    // The stage has nothing left: the view under it takes the step
    back();
    expect(game).toHaveBeenCalledTimes(1);
    expect(leave).not.toHaveBeenCalled();

    offGame();
    back();
    expect(leave).toHaveBeenCalledTimes(1);
    offStage();
  });
});
