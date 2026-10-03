/**
 * Tower Strategy Interface
 *
 * Each strategy is one concern of the bot (building, upgrading, research,
 * an ability, the hero, the wave start) and proposes what it would do; the
 * arbiter decides (decision/arbiter.ts, docs/BOT_PLAYER_PLAN.md, B3).
 */

import { GameStateSnapshot } from '../../director/models/game-state-snapshot';
import { TowerAction } from '../bots/tower-bot.interface';
import type { Proposal, ProposalKind } from '../decision/arbiter';
import type { ArmorSides } from '../decision/value';

/** What every strategy reads besides the snapshot, worked out once per decision (StrategyBot) */
export interface DecisionContext {
  /** HP of the coming waves per armor and side (value.ts) */
  readonly threat: ArmorSides;
  /** The own defense's damage times metres under fire, per armor and side */
  readonly capacity: ArmorSides;
  /** Metres under fire per own tower, ground and air (metersUnderFire over the own routes) */
  readonly metresByTower: ReadonlyMap<string, { ground: number; air: number }>;
  /** Own routes, which metresByTower averages over */
  readonly routes: number;
  /** Mean length of the own routes, m */
  readonly routeMetres: number;
}

export interface ITowerStrategy {
  /** Strategy name (for debugging) */
  readonly name: string;

  /** What it would do now; empty when nothing */
  propose(state: GameStateSnapshot, context: DecisionContext): Proposal[];

  /**
   * Optional: called once per frame with game-time delta. Override for
   * strategies with internal cooldowns (e.g. sell-cooldown, wave-start-delay).
   */
  tickCooldowns?(deltaTime: number): void;

  /** Optional: called after the bot executes a non-wait action from any strategy. */
  onActionExecuted?(action: TowerAction): void;

  /** Optional: called when the bot resets for a new game. */
  onReset?(): void;
}

/**
 * A strategy of one rule: when it can, it proposes its action as a whole, of
 * its kind (a rule by default, taken before any buy; the wave start).
 */
export abstract class BaseStrategy implements ITowerStrategy {
  constructor(
    public readonly name: string,
    private readonly proposalKind: ProposalKind = 'rule',
  ) {}

  abstract canExecute(state: GameStateSnapshot): boolean;
  abstract execute(state: GameStateSnapshot): TowerAction | null;

  propose(state: GameStateSnapshot, _context: DecisionContext): Proposal[] {
    if (!this.canExecute(state)) return [];
    return [{ kind: this.kindNow(state), label: this.name, cost: 0, value: 0, act: () => this.execute(state) }];
  }

  /** The kind of its proposal now; a strategy whose urgency changes overrides it */
  protected kindNow(_state: GameStateSnapshot): ProposalKind {
    return this.proposalKind;
  }

  /**
   * Called once per frame by StrategyBot with game-time delta.
   * Strategies with internal cooldowns override this to decrement them.
   * Default: no-op so most strategies don't need to care.
   */
  tickCooldowns(_deltaTime: number): void {
    /* no-op by default */
  }
}
