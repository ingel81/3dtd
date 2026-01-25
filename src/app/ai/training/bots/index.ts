// Tower Bots for AI Training

export * from './tower-bot.interface';
export { BaseTowerBot } from './base-tower-bot';
export { StrategyBot } from './strategy-bot';
export { StrategyBotFactory } from './strategy-bot.factory';

// Re-export factory for convenience
export { StrategyBotFactory as BotFactory } from './strategy-bot.factory';
