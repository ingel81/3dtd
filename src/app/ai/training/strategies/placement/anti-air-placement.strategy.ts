/**
 * Anti-Air Placement Strategy
 *
 * Priority: HIGH (90)
 * Triggers when: an air-defense gap exists and an air-capable tower is affordable.
 * Action: place the most cost-effective air-capable tower at a strategic spot.
 */

import { BaseStrategy } from '../tower-strategy.interface';
import { GameStateSnapshot } from '../../../core/models/game-state-snapshot';
import { TowerAction, BotConfig } from '../../bots/tower-bot.interface';
import { TOWER_TYPES } from '../../../../configs/tower-types.config';
import { StrategicPlacementService } from '../../../../services/world/strategic-placement.service';
import { GameStateManager } from '../../../../managers/game-state.manager';

export class AntiAirPlacementStrategy extends BaseStrategy {
  constructor(
    private strategicPlacement: StrategicPlacementService,
    private gameState: GameStateManager,
    private config: BotConfig
  ) {
    super('AntiAirPlacement', 90);
  }

  canExecute(state: GameStateSnapshot): boolean {
    if (this.config.maxTowers > 0 && state.defense.towerCount >= this.config.maxTowers) return false;
    if (!state.vulnerabilities.airDefenseGap) return false;
    if (state.waveNumber < 4) return false;

    const affordable = this.getAffordableTowers(state.player.credits, this.config.knownTowerTypes, state);
    const hasAntiAir = affordable.some(t => TOWER_TYPES[t].canTargetAir);

    return hasAntiAir;
  }

  execute(state: GameStateSnapshot): TowerAction | null {
    // 1. Find best anti-air tower
    const affordable = this.getAffordableTowers(state.player.credits, this.config.knownTowerTypes, state);
    const antiAirTowers = affordable.filter(t => TOWER_TYPES[t].canTargetAir);

    if (antiAirTowers.length === 0) return null;

    // Rank by effective DPS per credit against LIGHT armor — bat, hornet and
    // dragon between them cover light and heavy, and light is what the first
    // air waves send. Ranking on raw DPS-per-cost made this strategy pick the
    // Archer every single time, which technically closes the gap but leaves
    // the defense with no real answer to a dragon.
    const bestTower = antiAirTowers.reduce((best, current) =>
      this.getTowerValueVsArmor(current, 'light') > this.getTowerValueVsArmor(best, 'light')
        ? current
        : best
    );

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
          confidence: 0.95,
          reason: `Critical air defense gap - ${candidate.reason}`
        };
      }
    }

    return null;
  }
}
