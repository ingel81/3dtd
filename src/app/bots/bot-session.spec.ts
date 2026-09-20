import { describe, it, expect, vi } from 'vitest';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { BotSession } from './bot-session';
import { BotClientService, type BotDeps } from './bot-client.service';
import { StateSnapshotService } from '../director/state-snapshot.service';
import { TowerDefenseStore } from '../store/tower-defense.store';
import { BaseTowerBot } from './bots/base-tower-bot';
import { ITowerBot, TowerAction } from './bots/tower-bot.interface';
import { GameStateSnapshot } from '../director/models/game-state-snapshot';
import { GameEventBus } from '../game-engine/game-event-bus';

/** Sub-step length the game loop hands the bot (GameClock.FIXED_STEP_MS). */
const STEP_MS = 16.667;

/** The corridor build of the location, as GameStateManager.corridorPending tells it. */
const corridor = { building: false };

class TestBot extends BaseTowerBot {
  decisionCount = 0;
  constructor() {
    super('expert', { reactionTimeMs: 400 }, 'TestBot');
  }
  protected decideAction(_state: GameStateSnapshot): TowerAction | null {
    this.decisionCount++;
    return { type: 'wait', reason: 'test' };
  }
}

/** BotSession with an enabled TestBot, in the given game phase. */
function createSession(phase = 'wave') {
  const injector = Injector.create({
    providers: [
      { provide: StateSnapshotService, useValue: {} },
      { provide: TowerDefenseStore, useValue: { phase: signal(phase) } },
    ],
  });
  // Der Service ist hier nur Halter der Signale, in die die Session schreibt.
  const client = runInInjectionContext(injector, () => new BotClientService());
  const deps = { gameState: { corridorPending: () => corridor.building } } as unknown as BotDeps;
  const session = runInInjectionContext(injector, () => new BotSession(client, deps));
  const bot = new TestBot();
  // enableBot() would build a real strategy bot; updateBot only needs a bot.
  (session as unknown as { currentBot: ITowerBot | null }).currentBot = bot;
  client.botEnabled.set(true);
  return { session, bot };
}

describe('BotSession.updateBot snapshot laziness', () => {
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

  it('waits for the corridor of the location to be built, then decides', () => {
    const { session, bot } = createSession('setup');
    const snapshot = vi.fn(() => ({}) as GameStateSnapshot);
    corridor.building = true;
    try {
      session.updateBot(snapshot, STEP_MS);
      expect(bot.decisionCount).toBe(0);
    } finally {
      corridor.building = false;
    }

    session.updateBot(snapshot, STEP_MS);
    expect(bot.decisionCount).toBe(1);
  });
});

describe('BotSession bot actions', () => {
  class StrikeBot extends BaseTowerBot {
    constructor() {
      super('expert', { reactionTimeMs: 400 }, 'StrikeBot');
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
        { provide: StateSnapshotService, useValue: {} },
        { provide: TowerDefenseStore, useValue: { phase: signal('wave') } },
      ],
    });
    const client = runInInjectionContext(injector, () => new BotClientService());
    const deps = { gameState: { getEventBus: () => bus, corridorPending: () => false } } as unknown as BotDeps;
    const session = runInInjectionContext(injector, () => new BotSession(client, deps));
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

describe('BotSession run config', () => {
  /** A session whose seed source and restart are observable. */
  function configSession() {
    const injector = Injector.create({
      providers: [
        { provide: StateSnapshotService, useValue: {} },
        { provide: TowerDefenseStore, useValue: { phase: signal('setup') } },
      ],
    });
    const client = runInInjectionContext(injector, () => new BotClientService());
    const rng = { useNextSeed: vi.fn(), reset: vi.fn() };
    const restartGame = vi.fn();
    const deps = {
      gameState: { corridorPending: () => false, rng },
      callbacks: { restartGame },
    } as unknown as BotDeps;
    const session = runInInjectionContext(injector, () => new BotSession(client, deps));
    client.botEnabled.set(true);
    return { session, client, rng, restartGame };
  }

  /** applyRunConfig is what the `run_config` message lands in. */
  function apply(session: BotSession, config: Record<string, unknown>) {
    (session as unknown as { applyRunConfig(c: unknown): void }).applyRunConfig(config);
  }

  it('asks the source for the seed instead of resetting it, and starts the run', () => {
    const { session, rng, restartGame } = configSession();

    apply(session, { seed: 4242 });

    // reset() here would be drawn over by the restart's own reset
    expect(rng.reset).not.toHaveBeenCalled();
    expect(rng.useNextSeed).toHaveBeenCalledWith(4242);
    expect(restartGame).toHaveBeenCalledTimes(1);
  });

  it('starts the run only after the config, so the head names what the run plays', () => {
    const { session, restartGame } = configSession();

    (session as unknown as { awaitRunConfig(): void }).awaitRunConfig();
    expect(restartGame).not.toHaveBeenCalled();     // the run waits

    apply(session, { seed: 7 });
    expect(restartGame).toHaveBeenCalledTimes(1);
  });

  it('starts the run anyway when no config arrives', () => {
    vi.useFakeTimers();
    const { session, restartGame } = configSession();

    (session as unknown as { awaitRunConfig(): void }).awaitRunConfig();
    vi.advanceTimersByTime(5000);

    expect(restartGame).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
