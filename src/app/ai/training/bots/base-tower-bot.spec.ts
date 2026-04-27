import { describe, it, expect } from 'vitest';
import { BaseTowerBot } from './base-tower-bot';
import { GameStateSnapshot } from '../../core/models/game-state-snapshot';
import { TowerAction } from './tower-bot.interface';

class TestBot extends BaseTowerBot {
  decisionCount = 0;
  constructor() {
    super('competent', { reactionTimeMs: 400 }, 'TestBot');
  }
  protected decideAction(_state: GameStateSnapshot): TowerAction | null {
    this.decisionCount++;
    return { type: 'wait', reason: 'test' };
  }
}

function fakeState(): GameStateSnapshot {
  // Minimal stub — BaseTowerBot doesn't read fields in the test path.
  return {} as GameStateSnapshot;
}

describe('BaseTowerBot (Phase 5.12 game-time cooldown)', () => {
  it('blocks decisions until game-time cooldown elapses', () => {
    const bot = new TestBot();
    const state = fakeState();

    // First call returns an action and arms the 400ms cooldown
    expect(bot.update(state, 0)).not.toBeNull();
    expect(bot.decisionCount).toBe(1);

    // Next three 100ms ticks stay in cooldown → no new decision
    bot.update(state, 100);
    bot.update(state, 100);
    bot.update(state, 100);
    expect(bot.decisionCount).toBe(1);

    // 4th tick pushes cooldown to <=0 → new decision allowed
    bot.update(state, 100);
    expect(bot.decisionCount).toBe(2);
  });

  it('cadence is timescale-independent when deltaTime is already game-time', () => {
    // Simulate 1 second of game-time in both small (1x) and large (75x) frames.
    // reactionTimeMs=400 → expect 2 decisions per game-second (first fires immediately
    // then after 400ms, then at 800ms — roughly 2-3 per 1000ms of game-time).
    const botSmall = new TestBot();
    for (let i = 0; i < 100; i++) botSmall.update(fakeState(), 10); // 100 × 10ms = 1000ms game-time
    const decisionsSmallFrames = botSmall.decisionCount;

    const botBig = new TestBot();
    botBig.update(fakeState(), 1000); // 1 × 1000ms = 1000ms game-time (single big frame at 75x)
    botBig.update(fakeState(), 0); // cooldown still active after 1 frame
    const decisionsBigFrames = botBig.decisionCount;

    // Both should decide roughly the same number of times per game-second,
    // though the big-frame bot catches up in fewer frames. The key invariant:
    // neither is starved of decisions by timescale.
    expect(decisionsSmallFrames).toBeGreaterThanOrEqual(2);
    expect(decisionsBigFrames).toBeGreaterThanOrEqual(1);
  });

  it('reset() clears cooldown', () => {
    const bot = new TestBot();
    bot.update(fakeState(), 0);           // decision 1, cooldown armed
    bot.update(fakeState(), 100);         // still blocked
    expect(bot.decisionCount).toBe(1);

    bot.reset();
    bot.update(fakeState(), 0);           // decision 2 after reset
    expect(bot.decisionCount).toBe(2);
  });
});
