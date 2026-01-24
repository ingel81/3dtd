/**
 * Splash Defense Placement Strategy
 *
 * Priority: HIGH (85)
 * Triggers when: Splash defense gap exists and can afford splash tower
 * Action: Place splash damage tower (cannon or rocket) at strategic position
 */

import { BaseStrategy } from '../tower-strategy.interface';
import { GameStateSnapshot } from '../../../core/models/game-state-snapshot';
import { TowerAction, BotConfig } from '../../bots/tower-bot.interface';
import { TOWER_TYPES } from '../../../../configs/tower-types.config';
import { StrategicPlacementService } from '../../../../services/strategic-placement.service';
import { GameStateManager } from '../../../../managers/game-state.manager';

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

    const affordable = this.getAffordableTowers(state.player.credits, this.config.knownTowerTypes);
    const hasSplash = affordable.some(t => t === 'cannon' || t === 'rocket');

    return hasSplash;
  }

  execute(state: GameStateSnapshot): TowerAction | null {
    // 1. Find best splash tower
    const affordable = this.getAffordableTowers(state.player.credits, this.config.knownTowerTypes);
    const splashTowers = affordable.filter(t => t === 'cannon' || t === 'rocket');

    if (splashTowers.length === 0) return null;

    // Pick best value splash tower
    const bestTower = splashTowers.reduce((best, current) => {
      return this.getTowerValue(current) > this.getTowerValue(best) ? current : best;
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
