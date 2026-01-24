/**
 * Strategy Bot Factory
 *
 * Creates bots with different strategy sets based on skill level.
 */

import { StrategyBot } from './strategy-bot';
import { BotSkillLevel, BOT_CONFIGS } from './tower-bot.interface';
import { ITowerStrategy } from '../strategies/tower-strategy.interface';
import { StrategicPlacementService } from '../../../services/strategic-placement.service';
import { GameStateManager } from '../../../managers/game-state.manager';
import { OsmStreetService } from '../../../services/osm-street.service';

// Strategy imports
import { AntiAirPlacementStrategy } from '../strategies/placement/anti-air-placement.strategy';
import { SplashDefensePlacementStrategy } from '../strategies/placement/splash-defense-placement.strategy';
import { CoverageFillStrategy } from '../strategies/placement/coverage-fill.strategy';
import { DistributedPlacementStrategy } from '../strategies/placement/distributed-placement.strategy';
import { NearSpawnUpgradeStrategy } from '../strategies/upgrade/near-spawn-upgrade.strategy';
import { AutoStartWaveStrategy } from '../strategies/wave/auto-start-wave.strategy';

export class StrategyBotFactory {
  constructor(
    private strategicPlacement: StrategicPlacementService,
    private gameState: GameStateManager,
    private osmService: OsmStreetService
  ) {}

  /**
   * Create bot with strategies for given skill level
   */
  createBot(skillLevel: BotSkillLevel, autoStartWaves = false): StrategyBot {
    const strategies = this.getStrategiesForSkillLevel(skillLevel, autoStartWaves);
    return new StrategyBot(skillLevel, strategies);
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

    switch (skillLevel) {
      case 'beginner':
        // Beginner: Only basic placement, no upgrades
        strategies.push(
          new CoverageFillStrategy(this.strategicPlacement, this.gameState, config)
        );
        break;

      case 'casual':
        // Casual: Basic placement + occasional upgrades
        strategies.push(
          new AntiAirPlacementStrategy(this.strategicPlacement, this.gameState, config),
          new SplashDefensePlacementStrategy(this.strategicPlacement, this.gameState, config),
          new CoverageFillStrategy(this.strategicPlacement, this.gameState, config),
          new NearSpawnUpgradeStrategy(this.gameState, this.osmService)
        );
        break;

      case 'strategist':
        // Strategist: Distributed placement for even path coverage (AI training)
        strategies.push(
          new AntiAirPlacementStrategy(this.strategicPlacement, this.gameState, config),
          new SplashDefensePlacementStrategy(this.strategicPlacement, this.gameState, config),
          new NearSpawnUpgradeStrategy(this.gameState, this.osmService),
          new DistributedPlacementStrategy(this.strategicPlacement, this.gameState, config)
        );
        break;

      case 'meta':
        // Meta: All strategies + advanced versions
        strategies.push(
          new AntiAirPlacementStrategy(this.strategicPlacement, this.gameState, config),
          new SplashDefensePlacementStrategy(this.strategicPlacement, this.gameState, config),
          new NearSpawnUpgradeStrategy(this.gameState, this.osmService),
          new CoverageFillStrategy(this.strategicPlacement, this.gameState, config)
          // TODO: Add advanced strategies
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
