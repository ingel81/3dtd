import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { TdIconComponent } from '../icon/icon.component';
import type { CoopService } from '../../services/coop.service';
import { MAX_PLAYERS, PROTOCOL_VERSION } from '../../coop/protocol';
import { BUILD_VERSION } from '../../configs/build-info.config';
import type { LanGame } from '../../core/desktop-bridge';

/** The LAN scan found nothing this long: offer the host IP field and the checklist (D54), ms */
const LAN_QUIET_MS = 4000;

/**
 * The way into a coop room (docs/COOP_PLAN.md, D61, D67): the player's name,
 * "Same network" in the desktop app (host a LAN game, the games found, the
 * host IP field) and "Online" over the active lobby (host, room code, the
 * lobbies behind a gear). The coop dock shows it with hosting; the location
 * dialog of a start without a place shows it for joining only (E30), which
 * is why the service comes in as an input: the dialog lives outside the game
 * component that provides it.
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

  readonly name = signal('');
  readonly code = signal('');
  /** The LAN scan has found nothing for a while */
  readonly lanQuiet = signal(false);
  readonly hostIp = signal('');
  readonly lanProbe = signal<'busy' | 'none' | null>(null);
  /** The refresh button turns for a moment after a click */
  readonly rescanning = signal(false);
  /** LAN games, each with why it cannot be joined where it cannot */
  readonly lanGames = computed(() => this.coop().lanGames().map((game) => ({ ...game, why: lanRefusal(game) })));

  /** The lobby menu behind the gear */
  readonly lobbyMenu = signal(false);
  readonly newLobbyName = signal('');
  readonly newLobbyUrl = signal('');
  readonly lobbyNote = signal<{ ok: boolean; text: string } | null>(null);

  readonly busy = computed(() => this.coop().status() === 'connecting');

  constructor() {
    let started = false;
    effect(() => {
      const coop = this.coop();
      if (started) return;
      started = true;
      untracked(() => {
        this.name.set(coop.name);
        this.code.set(coop.roomFromUrl ?? '');
      });
    });
    // Look for LAN games while this is shown, not while connecting
    let quietTimer: ReturnType<typeof setTimeout> | null = null;
    let scanning = false;
    effect(() => {
      const coop = this.coop();
      const on = coop.lanAvailable && coop.status() !== 'connecting' && !coop.room();
      if (on === scanning) return;
      scanning = on;
      untracked(() => {
        this.lanQuiet.set(false);
        if (quietTimer) clearTimeout(quietTimer);
        quietTimer = null;
        coop.scanLan(on);
        if (on) quietTimer = setTimeout(() => this.lanQuiet.set(coop.lanGames().length === 0), LAN_QUIET_MS);
      });
    });
    inject(DestroyRef).onDestroy(() => {
      if (quietTimer) clearTimeout(quietTimer);
      if (scanning) this.coop().scanLan(false);
    });
  }

  private playerName(): string {
    return this.name().trim() || 'Player';
  }

  hostLan(): void {
    void this.coop().hostLan(this.playerName());
  }

  hostOnline(): void {
    void this.coop().host(this.playerName());
  }

  joinLan(game: LanGame): void {
    void this.coop().joinLan(this.playerName(), game);
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
    this.lanQuiet.set(false);
    this.rescanning.set(true);
    setTimeout(() => {
      this.rescanning.set(false);
      this.lanQuiet.set(coop.lanGames().length === 0);
    }, LAN_QUIET_MS);
  }

  async probeLan(): Promise<void> {
    const ip = this.hostIp().trim();
    if (!ip) return;
    this.lanProbe.set('busy');
    this.lanProbe.set((await this.coop().probeLan(ip)) ? null : 'none');
  }

  addLobby(): void {
    const ok = this.coop().addLobby(this.newLobbyName(), this.newLobbyUrl());
    if (!ok) {
      this.lobbyNote.set({ ok: false, text: 'That is no lobby address (ws:// or wss://).' });
      return;
    }
    this.newLobbyName.set('');
    this.newLobbyUrl.set('');
    void this.checkLobby();
  }

  async checkLobby(): Promise<void> {
    const lobby = this.coop().lobby();
    if (!lobby) return;
    this.lobbyNote.set({ ok: true, text: 'Asking…' });
    this.lobbyNote.set(await this.coop().probeLobby(lobby.url));
  }

  installUpdate(): void {
    this.coop().installUpdate();
  }
}

/** Why a LAN game cannot be joined from here, null when it can */
function lanRefusal(game: LanGame): string | null {
  if (game.protocol !== PROTOCOL_VERSION || game.gameVersion !== BUILD_VERSION) {
    return `The host plays ${game.gameVersion || 'another version'}, you play ${BUILD_VERSION}. Both need the same version.`;
  }
  if (game.players >= MAX_PLAYERS) return 'The room is full.';
  return null;
}
