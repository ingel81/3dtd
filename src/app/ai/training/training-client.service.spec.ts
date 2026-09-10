import { describe, it, expect, vi } from 'vitest';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { TrainingClientService } from './training-client.service';
import { AIDataCollectorService } from '../core/ai-data-collector.service';
import { TowerDefenseStore } from '../../store/tower-defense.store';
import { BaseTowerBot } from './bots/base-tower-bot';
import { ITowerBot, TowerAction } from './bots/tower-bot.interface';
import { GameStateSnapshot } from '../core/models/game-state-snapshot';

/** Sub-step length the game loop hands the bot (GameStateManager.FIXED_STEP_MS). */
const STEP_MS = 16.667;

class TestBot extends BaseTowerBot {
  decisionCount = 0;
  constructor() {
    super('strategist', { reactionTimeMs: 400 }, 'TestBot');
  }
  protected decideAction(_state: GameStateSnapshot): TowerAction | null {
    this.decisionCount++;
    return { type: 'wait', reason: 'test' };
  }
}

/** TrainingClientService with an enabled TestBot, in the given game phase. */
function createService(phase = 'wave') {
  const injector = Injector.create({
    providers: [
      { provide: AIDataCollectorService, useValue: {} },
      { provide: TowerDefenseStore, useValue: { phase: signal(phase) } },
    ],
  });
  const service = runInInjectionContext(injector, () => new TrainingClientService());
  const bot = new TestBot();
  // initialize() wires half the game; updateBot only needs a bot and a game state.
  const internals = service as unknown as { currentBot: ITowerBot | null; gameState: unknown };
  internals.currentBot = bot;
  internals.gameState = {};
  service.botEnabled.set(true);
  return { service, bot };
}

describe('TrainingClientService.updateBot snapshot laziness', () => {
  it('builds no snapshot while the bot is in reaction cooldown, exactly one after', () => {
    const { service, bot } = createService();
    const snapshot = vi.fn(() => ({}) as GameStateSnapshot);

    // First tick decides and arms the 400 ms cooldown.
    service.updateBot(snapshot, 0);
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(bot.decisionCount).toBe(1);

    snapshot.mockClear();
    for (let i = 0; i < 3; i++) service.updateBot(snapshot, 100);
    expect(snapshot).not.toHaveBeenCalled();

    service.updateBot(snapshot, 100);
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(bot.decisionCount).toBe(2);
  });

  it('decides on the same sub-steps as a bot fed a snapshot every tick', () => {
    const { service, bot: lazyBot } = createService();
    const eagerBot = new TestBot();
    const snapshot = vi.fn(() => ({}) as GameStateSnapshot);
    const lazySteps: number[] = [];
    const eagerSteps: number[] = [];

    // Ten game-seconds of sub-steps.
    for (let step = 0; step < 600; step++) {
      const lazyBefore = lazyBot.decisionCount;
      service.updateBot(snapshot, STEP_MS);
      if (lazyBot.decisionCount > lazyBefore) lazySteps.push(step);

      const eagerBefore = eagerBot.decisionCount;
      eagerBot.update({} as GameStateSnapshot, STEP_MS);
      if (eagerBot.decisionCount > eagerBefore) eagerSteps.push(step);
    }

    expect(lazySteps).toEqual(eagerSteps);
    expect(lazySteps.length).toBeGreaterThan(20);
    expect(snapshot).toHaveBeenCalledTimes(lazySteps.length);
  });

  it('builds no snapshot outside setup and wave', () => {
    const { service, bot } = createService('gameover');
    const snapshot = vi.fn(() => ({}) as GameStateSnapshot);

    service.updateBot(snapshot, STEP_MS);

    expect(snapshot).not.toHaveBeenCalled();
    expect(bot.decisionCount).toBe(0);
  });
});
