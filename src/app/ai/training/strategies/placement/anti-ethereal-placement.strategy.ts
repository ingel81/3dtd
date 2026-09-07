/**
 * Anti-Ethereal Placement Strategy
 *
 * Priority: HIGH (88) — just under anti-air.
 * Triggers when: the defense has no tower that meaningfully damages ethereal
 * enemies, and one is affordable.
 *
 * Why this exists: ethereal is the one armor class that cannot be brute-forced.
 * Physical, pierce and fire all sit at 0.15x against it, so a defense of
 * archers and gatlings is effectively unarmed against ghosts and wraiths no
 * matter how much raw DPS it stacks. Only magic (1.75x), ice (1.5x) and
 * lightning (1.5x) get through.
 *
 * The curriculum pins `ghost_surge` to wave 13 and `wraith_storm` to wave 17,
 * and a forced template ignores the capability gate — so a bot without this
 * strategy simply loses there. Before it existed, ethereal counters were only
 * ever built by the random "try a new type" branch of the coverage strategies.
 */

import { BaseStrategy } from '../tower-strategy.interface';
import { GameStateSnapshot } from '../../../core/models/game-state-snapshot';
import { TowerAction, BotConfig } from '../../bots/tower-bot.interface';
import { TOWER_TYPES } from '../../../../configs/tower-types.config';
import { isAntiEtherealTower } from '../../../core/defense-analyzer';
import { StrategicPlacementService } from '../../../../services/world/strategic-placement.service';
import { GameStateManager } from '../../../../managers/game-state.manager';

/**
 * Start covering ethereal a few waves before the curriculum's first ethereal
 * wave (13), so the research and the build have time to land.
 */
const MIN_WAVE = 9;

export class AntiEtherealPlacementStrategy extends BaseStrategy {
  constructor(
    private strategicPlacement: StrategicPlacementService,
    private gameState: GameStateManager,
    private config: BotConfig
  ) {
    super('AntiEtherealPlacement', 88);
  }

  canExecute(state: GameStateSnapshot): boolean {
    if (this.config.maxTowers > 0 && state.defense.towerCount >= this.config.maxTowers) return false;
    if (!state.vulnerabilities.etherealGap) return false;
    if (state.waveNumber < MIN_WAVE) return false;

    return this.affordableAntiEthereal(state).length > 0;
  }

  execute(state: GameStateSnapshot): TowerAction | null {
    const candidatesByType = this.affordableAntiEthereal(state);
    if (candidatesByType.length === 0) return null;

    // Rank by effective DPS per credit against ethereal specifically — raw DPS
    // would pick the wrong tower here, which is the whole point of the class.
    const bestTower = candidatesByType.reduce((best, current) =>
      this.getTowerValueVsArmor(current, 'ethereal') > this.getTowerValueVsArmor(best, 'ethereal')
        ? current
        : best
    );

    const spawnPoints = this.gameState.getSpawnPoints();
    const paths = this.gameState.getCachedPaths();
    const positions = this.strategicPlacement.findStrategicPositions(
      spawnPoints,
      paths,
      TOWER_TYPES[bestTower].range,
      this.gameState.towerManager.getAll()
    );

    for (const candidate of positions) {
      const validation = this.gameState.towerManager.validatePosition(candidate.position);
      if (validation.valid) {
        return {
          type: 'place',
          position: { x: candidate.position.lon, z: candidate.position.lat },
          towerType: bestTower,
          confidence: 0.93,
          reason: `No answer to ethereal armor - ${candidate.reason}`,
        };
      }
    }

    return null;
  }

  private affordableAntiEthereal(state: GameStateSnapshot) {
    return this.getAffordableTowers(
      state.player.credits,
      this.config.knownTowerTypes,
      state
    ).filter((t) => isAntiEtherealTower(t));
  }
}
