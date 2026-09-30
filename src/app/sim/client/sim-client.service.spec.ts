import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Injector } from '@angular/core';
import { SimClient } from './sim-client.service';
import { GameStore } from '../../store/game.store';
import type { SimTransport, SimTransportHandlers } from './transport';
import type { SimMirrorApi, SimPresenterApi } from './contracts';
import type { SimFramePacket } from '../protocol/packet';
import type { ExportedEvent } from '../protocol/events';
import type { SimInput, SimRpc } from '../protocol/messages';
import type { LockstepLink } from '../../coop/lockstep';
import type { ViewEvent } from './view-events';

/** A transport that records what the client sends; the spec plays the simulation (publish) */
class FakeTransport implements SimTransport {
  readonly inputs: SimInput[] = [];
  readonly rpcs: [keyof SimRpc, unknown[]][] = [];
  readonly configs: unknown[] = [];
  /** Every message in the order sent, by kind */
  readonly sent: string[] = [];
  run = 0;
  throwOnFrame: Error | null = null;
  constructor(readonly handlers: SimTransportHandlers) {}
  configure(config: unknown): void {
    this.configs.push(config);
  }
  loadWorld(): void {
    this.sent.push('world');
  }
  unloadWorld(): void {
    this.sent.push('unload');
  }
  epoch(epoch: number): void {
    this.sent.push('epoch');
    this.run = epoch;
  }
  claim(): boolean {
    return true;
  }
  release(): void {
    /* nothing held */
  }
  input(input: SimInput): void {
    this.sent.push('input');
    this.inputs.push(input);
  }
  frame(): void {
    if (this.throwOnFrame) throw this.throwOnFrame;
  }
  rpc(method: keyof SimRpc, args: unknown[]): Promise<unknown> {
    this.sent.push(`rpc ${method}`);
    this.rpcs.push([method, args]);
    return Promise.resolve(null);
  }
  dispose(): void {
    /* nothing held */
  }
  /** The simulation publishes `packet` in the run it was last told */
  publish(packet: SimFramePacket, epoch = this.run): void {
    this.handlers.frame(packet, epoch);
  }
}

function packet(events: ExportedEvent[] = [], gameTimeMs = 0, tickMs = 1): SimFramePacket {
  return {
    events, ops: [], towerStates: [], removedTowers: [], stepsRun: 1, presented: true, scalars: { gameTimeMs, tickMs },
  } as unknown as SimFramePacket;
}

const event = (type: string): ExportedEvent => ({ type, payload: {}, live: true, show: true });

function setup() {
  const injector = Injector.create({
    providers: [
      { provide: GameStore, useFactory: () => new GameStore(), deps: [] },
      { provide: SimClient, useFactory: () => new SimClient(), deps: [] },
    ],
  });
  const client = injector.get(SimClient);
  const store = injector.get(GameStore);
  const mirror = {
    scalars: { localPlayerId: 'p1' },
    applyState: vi.fn(),
    importEvent: vi.fn((e: ExportedEvent) => ({ type: e.type }) as ViewEvent),
    afterFrame: vi.fn(),
    clear: vi.fn(),
  };
  const presenter = { applyOps: vi.fn(), present: vi.fn(), advance: vi.fn(), clear: vi.fn() };
  client.attach(mirror as unknown as SimMirrorApi, presenter as unknown as SimPresenterApi);
  let transport!: FakeTransport;
  client.start((handlers) => (transport = new FakeTransport(handlers)));
  client.loadWorld({} as never);
  const seen: string[] = [];
  client.bus.onAny((e) => seen.push(e.type));
  let now = 0;
  const frame = () => client.frame((now += 16), false);
  return { client, store, mirror, presenter, transport: () => transport, seen, frame };
}

describe('SimClient', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => undefined));

  describe('a failed simulation', () => {
    it('sends nothing further for good when the worker reports an error, and says so once', async () => {
      const { client, transport, frame } = setup();
      const failed = vi.fn();
      client.onFailure(failed);
      frame();
      expect(transport().inputs).toHaveLength(1);

      transport().handlers.error('TypeError: x is undefined\n  at pass');
      transport().handlers.error('another');
      client.bus.emit({ type: 'command:leave-tower' } as ViewEvent);
      frame();
      frame();

      expect(transport().inputs).toHaveLength(1);
      expect(client.failure()).toBe('TypeError: x is undefined');
      expect(failed).toHaveBeenCalledTimes(1);
      await expect(client.rpc('worldKey')).rejects.toThrow('simulation stopped');
      client.configure({ damageNumbers: true });
      expect(transport().configs).toEqual([]);
    });

    it('stops when the same thread simulation throws in its pass, and drops what arrives after', () => {
      const { client, transport, frame, presenter } = setup();
      transport().throwOnFrame = new Error('boom');
      frame();
      expect(client.failure()).toBe('boom');
      transport().throwOnFrame = null;
      transport().publish(packet());
      frame();
      expect(transport().inputs).toHaveLength(1);
      expect(presenter.present).not.toHaveBeenCalled();
    });

    it('lets the coop lockstep go: no delivery waits for this seat', () => {
      const { client, transport, frame } = setup();
      const link = { confirmedTick: vi.fn(() => 3), commandsAt: vi.fn(() => []), release: vi.fn() };
      client.setLockstep(link as unknown as LockstepLink);
      transport().handlers.error('worker: failed to load');
      frame();
      expect(link.confirmedTick).not.toHaveBeenCalled();
    });
  });

  describe('the input', () => {
    it('goes with the first frame, and after that only when something changed', () => {
      const { client, store, transport, frame } = setup();
      frame();
      frame();
      expect(transport().inputs).toEqual([
        { gameSpeed: 1, paused: false, renderingEnabled: false, replay: null, commands: [], lockstep: null },
      ]);

      store.gameSpeed.set(4);
      frame();
      store.paused.set(true);
      frame();
      frame();
      expect(transport().inputs.slice(1).map((i) => [i.gameSpeed, i.paused])).toEqual([[4, false], [4, true]]);

      // The replay UI changes its object in place
      client.replay = { playing: true, speed: 2 };
      frame();
      client.replay.playing = false;
      frame();
      frame();
      expect(transport().inputs.slice(3).map((i) => i.replay)).toEqual([{ playing: true, speed: 2 }, { playing: false, speed: 2 }]);
    });

    it('carries the commands given since the last one, in order, once', () => {
      const { client, transport, frame } = setup();
      frame();
      client.bus.emit({ type: 'command:leave-tower' } as ViewEvent);
      client.bus.emit({ type: 'debug:add-credits' } as ViewEvent);
      // Not an input of the player: an event of the simulation
      client.bus.emit({ type: 'tower:placed' } as ViewEvent);
      frame();
      frame();
      expect(transport().inputs).toHaveLength(2);
      expect(transport().inputs[1].commands).toEqual([
        { playerId: 'p1', command: { type: 'command:leave-tower' } },
        { playerId: 'p1', command: { type: 'debug:add-credits' } },
      ]);
    });

    it('waits for the world: commands given before it go with the first frame after', () => {
      const { client, transport, frame } = setup();
      client.newRun();
      client.bus.emit({ type: 'command:leave-tower' } as ViewEvent);
      frame();
      expect(transport().inputs).toHaveLength(0);
      client.loadWorld({} as never);
      frame();
      expect(transport().inputs[0].commands).toHaveLength(1);
    });

    it('hands the relay the ticks it closed since the last input, and nothing while it closed none', () => {
      const { client, transport, frame } = setup();
      let confirmed = -1;
      const link = { confirmedTick: () => confirmed, commandsAt: (tick: number) => [`c${tick}`], release: vi.fn() };
      client.setLockstep(link as unknown as LockstepLink, 3);
      expect(transport().configs).toEqual([{ lockstep: { hashEvery: 3 } }]);
      frame();
      expect(transport().inputs[0].lockstep).toBeNull();

      confirmed = 1;
      frame();
      frame();
      confirmed = 2;
      frame();
      expect(transport().inputs.slice(1).map((i) => i.lockstep)).toEqual([
        { confirmedTick: 1, ticks: [{ tick: 0, commands: ['c0'] }, { tick: 1, commands: ['c1'] }] },
        { confirmedTick: 2, ticks: [{ tick: 2, commands: ['c2'] }] },
      ]);
      expect(link.release.mock.calls.map(([tick]) => tick)).toEqual([0, 1, 2]);
    });
  });

  it('sends what changed since the last frame ahead of a call, so the call acts on the state the commands leave', () => {
    const { client, transport, frame } = setup();
    frame();
    client.bus.emit({ type: 'command:leave-tower' } as ViewEvent);
    void client.rpc('replayEnter', 3, false);

    expect(transport().sent.slice(-2)).toEqual(['input', 'rpc replayEnter']);
    expect(transport().inputs[1].commands.map((c) => c.command.type)).toEqual(['command:leave-tower']);
    frame();
    expect(transport().inputs).toHaveLength(2);
  });

  describe('a new run', () => {
    it('clears mirror and presentation at once and tells the main thread game:reset', () => {
      const { client, mirror, presenter, seen } = setup();
      client.newRun();
      expect(mirror.clear).toHaveBeenCalled();
      expect(presenter.clear).toHaveBeenCalled();
      expect(seen).toEqual(['game:reset']);
    });

    it('has the simulation let its world go before it takes the new epoch, and sends nothing until the next world', () => {
      const { client, transport, frame } = setup();
      frame();
      const before = transport().run;
      client.newRun();
      frame();
      expect(transport().sent).toEqual(['epoch', 'world', 'input', 'unload', 'epoch']);
      expect(transport().run).toBe(before + 1);
      expect(client.hasWorld).toBe(false);
    });

    it('drops the commands and the packets on their way of the old run', () => {
      const { client, transport, frame, seen, presenter } = setup();
      frame();
      const old = transport().run;
      client.bus.emit({ type: 'command:place-tower' } as ViewEvent);
      client.newRun();
      client.loadWorld({} as never);
      // Published before the simulation heard of the new run: its tower:placed must not reach it
      transport().publish(packet([event('tower:placed')]), old);
      frame();
      expect(seen).toEqual(['command:place-tower', 'game:reset']);
      expect(presenter.present).not.toHaveBeenCalled();
      expect(transport().inputs.every((input) => input.commands.length === 0)).toBe(true);

      transport().publish(packet());
      frame();
      expect(presenter.present).toHaveBeenCalledTimes(1);
    });

    it('hands the new world\'s own resets on no second time, everything else as it comes', () => {
      const { client, transport, frame, seen } = setup();
      client.newRun();
      client.loadWorld({} as never);
      frame();
      transport().publish(packet([event('game:reset'), event('game:reset'), event('wave:started')]));
      frame();
      transport().publish(packet([event('game:reset')]));
      frame();
      expect(seen).toEqual(['game:reset', 'wave:started', 'game:reset']);
    });
  });

  describe('the packets the simulation published since the last frame', () => {
    it('wait for the frame and are applied as one, every event in order', () => {
      const { transport, frame, presenter, seen } = setup();
      frame();
      transport().publish(packet([event('wave:started')], 0));
      transport().publish(packet([event('enemy:killed')], 16));
      transport().publish(packet([event('enemy:killed')], 32));
      expect(presenter.present).not.toHaveBeenCalled();
      frame();
      expect(presenter.present).toHaveBeenCalledTimes(1);
      expect(seen).toEqual(['wave:started', 'enemy:killed', 'enemy:killed']);
      // A frame without a packet applies nothing
      frame();
      expect(presenter.present).toHaveBeenCalledTimes(1);
    });

    it('stay for the next frame while the tables of the newest are written again', () => {
      const { transport, frame, presenter } = setup();
      frame();
      transport().publish(packet());
      transport().claim = () => false;
      frame();
      expect(presenter.present).not.toHaveBeenCalled();
      transport().claim = () => true;
      frame();
      expect(presenter.present).toHaveBeenCalledTimes(1);
    });
  });

  it('tells the link when its own commands ran in the simulation, not when their input went out', () => {
    const { client, transport, frame } = setup();
    const link = { confirmedTick: vi.fn(() => 0), commandsAt: vi.fn(() => []), release: vi.fn(), commandsRan: vi.fn() };
    client.setLockstep(link as unknown as LockstepLink);
    frame();
    expect(link.commandsRan).not.toHaveBeenCalled();
    transport().handlers.output({ kind: 'lockstep-ran', count: 2 });
    expect(link.commandsRan).toHaveBeenCalledWith(2);
  });

  it('forgets lockstep, replay and the failure on a restart, and tells the new simulation its epoch', () => {
    const { client, transport } = setup();
    const link = { confirmedTick: vi.fn(() => 0), commandsAt: vi.fn(() => []), release: vi.fn() };
    client.setLockstep(link as unknown as LockstepLink);
    client.replay = { playing: true, speed: 2 };
    transport().handlers.error('boom');
    const before = transport().run;

    client.stop();
    let next!: FakeTransport;
    client.start((handlers) => (next = new FakeTransport(handlers)));
    expect(client.failure()).toBeNull();
    expect(client.replay).toBeNull();
    expect(next.run).toBeGreaterThan(before);
    client.loadWorld({} as never);
    client.frame(16, false);
    expect(link.confirmedTick).not.toHaveBeenCalled();
    // A fresh simulation knows no settings yet: they go again
    expect(next.inputs).toHaveLength(1);
  });
});
