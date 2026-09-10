/**
 * Splash Defense Placement Strategy
 *
 * Priority: HIGH (85)
 * Triggers when: Splash defense gap exists and can afford splash tower
 * Action: Place the splash tower that suits the expected armor mix at a strategic position
 */

import { BaseStrategy } from '../tower-strategy.interface';
import { GameStateSnapshot } from '../../../core/models/game-state-snapshot';
import { TowerAction, BotConfig } from '../../bots/tower-bot.interface';
import { TOWER_TYPES, TowerTypeId } from '../../../../configs/tower-types.config';
import { ARMOR_TYPES } from '../../../../configs/combat/combat.types';
import { StrategicPlacementService } from '../../../../services/world/strategic-placement.service';
import { GameStateManager } from '../../../../managers/game-state.manager';
import { isSplashTower } from '../../../core/defense-analyzer';

export class SplashDefensePlacementStrategy extends BaseStrategy {
  constructor(
    private strategicPlacement: StrategicPlacementService,
    private gameState: GameStateManager,
    private config: BotConfig
  ) {
    super('SplashDefensePlacement', 85);
  }

  canExecute(state: GameStateSnapshot): boolean {
    if (this.config.maxTowers > 0 && state.defense.towerCount >= this.config.maxTowers) return false;
    if (!state.vulnerabilities.splashGap) return false;
    if (state.waveNumber < 3) return false;

    const affordable = this.getAffordableTowers(state.player.credits, this.config.knownTowerTypes, state);
    return affordable.some((t) => isSplashTower(t));
  }

  execute(state: GameStateSnapshot): TowerAction | null {
    // 1. Find best splash tower
    // Read splash from the capability table rather than a hardcoded
    // cannon/rocket pair — Fire and Lightning are area towers too and were
    // silently excluded from this decision.
    const affordable = this.getAffordableTowers(state.player.credits, this.config.knownTowerTypes, state);
    const splashTowers = affordable.filter((t) => isSplashTower(t));

    if (splashTowers.length === 0) return null;

    // Pick the best splash tower against the armor that is coming. Raw DPS per
    // gold would build a cannon against a rat swarm, where siege lands at 0.5.
    const dist = state.expectedArmorDistribution;
    const value = (t: TowerTypeId): number => dist
      ? ARMOR_TYPES.reduce((sum, armor) => sum + this.getTowerValueVsArmor(t, armor) * (dist[armor] ?? 0), 0)
      : this.getTowerValue(t);
    const bestTower = splashTowers.reduce((best, current) => {
      return value(current) > value(best) ? current : best;
    });

    // 2. Get strategic placement candidates
    const spawnPoints = this.gameState.getSpawnPoints();
    const paths = this.gameState.getCachedPaths();
    const candidates = this.strategicPlacement.findStrategicPositions(
      spawnPoints,
      paths,
      TOWER_TYPES[bestTower].range,
      this.gameState.towerManager.getAll()
    );

    // 3. Find first valid position
    for (const candidate of candidates) {
      const validation = this.gameState.towerManager.validatePosition(candidate.position);
      if (validation.valid) {
        return {
          type: 'place',
          position: { x: candidate.position.lon, z: candidate.position.lat },
          towerType: bestTower,
          confidence: 0.9,
          reason: `Splash defense gap - ${candidate.reason}`
        };
      }
    }

    return null;
  }
}
