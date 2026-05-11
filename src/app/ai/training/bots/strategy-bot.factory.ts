/**
 * Strategy Bot Factory
 *
 * Creates bots with different strategy sets based on skill level.
 */

import { StrategyBot } from './strategy-bot';
import { BotSkillLevel, BOT_CONFIGS, BotConfig } from './tower-bot.interface';
import { ITowerStrategy } from '../strategies/tower-strategy.interface';
import { StrategicPlacementService } from '../../../services/world/strategic-placement.service';
import { GameStateManager } from '../../../managers/game-state.manager';
import { OsmStreetService } from '../../../services/location/osm-street.service';

// Strategy imports
import { AntiAirPlacementStrategy } from '../strategies/placement/anti-air-placement.strategy';
import { SplashDefensePlacementStrategy } from '../strategies/placement/splash-defense-placement.strategy';
import { CoverageFillStrategy } from '../strategies/placement/coverage-fill.strategy';
import { DistributedPlacementStrategy } from '../strategies/placement/distributed-placement.strategy';
import { ResearchCenterPlacementStrategy } from '../strategies/placement/research-center-placement.strategy';
import { ResearchPickStrategy } from '../strategies/research/research-pick.strategy';
import { NearSpawnUpgradeStrategy } from '../strategies/upgrade/near-spawn-upgrade.strategy';
import { SellUnderperformerStrategy } from '../strategies/upgrade/sell-underperformer.strategy';
import { AutoStartWaveStrategy } from '../strategies/wave/auto-start-wave.strategy';

export class StrategyBotFactory {
  constructor(
    private strategicPlacement: StrategicPlacementService,
    private gameState: GameStateManager,
    private osmService: OsmStreetService
  ) {}

  /**
   * Create bot with strategies for given skill level.
   * Adds ±30% jitter to reactionTimeMs and maxTowers so parallel training
   * clients don't all play identically → richer training distribution.
   */
  createBot(skillLevel: BotSkillLevel, autoStartWaves = false): StrategyBot {
    const strategies = this.getStrategiesForSkillLevel(skillLevel, autoStartWaves);
    const overrides = this.jitterConfig(skillLevel);
    return new StrategyBot(skillLevel, strategies, overrides);
  }

  /** Random multiplier in [0.7, 1.3] */
  private jitter(): number {
    return 0.7 + Math.random() * 0.6;
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
   * Get strategy set for skill level
   */
  private getStrategiesForSkillLevel(
    skillLevel: BotSkillLevel,
    autoStartWaves: boolean
  ): ITowerStrategy[] {
    const strategies: ITowerStrategy[] = [];

    // Get config for this skill level
    const config = BOT_CONFIGS[skillLevel];

    // Research strategies — ALL skill levels get them so the bot can bootstrap
    // research and respect tower-lock state. Priority 95 (build center) > 90 (AntiAir).
    const researchCenterPlacement = new ResearchCenterPlacementStrategy(
      this.strategicPlacement, this.gameState
    );
    const researchPick = new ResearchPickStrategy(config);

    switch (skillLevel) {
      case 'beginner':
        // Beginner: Research Center + basic research (gatling-tech only) + placement
        strategies.push(
          researchCenterPlacement,
          researchPick,
          new CoverageFillStrategy(this.strategicPlacement, this.gameState, config)
        );
        break;

      case 'casual':
        // Casual: Research + basic placement + occasional upgrades
        strategies.push(
          researchCenterPlacement,
          new AntiAirPlacementStrategy(this.strategicPlacement, this.gameState, config),
          new SplashDefensePlacementStrategy(this.strategicPlacement, this.gameState, config),
          researchPick,
          new NearSpawnUpgradeStrategy(this.gameState, this.osmService),
          new CoverageFillStrategy(this.strategicPlacement, this.gameState, config)
        );
        break;

      case 'strategist':
        // Strategist: Full research tree + distributed placement + upgrades + sell
        strategies.push(
          researchCenterPlacement,
          new AntiAirPlacementStrategy(this.strategicPlacement, this.gameState, config),
          new SplashDefensePlacementStrategy(this.strategicPlacement, this.gameState, config),
          researchPick,
          new NearSpawnUpgradeStrategy(this.gameState, this.osmService),
          new SellUnderperformerStrategy(this.gameState, config),
          new DistributedPlacementStrategy(this.strategicPlacement, this.gameState, config)
        );
        break;

      case 'meta':
        // Meta: All strategies + research
        strategies.push(
          researchCenterPlacement,
          new AntiAirPlacementStrategy(this.strategicPlacement, this.gameState, config),
          new SplashDefensePlacementStrategy(this.strategicPlacement, this.gameState, config),
          researchPick,
          new NearSpawnUpgradeStrategy(this.gameState, this.osmService),
          new CoverageFillStrategy(this.strategicPlacement, this.gameState, config)
        );
        break;
    }

    // Add auto-start wave strategy if enabled
    if (autoStartWaves) {
      strategies.push(new AutoStartWaveStrategy(true));
    }

    return strategies;
  }
}
