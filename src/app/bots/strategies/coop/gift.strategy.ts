/**
 * Gift Strategy (docs/BOT_PLAYER_PLAN.md, B6, decision P5)
 *
 * A rule (decision/arbiter.ts), coop only: what a partner does in the gold
 * window. In the build phase, once a wave, when a partner leaked more than
 * the bot in the last wave and has less than half its gold, the bot sends a
 * share of its own (GIFT_SHARE), if it holds at least GIFT_MIN. The leaks on
 * the partners' lanes come from the bot's perception (B1).
 */

import type { GameStateSnapshot } from '../../../director/models/game-state-snapshot';
import type { BotWorld } from '../../bot-world';
import type { TowerAction } from '../../bots/tower-bot.interface';
import { BaseStrategy } from '../tower-strategy.interface';

/** Gold the bot keeps below which it sends nothing */
export const GIFT_MIN = 300;

/** Share of its gold the bot sends */
export const GIFT_SHARE = 0.3;

export class GiftStrategy extends BaseStrategy {
  /** The wave whose build phase saw the last gift */
  private giftedForWave = -1;

  constructor(private readonly world: BotWorld) {
    super('Gift');
  }

  canExecute(state: GameStateSnapshot): boolean {
    return this.recipient(state) !== null;
  }

  execute(state: GameStateSnapshot): TowerAction | null {
    const to = this.recipient(state);
    if (!to) return null;
    this.giftedForWave = state.waveNumber;
    const amount = Math.floor(state.player.credits * GIFT_SHARE);
    return { type: 'give-credits', to: to.id, amount, reason: `${to.id} leaked ${to.leaks} and runs short` };
  }

  onReset(): void {
    this.giftedForWave = -1;
  }

  /** The partner who leaked most, more than the bot, with under half its gold */
  private recipient(state: GameStateSnapshot): { id: string; leaks: number } | null {
    if (state.phase !== 'setup' || this.giftedForWave === state.waveNumber) return null;
    const credits = state.player.credits;
    if (credits < GIFT_MIN) return null;
    const last = this.world.perception.lastWave;
    if (!last) return null;
    let best: { id: string; leaks: number } | null = null;
    for (const partner of this.world.partners()) {
      const leaks = partner.lanes.reduce((sum, lane) => sum + (last.leaksElsewhere.get(lane) ?? 0), 0);
      if (leaks <= last.leaks || partner.credits >= credits / 2) continue;
      if (!best || leaks > best.leaks) best = { id: partner.id, leaks };
    }
    return best;
  }
}
