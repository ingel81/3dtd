import { Injectable, Injector, NgZone, computed, effect, inject, signal, untracked } from '@angular/core';
import { GameStateManager } from '../managers/game-state.manager';
import { ConfigService } from '../core/services/config.service';
import { GameStore } from '../store/game.store';
import { EngineInitializationService } from './infrastructure/engine-initialization.service';
import { LocationManagementService } from './location/location-management.service';
import { UrlLocationService } from './location/url-location.service';
import { PathAndRouteService } from './world/path-route.service';
import { LocationFacadeService } from './facade/location-facade.service';
import { BUILD_VERSION } from '../configs/build-info.config';
import { balanceConfigHash } from '../run-log/config-hash';
import { newRunSeed } from '../utils/game-rng';
import { COORD_DECIMALS } from '../utils/geo-utils';
import { CoopRefusedError, CoopSession, type CoopStart } from '../coop/coop-session';
import {
  buildWorldPackage,
  packagePaths,
  readWorldPackage,
  worldPackageRefusalText,
  type WorldPackage,
} from '../coop/world-package';
import type { CoopRoomInfo, RefusalReason } from '../coop/protocol';
import type { GeoPosition } from '../models/game.types';

/** Two points are the same place at the precision the URL keeps. */
function samePlace(a: GeoPosition, b: GeoPosition): boolean {
  return a.lat.toFixed(COORD_DECIMALS) === b.lat.toFixed(COORD_DECIMALS)
    && a.lon.toFixed(COORD_DECIMALS) === b.lon.toFixed(COORD_DECIMALS);
}

export type CoopStatus = 'off' | 'connecting' | 'lobby' | 'loading-world' | 'in-game' | 'closed';

/** The name the player gave last time, kept in this browser */
const NAME_KEY = '3dtd-coop-name';

/** Longest wait for this client's own load of the host's place before taking the world over, ms */
const WORLD_LOAD_TIMEOUT_MS = 120_000;

const REFUSAL_TEXT: Record<RefusalReason, string> = {
  protocol: 'The relay speaks another version of the coop protocol.',
  version: 'The host runs another version of the game. Both need the same one.',
  balance: 'The host plays with other tower or enemy values.',
  'no-room': 'There is no room with that code.',
  full: 'The room is full (four players).',
  started: 'The game in that room has started already.',
  'not-host': 'Only the host can do that.',
  'lane-taken': 'Someone else has that lane.',
  'not-ready': 'Not everyone has a lane and is ready yet.',
};

/**
 * Coop in the game (docs/COOP_PLAN.md, C4): the session to the relay and
 * what the game does with it.
 *
 * Host: opens a room and sends the world of the place loaded now. Joiner:
 * joins, gets the host's world; where that is another place than the one
 * loaded here, the page loads that place with the room in the URL and joins
 * again once it stands (join per link). Then the world package replaces
 * routes, cells and heights (C1b), and the world key must match the host's.
 * At the start every client resets the run with the room's seed, sets
 * players, lanes and line of sight role, and hands the simulation the tick
 * stream (lockstep).
 *
 * In the game the wave button means "ready"; the host starts the wave once
 * everyone is (D15). Speed and pause belong to the host.
 */
@Injectable()
export class CoopService {
  private readonly gameState = inject(GameStateManager);
  private readonly config = inject(ConfigService);
  private readonly gameStore = inject(GameStore);
  private readonly engineInit = inject(EngineInitializationService);
  private readonly locationMgmt = inject(LocationManagementService);
  private readonly urlLocation = inject(UrlLocationService);
  private readonly pathRoute = inject(PathAndRouteService);
  private readonly locationFacade = inject(LocationFacadeService);
  /** Host: adding a spawn for a lane the room lacks, see fillLanes */
  private filling = false;
  private readonly ngZone = inject(NgZone);

  private readonly injector = inject(Injector);
  private session: CoopSession | null = null;
  private waveStarter: (() => void) | null = null;
  private readyNow = false;
  /** The speed the room runs at; what the store shows is set from it (applySpeed) */
  private roomSpeed = 1;
  private roomPaused = false;

  readonly status = signal<CoopStatus>('off');
  readonly room = signal<CoopRoomInfo | null>(null);
  readonly error = signal<string | null>(null);
  readonly playerId = signal<string | null>(null);
  readonly chat = signal<{ from: string; text: string }[]>([]);
  /** The host's world stands here too and matches it (joiner), or was sent (host) */
  readonly worldReady = signal(false);
  readonly isHost = computed(() => {
    const room = this.room();
    return room !== null && room.hostId === this.playerId();
  });
  readonly inGame = computed(() => this.status() === 'in-game');
  /** The room code from the URL this page was opened with (?room=), to join once the place stands */
  readonly roomFromUrl: string | null;

  constructor() {
    const params = new URLSearchParams(window.location.search);
    this.roomFromUrl = params.get('room');

    const bus = this.gameState.getEventBus();
    bus.on('coop:ready-changed', (event) => {
      if (event.local) this.readyNow = event.ready;
      if (event.allReady && this.isHost() && this.inGame()) this.ngZone.run(() => this.waveStarter?.());
    });
    bus.on('wave:started', () => {
      this.readyNow = false;
    });

    // Speed and pause belong to the host (D15): a change in the store, from
    // the buttons or the keys, goes to the relay from the host and is taken
    // back on a guest. The room's answer sets the store (applySpeed).
    effect(() => {
      const speed = this.gameStore.gameSpeed();
      const paused = this.gameStore.paused();
      untracked(() => this.followLocalSpeed(speed, paused));
    }, { injector: this.injector });

  }

  get name(): string {
    try {
      return localStorage.getItem(NAME_KEY) ?? 'Player';
    } catch {
      return 'Player';
    }
  }

  set name(value: string) {
    try {
      localStorage.setItem(NAME_KEY, value);
    } catch {
      /* storage blocked: the name holds for this session */
    }
  }

  /** The facade's wave start, run by the host once everyone is ready. */
  setWaveStarter(start: () => void): void {
    this.waveStarter = start;
  }

  /** Open a room with the place loaded now and be its host. */
  async host(name: string): Promise<void> {
    const session = await this.connect(name);
    if (!session) return;
    await this.guard(async () => {
      this.room.set(await session.create());
      this.shareWorld();
    });
  }

  /** Join the room `code`. */
  async join(name: string, code: string): Promise<void> {
    const session = await this.connect(name);
    if (!session) return;
    await this.guard(async () => {
      this.room.set(await session.join(code));
    });
  }

  /** Host: send the world of the place loaded now (again, after a change of place). */
  shareWorld(): void {
    const source = this.gameState.worldSource();
    if (!this.session || !source) {
      this.error.set('The place is not loaded yet.');
      return;
    }
    const world = buildWorldPackage(source, this.head());
    this.session.sendWorld(world, world.spawns.map((spawn) => spawn.id));
    this.worldReady.set(true);
  }

  /**
   * Host: every player needs a lane of their own (D26). While the room has
   * more players than the map has spawns, add one on a street round from
   * the others and send the map again; up to four.
   */
  private async fillLanes(): Promise<void> {
    const room = this.room();
    if (this.filling || !room || room.started || !this.isHost() || !this.worldReady()) return;
    if (room.spawnIds.length >= room.players.length || this.gameState.getSpawnPoints().length >= 4) return;
    this.filling = true;
    try {
      const added = await this.locationFacade.addRandomSpawn();
      if (added && this.session) this.shareWorld();
      else if (!added) this.error.set('Found no street for another spawn: add one with the + button.');
    } finally {
      this.filling = false;
    }
  }

  pick(spawnId: string | null): void {
    this.session?.pick(spawnId);
  }

  setLobbyReady(ready: boolean): void {
    this.session?.ready(ready);
  }

  /** Host: start the game. */
  start(): void {
    this.session?.start(newRunSeed());
  }

  /** Host: game speed, 0 pauses. */
  setSpeed(speed: number): void {
    if (this.isHost()) this.session?.setSpeed(speed);
  }

  /** In the game: the wave button. Ready for the next wave, or no longer. */
  toggleReady(): void {
    this.readyNow = !this.readyNow;
    this.gameState.getEventBus().emit({ type: 'command:set-ready', ready: this.readyNow });
  }

  sendChat(text: string): void {
    const trimmed = text.trim();
    if (trimmed) this.session?.chat(trimmed);
  }

  /** Leave the room; in the game the lane closes for the others. */
  leave(): void {
    this.session?.close();
    this.session = null;
    this.gameState.setLockstep(null);
    this.gameState.setLosRole(null);
    this.status.set('off');
    this.room.set(null);
    this.worldReady.set(false);
  }

  /**
   * Opened with an invite link: it carries the host's place, so this page
   * loaded that map; once it stands, join the room right away.
   */
  async joinFromUrl(): Promise<boolean> {
    const code = this.roomFromUrl;
    if (!code || this.session) return false;
    if (!(await this.placeLoaded())) return false;
    await this.join(this.name, code);
    return this.room() !== null;
  }

  /**
   * The invite link: this page at the host's place with the room, so a
   * joiner loads the right map at once (and joins from the dialog).
   */
  inviteLink(): string {
    const room = this.room();
    const hq = this.locationMgmt.hq();
    if (!room || !hq) return '';
    const spawns = this.gameState.getSpawnPoints().map(({ lat, lon }) => ({ lat, lon }));
    return `${window.location.origin}${this.urlLocation.urlFor(hq, spawns)}&room=${room.code}`;
  }

  private head(): { gameVersion: string; configHash: string } {
    return { gameVersion: BUILD_VERSION, configHash: balanceConfigHash() };
  }

  private async connect(name: string): Promise<CoopSession | null> {
    this.leave();
    this.name = name;
    this.error.set(null);
    this.status.set('connecting');
    const session = new CoopSession(this.config.coopRelay(), { name, ...this.head() });
    this.wire(session);
    try {
      this.playerId.set(await session.connect());
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
      this.status.set('closed');
      return null;
    }
    this.session = session;
    this.status.set('lobby');
    return session;
  }

  private async guard(run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (err) {
      this.error.set(err instanceof CoopRefusedError ? REFUSAL_TEXT[err.reason] : String(err));
      this.leave();
    }
  }

  /** The session's messages into signals and the game, in the Angular zone. */
  private wire(session: CoopSession): void {
    const inZone = <A extends unknown[]>(fn: (...args: A) => void) => (...args: A) => this.ngZone.run(() => fn(...args));
    session.onRoom = inZone((room) => {
      this.room.set(room);
      void this.fillLanes();
    });
    session.onWorld = inZone((world) => void this.takeWorld(world));
    session.onStarted = inZone((start) => this.startGame(start));
    session.onSpeed = inZone((speed) => this.applySpeed(speed));
    session.onHost = inZone((hostId) => {
      if (this.room()) this.room.set({ ...this.room()!, hostId });
      if (hostId === this.playerId() && this.inGame()) this.gameState.setLosRole('host');
    });
    session.onChat = inZone((from, text) => this.chat.update((lines) => [...lines.slice(-49), { from, text }]));
    session.onRefused = inZone((reason) => this.error.set(REFUSAL_TEXT[reason]));
    session.onClosed = inZone(() => {
      if (this.session !== session) return;
      this.error.set('The connection to the relay closed.');
      this.status.set('closed');
    });
  }

  /**
   * Joiner: the host's world came. Here the same place must stand: if not,
   * load it with the room in the URL; once it stands, take routes, cells and
   * heights over and check the world key.
   */
  private async takeWorld(data: unknown): Promise<void> {
    if (this.isHost()) return;
    const read = readWorldPackage(JSON.stringify(data), this.head());
    if (!read.world) {
      this.error.set(worldPackageRefusalText(read.refusal));
      return;
    }
    const world = read.world;
    // The host added spawns for the lanes (D26): add them here too, no reload
    const missing = this.missingSpawns(world);
    if (missing.length > 0) {
      this.status.set('loading-world');
      if (!(await this.placeLoaded())) return;
      for (const spawn of missing) {
        if (!(await this.locationFacade.addSpawnAt(spawn.lat, spawn.lon))) break;
      }
    }
    if (!this.standsOn(world)) {
      const room = this.room()?.code ?? this.roomFromUrl;
      const url = this.urlLocation.urlFor(world.hq, world.spawns.map(({ lat, lon }) => ({ lat, lon })));
      // Out of the room first: the browser closes the socket of a page it
      // leaves late, and the relay kept this player in the list till then
      this.leave();
      window.location.assign(`${url}&room=${encodeURIComponent(room ?? '')}`);
      return;
    }
    this.status.set('loading-world');
    const loaded = await this.placeLoaded();
    if (!loaded) {
      this.error.set('The place did not finish loading.');
      return;
    }
    this.adoptWorld(world);
  }

  /**
   * The spawns of `world` this place lacks at its end, where it has the same
   * HQ and its own spawns are the world's first ones; none otherwise.
   */
  private missingSpawns(world: WorldPackage): GeoPosition[] {
    const hq = this.locationMgmt.hq();
    const spawns = this.gameState.getSpawnPoints();
    if (!hq || !samePlace(hq, world.hq) || spawns.length >= world.spawns.length) return [];
    if (!spawns.every((spawn, i) => samePlace(spawn, world.spawns[i]))) return [];
    return world.spawns.slice(spawns.length);
  }

  /** The place loaded here is the world's: same HQ, same spawns in the same order. */
  private standsOn(world: WorldPackage): boolean {
    const hq = this.locationMgmt.hq();
    const spawns = this.gameState.getSpawnPoints();
    return hq !== null && samePlace(hq, world.hq)
      && spawns.length === world.spawns.length
      && spawns.every((spawn, i) => samePlace(spawn, world.spawns[i]));
  }

  /** Wait until the place stands here: loading screen gone, corridor frozen. */
  private async placeLoaded(): Promise<boolean> {
    const end = performance.now() + WORLD_LOAD_TIMEOUT_MS;
    while (this.engineInit.loading() || this.gameState.corridorPending()) {
      if (performance.now() > end) return false;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return true;
  }

  /** Routes, cells and heights of the host's world, then its key must be this world's (C1b). */
  private adoptWorld(world: WorldPackage): void {
    const paths = packagePaths(world);
    this.pathRoute.adoptPaths(paths);
    this.gameState.reseatWavePipeline(world.spawns, paths);
    this.gameState.rebuildRouteCells();
    this.gameState.getGlobalRouteGrid().restoreHeights(world.heights);
    const key = this.gameState.worldKey();
    if (key !== world.worldKey) {
      this.error.set(worldPackageRefusalText('other-world'));
      console.warn(`[Coop] world key ${key}, host ${world.worldKey}`);
      this.status.set('lobby');
      return;
    }
    this.worldReady.set(true);
    this.status.set('lobby');
  }

  /** The room started: a fresh run with its seed, players, lanes, the tick stream. */
  private startGame(start: CoopStart): void {
    const gsm = this.gameState;
    gsm.reset(start.seed);
    gsm.setPlayers(start.players, start.localId);
    gsm.setLanes(start.lanes);
    gsm.setLosRole(this.isHost() ? 'host' : 'guest');
    gsm.setLockstep(start.link);
    this.readyNow = false;
    this.applySpeed(start.speed);
    this.status.set('in-game');
  }

  private applySpeed(speed: number): void {
    this.roomPaused = speed === 0;
    if (speed !== 0) this.roomSpeed = speed;
    this.gameStore.paused.set(this.roomPaused);
    this.gameStore.gameSpeed.set(this.roomSpeed);
  }

  /** The store changed here: in the game the host asks the room for it, a guest goes back to the room's. */
  private followLocalSpeed(speed: number, paused: boolean): void {
    if (!this.inGame() || (speed === this.roomSpeed && paused === this.roomPaused)) return;
    if (this.isHost()) {
      this.session?.setSpeed(paused ? 0 : speed);
      return;
    }
    this.gameStore.paused.set(this.roomPaused);
    this.gameStore.gameSpeed.set(this.roomSpeed);
  }
}
