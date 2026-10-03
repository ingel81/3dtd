import { describe, expect, it, vi } from 'vitest';
import { StrategyBot } from './strategy-bot';
import { createEmptySnapshot } from '../../director/models/game-state-snapshot';
import type { ITowerStrategy } from '../strategies/tower-strategy.interface';
import { BotPerception } from '../perception/bot-perception';

/** A bot with one buying strategy, in a world whose dice give `roll` */
function botWith(skill: 'beginner' | 'expert', roll: number) {
  const peekWaves = vi.fn(() => []);
  const perception = new BotPerception();
  perception.onWaveStarted(1);
  perception.onEnemyArrived({
    id: 'e', movement: { routeId: 'r', getPathProgress: () => 1 }, typeConfig: {}, health: { maxHp: 10 },
    getEffectiveArmorType: () => 'light',
  });
  perception.onWaveCompleted([]);
  const world = {
    rng: { stream: () => () => roll },
    perception,
    peekWaves,
    metresByTower: () => new Map(),
    towerManager: { getAll: () => [] },
    getCachedPaths: () => new Map(),
  };
  const research: ITowerStrategy = {
    name: 'research',
    propose: () => [
      { kind: 'research', label: 'research', cost: 0, value: 0, act: () => ({ type: 'research-start', reason: 'research' }) },
      { kind: 'buy', label: 'tower', cost: 10, value: 1, act: () => ({ type: 'place', reason: 'tower' }) },
    ],
  };
  const bot = new StrategyBot(skill, [research], world as never);
  return { bot, peekWaves };
}

describe('StrategyBot attention', () => {
  const state = createEmptySnapshot();
  state.player.credits = 100;

  it('reads the wave panel and the leaks when the dice fall under its attention', () => {
    const { bot, peekWaves } = botWith('expert', 0.5);
    // The last wave leaked: it builds before it researches
    expect(bot.update(state, 0)?.type).toBe('place');
    expect(peekWaves).toHaveBeenCalled();
  });

  it('misses both when it does not look: it takes the last wave as held', () => {
    const { bot, peekWaves } = botWith('beginner', 0.5);
    expect(bot.update(state, 0)?.type).toBe('research-start');
    expect(peekWaves).not.toHaveBeenCalled();
  });
});
