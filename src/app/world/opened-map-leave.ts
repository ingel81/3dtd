import type { GameStore } from '../store/game.store';
import type { UIStore } from '../store/ui.store';

/**
 * Whether a map double-clicked in the desktop app may take this window
 * (WorldChoiceService.playOpenedMaps): a coop room's map is the host's to
 * pick, a run under way asks first, a game not begun or over goes. The map
 * stays in the map folder either way.
 */
export function mayLeaveForOpenedMap(
  game: Pick<GameStore, 'phase' | 'waveNumber' | 'isGameOver'>,
  ui: Pick<UIStore, 'coopMapLocked' | 'notice'>,
  confirm: (question: string) => boolean,
): (mapName: string) => boolean {
  return (name) => {
    if (ui.coopMapLocked()) {
      ui.notice.set({ text: `In a coop room the host picks the map: ${name} is in your map folder.`, tone: 'warn' });
      return false;
    }
    return (game.phase() === 'setup' && game.waveNumber() === 0) || game.isGameOver() || confirm(`Leave this game and play ${name}?`);
  };
}
