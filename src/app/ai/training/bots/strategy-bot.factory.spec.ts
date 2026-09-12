import { describe, it, expect } from 'vitest';
import { StrategyBotFactory } from './strategy-bot.factory';
import type { BotSkillLevel } from './tower-bot.interface';
import type { ITowerStrategy } from '../strategies/tower-strategy.interface';

function strategyNames(skill: BotSkillLevel, autoStartWaves = false): string[] {
  // The strategies only keep their collaborators; nothing is called while composing
  const factory = new StrategyBotFactory({} as never, {} as never, {} as never);
  const bot = factory.createBot(skill, autoStartWaves);
  return (bot as unknown as { strategies: ITowerStrategy[] }).strategies.map((s) => s.name);
}

describe('StrategyBotFactory', () => {
  it.each(['beginner', 'casual', 'strategist', 'meta'] as BotSkillLevel[])(
    'gives %s the nuclear strike, at the top of its priorities',
    (skill) => {
      const names = strategyNames(skill);
      expect(names).toContain('NuclearStrike');
      expect(names[0]).toBe('NuclearStrike');
    },
  );

  it('appends the wave starter only in auto mode', () => {
    expect(strategyNames('strategist')).not.toContain('AutoStartWave');
    expect(strategyNames('strategist', true)).toContain('AutoStartWave');
  });
});
