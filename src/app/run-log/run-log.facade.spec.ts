import '@angular/compiler';
import { getTestBed, TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GameEventBus } from '../game-engine/game-event-bus';
import { SimClient } from '../sim/client/sim-client.service';
import { SimMirror } from '../sim/client/mirror/sim-mirror';
import { LocationManagementService } from '../services/location/location-management.service';
import { DevWorldService } from '../devworld/devworld.service';
import { RunLogFacade } from './run-log.facade';
import type { RunLogHead } from './run-log.types';

/**
 * When a run opens: with the new run's first packet, not at game:reset. On a
 * new place SimClient.newRun hands game:reset on with the mirror cleared
 * (seed 0, no credits, no HQ), seconds before the new world's first packet.
 */
describe('RunLogFacade opens a run with the first packet of the run', () => {
  let bus: GameEventBus;
  let frames: (() => void)[];
  let scalars: { seed: number; baseHealth: number; enemiesAlive: number };
  let credits: number;
  let facade: RunLogFacade;

  beforeAll(() => {
    getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });
  afterEach(() => TestBed.resetTestingModule());

  /** A packet applied: the mirror holds its numbers, then the frame listeners run (SimClient.apply) */
  const packet = (seed: number, hq: number, gold: number) => {
    scalars = { seed, baseHealth: hq, enemiesAlive: 0 };
    credits = gold;
    for (const frame of frames) frame();
  };

  beforeEach(() => {
    bus = new GameEventBus();
    frames = [];
    scalars = { seed: 0, baseHealth: 0, enemiesAlive: 0 };
    credits = 0;
    const mirror = {
      get scalars() { return scalars; },
      localPlayerId: 'local',
      subStep: 0,
      gameTimeMs: 0,
      players: ['local'],
      creditsOf: () => credits,
      towers: () => [],
      towersOf: () => [],
      killCreditPlayer: () => 'local',
      abilityDamageOf: () => 0,
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: SimClient, useValue: { bus, onFrame: (listener: () => void) => { frames.push(listener); return () => true; } } },
        { provide: SimMirror, useValue: mirror },
        { provide: LocationManagementService, useValue: { editableHqLocation: () => null } },
        { provide: DevWorldService, useValue: { isActive: true } },
      ],
    });
    facade = TestBed.inject(RunLogFacade);
  });

  const head = () => facade.current()?.head as RunLogHead | undefined;

  it('the first run: no run before a packet came, then its seed', () => {
    facade.initialize();
    expect(facade.current()).toBeNull();
    packet(4242, 500, 100);
    expect(head()?.seed).toBe(4242);
  });

  it('a new place: the reset of the cleared mirror opens nothing, the first packet of the new world does', () => {
    facade.initialize();
    packet(1, 500, 100);
    const first = facade.current();

    // SimClient.newRun: the mirror cleared, game:reset handed on at once
    scalars = { seed: 0, baseHealth: 0, enemiesAlive: 0 };
    credits = 0;
    bus.emit({ type: 'game:reset' });
    // The world loads; its first packet brings the reset of the credits
    bus.emit({ type: 'credits:changed', delta: 100, credits: 100, source: 'reset', local: true, playerId: 'local' } as never);
    packet(7, 500, 100);

    expect(facade.current()).not.toBe(first);
    expect(head()?.seed).toBe(7);
    // Wave 1 starts at the new run's credits, and the reset is no income of it
    bus.emit({ type: 'wave:started', waveNumber: 1 } as never);
    bus.emit({ type: 'wave:completed', waveNumber: 1 } as never);
    const wave = facade.current()!.records.find((r) => r.kind === 'wave') as { creditsStart: number; income: Record<string, number> } | undefined;
    expect(wave?.creditsStart).toBe(100);
    expect(wave?.income['reset']).toBeUndefined();
  });

  it('notes a boss through the portal, the worm by its chain too', () => {
    facade.initialize();
    packet(1, 500, 100);
    bus.emit({ type: 'wave:started', waveNumber: 30 } as never);
    bus.emit({ type: 'worm:spawned', head: { typeConfig: { id: 'worm', isBoss: true } }, group: {}, viaPortal: true } as never);
    bus.emit({ type: 'worm:spawned', head: { typeConfig: { id: 'worm', isBoss: true } }, group: {}, viaPortal: false } as never);
    bus.emit({ type: 'enemy:spawned', enemy: { id: 'e1', typeConfig: { id: 'herbert', isBoss: true } }, viaPortal: true } as never);
    const bosses = facade.current()!.records.filter((r) => r.kind === 'event' && (r as { event: string }).event === 'boss-spawned');
    expect(bosses.map((r) => (r as { id?: string }).id)).toEqual(['worm', 'herbert']);
  });
});
