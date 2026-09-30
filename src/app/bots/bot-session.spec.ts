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
import { GameStore } from '../store/game.store';
import { SimClient } from '../sim/client/sim-client.service';
import { SimMirror } from '../sim/client/mirror/sim-mirror';
import { packet } from '../sim/client/mirror/testing/mirror-packets';
import { RouteQueriesService } from '../services/route-queries.service';
import { PathAndRouteService } from '../services/world/path-route.service';
import { MainWorldService } from '../services/world/main-world.service';
import { GameClock } from '../managers/game-state/game-clock';

/** Sub-step length the game loop hands the bot (GameClock.FIXED_STEP_MS). */
const STEP_MS = GameClock.FIXED_STEP_MS;

/** The corridor build of the location, as MainWorldService.corridorPending tells it. */
const corridor = { building: false };

/**
 * The injector a session is built in: the stores, the simulation's bus and
 * a mirror with `players` (the first at this client, `ready` or not).
 */
function sessionInjector(phase: string, options: { bus?: GameEventBus; players?: string[]; ready?: boolean; sim?: object } = {}): Injector {
  const players = options.players ?? ['local'];
  const mirror = new SimMirror();
  mirror.applyState(packet({ scalars: { players, localPlayerId: players[0], credits: players.map(() => 0), ready: players.map(() => options.ready ?? false) } }));
  return Injector.create({
    providers: [
      { provide: StateSnapshotService, useValue: {} },
      { provide: TowerDefenseStore, useValue: { phase: signal(phase), spawnPoints: signal([]) } },
      { provide: GameStore, useValue: { setGameSpeed: vi.fn() } },
      { provide: SimClient, useValue: options.sim ?? { bus: options.bus ?? new GameEventBus() } },
      { provide: SimMirror, useValue: mirror },
      { provide: RouteQueriesService, useValue: {} },
      { provide: PathAndRouteService, useValue: { getCachedPaths: () => new Map() } },
      { provide: MainWorldService, useValue: { corridorPending: () => corridor.building } },
    ],
  });
}

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
  const injector = sessionInjector(phase);
  // Der Service ist hier nur Halter der Signale, in die die Session schreibt.
  const client = runInInjectionContext(injector, () => new BotClientService());
  const deps = {} as unknown as BotDeps;
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
    const injector = sessionInjector('wave', { bus });
    const client = runInInjectionContext(injector, () => new BotClientService());
    const deps = {} as unknown as BotDeps;
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
    const injector = sessionInjector('setup');
    const client = runInInjectionContext(injector, () => new BotClientService());
    const restartGame = vi.fn();
    const deps = { callbacks: { restartGame } } as unknown as BotDeps;
    const session = runInInjectionContext(injector, () => new BotSession(client, deps));
    client.botEnabled.set(true);
    return { session, client, restartGame };
  }

  /** applyRunConfig is what the `run_config` message lands in. */
  function apply(session: BotSession, config: Record<string, unknown>) {
    (session as unknown as { applyRunConfig(c: unknown): void }).applyRunConfig(config);
  }

  it('starts the run with the seed the server named, once; a repeat without a config draws its own', () => {
    vi.useFakeTimers();
    const { session, restartGame } = configSession();

    apply(session, { seed: 4242 });
    expect(restartGame).toHaveBeenCalledTimes(1);
    expect(restartGame).toHaveBeenLastCalledWith(4242);

    (session as unknown as { awaitRunConfig(): void }).awaitRunConfig();
    vi.advanceTimersByTime(5000);
    expect(restartGame).toHaveBeenLastCalledWith(undefined);
    vi.useRealTimers();
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

describe('BotSession in a coop room (bot=coop)', () => {
  class WaveBot extends BaseTowerBot {
    decisions = 0;
    constructor() {
      super('expert', { reactionTimeMs: 400 }, 'WaveBot');
    }
    protected decideAction(_state: GameStateSnapshot): TowerAction | null {
      this.decisions++;
      return { type: 'start-wave', reason: 'test' };
    }
  }

  /** A coop bot's session; `players` of the run, `ready` whether the local one said ready */
  function coopSession(players: string[], ready = false) {
    const injector = sessionInjector('setup', { players, ready });
    const client = runInInjectionContext(injector, () => new BotClientService());
    const startWave = vi.fn();
    const deps = { callbacks: { startWave } } as unknown as BotDeps;
    const session = runInInjectionContext(injector, () => new BotSession(client, deps));
    const bot = new WaveBot();
    (session as unknown as { currentBot: ITowerBot | null }).currentBot = bot;
    client.botEnabled.set(true);
    client.botCoop.set(true);
    return { session, bot, startWave };
  }

  it('does nothing in the single player game of the lobby', () => {
    const { session, bot } = coopSession(['local']);
    session.updateBot(() => ({}) as GameStateSnapshot, STEP_MS);
    expect(bot.decisions).toBe(0);
  });

  it('says ready through the wave button once the room plays', () => {
    const { session, startWave } = coopSession(['host', 'guest']);
    session.updateBot(() => ({ player: {} }) as GameStateSnapshot, STEP_MS);
    expect(startWave).toHaveBeenCalledTimes(1);
  });

  it('does not take a ready back: the button toggles', () => {
    const { session, bot, startWave } = coopSession(['host', 'guest'], true);
    session.updateBot(() => ({ player: {} }) as GameStateSnapshot, STEP_MS);
    expect(bot.decisions).toBe(1);
    expect(startWave).not.toHaveBeenCalled();
  });
});

describe('BotSession waits for the packet of its last command', () => {
  /** The simulation as the session sees it: commands queue, a call answers when resolved, packets come in */
  function waitingSession() {
    let queued = 0;
    let received = 0;
    let answer: (() => void) | null = null;
    const frames = new Set<(p: { frame: number }) => void>();
    const sim = {
      bus: new GameEventBus(),
      get queuedCommands() { return queued; },
      get receivedFrame() { return received; },
      runEpoch: 1,
      rpc: () => new Promise<void>((resolve) => { answer = resolve; }),
      onFrame: (listener: (p: { frame: number }) => void) => { frames.add(listener); return () => frames.delete(listener); },
    };
    const injector = sessionInjector('wave', { sim });
    const client = runInInjectionContext(injector, () => new BotClientService());
    const session = runInInjectionContext(injector, () => new BotSession(client, {} as unknown as BotDeps));
    const bot = new TestBot();
    (session as unknown as { currentBot: ITowerBot | null }).currentBot = bot;
    client.botEnabled.set(true);
    // Every decision gives a command, as a placement does
    (session as unknown as { executeBotAction: () => void }).executeBotAction = () => { queued++; };
    const packetIn = (frame: number) => { received = frame; };
    const packetApplied = (frame: number) => { for (const f of [...frames]) f({ frame }); };
    const answered = async () => { answer?.(); await Promise.resolve(); await Promise.resolve(); };
    return { session, bot, packetIn, packetApplied, answered };
  }

  it('decides again only after a packet that came after the command ran', async () => {
    const { session, bot, packetIn, packetApplied, answered } = waitingSession();
    const snapshot = () => ({}) as GameStateSnapshot;
    const decide = () => session.updateBot(snapshot, 1000);

    decide();
    expect(bot.decisionCount).toBe(1);
    // Speed 75: the reaction time is over every frame, yet nothing is decided on the old state
    packetIn(5);
    packetApplied(5);
    decide();
    expect(bot.decisionCount).toBe(1);

    // The call answers: packet 5 came before the command ran, the next one after
    await answered();
    packetApplied(5);
    decide();
    expect(bot.decisionCount).toBe(1);
    packetIn(6);
    packetApplied(6);
    decide();
    expect(bot.decisionCount).toBe(2);
  });

  it('lets go of the wait on reset', () => {
    const { session, bot } = waitingSession();
    const snapshot = () => ({}) as GameStateSnapshot;
    session.updateBot(snapshot, 1000);
    session.resetBot();
    session.updateBot(snapshot, 1000);
    expect(bot.decisionCount).toBe(2);
  });
});
