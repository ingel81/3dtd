import { describe, it, expect } from 'vitest';
import { StrategyBotFactory } from './strategy-bot.factory';
import type { BotSkillLevel } from './tower-bot.interface';
import type { ITowerStrategy } from '../strategies/tower-strategy.interface';
import { GameRng } from '../../utils/game-rng';

function strategiesOf(skill: BotSkillLevel, autoStartWaves = false): ITowerStrategy[] {
  // The strategies only keep their collaborators; nothing is called while
  // composing, but the config jitter draws from the run's bot stream.
  const factory = new StrategyBotFactory({} as never, { rng: new GameRng(1) } as never);
  const bot = factory.createBot(skill, autoStartWaves);
  return (bot as unknown as { strategies: ITowerStrategy[] }).strategies;
}

const names = (skill: BotSkillLevel, autoStartWaves = false) => strategiesOf(skill, autoStartWaves).map((s) => s.name);

describe('StrategyBotFactory', () => {
  it.each(['beginner', 'normal', 'expert'] as BotSkillLevel[])(
    'gives %s the abilities first among its rules, the nuclear strike on top',
    (skill) => {
      expect(names(skill).slice(0, 4)).toEqual(['NuclearStrike', 'FrostBomb', 'Emp', 'OrbitalLaser']);
    },
  );

  it.each(['beginner', 'normal', 'expert'] as BotSkillLevel[])(
    'gives %s the research center and the silo before research, building and upgrading',
    (skill) => {
      const list = names(skill);
      const silo = list.indexOf('MissileSiloPlacement');
      expect(silo).toBeGreaterThan(list.indexOf('ResearchCenterPlacement'));
      for (const later of ['ResearchPick', 'Build', 'Upgrade']) expect(silo, later).toBeLessThan(list.indexOf(later));
    },
  );

  it('gives the expert the hero, selling and targeting, the beginner none', () => {
    // Nobody used the hero before 2026-09-20, so every run measured a game
    // without him (BALANCING_PLAN.md, D15).
    expect(names('expert')).toEqual(expect.arrayContaining(['Hero', 'Sell', 'Targeting']));
    for (const name of ['Hero', 'Sell', 'Targeting']) expect(names('beginner')).not.toContain(name);
  });

  it('lets the normal player and the expert send gold in coop, not the beginner', () => {
    expect(names('normal')).toContain('Gift');
    expect(names('expert')).toContain('Gift');
    expect(names('beginner')).not.toContain('Gift');
  });

  it('gives the normal player the hero, but neither selling nor targeting', () => {
    expect(names('normal')).toContain('Hero');
    expect(names('normal')).not.toContain('Sell');
    expect(names('normal')).not.toContain('Targeting');
  });

  it('builds the expert spread over the route, the beginner at its two ends', () => {
    const spots = (skill: BotSkillLevel) =>
      (strategiesOf(skill).find((s) => s.name === 'Build') as unknown as { spots: string }).spots;
    expect(spots('expert')).toBe('distributed');
    expect(spots('normal')).toBe('distributed');
    expect(spots('beginner')).toBe('strategic');
  });

  it('hands the strategies the bot\'s jittered tower cap', () => {
    const build = strategiesOf('expert').find((s) => s.name === 'Build') as unknown as { config: { maxTowers: number } };
    const factory = new StrategyBotFactory({} as never, { rng: new GameRng(1) } as never);
    const bot = factory.createBot('expert');
    expect(build.config.maxTowers).toBe(bot.config.maxTowers);
  });

  it('appends the wave starter only in auto mode', () => {
    expect(names('expert')).not.toContain('AutoStartWave');
    expect(names('expert', true).at(-1)).toBe('AutoStartWave');
  });
});
