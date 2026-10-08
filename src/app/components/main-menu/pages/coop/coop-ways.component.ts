import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, output, signal, untracked } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TdIconComponent } from '../../../icon/icon.component';
import { FocusOnShowDirective } from '../../../focus-on-show.directive';
import type { CoopService } from '../../../../services/coop.service';
import { COOP } from '../../../../services/coop.token';
import { MAX_PLAYERS, PROTOCOL_VERSION, type PublicRoom } from '../../../../coop/protocol';
import { BUILD_VERSION } from '../../../../configs/build-info.config';
import type { LanGame } from '../../../../core/desktop-bridge';
import { GameStore } from '../../../../store/game.store';
import { LocationStore } from '../../../../store/location.store';
import { LocationManagementService } from '../../../../services/location/location-management.service';
import { APP_DOWNLOADS } from '../../../../coop/coop-access';

/** How often the open rooms of the lobby are looked at while shown, ms */
const ROOMS_EVERY_MS = 5000;

/** The LAN scan found nothing this long: offer the host IP field and the checklist (D54), ms */
const LAN_QUIET_MS = 4000;

/** Which way hosting goes */
export type HostWay = 'online' | 'lan';

/**
 * The ways into a coop room on the menu's Coop page (docs/COOP_PLAN.md,
 * D61, D67; plan E121): the player's name and the online lobby on top, then
 * three ways one under the other. Host online opens a room on the place
 * loaded (it needs one; "Change place" goes to New game) and asks first when
 * that ends a solo run (a map with one spawn gets a second lane). Join online
 * takes a room code or a room of the lobby's public list, looked at every
 * few seconds. Same network lists the games the desktop app finds and hosts
 * one; a browser gets a pointer to the app there. Once a room is entered the
 * coop dock holds it (lobby, lanes, chat); the page reports `entered`.
 */
@Component({
  selector: 'app-coop-ways',
  standalone: true,
  imports: [MatTooltipModule, TdIconComponent, FocusOnShowDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './coop-ways.component.html',
  styleUrl: './coop-ways.component.scss',
})
export class CoopWaysComponent {
  private readonly game = inject(GameStore);
  private readonly locationStore = inject(LocationStore);
  private readonly locationMgmt = inject(LocationManagementService);

  /** The game's coop service; the page shows this only where there is one */
  readonly coop: CoopService = inject(COOP);
  /** "Change place" or "Choose a place": the page opens New game */
  readonly changePlace = output<void>();
  /** "Open the room": the page closes the menu, the dock shows the room */
  readonly openRoom = output<void>();

  protected readonly maxPlayers = MAX_PLAYERS;
  protected readonly allDownloads = APP_DOWNLOADS.all;

  readonly name = signal(this.coop.name);
  readonly code = signal(this.coop.roomFromUrl ?? '');

  /** The place loaded, the one a room opens on; '' before the first */
  readonly placeName = computed(() => (this.locationMgmt.hq() ? this.locationMgmt.getLocationDisplayName() : ''));

  /**
   * The wave of the solo run that opening a room would end, 0 when it would
   * not: a room on a map with one spawn adds a lane for the second player at
   * once (CoopService.openRoom), and a new spawn starts the run over.
   */
  readonly soloRunEnds = computed(() => {
    const wave = this.game.waveNumber() > 0 && !this.game.isGameOver() ? this.game.waveNumber() : 0;
    return this.locationStore.spawnPoints().length < 2 ? wave : 0;
  });
  /** A host button was pressed while it would end the solo run: the section asks once more */
  readonly confirmHost = signal<HostWay | null>(null);

  readonly busy = computed(() => this.coop.status() === 'connecting');
  /** The lobby's open rooms, each with why it cannot be joined where it cannot */
  readonly publicRooms = computed(() => this.coop.publicRooms()?.map((room) => ({ ...room, why: publicRefusal(room) })) ?? null);

  /** The LAN scan has found nothing for a while */
  readonly lanQuiet = signal(false);
  readonly hostIp = signal('');
  readonly lanProbe = signal<'busy' | 'none' | null>(null);
  /** The refresh button turns for a moment after a click */
  readonly rescanning = signal(false);
  /** LAN games, each with why it cannot be joined where it cannot */
  readonly lanGames = computed(() => this.coop.lanGames().map((game) => ({ ...game, why: lanRefusal(game) })));

  /** One timer for "the scan stays quiet": the first search and every search again share it */
  private quietTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Look for LAN games while the page shows, not while connecting or in a room
    let scanning = false;
    effect(() => {
      const coop = this.coop;
      const on = coop.lanAvailable && coop.status() !== 'connecting' && !coop.room();
      if (on === scanning) return;
      scanning = on;
      untracked(() => {
        coop.scanLan(on);
        if (on) this.waitForQuiet();
        else this.stopQuiet();
      });
    });
    // The open rooms of the lobby, every few seconds while not in a room
    const listTimer = setInterval(() => this.refreshRooms(), ROOMS_EVERY_MS);
    effect(() => {
      this.coop.lobby();
      untracked(() => this.refreshRooms());
    });
    inject(DestroyRef).onDestroy(() => {
      this.stopQuiet();
      clearInterval(listTimer);
      if (scanning) this.coop.scanLan(false);
    });
  }

  private playerName(): string {
    return this.name().trim() || 'Player';
  }

  setName(value: string): void {
    this.name.set(value);
    this.coop.name = value.trim() || 'Player';
  }

  pickLobby(select: HTMLSelectElement): void {
    this.coop.selectLobby(select.value);
  }

  /** Host on a way; a solo run that would end is asked about first */
  host(way: HostWay): void {
    const coop = this.coop;
    if (!this.placeName()) return;
    if (this.soloRunEnds() > 0 && this.confirmHost() !== way) {
      this.confirmHost.set(way);
      return;
    }
    this.confirmHost.set(null);
    if (way === 'lan') void coop.hostLan(this.playerName());
    else void coop.host(this.playerName());
  }

  refreshRooms(): void {
    const coop = this.coop;
    if (!coop.lobby() || coop.room() || coop.status() === 'connecting') return;
    void coop.refreshPublicRooms();
  }

  joinRoom(room: { code: string; why: string | null }): void {
    if (room.why) return;
    void this.coop.join(this.playerName(), room.code);
  }

  join(): void {
    const code = this.code().trim().toUpperCase();
    if (!code) return;
    void this.coop.join(this.playerName(), code);
  }

  joinLan(game: LanGame & { why: string | null }): void {
    if (game.why) return;
    void this.coop.joinLan(this.playerName(), game);
  }

  /** Start the search over: fresh sockets on every adapter, an empty list, the IP field after a while again */
  rescanLan(): void {
    const coop = this.coop;
    coop.scanLan(false);
    coop.scanLan(true);
    this.lanProbe.set(null);
    this.rescanning.set(true);
    this.waitForQuiet();
  }

  private waitForQuiet(): void {
    this.stopQuiet();
    this.quietTimer = setTimeout(() => {
      this.quietTimer = null;
      this.rescanning.set(false);
      this.lanQuiet.set(this.coop.lanGames().length === 0);
    }, LAN_QUIET_MS);
  }

  private stopQuiet(): void {
    if (this.quietTimer) clearTimeout(this.quietTimer);
    this.quietTimer = null;
    this.lanQuiet.set(false);
    this.rescanning.set(false);
  }

  async probeLan(): Promise<void> {
    const ip = this.hostIp().trim();
    const coop = this.coop;
    if (!ip) return;
    this.lanProbe.set('busy');
    this.lanProbe.set((await coop.probeLan(ip)) ? null : 'none');
  }

  /** Stop connecting: no room, no world coming */
  cancelConnect(): void {
    const coop = this.coop;
    coop.intent.set(null);
    coop.leave();
  }

  installUpdate(): void {
    this.coop.installUpdate();
  }
}

/** Why a room of the public list cannot be joined from here, null when it can */
export function publicRefusal(room: PublicRoom): string | null {
  if (room.gameVersion !== BUILD_VERSION) return `The host plays ${room.gameVersion || 'another version'}, you play ${BUILD_VERSION}.`;
  if (room.started) return 'The game has started; joining a running game comes later.';
  if (room.players >= MAX_PLAYERS) return 'The room is full.';
  return null;
}

/** Why a LAN game cannot be joined from here, null when it can */
export function lanRefusal(game: LanGame): string | null {
  if (game.protocol !== PROTOCOL_VERSION || game.gameVersion !== BUILD_VERSION) {
    return `The host plays ${game.gameVersion || 'another version'}, you play ${BUILD_VERSION}. Both need the same version.`;
  }
  if (game.players >= MAX_PLAYERS) return 'The room is full.';
  return null;
}
