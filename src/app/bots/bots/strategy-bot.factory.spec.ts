import { describe, it, expect } from 'vitest';
import { StrategyBotFactory } from './strategy-bot.factory';
import type { BotSkillLevel } from './tower-bot.interface';
import type { ITowerStrategy } from '../strategies/tower-strategy.interface';
import { GameRng } from '../../utils/game-rng';

function strategyNames(skill: BotSkillLevel, autoStartWaves = false): string[] {
  // The strategies only keep their collaborators; nothing is called while
  // composing, but the config jitter draws from the run's bot stream.
  const factory = new StrategyBotFactory(
    {} as never,
    { rng: new GameRng(1) } as never,
    {} as never,
  );
  const bot = factory.createBot(skill, autoStartWaves);
  return (bot as unknown as { strategies: ITowerStrategy[] }).strategies.map((s) => s.name);
}

describe('StrategyBotFactory', () => {
  it.each(['beginner', 'expert'] as BotSkillLevel[])(
    'gives %s the nuclear strike, at the top of its priorities',
    (skill) => {
      const names = strategyNames(skill);
      expect(names).toContain('NuclearStrike');
      expect(names[0]).toBe('NuclearStrike');
    },
  );

  it.each(['beginner', 'expert'] as BotSkillLevel[])(
    'gives %s the missile silo placement, after the research center and before the combat placements',
    (skill) => {
      const names = strategyNames(skill);
      const silo = names.indexOf('MissileSiloPlacement');
      expect(silo).toBeGreaterThan(names.indexOf('ResearchCenterPlacement'));
      for (const placement of ['AntiAirPlacement', 'CoverageFill', 'DistributedPlacement']) {
        if (names.includes(placement)) expect(silo, placement).toBeLessThan(names.indexOf(placement));
      }
    },
  );

  it('gives the expert the hero, and the beginner none', () => {
    // Nobody used the hero before 2026-09-20, so every run measured a game
    // without him (BALANCING_PLAN.md, D15).
    expect(strategyNames('expert')).toContain('Hero');
    expect(strategyNames('beginner')).not.toContain('Hero');
  });

  it('gives the expert what answers a wave, the beginner only a fill', () => {
    expect(strategyNames('expert')).toEqual(expect.arrayContaining([
      'AntiAirPlacement', 'AntiEtherealPlacement', 'SplashDefensePlacement',
      'SellUnderperformer', 'DistributedPlacement',
    ]));
    expect(strategyNames('beginner')).toContain('CoverageFill');
    expect(strategyNames('beginner')).not.toContain('SellUnderperformer');
  });

  it('appends the wave starter only in auto mode', () => {
    expect(strategyNames('expert')).not.toContain('AutoStartWave');
    expect(strategyNames('expert', true)).toContain('AutoStartWave');
  });
});
