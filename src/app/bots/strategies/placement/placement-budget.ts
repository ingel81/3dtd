import { GameStateSnapshot } from '../../../director/models/game-state-snapshot';
import { TowerTypeId } from '../../../configs/tower-types.config';

/**
 * Shared canExecute gate for placement strategies that save up toward one
 * tower type at a time (CoverageFill, DistributedPlacement): active while
 * under the tower cap, and either already committed to a savings goal or
 * holding at least the minimum credits to start one.
 */
export function canExecutePlacement(
  state: GameStateSnapshot,
  maxTowers: number,
  savingForType: TowerTypeId | null
): boolean {
  const notMaxed = maxTowers <= 0 || state.defense.towerCount < maxTowers;
  if (!notMaxed) return false;

  // If saving for a type, stay active even if we can't afford anything yet
  if (savingForType) return true;

  return state.player.credits >= 20;
}
