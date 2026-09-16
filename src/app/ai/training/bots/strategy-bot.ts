/**
 * Strategy-Based Tower Bot
 *
 * Uses composition of ITowerStrategy plugins for decision-making.
 * Easily extensible: add new strategies without modifying this class.
 */

import { BaseTowerBot } from './base-tower-bot';
import { ITowerStrategy } from '../strategies/tower-strategy.interface';
import { GameStateSnapshot } from '../../core/models/game-state-snapshot';
import { TowerAction, BotSkillLevel, BotConfig } from './tower-bot.interface';

export class StrategyBot extends BaseTowerBot {
  private strategies: ITowerStrategy[] = [];

  constructor(
    skillLevel: BotSkillLevel,
    strategies: ITowerStrategy[],
    configOverrides?: Partial<BotConfig>,
    name?: string
  ) {
    super(
      skillLevel,
      configOverrides,
      name || `Strategy${skillLevel.charAt(0).toUpperCase()}${skillLevel.slice(1)}Bot`,
    );

    // Sort strategies by priority (highest first)
    this.strategies = strategies.sort((a, b) => b.priority - a.priority);

  }

  /**
   * Frame update hook — ticks per-strategy game-time cooldowns BEFORE the
   * BaseTowerBot runs its own reaction-time cooldown. We tick every frame
   * so strategy cooldowns (e.g. sell, auto-start-wave) advance even while
   * the bot itself is in reaction cooldown. Without this, strategy cooldowns
   * would be starved at high timescales exactly like the bot was pre-5.12.
   */
  override tickCooldown(deltaTime: number): boolean {
    for (const strategy of this.strategies) {
      strategy.tickCooldowns?.(deltaTime);
    }
    return super.tickCooldown(deltaTime);
  }

  override update(state: GameStateSnapshot, deltaTime: number): TowerAction | null {
    // deltaTime is 0 when the caller already ticked via tickCooldown().
    if (deltaTime > 0) {
      for (const strategy of this.strategies) {
        strategy.tickCooldowns?.(deltaTime);
      }
    }
    return super.update(state, deltaTime);
  }

  /**
   * Decision-making: Execute first applicable strategy
   */
  protected decideAction(state: GameStateSnapshot): TowerAction | null {
    let pendingWait: TowerAction | null = null;

    // Iterate through strategies in priority order
    for (const strategy of this.strategies) {
      if (!strategy.canExecute(state)) {
        continue;
      }

      const action = strategy.execute(state);

      if (action) {
        if (action.type === 'wait') {
          // Store first wait as fallback, but don't block lower-priority strategies
          if (!pendingWait) pendingWait = action;
          continue;
        }

        this.notifyActionExecuted(action);
        return action;
      }
    }

    // Return best wait action if no concrete action was found
    // Don't notify strategies (wait shouldn't reset AutoStartWave's timer)
    if (pendingWait) {
      return pendingWait;
    }

    return { type: 'wait', reason: 'No applicable strategy' };
  }

  override reset(): void {
    super.reset();
    for (const strategy of this.strategies) {
      strategy.onReset?.();
    }
  }

  /**
   * Notify all strategies that an action was executed (optional hook)
   */
  private notifyActionExecuted(action: TowerAction): void {
    for (const strategy of this.strategies) {
      strategy.onActionExecuted?.(action);
    }
  }

}
