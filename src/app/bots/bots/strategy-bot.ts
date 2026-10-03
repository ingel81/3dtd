/**
 * Strategy-Based Tower Bot
 *
 * Composes ITowerStrategy plugins: each proposes, the arbiter decides
 * (decision/arbiter.ts, docs/BOT_PLAYER_PLAN.md, B3). The strategies keep the
 * order the factory gives them; among the rules it is the order they are
 * taken in.
 */

import { BaseTowerBot } from './base-tower-bot';
import { DecisionContext, ITowerStrategy } from '../strategies/tower-strategy.interface';
import { GameStateSnapshot } from '../../director/models/game-state-snapshot';
import { TowerAction, BotSkillLevel, BotConfig } from './tower-bot.interface';
import type { BotWorld } from '../bot-world';
import { arbitrate } from '../decision/arbiter';
import { ArmorSides, threatFromMix, threatFromWaves } from '../decision/value';
import { damageMetresPerArmor } from '../../director/defense-analyzer';
import { haversineDistance } from '../../utils/geo-utils';
import type { GeoPosition } from '../../models/game.types';

/** Coming waves the bot reads off the wave panel */
const WAVES_AHEAD = 2;

export class StrategyBot extends BaseTowerBot {
  private strategies: ITowerStrategy[] = [];

  constructor(
    skillLevel: BotSkillLevel,
    strategies: ITowerStrategy[],
    private readonly world: BotWorld,
    configOverrides?: Partial<BotConfig>,
    name?: string
  ) {
    super(
      skillLevel,
      configOverrides,
      name || `Strategy${skillLevel.charAt(0).toUpperCase()}${skillLevel.slice(1)}Bot`,
    );

    this.strategies = strategies;
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

  /** Every strategy proposes, the arbiter takes one */
  protected decideAction(state: GameStateSnapshot): TowerAction | null {
    const context = this.contextOf(state);
    const proposals = this.strategies.flatMap((strategy) => strategy.propose(state, context));
    const last = this.world.perception.lastWave;
    const action = arbitrate({ proposals, credits: state.player.credits, safe: last === null || last.leaks === 0 });
    // A wait does not count as an action (it would reset the wave starter's timer)
    if (action.type !== 'wait') this.notifyActionExecuted(action);
    return action;
  }

  /**
   * What every strategy reads: the threat of the coming waves (off the wave
   * panel for a bot that reads it, else the expected armor mix), the own
   * defense's damage times metres under fire, the metres per tower.
   */
  private contextOf(state: GameStateSnapshot): DecisionContext {
    const metresByTower = this.world.metresByTower();
    const airUnlocked = state.research?.airTargetingUnlocked ?? false;
    const capacity = damageMetresPerArmor(this.world.towerManager.getAll(), airUnlocked, metresByTower);
    const waves = this.config.adaptsToEnemies ? this.world.peekWaves(state.waveNumber + 1, WAVES_AHEAD) : [];
    const read = threatFromWaves(waves);
    const threat = totalOf(read) > 0 ? read : threatFromMix(state.expectedArmorDistribution);
    const paths = [...this.world.getCachedPaths().values()];
    const routeMetres = paths.length > 0 ? paths.reduce((sum, path) => sum + pathLength(path), 0) / paths.length : 0;
    return { threat, capacity, metresByTower, routes: paths.length, routeMetres };
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

function totalOf(sides: ArmorSides): number {
  let sum = 0;
  for (const side of [sides.ground, sides.air]) for (const hp of Object.values(side)) sum += hp;
  return sum;
}

function pathLength(path: readonly GeoPosition[]): number {
  let metres = 0;
  for (let i = 1; i < path.length; i++) {
    metres += haversineDistance(path[i - 1].lat, path[i - 1].lon, path[i].lat, path[i].lon);
  }
  return metres;
}
