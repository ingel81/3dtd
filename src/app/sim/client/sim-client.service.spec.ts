import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Injector } from '@angular/core';
import { EARLY_TICK_MS, SimClient, earlyTickParam } from './sim-client.service';
import { GameStore } from '../../store/game.store';
import type { SimTransport, SimTransportHandlers } from './transport';
import type { SimMirrorApi, SimPresenterApi } from './contracts';
import type { SimFramePacket } from '../protocol/packet';
import type { ExportedEvent } from '../protocol/events';
import type { SimRpc, SimTickInput } from '../protocol/messages';
import type { LockstepLink } from '../../coop/lockstep';
import type { ViewEvent } from './view-events';

/** A transport that records what the client sends and answers when told to */
class FakeTransport implements SimTransport {
  concurrent = false;
  readonly ticks: SimTickInput[] = [];
  readonly rpcs: [keyof SimRpc, unknown[]][] = [];
  readonly configs: unknown[] = [];
  throwOnTick: Error | null = null;
  constructor(readonly handlers: SimTransportHandlers) {}
  configure(config: unknown): void {
    this.configs.push(config);
  }
  loadWorld(): void {
    /* the world is taken */
  }
  claim(): boolean {
    return true;
  }
  release(): void {
    /* nothing held */
  }
  tick(input: SimTickInput): void {
    if (this.throwOnTick) throw this.throwOnTick;
    this.ticks.push(input);
  }
  rpc(method: keyof SimRpc, args: unknown[]): Promise<unknown> {
    this.rpcs.push([method, args]);
    return Promise.resolve(null);
  }
  dispose(): void {
    /* nothing held */
  }
}

function packet(events: ExportedEvent[] = [], gameTimeMs = 0, tickMs = 1): SimFramePacket {
  return { events, ops: [], scalars: { gameTimeMs, tickMs } } as unknown as SimFramePacket;
}

const event = (type: string): ExportedEvent => ({ type, payload: {}, live: true, show: true });

function setup() {
  const client = Injector.create({
    providers: [
      { provide: GameStore, useFactory: () => new GameStore(), deps: [] },
      { provide: SimClient, useFactory: () => new SimClient(), deps: [] },
    ],
  }).get(SimClient);
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
  return { client, mirror, presenter, transport: () => transport, seen, frame };
}

describe('SimClient', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => undefined));

  describe('a failed simulation', () => {
    it('stops ticking for good when the worker reports an error, and says so once', async () => {
      const { client, transport, frame } = setup();
      const failed = vi.fn();
      client.onFailure(failed);
      frame();
      expect(transport().ticks).toHaveLength(1);

      // The tick in flight threw in the worker: no packet comes back for it
      transport().handlers.error('TypeError: x is undefined\n  at tick');
      transport().handlers.error('another');
      frame();
      frame();

      expect(transport().ticks).toHaveLength(1);
      expect(client.failure()).toBe('TypeError: x is undefined');
      expect(failed).toHaveBeenCalledTimes(1);
      await expect(client.rpc('worldKey')).rejects.toThrow('simulation stopped');
      client.configure({ damageNumbers: true });
      expect(transport().configs).toEqual([]);
    });

    it('stops when the same thread simulation throws in its tick, and drops what arrives after', () => {
      const { client, transport, frame, presenter } = setup();
      transport().throwOnTick = new Error('boom');
      frame();
      expect(client.failure()).toBe('boom');
      transport().throwOnTick = null;
      transport().handlers.frame(packet());
      frame();
      expect(transport().ticks).toHaveLength(0);
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

  it('sends the commands given since the last tick ahead of a call, so the call acts on their state', () => {
    const { client, transport, frame } = setup();
    client.bus.emit({ type: 'command:leave-tower' } as ViewEvent);
    void client.rpc('replayEnter', 3, false);

    expect(transport().rpcs.map(([method]) => method)).toEqual(['applyCommands', 'replayEnter']);
    const [, [commands]] = transport().rpcs[0] as [string, [{ command: { type: string } }[]]];
    expect(commands.map((c) => c.command.type)).toEqual(['command:leave-tower']);
    frame();
    expect(transport().ticks[0].commands).toEqual([]);
  });

  describe('a new run', () => {
    it('clears mirror and presentation at once and tells the main thread game:reset', () => {
      const { client, mirror, presenter, seen } = setup();
      client.newRun();
      expect(mirror.clear).toHaveBeenCalled();
      expect(presenter.clear).toHaveBeenCalled();
      expect(seen).toEqual(['game:reset']);
    });

    it('drops the commands and the packet in flight of the old run', () => {
      const { client, transport, frame, seen } = setup();
      frame();
      client.bus.emit({ type: 'command:place-tower' } as ViewEvent);
      client.newRun();
      // The old run's tick answers late: its tower:placed must not reach the new run
      transport().handlers.frame(packet([event('tower:placed')]));
      frame();
      expect(seen).toEqual(['command:place-tower', 'game:reset']);
      expect(transport().ticks[1].commands).toEqual([]);
    });

    it('sends no tick of the new run before the tick of the old run is back, and drops that one', () => {
      const { client, transport, frame, presenter } = setup();
      frame();
      client.newRun();
      client.loadWorld({} as never);
      frame();
      expect(transport().ticks).toHaveLength(1);

      transport().handlers.frame(packet([event('tower:placed')]));
      frame();
      expect(presenter.present).not.toHaveBeenCalled();
      expect(transport().ticks).toHaveLength(2);
      transport().handlers.frame(packet());
      frame();
      expect(presenter.present).toHaveBeenCalledTimes(1);
    });

    it('hands the new world\'s own resets on no second time, everything else as it comes', () => {
      const { client, transport, frame, seen } = setup();
      client.newRun();
      frame();
      transport().handlers.frame(packet([event('game:reset'), event('game:reset'), event('wave:started')]));
      frame();
      transport().handlers.frame(packet([event('game:reset')]));
      frame();
      expect(seen).toEqual(['game:reset', 'wave:started', 'game:reset']);
    });
  });

  describe('a tick longer than a frame (worker with two sets of tables)', () => {
    it('sends the next tick as soon as the packet is back, and applies the packet with the next frame', () => {
      const { transport, frame, presenter } = setup();
      transport().concurrent = true;
      frame();
      transport().handlers.frame(packet([], 0, 40));
      expect(transport().ticks).toHaveLength(2);
      expect(presenter.present).not.toHaveBeenCalled();
      frame();
      expect(presenter.present).toHaveBeenCalledTimes(1);
      expect(transport().ticks).toHaveLength(2);
    });

    it('waits for the frame while the packet before is not applied: its tables would be written over', () => {
      const { transport, frame, presenter } = setup();
      transport().concurrent = true;
      frame();
      transport().handlers.frame(packet([], 0, 40));
      transport().handlers.frame(packet([], 16, 40));
      expect(transport().ticks).toHaveLength(2);
      frame();
      expect(presenter.present).toHaveBeenCalledTimes(2);
      expect(transport().ticks).toHaveLength(3);
    });

    it('keeps to the frame when the tick is shorter than one, or the tables are copies', () => {
      const short = setup();
      short.transport().concurrent = true;
      short.frame();
      short.transport().handlers.frame(packet([], 0, 2));
      expect(short.transport().ticks).toHaveLength(1);

      const copies = setup();
      copies.frame();
      copies.transport().handlers.frame(packet([], 0, 40));
      expect(copies.transport().ticks).toHaveLength(1);
    });
  });

  it('tells the link when its own commands ran in the simulation, not when their tick went out', () => {
    const { client, transport, frame } = setup();
    const link = { confirmedTick: vi.fn(() => 0), commandsAt: vi.fn(() => []), release: vi.fn(), commandsRan: vi.fn() };
    client.setLockstep(link as unknown as LockstepLink);
    frame();
    expect(link.commandsRan).not.toHaveBeenCalled();
    transport().handlers.output({ kind: 'lockstep-ran', count: 2 });
    expect(link.commandsRan).toHaveBeenCalledWith(2);
  });

  it('forgets lockstep, replay and the failure on a restart', () => {
    const { client, transport } = setup();
    const link = { confirmedTick: vi.fn(() => 0), commandsAt: vi.fn(() => []), release: vi.fn() };
    client.setLockstep(link as unknown as LockstepLink);
    client.replay = { playing: true, speed: 2 };
    transport().handlers.error('boom');

    client.stop();
    client.start((handlers) => new FakeTransport(handlers));
    expect(client.failure()).toBeNull();
    expect(client.replay).toBeNull();
    client.loadWorld({} as never);
    client.frame(16, false);
    expect(link.confirmedTick).not.toHaveBeenCalled();
  });
});

describe('earlyTickParam (TODO E72)', () => {
  it('takes whole ms from 0 to 1000 and off, else the default', () => {
    expect(earlyTickParam('?earlyTick=20')).toBe(20);
    expect(earlyTickParam('?earlyTick=0')).toBe(0);
    expect(earlyTickParam('?earlyTick=off')).toBe(Infinity);
    for (const bad of ['', '?earlyTick=', '?earlyTick=-1', '?earlyTick=2.5', '?earlyTick=1001', '?earlyTick=x']) {
      expect(earlyTickParam(bad)).toBe(EARLY_TICK_MS);
    }
  });
});
