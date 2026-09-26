import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, linkedSignal, signal, untracked } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { TdIconComponent } from '../icon/icon.component';
import type { CoopService } from '../../services/coop.service';
import { MAX_PLAYERS, PROTOCOL_VERSION, type PublicRoom } from '../../coop/protocol';
import { BUILD_VERSION } from '../../configs/build-info.config';
import type { LanGame } from '../../core/desktop-bridge';
import { readText, writeText } from '../../utils/storage';

/** How often the open rooms of the lobby are looked at while shown, ms */
const ROOMS_EVERY_MS = 5000;

/** The LAN scan found nothing this long: offer the host IP field and the checklist (D54), ms */
const LAN_QUIET_MS = 4000;

/** localStorage: the way the player took last, online or on the same network (plan U3) */
const WAY_KEY = '3dtd-coop-way';

/** The select's entry that opens the fields for a new lobby */
const ADD_LOBBY = '__add';

export type CoopWay = 'online' | 'lan';

/**
 * The way into a coop room (docs/COOP_PLAN.md, D61, D67; the layout
 * docs/COOP_UI_REWORK_PLAN.md, U3): the player's name, then Online or, in
 * the desktop app, Same network, one at a time behind a switch that keeps
 * the last choice. Online: the lobby as a select, its open rooms, a room
 * code. Same network: the games found, the host IP field. One button hosts
 * on the chosen way. The coop dock shows it with hosting; the location
 * dialog of a start without a place shows it for joining only (E30), which
 * is why the service comes in as an input: the dialog lives outside the
 * game component that provides it.
 */
@Component({
  selector: 'app-coop-entry',
  standalone: true,
  imports: [MatTooltipModule, TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './coop-entry.component.html',
  styleUrl: './coop-entry.component.scss',
  styles: `
    :host {
      ${TD_CSS_VARS}
    }
  `,
})
export class CoopEntryComponent {
  readonly coop = input.required<CoopService>();
  /** Offer hosting too; the location dialog joins only, hosting needs a place */
  readonly canHost = input(true);
  /** Where hosting happens, for the notes */
  readonly placeName = input('');

  protected readonly maxPlayers = MAX_PLAYERS;
  protected readonly addLobbyValue = ADD_LOBBY;

  readonly name = linkedSignal(() => this.coop().name);
  readonly code = linkedSignal(() => this.coop().roomFromUrl ?? '');

  /** Online or Same network; the web version has only Online */
  private readonly chosenWay = signal<CoopWay>(readWay());
  readonly way = computed<CoopWay>(() => (this.coop().lanAvailable ? this.chosenWay() : 'online'));

  /** The LAN scan has found nothing for a while */
  readonly lanQuiet = signal(false);
  readonly hostIp = signal('');
  readonly lanProbe = signal<'busy' | 'none' | null>(null);
  /** The refresh button turns for a moment after a click */
  readonly rescanning = signal(false);
  /** LAN games, each with why it cannot be joined where it cannot */
  readonly lanGames = computed(() => this.coop().lanGames().map((game) => ({ ...game, why: lanRefusal(game) })));

  /** The fields for a new lobby, opened from the select */
  readonly addingLobby = signal(false);
  readonly newLobbyName = signal('');
  readonly newLobbyUrl = signal('');
  readonly lobbyNote = signal<{ ok: boolean; text: string } | null>(null);

  readonly busy = computed(() => this.coop().status() === 'connecting');
  /** The lobby's open rooms, each with why it cannot be joined where it cannot */
  readonly publicRooms = computed(() => this.coop().publicRooms()?.map((room) => ({ ...room, why: publicRefusal(room) })) ?? null);

  /** One timer for "the scan stays quiet": the first search and every search again share it */
  private quietTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Look for LAN games while Same network is shown, not while connecting
    let scanning = false;
    effect(() => {
      const coop = this.coop();
      const on = coop.lanAvailable && this.way() === 'lan' && coop.status() !== 'connecting' && !coop.room();
      if (on === scanning) return;
      scanning = on;
      untracked(() => {
        coop.scanLan(on);
        if (on) this.waitForQuiet();
        else this.stopQuiet();
      });
    });
    // The open rooms of the lobby, every few seconds while Online is shown and not in a room
    const listTimer = setInterval(() => this.refreshRooms(), ROOMS_EVERY_MS);
    effect(() => {
      this.coop().lobby();
      this.way();
      untracked(() => this.refreshRooms());
    });
    inject(DestroyRef).onDestroy(() => {
      this.stopQuiet();
      clearInterval(listTimer);
      if (scanning) this.coop().scanLan(false);
    });
  }

  private playerName(): string {
    return this.name().trim() || 'Player';
  }

  setWay(way: CoopWay): void {
    this.chosenWay.set(way);
    // No storage: the choice holds for this page
    writeText(WAY_KEY, way);
  }

  /** Host on the chosen way */
  host(): void {
    if (this.way() === 'lan') void this.coop().hostLan(this.playerName());
    else void this.coop().host(this.playerName());
  }

  joinLan(game: LanGame & { why: string | null }): void {
    if (game.why) return;
    void this.coop().joinLan(this.playerName(), game);
  }

  refreshRooms(): void {
    const coop = this.coop();
    if (this.way() !== 'online' || coop.room() || coop.status() === 'connecting') return;
    void coop.refreshPublicRooms();
  }

  joinRoom(room: { code: string; why: string | null }): void {
    if (room.why) return;
    void this.coop().join(this.playerName(), room.code);
  }

  join(): void {
    const code = this.code().trim().toUpperCase();
    if (!code) return;
    void this.coop().join(this.playerName(), code);
  }

  /** Start the search over: fresh sockets on every adapter, an empty list, the IP field after a while again */
  rescanLan(): void {
    const coop = this.coop();
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
      this.lanQuiet.set(this.coop().lanGames().length === 0);
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
    if (!ip) return;
    this.lanProbe.set('busy');
    this.lanProbe.set((await this.coop().probeLan(ip)) ? null : 'none');
  }

  /** The lobby select: a lobby becomes the active one, "Add lobby…" opens the fields */
  pickLobby(select: HTMLSelectElement): void {
    if (select.value === ADD_LOBBY) {
      this.addingLobby.set(true);
      // The select keeps showing the active lobby, not the add entry
      select.value = this.coop().lobby()?.url ?? '';
      return;
    }
    this.lobbyNote.set(null);
    this.coop().selectLobby(select.value);
  }

  addLobby(): void {
    const ok = this.coop().addLobby(this.newLobbyName(), this.newLobbyUrl());
    if (!ok) {
      this.lobbyNote.set({ ok: false, text: 'That is no lobby address (ws:// or wss://).' });
      return;
    }
    this.newLobbyName.set('');
    this.newLobbyUrl.set('');
    this.addingLobby.set(false);
    void this.checkLobby();
  }

  /** Whether the lobby just added answers and takes this version */
  async checkLobby(): Promise<void> {
    const lobby = this.coop().lobby();
    if (!lobby) return;
    this.lobbyNote.set({ ok: true, text: 'Asking…' });
    this.lobbyNote.set(await this.coop().probeLobby(lobby.url));
  }

  removeLobby(url: string): void {
    this.coop().removeLobby(url);
    this.lobbyNote.set(null);
  }

  /** Stop connecting: no room, no world coming */
  cancelConnect(): void {
    this.coop().intent.set(null);
    this.coop().leave();
  }

  installUpdate(): void {
    this.coop().installUpdate();
  }
}

/** The way stored last time, Online without one */
function readWay(): CoopWay {
  return readText(WAY_KEY) === 'lan' ? 'lan' : 'online';
}

/** Why a room of the public list cannot be joined from here, null when it can */
function publicRefusal(room: PublicRoom): string | null {
  if (room.gameVersion !== BUILD_VERSION) return `The host plays ${room.gameVersion || 'another version'}, you play ${BUILD_VERSION}.`;
  if (room.started) return 'The game has started; joining a running game comes later.';
  if (room.players >= MAX_PLAYERS) return 'The room is full.';
  return null;
}

/** Why a LAN game cannot be joined from here, null when it can */
function lanRefusal(game: LanGame): string | null {
  if (game.protocol !== PROTOCOL_VERSION || game.gameVersion !== BUILD_VERSION) {
    return `The host plays ${game.gameVersion || 'another version'}, you play ${BUILD_VERSION}. Both need the same version.`;
  }
  if (game.players >= MAX_PLAYERS) return 'The room is full.';
  return null;
}
