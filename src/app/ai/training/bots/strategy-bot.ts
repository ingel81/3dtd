/**
 * Strategy-Based Tower Bot
 *
 * Uses composition of ITowerStrategy plugins for decision-making.
 * Easily extensible: add new strategies without modifying this class.
 */

import { BaseTowerBot } from './base-tower-bot';
import { ITowerStrategy } from '../strategies/tower-strategy.interface';
import { GameStateSnapshot } from '../../core/models/game-state-snapshot';
import { TowerAction, BotSkillLevel } from './tower-bot.interface';
import { TowerTypeId } from '../../../configs/tower-types.config';

export class StrategyBot extends BaseTowerBot {
  private strategies: ITowerStrategy[] = [];

  constructor(
    skillLevel: BotSkillLevel,
    strategies: ITowerStrategy[],
    name?: string
  ) {
    super(skillLevel, name || `Strategy${skillLevel.charAt(0).toUpperCase()}${skillLevel.slice(1)}Bot`);

    // Sort strategies by priority (highest first)
    this.strategies = strategies.sort((a, b) => b.priority - a.priority);

    console.log(`[Bot] Initialized with ${strategies.length} strategies:`,
      strategies.map(s => `${s.name}(${s.priority})`).join(', ')
    );
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

        this.notifyStrategies('onActionExecuted', action);
        console.log(`[Bot] ${strategy.name} → ${action.type}`, action.reason || '');
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
    this.notifyStrategies('onReset');
  }

  /**
   * Notify all strategies of events (optional hook)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private notifyStrategies(event: string, ...args: any[]): void {
    for (const strategy of this.strategies) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const handler = (strategy as any)[event];
      if (typeof handler === 'function') {
        handler.call(strategy, ...args);
      }
    }
  }

  /**
   * Add strategy at runtime (for dynamic behavior)
   */
  addStrategy(strategy: ITowerStrategy): void {
    this.strategies.push(strategy);
    this.strategies.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Remove strategy by name
   */
  removeStrategy(name: string): boolean {
    const index = this.strategies.findIndex(s => s.name === name);
    if (index >= 0) {
      this.strategies.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Replace strategy
   */
  replaceStrategy(name: string, newStrategy: ITowerStrategy): boolean {
    const index = this.strategies.findIndex(s => s.name === name);
    if (index >= 0) {
      this.strategies[index] = newStrategy;
      this.strategies.sort((a, b) => b.priority - a.priority);
      return true;
    }
    return false;
  }

  /**
   * Make a suboptimal action (for mistake simulation)
   * Called by BaseTowerBot.update() when mistakeRate triggers
   */
  protected override makeSuboptimalAction(
    _state: GameStateSnapshot,
    originalAction: TowerAction
  ): TowerAction {
    // 50% chance: pick a different tower type
    if (originalAction.type === 'place' && originalAction.towerType) {
      const alternatives = this.config.knownTowerTypes.filter(
        (t: TowerTypeId) => t !== originalAction.towerType
      );
      if (alternatives.length > 0 && Math.random() < 0.5) {
        const randomType = alternatives[Math.floor(Math.random() * alternatives.length)];
        return {
          ...originalAction,
          towerType: randomType,
          reason: `Mistake: ${randomType} statt ${originalAction.towerType}`,
          confidence: (originalAction.confidence ?? 0.8) * 0.6,
        };
      }
    }

    // Otherwise: shift position slightly
    if (originalAction.position) {
      return {
        ...originalAction,
        position: {
          x: originalAction.position.x + (Math.random() - 0.5) * 20,
          z: originalAction.position.z + (Math.random() - 0.5) * 20,
        },
        confidence: (originalAction.confidence ?? 0.8) * 0.7,
      };
    }

    return originalAction;
  }
}
