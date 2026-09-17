/**
 * Missile Silo Placement Strategy
 *
 * Priority: 91, above the combat placements (AntiAir 90 and below): the
 * nuclear strike fires only while a silo stands (AbilityConfig.launchFrom),
 * so the 1,000 credits of its research sit idle until one is built.
 *
 * Triggers when:
 * - the research `nuclear-strike` is done (the silo is unlocked)
 * - no silo stands (one per map)
 * - the credits pay for the silo plus an Archer, the Research Center's rule:
 *   the bot does not spend its last credits on a building
 *
 * Places it like the Research Center: the best candidate of
 * findStrategicPositions for the silo's type. A building without range is
 * scored in 60 m; every candidate stands beside the route, off the street,
 * and passes the placement rules.
 */

import { BaseStrategy } from '../tower-strategy.interface';
import { GameStateSnapshot } from '../../../core/models/game-state-snapshot';
import { TowerAction } from '../../bots/tower-bot.interface';
import { TOWER_TYPES, type TowerTypeId } from '../../../../configs/tower-types.config';
import { StrategicPlacementService } from '../../../../services/world/strategic-placement.service';
import { GameStateManager } from '../../../../managers/game-state.manager';

const SILO: TowerTypeId = 'missile-silo';

export class MissileSiloPlacementStrategy extends BaseStrategy {
  constructor(
    private readonly strategicPlacement: StrategicPlacementService,
    private readonly gameState: GameStateManager,
  ) {
    super('MissileSiloPlacement', 91);
  }

  canExecute(state: GameStateSnapshot): boolean {
    if (!state.research?.towerUnlocked[SILO]) return false;
    if ((state.defense.towerDistribution[SILO]?.count ?? 0) > 0) return false;
    return state.player.credits >= TOWER_TYPES[SILO].cost + TOWER_TYPES.archer.cost;
  }

  execute(_state: GameStateSnapshot): TowerAction | null {
    const spawnPoints = this.gameState.getSpawnPoints();
    const paths = this.gameState.getCachedPaths();
    const [best] = this.strategicPlacement.findStrategicPositions(spawnPoints, paths, SILO);
    if (!best) return null;

    return {
      type: 'place',
      position: { x: best.position.lon, z: best.position.lat },
      towerType: SILO,
      confidence: 0.9,
      reason: 'Launch site for the nuclear strike',
    };
  }
}
