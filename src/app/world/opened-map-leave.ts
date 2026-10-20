import type { GameStore } from '../store/game.store';
import type { UIStore } from '../store/ui.store';
import type { Messages } from '../i18n/messages/en';

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
  t: () => Messages,
): (mapName: string) => boolean {
  return (name) => {
    if (ui.coopMapLocked()) {
      ui.notice.set({ text: t().places.openedInCoop(name), tone: 'warn' });
      return false;
    }
    return (game.phase() === 'setup' && game.waveNumber() === 0) || game.isGameOver() || confirm(t().places.leaveForMap(name));
  };
}
