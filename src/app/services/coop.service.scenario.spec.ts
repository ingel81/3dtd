/**
 * CoopService end to end over a real relay (docs/COOP_PLAN.md, review R21):
 * a host and a guest, each a CoopService of its own on real sockets, the
 * relay of `npm run coop-server` on a free port. The game, the map and the
 * engine are fakes; the world package is a stand-in that says which place
 * and spawns it is. What it pins: opening and joining a room, the lane each
 * player gets by itself, the start once the guest is ready, the host's
 * rights (take out, close), the room's options, the system lines of the
 * chat, a relay that is not there, and
 * going on alone after the connection broke.
 */
// The service is partially compiled and needs the JIT compiler
import '@angular/compiler';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { EnvironmentInjector, Injector, signal } from '@angular/core';
import { getTestBed, TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { WebSocket as WsSocket } from 'ws';
import { startRelay, type RelayServer } from '../../../coop-server/src/server';
import { GameEventBus } from '../game-engine/game-event-bus';
import { withAutoStubs } from '../integration/test-helpers';

// The game's services as bare tokens: the fakes below stand in for them
vi.mock('../managers/game-state.manager', () => ({ GameStateManager: class {} }));
vi.mock('../core/services/config.service', () => ({ ConfigService: class {} }));
vi.mock('../store/game.store', () => ({ GameStore: class {} }));
vi.mock('../store/ui.store', () => ({ UIStore: class {} }));
vi.mock('./infrastructure/engine-initialization.service', () => ({ EngineInitializationService: class {} }));
vi.mock('./location/location-management.service', () => ({ LocationManagementService: class {} }));
vi.mock('./location/url-location.service', () => ({ UrlLocationService: class {} }));
vi.mock('./world/path-route.service', () => ({ PathAndRouteService: class {} }));
vi.mock('./facade/location-facade.service', () => ({ LocationFacadeService: class {} }));
vi.mock('./location/location-change-coordinator.service', () => ({ LocationChangeCoordinatorService: class {} }));
vi.mock('./input-handler.service', () => ({ InputHandlerService: class {} }));
vi.mock('../run-log/run-log.facade', () => ({ RunLogFacade: class {} }));
// A world package that only says where it is: the host's HQ, the spawns
vi.mock('../coop/world-package', () => ({
  buildWorldPackage: (source: { hq?: { lat: number; lon: number } }, head: object) =>
    ({ ...head, hq: source.hq ?? HQ, spawns: SPAWNS, worldKey: 'k', heights: [] }),
  readWorldPackage: (json: string) => ({ world: JSON.parse(json) }),
  packagePaths: () => new Map(),
  worldPackageRefusalText: () => 'refused',
}));

import { CoopService } from './coop.service';
import { GameStateManager } from '../managers/game-state.manager';
import { ConfigService } from '../core/services/config.service';
import { GameStore } from '../store/game.store';
import { UIStore } from '../store/ui.store';
import { EngineInitializationService } from './infrastructure/engine-initialization.service';
import { LocationManagementService } from './location/location-management.service';
import { UrlLocationService } from './location/url-location.service';
import { PathAndRouteService } from './world/path-route.service';
import { LocationFacadeService } from './facade/location-facade.service';
import { LocationChangeCoordinatorService } from './location/location-change-coordinator.service';
import { InputHandlerService } from './input-handler.service';
import { RunLogFacade } from '../run-log/run-log.facade';

const HQ = { lat: 48.7758, lon: 9.1829 };
const SPAWNS = [
  { id: 'spawn-1', name: 'North', lat: 48.785, lon: 9.183 },
  { id: 'spawn-2', name: 'South', lat: 48.767, lon: 9.182 },
];

/** One player's CoopService on fakes of the game */
function player(relayPort: number) {
  localStorage.setItem('3dtd-coop-relay', `ws://localhost:${relayPort}`);
  const hq = signal(HQ);
  const bus = new GameEventBus();
  const gsm = withAutoStubs({
    getEventBus: () => bus,
    getSpawnPoints: () => SPAWNS,
    worldSource: () => ({ hq: hq() }),
    worldKey: () => 'k',
    corridorPending: () => false,
    getCachedPaths: () => new Map(),
    getGlobalRouteGrid: () => withAutoStubs({}),
    creditsOf: () => 100,
    stateHash: () => 1,
    players: [] as string[],
    lockstepActive: false,
    towerManager: withAutoStubs({ getById: () => null }),
    setPlayers: vi.fn((players: string[]) => { gsm.players = [...players]; }),
  });
  // Going to another place in the page lands where it was asked to
  const locationChange = { applyNewLocation: vi.fn(async (data: { hq: { lat: number; lon: number } }) => hq.set({ lat: data.hq.lat, lon: data.hq.lon })) };
  const injector = Injector.create({
    parent: TestBed.inject(EnvironmentInjector),
    providers: [
      CoopService,
      { provide: GameStateManager, useValue: gsm },
      { provide: ConfigService, useValue: { coopRelay: signal(null), needsCredentials: signal(false) } },
      { provide: GameStore, useValue: { gameSpeed: signal(1), paused: signal(false) } },
      { provide: UIStore, useValue: { coopMapLocked: signal(false), notice: signal<string | null>(null) } },
      { provide: EngineInitializationService, useValue: { getEngine: () => ({}), loading: () => false } },
      { provide: LocationManagementService, useValue: { hq, spawns: signal(SPAWNS.map(({ lat, lon }) => ({ lat, lon }))) } },
      { provide: UrlLocationService, useValue: { urlFor: () => '/?l=48.7758,9.1829' } },
      { provide: PathAndRouteService, useValue: withAutoStubs({}) },
      { provide: LocationFacadeService, useValue: withAutoStubs({ addRandomSpawn: vi.fn(async () => true) }) },
      { provide: LocationChangeCoordinatorService, useValue: locationChange },
      { provide: InputHandlerService, useValue: withAutoStubs({}) },
      { provide: RunLogFacade, useValue: { collector: withAutoStubs({}) } },
    ],
  });
  return { coop: injector.get(CoopService), gsm, hq, locationChange };
}

/** Wait for `ok`, flushing effects, up to 3 s */
async function until(ok: () => boolean): Promise<void> {
  const end = Date.now() + 3000;
  while (!ok()) {
    if (Date.now() > end) throw new Error('timed out');
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

describe('CoopService over a real relay (review R21)', () => {
  let relay: RelayServer | null = null;

  beforeAll(() => {
    getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
    // The sockets of the ws package, as the relay has them: jsdom's events
    // and Node's own WebSocket do not mix
    vi.stubGlobal('WebSocket', WsSocket);
  });

  afterEach(async () => {
    await relay?.close();
    relay = null;
    TestBed.resetTestingModule();
    localStorage.clear();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Host with a room, guest in it, both on a lane */
  async function lobby() {
    relay = await startRelay({ port: 0 });
    const host = player(relay.port);
    const guest = player(relay.port);
    await host.coop.host('Ann');
    await until(() => host.coop.room() !== null && host.coop.worldReady());
    await guest.coop.join('Bob', host.coop.room()!.code);
    const lanes = () => host.coop.room()!.players.map((p) => p.spawnId);
    await until(() => lanes().length === 2 && lanes().every((lane) => lane !== null));
    return { host, guest };
  }

  it('opens a room, lets a guest in and gives each a lane of their own', async () => {
    const { host, guest } = await lobby();
    const room = host.coop.room()!;
    expect(room.players.map((p) => p.name)).toEqual(['Ann', 'Bob']);
    expect(new Set(room.players.map((p) => p.spawnId))).toEqual(new Set(['spawn-1', 'spawn-2']));
    expect(host.coop.isHost()).toBe(true);
    expect(guest.coop.isHost()).toBe(false);
    await until(() => host.coop.chat().some((line) => line.from === null && line.text === 'Bob joined'));
  });

  it('starts once the guest is ready, with the roster and the relay’s lockstep on both', async () => {
    const { host, guest } = await lobby();
    guest.coop.setLobbyReady(true);
    await until(() => host.coop.room()!.players.find((p) => p.name === 'Bob')!.ready);
    host.coop.start();
    await until(() => host.coop.inGame() && guest.coop.inGame());
    expect(guest.coop.roster().map((p) => p.name)).toEqual(['Ann', 'Bob']);
    expect(guest.gsm.setLockstep).toHaveBeenCalledWith(expect.objectContaining({ playerId: guest.coop.playerId() }));
    expect(guest.gsm.players).toEqual(host.gsm.players);
  });

  it('lets the host take a guest out and close the room', async () => {
    const { host, guest } = await lobby();
    host.coop.kick(guest.coop.playerId()!);
    await until(() => guest.coop.room() === null);
    expect(guest.coop.error()).toBe('The host took you out of the room.');
    host.coop.setLocked(true);
    await until(() => host.coop.room()!.locked);
    const late = player(relay!.port);
    await late.coop.join('Carl', host.coop.room()!.code);
    expect(late.coop.error()).toBe('The host closed the room to new players.');
  });

  it('tells the guest at once when the host changes the map (PLAYTEST T25)', async () => {
    const { host, guest } = await lobby();
    host.hq.set({ lat: 48.78, lon: 9.19 });
    await until(() => guest.coop.hostChangingMap());
    await until(() => guest.coop.chat().some((line) => line.text === 'Ann is changing the map, it comes here next'));
  });

  it('follows the host to a new place in the page, without a reload (TODO E27)', async () => {
    const { host, guest } = await lobby();
    const place = { lat: 48.78, lon: 9.19 };
    host.hq.set(place);
    await until(() => guest.locationChange.applyNewLocation.mock.calls.length > 0);
    expect(guest.locationChange.applyNewLocation.mock.calls[0][0].hq).toMatchObject(place);
    await until(() => guest.coop.worldReady() && guest.hq().lat === place.lat);
    expect(guest.coop.room()?.code).toBe(host.coop.room()!.code);
    await until(() => host.coop.room()!.players.find((p) => p.name === 'Bob')!.status === 'ready');
  });

  it('takes the options from the host, asks the guest for ready again and tells both in the chat (D38)', async () => {
    const { host, guest } = await lobby();
    guest.coop.setLobbyReady(true);
    await until(() => host.coop.room()!.players.find((p) => p.name === 'Bob')!.ready);
    guest.coop.setOption('pause', 'all');
    host.coop.setOption('pause', 'all');
    await until(() => guest.coop.options().pause === 'all');
    expect(guest.coop.room()!.players.find((p) => p.name === 'Bob')!.ready).toBe(false);
    for (const side of [host, guest]) {
      await until(() => side.coop.chat().some((line) => line.from === null && line.text === 'Ann set Pause: Anyone'));
    }
    expect(guest.coop.mayPause()).toBe(true);
  });

  it('starts without the host saying ready, and hands every client the cheat rule of the room (D38, D40)', async () => {
    const { host, guest } = await lobby();
    guest.coop.setLobbyReady(true);
    await until(() => host.coop.room()!.players.find((p) => p.name === 'Bob')!.ready);
    host.coop.start();
    await until(() => host.coop.inGame() && guest.coop.inGame());
    const rule = vi.mocked(guest.gsm.setCheatRule).mock.lastCall![0]!;
    // Cheats off by default: nobody, the host neither
    expect(rule(host.coop.playerId()!)).toBe(false);
  });

  it("tells the host what the guest's client does, and that its map stands (User, 2026-09-25)", async () => {
    const { host, guest } = await lobby();
    await until(() => host.coop.room()!.players.find((p) => p.name === 'Bob')!.status === 'ready');
    expect(guest.coop.room()!.players.find((p) => p.name === 'Bob')!.status).toBe('ready');
    await until(() => host.coop.chat().some((line) => line.from === null && line.text === "Bob's map stands"));
  });

  it('says so when no relay answers', async () => {
    relay = await startRelay({ port: 0 });
    const port = relay.port;
    await relay.close();
    relay = null;
    const alone = player(port);
    await alone.coop.host('Ann');
    expect(alone.coop.error()).toContain("Can't reach the coop server");
    expect(alone.coop.status()).toBe('closed');
  });

  it('goes on alone once the connection broke in the game (R10)', async () => {
    const { host, guest } = await lobby();
    guest.coop.setLobbyReady(true);
    await until(() => host.coop.room()!.players.every((p) => p.ready || p.id === host.coop.room()!.hostId));
    host.coop.start();
    await until(() => host.coop.inGame() && guest.coop.inGame());
    await relay!.close();
    relay = null;
    await until(() => guest.coop.lostInGame());
    guest.coop.continueAlone();
    expect(guest.gsm.setLockstep).toHaveBeenLastCalledWith(null);
    expect(guest.gsm.playerLeft).toHaveBeenCalledWith(host.coop.playerId());
    expect(guest.coop.status()).toBe('off');
  });

  it('hosts on the LAN over the app’s relay and lets a guest in by a found game (C4d)', async () => {
    relay = await startRelay({ port: 0 });
    const port = relay.port;
    const coopLan = {
      host: vi.fn(async () => ({ port, addresses: [{ name: 'Ethernet', address: '192.168.1.20' }] })),
      stop: vi.fn(),
      scan: vi.fn(() => () => undefined),
      probe: vi.fn(async () => false),
    };
    vi.stubGlobal('desktop', {
      version: '0.5.0', onUpdateReady: () => () => undefined, installUpdateNow: () => undefined, saveRun: async () => true, coopLan,
    });
    try {
      const host = player(port);
      const guest = player(port);
      localStorage.clear();
      expect(host.coop.lanAvailable).toBe(true);
      await host.coop.hostLan('Ann');
      await until(() => host.coop.room() !== null && host.coop.worldReady());
      expect(host.coop.relay()).toEqual({ url: `ws://127.0.0.1:${port}`, source: 'lan' });
      expect(host.coop.lanAddresses()).toEqual([{ name: 'Ethernet', address: '192.168.1.20' }]);

      const code = host.coop.room()!.code;
      // The first address does not answer; the next one is the host's
      await guest.coop.joinLan('Bob', {
        code, host: 'Ann', players: 1, gameVersion: 'v', protocol: 1, address: '127.0.0.2', port: 1,
        endpoints: [{ address: '127.0.0.1', port: 1 }, { address: '127.0.0.1', port }],
      });
      await until(() => host.coop.room()!.players.length === 2);
      expect(guest.coop.relay()?.source).toBe('lan');

      host.coop.leave();
      expect(coopLan.stop).toHaveBeenCalledTimes(1);
      expect(host.coop.lanAddresses()).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
      vi.stubGlobal('WebSocket', WsSocket);
    }
  });
});
