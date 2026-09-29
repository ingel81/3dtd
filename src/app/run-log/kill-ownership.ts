import type { KilledBy } from '../game-engine/events/event-types';
import type { SimMirror } from '../sim/client/mirror/sim-mirror';

/**
 * Whose kill it is in this player's run log: whose the gold is
 * (SimMirror.killCreditPlayer, the simulation's rule), so a tower sold before its shot
 * landed counts once, for the first player, and not in both logs (TODO E44).
 * A kill of no one (the dev tools, the others) counts in every log.
 */
export function killOwnership(
  gameState: Pick<SimMirror, 'killCreditPlayer' | 'localPlayerId'>,
): (killedBy: KilledBy | null) => boolean {
  return (killedBy) => {
    switch (killedBy?.kind) {
      case 'tower':
      case 'hero':
      case 'ability':
        return gameState.killCreditPlayer(killedBy) === gameState.localPlayerId;
      default:
        return true;
    }
  };
}
