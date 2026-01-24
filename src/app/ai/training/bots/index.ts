// Tower Bots for AI Training

export * from './tower-bot.interface';
export { BaseTowerBot } from './base-tower-bot';
export { BeginnerBot } from './beginner-bot';
export { CasualBot } from './casual-bot';
export { StrategistBot } from './strategist-bot';
export { SmartTowerBot } from './smart-tower-bot';

import { ITowerBot, BotSkillLevel } from './tower-bot.interface';
import { BeginnerBot } from './beginner-bot';
import { CasualBot } from './casual-bot';
import { StrategistBot } from './strategist-bot';
import { SmartTowerBot } from './smart-tower-bot';
import { StrategicPlacementService } from '../../../services/strategic-placement.service';
import { GameStateManager } from '../../../managers/game-state.manager';

/**
 * Create a bot instance by skill level
 */
export function createBot(level: BotSkillLevel): ITowerBot {
  switch (level) {
    case 'beginner':
      return new BeginnerBot();
    case 'casual':
      return new CasualBot();
    case 'strategist':
      return new StrategistBot();
    case 'meta':
      // Meta bot is same as strategist but with different config
      // Could be extended with more sophisticated logic
      return new StrategistBot();
  }
}

/**
 * Get weighted random bot for training
 *
 * Default distribution:
 * - Beginner: 30%
 * - Casual: 40%
 * - Strategist: 20%
 * - Meta: 10%
 */
export function getRandomBot(weights?: Record<BotSkillLevel, number>): ITowerBot {
  const defaultWeights: Record<BotSkillLevel, number> = {
    beginner: 0.3,
    casual: 0.4,
    strategist: 0.2,
    meta: 0.1,
  };

  const w = weights ?? defaultWeights;
  const random = Math.random();

  let cumulative = 0;
  for (const [level, weight] of Object.entries(w) as [BotSkillLevel, number][]) {
    cumulative += weight;
    if (random < cumulative) {
      return createBot(level);
    }
  }

  return createBot('casual'); // Fallback
}

/**
 * Create a SmartTowerBot instance with strategic placement
 *
 * SmartTowerBot uses StrategicPlacementService for targeted tower placement
 * near enemy spawns along paths, avoiding trial & error.
 *
 * @param strategicPlacement Strategic placement service instance
 * @param gameState Game state manager instance
 * @param skillLevel Bot skill level (casual, strategist, meta)
 * @param name Optional custom bot name
 * @param autoStartWaves Whether bot should automatically start waves when ready
 */
export function createSmartBot(
  strategicPlacement: StrategicPlacementService,
  gameState: GameStateManager,
  skillLevel: BotSkillLevel = 'strategist',
  name?: string,
  autoStartWaves = false
): ITowerBot {
  return new SmartTowerBot(skillLevel, strategicPlacement, gameState, name, autoStartWaves);
}
