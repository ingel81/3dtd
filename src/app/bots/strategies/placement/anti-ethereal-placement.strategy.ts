/**
 * Anti-Ethereal Placement Strategy
 *
 * Priority: HIGH (88) — just under anti-air.
 * Triggers when: fewer than a quarter of the towers can hurt ethereal enemies
 * (at least one once the bootstrap stands), and one is affordable.
 *
 * Why this exists: ethereal is the one armor class that cannot be brute-forced.
 * Physical, pierce and fire all sit at 0.1x against it, so a defense of
 * archers and gatlings is effectively unarmed against ghosts and wraiths no
 * matter how much raw DPS it stacks. Only magic (1.75x), ice (1.5x) and
 * lightning (1.5x) get through.
 *
 * A player builds these as part of the mix, not only after a ghost wave has
 * hurt them, so the bot keeps a share of them from the start. With a single
 * one built late, the ghost rows measured a bot that stands unarmed rather
 * than the wave.
 */

import { BaseStrategy } from '../tower-strategy.interface';
import { GameStateSnapshot } from '../../../director/models/game-state-snapshot';
import { TowerAction, BotConfig } from '../../bots/tower-bot.interface';
import { isAntiEtherealTower } from '../../../director/defense-analyzer';
import { StrategicPlacementService } from '../../../services/world/strategic-placement.service';
import type { BotWorld } from '../../bot-world';
import type { TowerTypeId } from '../../../configs/tower-types.config';

/** Share of the towers that answers ethereal armor */
const ETHEREAL_SHARE = 0.25;

/** The first towers are the cheapest bootstrap, the share starts after them */
const BOOTSTRAP_TOWERS = 2;

/** How many anti-ethereal towers a defense of `towerCount` towers wants */
export function antiEtherealWanted(towerCount: number): number {
  if (towerCount < BOOTSTRAP_TOWERS) return 0;
  return Math.max(1, Math.round(towerCount * ETHEREAL_SHARE));
}

export class AntiEtherealPlacementStrategy extends BaseStrategy {
  constructor(
    private strategicPlacement: StrategicPlacementService,
    private gameState: BotWorld,
    private config: BotConfig
  ) {
    super('AntiEtherealPlacement', 88);
  }

  canExecute(state: GameStateSnapshot): boolean {
    if (this.config.maxTowers > 0 && state.defense.towerCount >= this.config.maxTowers) return false;
    if (this.builtCounts().total >= antiEtherealWanted(state.defense.towerCount)) return false;

    return this.affordableAntiEthereal(state).length > 0;
  }

  execute(state: GameStateSnapshot): TowerAction | null {
    const candidatesByType = this.affordableAntiEthereal(state);
    if (candidatesByType.length === 0) return null;

    // Spread over the types: the least built first, among those the best
    // effective DPS per credit against ethereal. Raw DPS would pick the wrong
    // tower here, which is the whole point of the class.
    const { byType } = this.builtCounts();
    const count = (t: TowerTypeId) => byType.get(t) ?? 0;
    const bestTower = candidatesByType.reduce((best, current) => {
      if (count(current) !== count(best)) return count(current) < count(best) ? current : best;
      return this.getTowerValueVsArmor(current, 'ethereal') > this.getTowerValueVsArmor(best, 'ethereal')
        ? current
        : best;
    });

    const spawnPoints = this.gameState.getSpawnPoints();
    const paths = this.gameState.getCachedPaths();
    const [best] = this.strategicPlacement.findStrategicPositions(spawnPoints, paths, bestTower);
    if (!best) return null;

    return {
      type: 'place',
      position: { x: best.position.lon, z: best.position.lat },
      towerType: bestTower,
      confidence: 0.93,
      reason: `Share against ethereal armor - ${best.reason}`,
    };
  }

  /** Anti-ethereal towers standing, in total and per type */
  private builtCounts(): { total: number; byType: Map<TowerTypeId, number> } {
    const byType = new Map<TowerTypeId, number>();
    let total = 0;
    for (const tower of this.gameState.towerManager.getAll()) {
      const id = tower.typeConfig.id;
      if (!isAntiEtherealTower(id)) continue;
      byType.set(id, (byType.get(id) ?? 0) + 1);
      total++;
    }
    return { total, byType };
  }

  private affordableAntiEthereal(state: GameStateSnapshot) {
    return this.getAffordableTowers(
      state.player.credits,
      this.config.knownTowerTypes,
      state
    ).filter((t) => isAntiEtherealTower(t));
  }
}
