/**
 * The arbiter (docs/BOT_PLAYER_PLAN.md, B3, decision P1)
 *
 * Every strategy proposes; one place decides. It replaces the priority list,
 * under which the first strategy that could act took the turn whatever the
 * others had to offer: an affordable upgrade always beat a new tower, a
 * savings goal was a coin flip. In this order:
 *
 * 1. Rules: what is right whenever it is possible, in the order the factory
 *    lists them: the abilities, the hero, the research center and the silo,
 *    selling, a research the next wave cannot wait for.
 * 2. Research, while the last wave held (no leak): a player who holds
 *    invests.
 * 3. Buys, by value per gold (value.ts). When the best of all costs more than
 *    the bot has and is clearly better per gold than what it can afford, the
 *    bot saves for it instead of spending the gold on less.
 * 4. Research after all, when there is nothing to buy.
 * 5. The next wave, in the build phase, once nothing above acts: the gold is
 *    spent or saved for something.
 */

import type { TowerAction } from '../bots/tower-bot.interface';

export type ProposalKind = 'rule' | 'research' | 'buy' | 'wave';

export interface Proposal {
  readonly kind: ProposalKind;
  /** Who proposes it, for the reason */
  readonly label: string;
  /** Gold it costs; 0 for what costs nothing or was checked already */
  readonly cost: number;
  /** Buys: kill time it saves against the coming waves (value.ts); the others leave it 0 */
  readonly value: number;
  /** The action, worked out only for the proposal the arbiter takes; null when it cannot be done after all */
  act(): TowerAction | null;
}

/** A dearer buy is saved for when it is this much better per gold than the best affordable one */
export const SAVE_MARGIN = 1.5;

/** ...and costs at most this many times the gold the bot has: no saving for the far future */
export const SAVE_REACH = 3;

export interface ArbiterInput {
  readonly proposals: readonly Proposal[];
  readonly credits: number;
  /** The last wave leaked nothing (or there was none yet) */
  readonly safe: boolean;
  /** Spread on a buy's value, drawn once per buy and decision (BotConfig.noise) */
  readonly jitter?: (value: number) => number;
}

/** The action the arbiter takes; a wait with the reason when it saves or nothing applies */
export function arbitrate({ proposals, credits, safe, jitter }: ArbiterInput): TowerAction {
  const of = (kind: ProposalKind) => proposals.filter((p) => p.kind === kind);
  const first = (list: readonly Proposal[]): TowerAction | null => {
    for (const proposal of list) {
      const action = proposal.act();
      if (action && action.type !== 'wait') return action;
    }
    return null;
  };

  const rule = first(of('rule'));
  if (rule) return rule;

  const research = of('research').filter((p) => p.cost <= credits);
  if (safe) {
    const invested = first(research);
    if (invested) return invested;
  }

  const buys = of('buy').filter((p) => p.value > 0 && p.cost > 0);
  const seen = new Map(buys.map((p) => [p, jitter ? jitter(p.value) : p.value]));
  const ratio = (p: Proposal) => seen.get(p)! / p.cost;
  const byRatio = [...buys].sort((a, b) => ratio(b) - ratio(a));
  const affordable = byRatio.filter((p) => p.cost <= credits);
  const best = byRatio[0];
  const saving = best !== undefined && best.cost > credits && best.cost <= credits * SAVE_REACH
    && (affordable.length === 0 || ratio(best) >= SAVE_MARGIN * ratio(affordable[0]));

  if (!saving) {
    for (const buy of affordable) {
      const action = buy.act();
      if (action && action.type !== 'wait') {
        // The reason names its value per gold, for the bot window and the logs
        return { ...action, reason: `${action.reason ?? buy.label} (value/gold ${ratio(buy).toPrecision(3)})` };
      }
    }
    if (!safe && buys.length === 0) {
      const invested = first(research);
      if (invested) return invested;
    }
  }

  const wave = first(of('wave'));
  if (wave) return wave;

  return saving
    ? { type: 'wait', reason: `Saving for ${best.label} (${Math.floor(credits)}/${best.cost})` }
    : { type: 'wait', reason: 'Nothing worth doing' };
}

