import { describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import type { UiNotice } from '../store/ui.store';
import { mayLeaveForOpenedMap } from './opened-map-leave';

/** A map double-clicked in the desktop app, in a window that plays something (E195 phase 3) */
describe('mayLeaveForOpenedMap', () => {
  function window(phase: string, wave: number, over = false, locked = false) {
    const game = { phase: signal(phase), waveNumber: signal(wave), isGameOver: signal(over) };
    const ui = { coopMapLocked: signal(locked), notice: signal<UiNotice | null>(null) };
    const confirm = vi.fn(() => false);
    const may = mayLeaveForOpenedMap(game as never, ui as never, confirm);
    return { may, ui, confirm };
  }

  it('goes without a question before the first wave and after game over', () => {
    expect(window('setup', 0).may('Bay')).toBe(true);
    expect(window('wave', 4, true).may('Bay')).toBe(true);
  });

  it('asks in a run under way', () => {
    const { may, confirm } = window('wave', 4);
    expect(may('Bay')).toBe(false);
    expect(confirm).toHaveBeenCalledWith('Leave this game and play Bay?');
  });

  it('stays in a coop room whose map the host picks, and says where the map went', () => {
    const { may, ui, confirm } = window('setup', 0, false, true);
    expect(may('Bay')).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
    expect(ui.notice()?.text).toBe('In a coop room the host picks the map: Bay is in your map folder.');
  });
});
