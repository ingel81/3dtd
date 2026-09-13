import { describe, it, expect, vi } from 'vitest';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { TrainingSession } from './training-session';
import { TrainingClientService, type TrainingDeps } from './training-client.service';
import { AIDataCollectorService } from '../core/ai-data-collector.service';
import { TowerDefenseStore } from '../../store/tower-defense.store';
import { BaseTowerBot } from './bots/base-tower-bot';
import { ITowerBot, TowerAction } from './bots/tower-bot.interface';
import { GameStateSnapshot } from '../core/models/game-state-snapshot';
import { GameEventBus } from '../../game-engine/game-event-bus';

/** Sub-step length the game loop hands the bot (GameClock.FIXED_STEP_MS). */
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

/** TrainingSession with an enabled TestBot, in the given game phase. */
function createSession(phase = 'wave') {
  const injector = Injector.create({
    providers: [
      { provide: AIDataCollectorService, useValue: {} },
      { provide: TowerDefenseStore, useValue: { phase: signal(phase) } },
    ],
  });
  // Der Service ist hier nur Halter der Signale, in die die Session schreibt.
  const client = runInInjectionContext(injector, () => new TrainingClientService());
  const session = runInInjectionContext(injector, () => new TrainingSession(client, {} as TrainingDeps));
  const bot = new TestBot();
  // enableBot() would build a real strategy bot; updateBot only needs a bot.
  (session as unknown as { currentBot: ITowerBot | null }).currentBot = bot;
  client.botEnabled.set(true);
  return { session, bot };
}

describe('TrainingSession.updateBot snapshot laziness', () => {
  it('builds no snapshot while the bot is in reaction cooldown, exactly one after', () => {
    const { session, bot } = createSession();
    const snapshot = vi.fn(() => ({}) as GameStateSnapshot);

    // First tick decides and arms the 400 ms cooldown.
    session.updateBot(snapshot, 0);
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(bot.decisionCount).toBe(1);

    snapshot.mockClear();
    for (let i = 0; i < 3; i++) session.updateBot(snapshot, 100);
    expect(snapshot).not.toHaveBeenCalled();

    session.updateBot(snapshot, 100);
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(bot.decisionCount).toBe(2);
  });

  it('decides on the same sub-steps as a bot fed a snapshot every tick', () => {
    const { session, bot: lazyBot } = createSession();
    const eagerBot = new TestBot();
    const snapshot = vi.fn(() => ({}) as GameStateSnapshot);
    const lazySteps: number[] = [];
    const eagerSteps: number[] = [];

    // Ten game-seconds of sub-steps.
    for (let step = 0; step < 600; step++) {
      const lazyBefore = lazyBot.decisionCount;
      session.updateBot(snapshot, STEP_MS);
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
    const { session, bot } = createSession('gameover');
    const snapshot = vi.fn(() => ({}) as GameStateSnapshot);

    session.updateBot(snapshot, STEP_MS);

    expect(snapshot).not.toHaveBeenCalled();
    expect(bot.decisionCount).toBe(0);
  });
});

describe('TrainingSession bot actions', () => {
  class StrikeBot extends BaseTowerBot {
    constructor() {
      super('strategist', { reactionTimeMs: 400 }, 'StrikeBot');
    }
    protected decideAction(_state: GameStateSnapshot): TowerAction | null {
      return { type: 'use-ability', abilityId: 'nuclear-strike', position: { x: 9.1, z: 48.2 } };
    }
  }

  it('sends use-ability as command:use-ability, the aim as lat/lon', () => {
    const bus = new GameEventBus();
    const commands = vi.fn();
    bus.on('command:use-ability', commands);
    const injector = Injector.create({
      providers: [
        { provide: AIDataCollectorService, useValue: {} },
        { provide: TowerDefenseStore, useValue: { phase: signal('wave') } },
      ],
    });
    const client = runInInjectionContext(injector, () => new TrainingClientService());
    const deps = { gameState: { getEventBus: () => bus } } as unknown as TrainingDeps;
    const session = runInInjectionContext(injector, () => new TrainingSession(client, deps));
    (session as unknown as { currentBot: ITowerBot | null }).currentBot = new StrikeBot();
    client.botEnabled.set(true);

    session.updateBot(() => ({}) as GameStateSnapshot, 0);

    expect(commands).toHaveBeenCalledWith({
      type: 'command:use-ability',
      abilityId: 'nuclear-strike',
      target: { lat: 48.2, lon: 9.1 },
    });
  });
});
