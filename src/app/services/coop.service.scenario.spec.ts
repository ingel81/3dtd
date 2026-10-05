/**
 * CoopService end to end over a real relay (docs/COOP_PLAN.md, review R21):
 * a host and a guest, each a CoopService of its own on real sockets, the
 * relay of `npm run coop-server` on a free port. The simulation's end
 * (SimClient), the map, the main world and the engine are fakes, the mirror
 * is real; the world package is a stand-in that says which place
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
import { startRelay, type RelayOptions, type RelayServer } from '../../../coop-server/src/server';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reconcileWave } from '../run-log/run-log-check';
import type { RunLog } from '../run-log/run-log.types';
import { withAutoStubs } from '../integration/test-helpers';
import { createMainEventBus } from '../sim/client/view-events';
import type { EnemyView } from '../sim/client/views';
import { packet } from '../sim/client/mirror/testing/mirror-packets';

// The game's services as bare tokens: the fakes below stand in for them
vi.mock('../sim/client/sim-client.service', () => ({ SimClient: class {} }));
vi.mock('./world/main-world.service', () => ({ MainWorldService: class {} }));
vi.mock('./world/global-route-grid.service', () => ({ GlobalRouteGridService: class {} }));
vi.mock('./tower-los-registry', () => ({ TowerLosRegistry: class {} }));
vi.mock('../presentation/presentation.service', () => ({ PresentationService: class {} }));
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
import { WorldPackageLoader } from './world/world-package-loader.service';
import { CoopSession } from '../coop/coop-session';
import { BUILD_VERSION } from '../configs/build-info.config';
import { balanceConfigHash } from '../run-log/config-hash';
import { SimClient } from '../sim/client/sim-client.service';
import { SimMirror } from '../sim/client/mirror/sim-mirror';
import { MainWorldService } from './world/main-world.service';
import { GlobalRouteGridService } from './world/global-route-grid.service';
import { TowerLosRegistry } from './tower-los-registry';
import { PresentationService } from '../presentation/presentation.service';
import { ConfigService } from '../core/services/config.service';
import { GameStore } from '../store/game.store';
import { UIStore, type UiNotice } from '../store/ui.store';
import { EngineInitializationService } from './infrastructure/engine-initialization.service';
import { LocationManagementService } from './location/location-management.service';
import { UrlLocationService } from './location/url-location.service';
import { PathAndRouteService } from './world/path-route.service';
import { LocationFacadeService } from './facade/location-facade.service';
import { LocationChangeCoordinatorService } from './location/location-change-coordinator.service';
import { InputHandlerService } from './input-handler.service';
import { RunLogFacade } from '../run-log/run-log.facade';
import { WaveDirector } from '../director/wave-director';
import type { WaveSourceId } from '../director/wave-source';

const HQ = { lat: 48.7758, lon: 9.1829 };
const SPAWNS = [
  { id: 'spawn-1', name: 'North', lat: 48.785, lon: 9.183 },
  { id: 'spawn-2', name: 'South', lat: 48.767, lon: 9.182 },
];

/** One player's CoopService on fakes of the game */
function player(relayPort: number, waveSource?: WaveSourceId) {
  localStorage.setItem('3dtd-coop-relay', `ws://localhost:${relayPort}`);
  const hq = signal(HQ);
  const closedRun = signal<RunLog | null>(null);
  const bus = createMainEventBus();
  // The simulation's end: its bus, and what the coop sends it
  const failureListeners: ((error: string) => void)[] = [];
  const sim = {
    bus,
    started: true,
    setLockstep: vi.fn(),
    configure: vi.fn(),
    onFailure: (listener: (error: string) => void) => {
      failureListeners.push(listener);
      return () => undefined;
    },
    onFrame: () => () => undefined,
    /** The simulation threw: what SimClient tells its listeners */
    fail: (error: string) => failureListeners.forEach((listener) => listener(error)),
    rpc: vi.fn(async (method: string) => (method === 'stateHash' ? 1 : null)),
  };
  const world = withAutoStubs({
    spawnPoints: SPAWNS,
    source: () => ({ hq: hq() }),
    key: () => 'k',
    corridorPending: () => false,
  });
  const los = { setRole: vi.fn() };
  const mirror = new SimMirror();
  // Going to another place in the page lands where it was asked to
  const locationChange = { applyNewLocation: vi.fn(async (data: { hq: { lat: number; lon: number } }) => hq.set({ lat: data.hq.lat, lon: data.hq.lon })) };
  // The wave source this seat would play next, when the test cares
  // The run log as RunLogFacade keeps it: a reset closes the open run and
  // opens the next, which asks the coop for its head. It hears the reset
  // after the coop, as in the game, where the coop subscribes in its constructor.
  let coopHead: () => { players: string[]; you: string } | null = () => null;
  const runs: { coop: { players: string[]; you: string } | null }[] = [{ coop: null }];
  const runLog = {
    collector: withAutoStubs({ markCoop: (players: string[], you: string) => { runs[runs.length - 1].coop = { players, you }; } }),
    closedRun,
    setCoopHead: (head: typeof coopHead) => { coopHead = head; },
  };
  const director = waveSource
    ? { sourceNextRun: waveSource, useSourceNextRun: vi.fn(function (this: { sourceNextRun: WaveSourceId }, id: WaveSourceId) { this.sourceNextRun = id; }) }
    : null;
  const injector = Injector.create({
    parent: TestBed.inject(EnvironmentInjector),
    providers: [
      CoopService,
      // The real one, on the stand-ins below
      WorldPackageLoader,
      { provide: SimClient, useValue: sim },
      { provide: SimMirror, useValue: mirror },
      { provide: MainWorldService, useValue: world },
      { provide: GlobalRouteGridService, useValue: withAutoStubs({}) },
      { provide: TowerLosRegistry, useValue: los },
      { provide: PresentationService, useValue: { host: null } },
      { provide: ConfigService, useValue: { coopRelay: signal(null), coopLobbies: signal(null), needsCredentials: signal(false) } },
      { provide: GameStore, useValue: { gameSpeed: signal(1), paused: signal(false) } },
      { provide: UIStore, useValue: { coopMapLocked: signal(false), notice: signal<UiNotice | null>(null), coopDockOpen: signal(false) } },
      { provide: EngineInitializationService, useValue: { getEngine: () => ({}), loading: () => false } },
      { provide: LocationManagementService, useValue: { hq, spawns: signal(SPAWNS.map(({ lat, lon }) => ({ lat, lon }))), missionInfo: signal({ city: 'Stuttgart', country: 'Deutschland', address: 'Marktplatz 1' }) } },
      { provide: UrlLocationService, useValue: { urlFor: () => '/?l=48.7758,9.1829' } },
      { provide: PathAndRouteService, useValue: withAutoStubs({ getCachedPaths: () => new Map() }) },
      { provide: LocationFacadeService, useValue: withAutoStubs({ addRandomSpawn: vi.fn(async () => true) }) },
      { provide: LocationChangeCoordinatorService, useValue: locationChange },
      { provide: InputHandlerService, useValue: withAutoStubs({}) },
      { provide: RunLogFacade, useValue: runLog },
      { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => of(true) }) } },
      ...(director ? [{ provide: WaveDirector, useValue: director }] : []),
    ],
  });
  const coop = injector.get(CoopService);
  bus.onLive('game:reset', () => {
    runs.push({ coop: null });
    const head = coopHead();
    if (head) runLog.collector.markCoop(head.players, head.you);
  });
  return { coop, sim, los, mirror, hq, locationChange, closedRun, director, runs };
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
  async function lobby(options: Partial<RelayOptions> = {}, sources: [WaveSourceId?, WaveSourceId?] = []) {
    relay = await startRelay({ port: 0, ...options });
    const host = player(relay.port, sources[0]);
    const guest = player(relay.port, sources[1]);
    await host.coop.host('Ann');
    await until(() => host.coop.room() !== null && host.coop.worldReady());
    await guest.coop.join('Bob', host.coop.room()!.code);
    const lanes = () => host.coop.room()!.players.map((p) => p.spawnIds);
    await until(() => lanes().length === 2 && lanes().every((lane) => lane.length > 0));
    return { host, guest };
  }

  it('keeps the name for the session where storage is blocked (review 2026-10-01)', () => {
    const { coop } = player(1);
    const blocked = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked);
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked);
    try {
      expect(coop.name).toBe('Player');
      coop.name = 'Ann';
      expect(coop.name).toBe('Ann');
    } finally {
      set.mockRestore();
      get.mockRestore();
    }
  });

  it('opens a room, lets a guest in and gives each a lane of their own', async () => {
    const { host, guest } = await lobby();
    const room = host.coop.room()!;
    expect(room.players.map((p) => p.name)).toEqual(['Ann', 'Bob']);
    expect(new Set(room.players.flatMap((p) => p.spawnIds))).toEqual(new Set(['spawn-1', 'spawn-2']));
    expect(host.coop.isHost()).toBe(true);
    expect(guest.coop.isHost()).toBe(false);
    await until(() => host.coop.chat().some((line) => line.from === null && line.text === 'Bob joined'));
  });

  it('lets the host decide the wave source: the guest plays the same one', async () => {
    const { guest } = await lobby({}, ['table', 'budget']);
    await until(() => guest.director!.useSourceNextRun.mock.calls.length > 0);
    expect(guest.director!.useSourceNextRun).toHaveBeenCalledWith('table');
    expect(guest.director!.sourceNextRun).toBe('table');
    // Leaving the room gives the guest its own source back
    guest.coop.leave();
    expect(guest.director!.sourceNextRun).toBe('budget');
  });

  it('starts once the guest is ready, with the roster and the relay’s lockstep on both', async () => {
    const { host, guest } = await lobby();
    guest.coop.setLobbyReady(true);
    await until(() => host.coop.room()!.players.find((p) => p.name === 'Bob')!.ready);
    host.coop.start();
    await until(() => host.coop.inGame() && guest.coop.inGame());
    expect(guest.coop.roster().map((p) => p.name)).toEqual(['Ann', 'Bob']);
    expect(guest.sim.setLockstep).toHaveBeenCalledWith(expect.objectContaining({ playerId: guest.coop.playerId() }), undefined);
    const roster = (side: typeof host) =>
      side.sim.configure.mock.calls.map(([config]) => config.players).find((players) => players !== undefined);
    expect(roster(guest)).toEqual({ players: roster(host).players, local: guest.coop.playerId() });
    // The host renders the lines of sight, the guest waits for them (COOP_PLAN C3)
    expect(host.los.setRole).toHaveBeenLastCalledWith('render');
    expect(guest.los.setRole).toHaveBeenLastCalledWith('wait');
  });

  // The start resets the simulation by a call; its game:reset comes with a
  // later packet, when the game already runs (review f05)
  it('marks the run the start opens as coop, not the one before, and says nothing of a new run then', async () => {
    const { host, guest } = await lobby();
    guest.coop.setLobbyReady(true);
    await until(() => host.coop.room()!.players.find((p) => p.name === 'Bob')!.ready);
    host.coop.start();
    await until(() => host.coop.inGame() && guest.coop.inGame());
    expect(guest.sim.rpc).toHaveBeenCalledWith('reset', expect.any(Number));
    guest.sim.bus.emit({ type: 'game:reset' });

    expect(guest.runs.map((run) => run.coop)).toEqual([null, { players: ['Ann', 'Bob'], you: 'Bob' }]);
    const newRunLines = () => guest.coop.chat().filter((line) => line.text === 'The host started a new run');
    expect(newRunLines()).toEqual([]);

    // The host's restart later on is a new run, and a coop one again
    guest.sim.bus.emit({ type: 'game:reset' });
    expect(guest.runs.map((run) => run.coop?.you ?? null)).toEqual([null, 'Bob', 'Bob']);
    expect(newRunLines()).toHaveLength(1);
  });

  it('counts an ooze that flows in point by point once for its lane (TODO E34)', async () => {
    const { host, guest } = await lobby();
    guest.coop.setLobbyReady(true);
    await until(() => host.coop.room()!.players.find((p) => p.name === 'Bob')!.ready);
    host.coop.start();
    await until(() => host.coop.inGame() && guest.coop.inGame());
    const me = host.coop.roster().find((p) => p.id === host.coop.playerId())!;
    const bus = host.sim.bus;
    // The route an enemy walks, as the mirror names it: its spawn's id
    const enemy = (id: string) => ({ id, movement: { routeId: me.spawnIds[0] } }) as unknown as EnemyView;

    bus.emit({ type: 'enemy:leaking', enemy: enemy('ooze'), damage: 1 });
    bus.emit({ type: 'enemy:leaking', enemy: enemy('ooze'), damage: 1 });
    bus.emit({ type: 'enemy:reached-base', enemy: enemy('ooze'), damage: 1 } as never);
    bus.emit({ type: 'enemy:reached-base', enemy: enemy('zombie'), damage: 1 } as never);

    expect(host.coop.waveLeaks().get(me.id)).toBe(2);
  });

  it('sends a coop run log to a relay that collects, once the player said yes (TODO E38)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'runs-'));
    try {
      localStorage.removeItem('3dtd-run-upload');
      const { host, guest } = await lobby({ collectRuns: { dir, maxBytes: 1e9, maxAgeMs: 1e12 } });
      // A new name in the lobby: the file carries it, not the one of the hello (TODO E44)
      guest.coop.rename('Bea');
      await until(() => host.coop.room()!.players.some((p) => p.name === 'Bea'));
      guest.coop.setLobbyReady(true);
      await until(() => host.coop.room()!.players.find((p) => p.name === 'Bea')!.ready);
      host.coop.start();
      await until(() => host.coop.inGame() && guest.coop.inGame());

      const head = { kind: 'head', format: 3, runId: 'run-1', gameVersion: 'v1', coop: { players: ['Ann', 'Bob'], you: 'Bob' } };
      const wave: Record<string, unknown> = {
        kind: 'wave', wave: 1, income: {}, spending: {}, creditsStart: 100, creditsEnd: 100,
        killsByTower: 1, killsByHero: 0, killsByAbility: 0, killsByDebug: 0, killsByOther: 0,
        enemiesAtStart: 0, enemiesSpawned: 1, enemiesAlive: 0, leaked: 0, towers: [],
      };
      expect(reconcileWave(wave as never)).toEqual([]);
      guest.closedRun.set({ head, records: [head, wave] } as unknown as RunLog);

      // Asked once (the dialog says yes), the answer kept, the log on the relay
      await until(() => localStorage.getItem('3dtd-run-upload') === 'yes');
      const files = () => readdirSync(join(dir, 'coop'), { recursive: true }).map(String).filter((f) => f.endsWith('.jsonl.gz'));
      await until(() => { try { return files().length === 1; } catch { return false; } });
      expect(files()[0]).toMatch(/Bea_p\d+_run-1\.jsonl\.gz$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      localStorage.removeItem('3dtd-run-upload');
    }
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

  it('a look at the room list while a join waits leaves the join its answer (e2e T36, 2026-09-26)', async () => {
    const { host } = await lobby();
    host.coop.setLocked(true);
    await until(() => host.coop.room()!.locked);
    // One session, two requests at once: the coop entry looked at the open rooms mid-join,
    // the list took the join's refusal and the join waited for ever
    const session = new CoopSession(`ws://localhost:${relay!.port}`, { name: 'Carl', gameVersion: BUILD_VERSION, configHash: balanceConfigHash() });
    await session.connect();
    const joined = session.join(host.coop.room()!.code);
    await expect(session.listRooms()).rejects.toThrow(/Busy/);
    await expect(joined).rejects.toMatchObject({ reason: 'locked' });
    session.close();
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
    const cheatsFor = guest.sim.configure.mock.calls.map(([config]) => config.cheatsFor).filter((c) => c !== undefined).at(-1);
    // Cheats off by default: nobody, the host neither
    expect(cheatsFor).toEqual([]);
  });

  it("tells the host what the guest's client does, and that its map stands (User, 2026-09-25)", async () => {
    const { host, guest } = await lobby();
    await until(() => host.coop.room()!.players.find((p) => p.name === 'Bob')!.status === 'ready');
    expect(guest.coop.room()!.players.find((p) => p.name === 'Bob')!.status).toBe('ready');
    await until(() => host.coop.chat().some((line) => line.from === null && line.text === "Bob's map stands"));
  });

  it('says the lobby is offline once, as the "does not answer" line of the entry, when no relay answers (D61, E114)', async () => {
    relay = await startRelay({ port: 0 });
    const port = relay.port;
    await relay.close();
    relay = null;
    const alone = player(port);
    alone.coop.publicRooms.set([]);
    await alone.coop.host('Ann');
    // No second message beside the line the entry shows for a lobby that does not answer
    expect(alone.coop.error()).toBeNull();
    expect(alone.coop.publicRooms()).toBeNull();
    expect(alone.coop.status()).toBe('closed');
    // Named for the entry, which says it on either way (an invite link on Same network too)
    expect(alone.coop.lobbyDown()).toEqual(expect.any(String));
    // The probe of the lobby menu marks it, so the entry shows no second note
    const lobbyUrl = alone.coop.lobby()!.url;
    expect(await alone.coop.probeLobby(lobbyUrl)).toMatchObject({ ok: false, down: true });
  });

  it('goes on alone once the connection broke in the game (R10)', async () => {
    const { host, guest } = await lobby();
    guest.coop.setLobbyReady(true);
    await until(() => host.coop.room()!.players.every((p) => p.ready || p.id === host.coop.room()!.hostId));
    host.coop.start();
    await until(() => host.coop.inGame() && guest.coop.inGame());
    // The simulation runs the room's roster
    guest.mirror.applyState(packet({ scalars: { players: guest.coop.roster().map((p) => p.id), localPlayerId: guest.coop.playerId()! } }));
    await relay!.close();
    relay = null;
    await until(() => guest.coop.lostInGame());
    guest.coop.continueAlone();
    expect(guest.sim.setLockstep).toHaveBeenLastCalledWith(null);
    expect(guest.sim.configure).toHaveBeenCalledWith({ playersLeft: expect.arrayContaining([host.coop.playerId()]) });
    expect(guest.los.setRole).toHaveBeenLastCalledWith('render');
    expect(guest.coop.status()).toBe('off');
  });

  it('leaves the room when its simulation failed, so the host does not wait for this seat', async () => {
    const { host, guest } = await lobby();
    guest.coop.setLobbyReady(true);
    await until(() => host.coop.room()!.players.every((p) => p.ready || p.id === host.coop.room()!.hostId));
    host.coop.start();
    await until(() => host.coop.inGame() && guest.coop.inGame());

    const guestId = guest.coop.playerId()!;
    guest.sim.fail('TypeError: boom');
    expect(guest.coop.status()).toBe('off');
    expect(guest.sim.setLockstep).toHaveBeenLastCalledWith(null);
    // The host hears the seat leave: its lane closes there
    await until(() => host.coop.room()!.players.every((p) => p.id !== guestId));
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

  it('turns a server set before the lobby list into a lobby of the player’s, and names it in the room (D58)', async () => {
    relay = await startRelay({ port: 0 });
    const { coop } = player(relay.port);
    // The dev page's own lobby first, then the old server, which is the active one
    expect(coop.lobbies().map((l) => l.name)).toEqual(['This machine', `localhost:${relay.port}`]);
    expect(coop.lobby()?.url).toBe(`ws://localhost:${relay.port}`);
    expect(localStorage.getItem('3dtd-coop-relay')).toBeNull();
    await coop.host('Ann');
    await until(() => coop.room() !== null);
    expect(coop.reachedVia()).toBe(`localhost:${relay.port}`);
    expect(coop.addLobby('Home', 'ws://192.168.0.5:3003')).toBe(true);
    expect(coop.lobby()?.name).toBe('Home');
    expect(coop.addLobby('Bad', 'http://x')).toBe(false);
  });

  it('lists the host’s room publicly with its city, never the street, and hides it once private (D62, D63)', async () => {
    const { host, guest } = await lobby();
    await until(() => host.coop.room()!.listing.city === 'Stuttgart, Deutschland');
    const look = player(relay!.port);
    await look.coop.refreshPublicRooms();
    expect(look.coop.publicRooms()).toEqual([expect.objectContaining({
      code: host.coop.room()!.code, title: "Ann's game", host: 'Ann', city: 'Stuttgart, Deutschland', players: 2, started: false,
    })]);
    expect(JSON.stringify(look.coop.publicRooms())).not.toContain('Marktplatz');
    expect(look.coop.lobbyPing()).not.toBeNull();
    host.coop.setListing({ title: 'Chill' });
    await until(() => guest.coop.room()!.listing.title === 'Chill');
    host.coop.setListing({ public: false });
    await until(() => !host.coop.room()!.listing.public);
    await look.coop.refreshPublicRooms();
    expect(look.coop.publicRooms()).toEqual([]);
  });
});
