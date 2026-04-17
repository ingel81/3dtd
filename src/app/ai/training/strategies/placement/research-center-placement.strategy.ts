/**
 * Research Center Placement Strategy
 *
 * Priority: VERY HIGH (95) — higher than AntiAir/Splash so the bot bootstraps
 * research early. Without a Research Center the bot cannot unlock new towers.
 *
 * Triggers when:
 * - Research Center NOT yet placed (state.research.centerLevel === 0)
 * - Player has enough credits (>= 75)
 * - Wave >= 1 (grace period for first wave with Archer-only)
 */

import { BaseStrategy } from '../tower-strategy.interface';
import { GameStateSnapshot } from '../../../core/models/game-state-snapshot';
import { TowerAction } from '../../bots/tower-bot.interface';
import { TOWER_TYPES } from '../../../../configs/tower-types.config';
import { StrategicPlacementService } from '../../../../services/strategic-placement.service';
import { GameStateManager } from '../../../../managers/game-state.manager';

export class ResearchCenterPlacementStrategy extends BaseStrategy {
  constructor(
    private strategicPlacement: StrategicPlacementService,
    private gameState: GameStateManager,
  ) {
    super('ResearchCenterPlacement', 95);
  }

  canExecute(state: GameStateSnapshot): boolean {
    // Already placed?
    if (state.research && state.research.centerLevel > 0) return false;

    // Need enough credits: research center + at least one Archer
    // (so the bot doesn't drain everything into the research center and stall)
    const centerCost = TOWER_TYPES['research-center'].cost;
    const archerCost = TOWER_TYPES['archer']?.cost ?? 45;
    if (state.player.credits < centerCost + archerCost) return false;

    return true;
  }

  execute(state: GameStateSnapshot): TowerAction | null {
    // Reuse the standard strategic-placement logic — Research Center doesn't need
    // combat range, but the placement service already picks valid street-adjacent positions.
    const spawnPoints = this.gameState.getSpawnPoints();
    const paths = this.gameState.getCachedPaths();
    const candidates = this.strategicPlacement.findStrategicPositions(
      spawnPoints,
      paths,
      TOWER_TYPES['research-center'].range || 60,  // range 0 → default search radius
      this.gameState.towerManager.getAll(),
    );

    // First valid candidate
    for (const candidate of candidates) {
      const validation = this.gameState.towerManager.validatePosition(candidate.position);
      if (validation.valid) {
        return {
          type: 'place',
          position: { x: candidate.position.lon, z: candidate.position.lat },
          towerType: 'research-center',
          confidence: 0.95,
          reason: 'Bootstrapping research',
        };
      }
    }

    return null;
  }
}
