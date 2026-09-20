/**
 * Strategy Bot Factory
 *
 * Creates bots with different strategy sets based on skill level.
 */

import { StrategyBot } from './strategy-bot';
import { BotSkillLevel, BOT_CONFIGS, BotConfig } from './tower-bot.interface';
import { ITowerStrategy } from '../strategies/tower-strategy.interface';
import { StrategicPlacementService } from '../../services/world/strategic-placement.service';
import { GameStateManager } from '../../managers/game-state.manager';
import { OsmStreetService } from '../../services/location/osm-street.service';

// Strategy imports
import { AntiAirPlacementStrategy } from '../strategies/placement/anti-air-placement.strategy';
import { AntiEtherealPlacementStrategy } from '../strategies/placement/anti-ethereal-placement.strategy';
import { SplashDefensePlacementStrategy } from '../strategies/placement/splash-defense-placement.strategy';
import { CoverageFillStrategy } from '../strategies/placement/coverage-fill.strategy';
import { DistributedPlacementStrategy } from '../strategies/placement/distributed-placement.strategy';
import { ResearchCenterPlacementStrategy } from '../strategies/placement/research-center-placement.strategy';
import { MissileSiloPlacementStrategy } from '../strategies/placement/missile-silo-placement.strategy';
import { ResearchPickStrategy } from '../strategies/research/research-pick.strategy';
import { PathCoverageUpgradeStrategy } from '../strategies/upgrade/path-coverage-upgrade.strategy';
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

    if (skillLevel === 'beginner') {
      // The beginner keeps to the research centre, the basic research and a
      // coverage fill: slow, few towers, no selling, no hero.
      strategies.push(
        researchCenterPlacement,
        researchPick,
        new CoverageFillStrategy(this.strategicPlacement, this.gameState, config),
      );
    } else {
      // The expert answers what a wave brings, researches the whole tree,
      // upgrades along the path, sells what does not earn its place, and
      // hires the hero.
      strategies.push(
        researchCenterPlacement,
        new AntiAirPlacementStrategy(this.strategicPlacement, this.gameState, config),
        new AntiEtherealPlacementStrategy(this.strategicPlacement, this.gameState, config),
        new SplashDefensePlacementStrategy(this.strategicPlacement, this.gameState, config),
        researchPick,
        new HeroStrategy(this.gameState),
        new PathCoverageUpgradeStrategy(this.gameState, this.osmService),
        new SellUnderperformerStrategy(this.gameState, config),
        new DistributedPlacementStrategy(this.strategicPlacement, this.gameState, config),
      );
    }

    // Both bots build the strike's missile silo and fire a nuclear strike they
    // have. Only the expert researches it (ResearchPick); for the beginner
    // both stay inert.
    strategies.push(new MissileSiloPlacementStrategy(this.strategicPlacement, this.gameState));
    strategies.push(new NuclearStrikeStrategy(this.gameState));
    strategies.push(new FrostBombStrategy(this.gameState));
    strategies.push(new EmpStrategy(this.gameState));
    strategies.push(new OrbitalLaserStrategy(this.gameState));

    // Add auto-start wave strategy if enabled
    if (autoStartWaves) {
      strategies.push(new AutoStartWaveStrategy(true));
    }

    return strategies;
  }
}
