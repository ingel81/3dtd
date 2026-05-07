/**
 * Sell-Underperformer Strategy
 *
 * Priority: 72 (between NearSpawnUpgrade at 75 and DistributedPlacement at 65)
 *
 * Purpose: Dispose of early-game placeholder towers (un-upgraded Lvl 1 Archers)
 * when the bot has accumulated enough gold to replace them with something
 * actually useful. Prevents 300k+ gold hoards that were common without any
 * sell mechanism.
 *
 * Triggers when:
 *  - credits > richThreshold (default 2000)
 *  - at least one Archer exists with NO upgrades spent on it
 *  - tower count is at least 5 (don't sell early bootstrap towers)
 *  - a more expensive affordable alternative exists (meaningful reinvestment)
 *
 * Action: sell the cheapest unupgraded Archer — next build tick will replace it.
 */

import { BaseStrategy } from '../tower-strategy.interface';
import { GameStateSnapshot } from '../../../core/models/game-state-snapshot';
import { TowerAction, BotConfig } from '../../bots/tower-bot.interface';
import { TOWER_TYPES, TowerTypeId } from '../../../../configs/tower-types.config';
import { GameStateManager } from '../../../../managers/game-state.manager';
import { Tower } from '../../../../entities/tower.entity';

export class SellUnderperformerStrategy extends BaseStrategy {
  private readonly richThreshold = 2000;
  private readonly minTowerCount = 5;
  /** Phase 5.12: game-time accumulator (ticks via tickCooldowns). */
  private sellCooldownRemainingMs = 0;
  private readonly sellCooldownMs = 4000; // not too spammy

  constructor(
    private gameState: GameStateManager,
    private config: BotConfig,
  ) {
    super('SellUnderperformer', 72);
  }

  override tickCooldowns(deltaTime: number): void {
    if (this.sellCooldownRemainingMs > 0) {
      this.sellCooldownRemainingMs = Math.max(0, this.sellCooldownRemainingMs - deltaTime);
    }
  }

  canExecute(state: GameStateSnapshot): boolean {
    if (state.player.credits < this.richThreshold) return false;
    if (state.defense.towerCount < this.minTowerCount) return false;
    if (this.sellCooldownRemainingMs > 0) return false;

    // Needs at least one unupgraded Archer
    const archers = this.findUnupgradedArchers();
    if (archers.length === 0) return false;

    // And a better affordable alternative (worth the swap)
    const betterAffordable = this.config.knownTowerTypes.some(id => {
      const cfg = TOWER_TYPES[id];
      if (!cfg) return false;
      if (id === 'archer') return false;
      if (cfg.cost > state.player.credits) return false;
      if (state.research && !state.research.towerUnlocked[id]) return false;
      return true;
    });
    return betterAffordable;
  }

  execute(_state: GameStateSnapshot): TowerAction | null {
    const archers = this.findUnupgradedArchers();
    if (archers.length === 0) return null;

    // Sell the one closest to the path endpoint (least defensive value at
    // this point since early-game towers are near the spawn, where higher-tier
    // replacements will get placed anyway by NearSpawnUpgrade / DistributedPlacement).
    // Simpler: just sell the first. Strategies aren't stateful long-term here.
    const target = archers[0];
    this.sellCooldownRemainingMs = this.sellCooldownMs;

    return {
      type: 'sell',
      towerId: target.id,
      confidence: 0.75,
      reason: `Selling unupgraded Archer to reinvest (credits=${Math.round(_state.player.credits)})`,
    };
  }

  onReset(): void {
    this.sellCooldownRemainingMs = 0;
  }

  /** Archers whose upgrade-tree is fully at level 0 (no upgrades spent). */
  private findUnupgradedArchers(): Tower[] {
    const all = this.gameState.towerManager.getAll();
    return all.filter(t => {
      if (t.typeConfig.id !== 'archer') return false;
      const upgrades = t.typeConfig.upgrades ?? [];
      return upgrades.every(u => t.getUpgradeLevel(u.id) === 0);
    });
  }
}
