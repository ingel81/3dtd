/**
 * Strategy Bot Factory
 *
 * Creates bots with different strategy sets based on skill level.
 */

import { StrategyBot } from './strategy-bot';
import { BotSkillLevel, BOT_CONFIGS, BotConfig } from './tower-bot.interface';
import { ITowerStrategy } from '../strategies/tower-strategy.interface';
import { StrategicPlacementService } from '../../services/world/strategic-placement.service';
import type { BotWorld } from '../bot-world';

// Strategy imports
import { ResearchCenterPlacementStrategy } from '../strategies/placement/research-center-placement.strategy';
import { MissileSiloPlacementStrategy } from '../strategies/placement/missile-silo-placement.strategy';
import { ResearchPickStrategy } from '../strategies/research/research-pick.strategy';
import { TowerBuildStrategy } from '../strategies/build/tower-build.strategy';
import { TowerUpgradeStrategy } from '../strategies/upgrade/tower-upgrade.strategy';
import { SellUnderperformerStrategy } from '../strategies/upgrade/sell-underperformer.strategy';
import { AutoStartWaveStrategy } from '../strategies/wave/auto-start-wave.strategy';
import { NuclearStrikeStrategy } from '../strategies/ability/nuclear-strike.strategy';
import { FrostBombStrategy } from '../strategies/ability/frost-bomb.strategy';
import { EmpStrategy } from '../strategies/ability/emp.strategy';
import { OrbitalLaserStrategy } from '../strategies/ability/orbital-laser.strategy';
import { HeroStrategy } from '../strategies/hero/hero.strategy';

export class StrategyBotFactory {
  constructor(
    private strategicPlacement: StrategicPlacementService,
    private gameState: BotWorld,
  ) {}

  /**
   * Create bot with strategies for given skill level.
   * Adds ±30% jitter to reactionTimeMs and maxTowers so parallel training
   * clients don't all play identically → richer training distribution.
   */
  createBot(skillLevel: BotSkillLevel, autoStartWaves = false): StrategyBot {
    const overrides = this.jitterConfig(skillLevel);
    // The strategies read the bot's own config, its jittered tower cap included
    const config = { ...BOT_CONFIGS[skillLevel], ...overrides };
    const strategies = this.getStrategiesForSkillLevel(config, autoStartWaves);
    return new StrategyBot(skillLevel, strategies, this.gameState, overrides);
  }

  /** Random multiplier in [0.7, 1.3], from the run's bot stream. */
  private jitter(): number {
    return 0.7 + this.gameState.rng.stream('bot')() * 0.6;
  }

  private jitterConfig(skillLevel: BotSkillLevel): Partial<BotConfig> {
    const base = BOT_CONFIGS[skillLevel];
    return {
      reactionTimeMs: Math.max(100, Math.round(base.reactionTimeMs * this.jitter())),
      // maxTowers=0 (unlimited) stays 0 — jitter only applies to concrete caps
      maxTowers: base.maxTowers > 0 ? Math.max(5, Math.round(base.maxTowers * this.jitter())) : 0,
    };
  }

  /**
   * The strategies of a bot, in the order its rules are taken
   * (decision/arbiter.ts): the abilities, the hero, the research center and
   * the silo, selling; then research, the buys and the wave start, which the
   * arbiter orders by kind and value.
   */
  private getStrategiesForSkillLevel(config: BotConfig, autoStartWaves: boolean): ITowerStrategy[] {
    const expert = config.skillLevel === 'expert';
    const strategies: ITowerStrategy[] = [
      // Both bots fire an ability they have; only the expert researches them
      // (ResearchPick), for the beginner they stay inert.
      new NuclearStrikeStrategy(this.gameState),
      new FrostBombStrategy(this.gameState),
      new EmpStrategy(this.gameState),
      new OrbitalLaserStrategy(this.gameState),
    ];
    // The expert hires the hero and sells what does not earn its place; the
    // beginner does neither.
    if (expert) strategies.push(new HeroStrategy(this.gameState));
    strategies.push(
      new ResearchCenterPlacementStrategy(this.strategicPlacement, this.gameState),
      new MissileSiloPlacementStrategy(this.strategicPlacement, this.gameState),
    );
    if (expert) strategies.push(new SellUnderperformerStrategy(this.gameState, config));
    strategies.push(
      new ResearchPickStrategy(config),
      // The expert spreads its towers over the zones of the route; the
      // beginner builds at the two ends, where the score puts them.
      new TowerBuildStrategy(this.strategicPlacement, this.gameState, config, expert ? 'distributed' : 'strategic'),
      new TowerUpgradeStrategy(this.gameState),
    );
    if (autoStartWaves) strategies.push(new AutoStartWaveStrategy(true));
    return strategies;
  }
}
