/**
 * Favourite-Tower Upgrade Strategy (the beginner's)
 *
 * Priority: MEDIUM (70)
 * Triggers when: a tower stands, and one of them has an upgrade the player
 * can pay for out of hand.
 * Action: upgrade the tower that has done the most damage so far, along its
 * cheapest branch.
 *
 * The beginner had no upgrade at all. It filled its ten tower slots by wave
 * five and then did nothing for the rest of the run: measured over 112 runs,
 * zero decisions per wave from wave ten on, a pile of 150,000 credits, and a
 * defense frozen at the shape it had in wave five. It died at wave 25 every
 * time, in a band of 15 to 27, which says more about a bot that stopped
 * playing than about the balance (docs/BALANCING_PLAN.md, Baseline).
 *
 * What a beginner does is not nothing, it is something simple: pour money
 * into the tower that visibly works. No path analysis, no spreading of the
 * branches, no selling, no tier planning beyond what the engine allows. That
 * is the difference to the expert's PathCoverageUpgrade, which funds both
 * ends of the path deliberately.
 */

import { BaseStrategy } from '../tower-strategy.interface';
import { requiredUpgradeTier } from '../../../configs/tower-types.config';
import { GameStateSnapshot } from '../../../director/models/game-state-snapshot';
import { TowerAction } from '../../bots/tower-bot.interface';
import { GameStateManager } from '../../../managers/game-state.manager';

/**
 * Credits a beginner keeps beside the price before spending.
 *
 * Not a plan, a feeling: buying the thing that empties the purse to the last
 * coin is what a player learns not to do first.
 */
const CUSHION = 1.5;

export class FavouriteTowerUpgradeStrategy extends BaseStrategy {
  constructor(private gameState: GameStateManager) {
    super('FavouriteTowerUpgrade', 70);
  }

  /** The run's bot stream (GameRng): a bot's choices must not move the enemies. */
  private rnd(): number {
    return this.gameState.rng.stream('bot')();
  }

  canExecute(state: GameStateSnapshot): boolean {
    if (state.defense.towerCount < 1 || state.player.credits < 50) return false;
    // Hesitant by default, decisive once the money is lying around: a beginner
    // who never spends is the bug this strategy exists for.
    const rate = state.player.credits >= 2000 ? 0.8 : 0.4;
    return this.rnd() <= rate;
  }

  execute(state: GameStateSnapshot): TowerAction | null {
    const maxTier = state.research?.maxUpgradeTier ?? 1;
    const towers = [...this.gameState.towerManager.getAll()]
      .sort((a, b) => (b.combat?.damageDealt ?? 0) - (a.combat?.damageDealt ?? 0));

    for (const tower of towers) {
      const affordable = tower.getAvailableUpgrades().filter((u) => {
        if (tower.getNextUpgradeCost(u.id) * CUSHION > state.player.credits) return false;
        if (u.id === 'research-slots') return true;
        return maxTier >= requiredUpgradeTier(tower.getUpgradeLevel(u.id));
      });
      if (affordable.length === 0) continue;

      // The cheapest one: the beginner buys what it can see it can afford.
      affordable.sort((a, b) => tower.getNextUpgradeCost(a.id) - tower.getNextUpgradeCost(b.id));
      const upgrade = affordable[0];

      return {
        type: 'upgrade',
        towerId: tower.id,
        upgradeId: upgrade.id,
        confidence: 0.5,
        reason: `Beginner upgrades ${tower.typeConfig.name} with ${upgrade.name}`,
      };
    }

    return null;
  }
}
