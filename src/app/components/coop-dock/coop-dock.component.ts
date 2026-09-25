import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { TdIconComponent } from '../icon/icon.component';
import { PingBarsComponent } from '../coop-ui/ping-bars.component';
import { chatView } from '../coop-ui/chat-view';
import { CoopService } from '../../services/coop.service';
import { UIStore } from '../../store/ui.store';
import { GameStateManager } from '../../managers/game-state.manager';
import { CameraControlService } from '../../services/camera-control.service';
import { EngineInitializationService } from '../../services/infrastructure/engine-initialization.service';
import { LocationManagementService } from '../../services/location/location-management.service';
import { SPAWN_COLORS } from '../../configs/map-constants.config';
import { MAX_PLAYERS, PROTOCOL_VERSION, type PlayerStatus } from '../../coop/protocol';
import { BUILD_VERSION } from '../../configs/build-info.config';
import type { LanGame } from '../../core/desktop-bridge';
import { clientLabel } from '../../coop/client-info';
import { relayLabel } from '../../coop/relay-address';
import { ROOM_OPTION_CHOICES, optionLabel, type RoomOptionKey } from '../../coop/room-options';
import { TICK_SUB_STEPS } from '../../coop/lockstep';
import { GameClock } from '../../managers/game-state/game-clock';
import { ABILITY_BAR_EDGE_PX, ABILITY_BAR_PX } from '../ability-bar/ability-button';

/** What a player's client is doing, in their row (User, 2026-09-25); 'ready' says nothing */
const STATUS_TEXT: Partial<Record<PlayerStatus, string>> = {
  key: 'Entering their map key…',
  loading: 'Loading the map…',
  reloading: 'Reloading for the new place…',
};

/** The LAN scan found nothing this long: offer the host IP field and the checklist (D54), ms */
const LAN_QUIET_MS = 4000;

/** How long "Copied" stays on a copy button, ms */
const COPIED_MS = 1200;

/** A step of joining a room as it goes (the guest's handshake) */
interface JoinStep {
  label: string;
  meta: string;
  state: 'done' | 'now' | 'todo';
}

/**
 * The coop dock (docs/COOP_PLAN.md, C8, D41): right of the ability bar, from
 * below the info overlay down to the logo row, without a veil; the map
 * stays usable beside it. Not in a room it opens or joins one; joining it
 * shows the handshake step by step; in the room it holds code and invite,
 * who we wait on, players, lanes, the room's options and the chat. In the
 * game the same dock, options read only. The header chip and Tab open and
 * close it (UIStore.coopDockOpen); closing leaves the room open.
 */
@Component({
  selector: 'app-coop-dock',
  standalone: true,
  imports: [MatTooltipModule, NgTemplateOutlet, TdIconComponent, PingBarsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[style.left.px]': 'left',
    '[style.top.px]': 'top()',
    '[style.--td-dock-top]': "top() + 'px'",
    '[class.is-short]': '!coop.room() || joining()',
    role: 'dialog',
    'aria-labelledby': 'td-coop-dock-title',
  },
  templateUrl: './coop-dock.component.html',
  styleUrl: './coop-dock.component.scss',
  styles: `
    :host {
      ${TD_CSS_VARS}
    }
  `,
})
export class CoopDockComponent {
  readonly coop = inject(CoopService);
  private readonly uiStore = inject(UIStore);
  private readonly gameState = inject(GameStateManager);
  private readonly camera = inject(CameraControlService);
  private readonly engineInit = inject(EngineInitializationService);
  private readonly locationMgmt = inject(LocationManagementService);
  private readonly chatBox = viewChild<ElementRef<HTMLElement>>('chatBox');

  protected readonly left = ABILITY_BAR_EDGE_PX + ABILITY_BAR_PX.clear;
  /** Level with the ability bar's top: below the info overlay, which grows and folds */
  protected readonly top = computed(() => this.uiStore.infoOverlayBottom() + ABILITY_BAR_PX.clear);
  protected readonly maxPlayers = MAX_PLAYERS;
  protected readonly options = ROOM_OPTION_CHOICES;
  protected readonly optionLabel = optionLabel;
  protected readonly clientLabel = clientLabel;
  protected readonly relayLabel = relayLabel;

  readonly name = signal(this.coop.name);
  readonly code = signal(this.coop.roomFromUrl ?? '');
  readonly chatLine = signal('');
  /** Which copy button shows "Copied" for a moment */
  readonly copied = signal<'code' | 'link' | null>(null);
  /** Mode & options open: for the host from the start, who sets them (PLAYTEST T58) */
  readonly optionsOpen = signal(this.coop.isHost());
  readonly moreOpen = signal(false);
  /** What the player asked for here: the joining steps are a guest's */
  private readonly intent = signal<'host' | 'join' | null>(this.coop.roomFromUrl ? 'join' : null);
  readonly relaySetting = signal(this.coop.relaySetting);
  readonly relayInvalid = signal(false);
  readonly relayProbe = signal<{ ok: boolean; text: string; busy: boolean } | null>(null);
  /** The LAN scan has found nothing for a while */
  readonly lanQuiet = signal(false);
  readonly hostIp = signal('');
  readonly lanProbe = signal<'busy' | 'none' | null>(null);
  /** LAN games, each with why it cannot be joined where it cannot */
  readonly lanGames = computed(() => this.coop.lanGames().map((game) => ({ ...game, why: lanRefusal(game) })));
  /** All of the host's addresses, for the tooltip: "192.168.1.20 (Ethernet)"; the first is shown */
  readonly lanAddressText = computed(() =>
    this.coop.lanAddresses().map((a) => `${a.address} (${a.name})`).join(' · '));

  readonly room = this.coop.room;
  readonly me = computed(() => this.room()?.players.find((p) => p.id === this.coop.playerId()) ?? null);
  readonly hostName = computed(() => this.coop.nameOf(this.room()?.hostId ?? ''));
  readonly placeName = computed(() => this.locationMgmt.getLocationDisplayName());

  /** Joining as a guest, until the map stands here and this player has a lane */
  readonly joining = computed(() => {
    const status = this.coop.status();
    if (this.intent() !== 'join' || this.room()?.started) return false;
    if (status === 'connecting' || status === 'loading-world') return true;
    return !!this.room() && !this.coop.isHost() && (!this.coop.worldReady() || !this.me()?.spawnId);
  });

  /** Share of the loading screen's steps done, while the engine loads a place */
  private readonly mapProgress = computed(() => {
    if (!this.engineInit.loading()) return null;
    const steps = this.engineInit.loadingSteps();
    return steps.length ? Math.round((steps.filter((s) => s.status === 'done').length / steps.length) * 100) : null;
  });

  readonly joinSteps = computed<JoinStep[]>(() => {
    const status = this.coop.status();
    const room = this.room();
    const relay = this.coop.relay();
    const progress = this.mapProgress();
    const step = (label: string, meta: string, done: boolean, now: boolean): JoinStep =>
      ({ label, meta, state: done ? 'done' : now ? 'now' : 'todo' });
    return [
      step('Connected to server', relay ? relayLabel(relay.url) : '', !!room || status === 'lobby', status === 'connecting'),
      step('Room found', room ? `${room.players.length}/${MAX_PLAYERS} players` : '', !!room, false),
      step("Loading the host's map", progress === null ? '' : `${progress} %`, this.coop.worldReady(), status === 'loading-world'),
      step('Taking a seat', '', !!this.me()?.spawnId, this.coop.worldReady()),
    ];
  });
  readonly mapPercent = computed(() => this.mapProgress() ?? 0);

  /** Every guest is ready; the host always is (D40) */
  readonly guestsReady = computed(() => {
    const room = this.room();
    return !!room && room.players.every((p) => p.id === room.hostId || p.ready);
  });

  /** The status line: who we wait on, or that all are ready */
  readonly status = computed(() => {
    const room = this.room();
    if (!room) return null;
    const host = this.coop.isHost();
    const ready = room.players.filter((p) => p.id === room.hostId || p.ready).length;
    const segments = room.players.map((p) => p.id === room.hostId || p.ready);
    if (room.players.length < 2) {
      return { go: false, segments: [...segments, false], lead: '', text: 'Waiting for a second player · share the code', bold: '' };
    }
    if (!this.coop.worldReady()) {
      return { go: false, segments, lead: '', text: host ? 'Sending the map…' : "Waiting for the host's map…", bold: '' };
    }
    const busy = room.players.find((p) => p.id !== this.coop.playerId() && (p.status === 'key' || p.status === 'loading' || p.status === 'reloading'));
    if (busy) {
      const what = busy.status === 'key' ? ' to enter their map key' : busy.status === 'reloading' ? ' to reload' : ' to load the map';
      return { go: false, segments, lead: 'Waiting for ', bold: busy.name, text: what };
    }
    const noLane = room.players.find((p) => p.spawnId === null);
    if (noLane) return { go: false, segments, lead: 'Waiting for ', bold: noLane.name, text: ' to take a lane' };
    if (this.guestsReady()) {
      return host
        ? { go: true, segments, lead: '', bold: 'Everyone is ready.', text: ' Start when you like.' }
        : { go: true, segments, lead: '', bold: "You're ready.", text: ` Waiting for ${this.hostName()} to start.` };
    }
    if (!host && !this.me()?.ready) return { go: false, segments, lead: 'Pick a lane, then ', bold: 'ready up', text: '' };
    const waiting = room.players.find((p) => p.id !== room.hostId && !p.ready)!;
    return { go: false, segments, lead: 'Waiting for ', bold: waiting.name, text: ` to ready up (${ready}/${room.players.length})` };
  });

  /** Why Start is off, for its tooltip; null when it can start */
  readonly startBlocked = computed(() => {
    const room = this.room();
    if (!room) return 'No room';
    if (room.players.length < 2) return 'Needs a second player';
    if (!this.coop.worldReady()) return 'The map is still being sent';
    const waiting = room.players.find((p) => p.spawnId === null || (p.id !== room.hostId && !p.ready));
    return waiting ? `Waiting for ${waiting.name}` : null;
  });

  readonly lanes = computed(() => {
    const room = this.room();
    if (!room) return [];
    const stats = this.coop.lanes();
    return room.spawnIds.map((spawnId, index) => {
      const owner = room.players.find((p) => p.spawnId === spawnId) ?? null;
      const stat = stats.get(spawnId);
      return {
        spawnId,
        index,
        label: `Spawn ${index + 1}`,
        color: this.laneColor(index),
        share: stat?.share ?? 0,
        length: stat ? `${stat.meters} m · ${walkTime(stat.seconds)}` : '',
        mine: owner?.id === this.coop.playerId(),
        owner: owner?.name ?? null,
      };
    });
  });

  readonly players = computed(() => {
    const room = this.room();
    if (!room) return [];
    return room.players.map((p) => ({
      ...p,
      me: p.id === this.coop.playerId(),
      host: p.id === room.hostId,
      lane: p.spawnId === null ? 'No lane yet' : `Spawn ${room.spawnIds.indexOf(p.spawnId) + 1}`,
      doing: p.status ? STATUS_TEXT[p.status] ?? null : null,
      color: p.spawnId === null ? 'transparent' : this.laneColor(room.spawnIds.indexOf(p.spawnId)),
      ready: p.id === room.hostId || p.ready,
      latency: this.coop.latencyTo(p.id),
      lagging: this.coop.lagging(p.id),
      left: this.coop.leftIds().has(p.id),
    }));
  });
  readonly freeSeat = computed(() => (this.room()?.players.length ?? 0) < 2);

  readonly chat = computed(() => chatView(this.coop.chat(), (id) => this.coop.nameOf(id), (id) => this.coop.laneColorOf(id)));

  /** The options as chips while the block is closed; cheats warn when not off */
  readonly optionChips = computed(() => {
    const values = this.coop.options();
    return ROOM_OPTION_CHOICES.map((o) => ({
      key: o.key,
      text: `${o.label} ${optionLabel(o.key, values[o.key])}`,
      warn: o.key === 'cheats' && values.cheats !== 'off',
    }));
  });
  /** The host may set options: in the lobby only */
  readonly canEditOptions = computed(() => this.coop.isHost() && !this.room()?.started);

  constructor() {
    // Look for LAN games while the dock offers them: not in a room, not on the way into one
    let quietTimer: ReturnType<typeof setTimeout> | null = null;
    let scanning = false;
    effect(() => {
      const on = this.coop.lanAvailable && !this.room() && !this.joining() && this.coop.status() !== 'connecting';
      if (on === scanning) return;
      scanning = on;
      untracked(() => {
        this.lanQuiet.set(false);
        if (quietTimer) clearTimeout(quietTimer);
        quietTimer = null;
        this.coop.scanLan(on);
        if (on) quietTimer = setTimeout(() => this.lanQuiet.set(this.coop.lanGames().length === 0), LAN_QUIET_MS);
      });
    });
    inject(DestroyRef).onDestroy(() => {
      if (quietTimer) clearTimeout(quietTimer);
      this.coop.scanLan(false);
    });
    // Becoming the host of a new room opens the options, which the host sets
    let wasHost = this.coop.isHost();
    effect(() => {
      const host = this.coop.isHost();
      if (host && !wasHost) this.optionsOpen.set(true);
      wasHost = host;
    });
    // The game starts: the dock steps aside for the squad box; Tab brings it back
    let before = this.coop.status();
    effect(() => {
      const status = this.coop.status();
      if (status === 'in-game' && before !== 'in-game') this.close();
      before = status;
    });
    // The newest chat line in view
    effect(() => {
      this.chat();
      const box = this.chatBox()?.nativeElement;
      if (box) queueMicrotask(() => { box.scrollTop = box.scrollHeight; });
    });
  }

  /** Whose game ran apart, where a majority says (S3) */
  desyncWho(outOfStep: readonly string[]): string {
    const me = this.coop.playerId();
    if (me !== null && outOfStep.includes(me)) return 'Your game ran apart from the others';
    if (outOfStep.length) return `${outOfStep.map((id) => this.coop.nameOf(id)).join(' and ')}'s game ran apart from the others`;
    return 'The games ran apart';
  }

  optionValue(key: RoomOptionKey): string {
    return this.coop.options()[key];
  }

  /** A cheat choice other than Off, where the relay does not allow cheats at all */
  cheatsImpossible(key: RoomOptionKey, value: string): boolean {
    return key === 'cheats' && value !== 'off' && !(this.room()?.cheats ?? false);
  }

  laneColor(index: number): string {
    if (index < 0) return 'transparent';
    return `#${SPAWN_COLORS[index % SPAWN_COLORS.length].toString(16).padStart(6, '0')}`;
  }

  host(): void {
    this.intent.set('host');
    void this.coop.host(this.name().trim() || 'Player');
  }

  hostLan(): void {
    this.intent.set('host');
    void this.coop.hostLan(this.name().trim() || 'Player');
  }

  joinLan(game: LanGame): void {
    this.intent.set('join');
    void this.coop.joinLan(this.name().trim() || 'Player', game);
  }

  async probeLan(): Promise<void> {
    const ip = this.hostIp().trim();
    if (!ip) return;
    this.lanProbe.set('busy');
    this.lanProbe.set((await this.coop.probeLan(ip)) ? null : 'none');
  }

  join(): void {
    if (!this.code().trim()) return;
    this.intent.set('join');
    void this.coop.join(this.name().trim() || 'Player', this.code().trim().toUpperCase());
  }

  /** A free lane: take it; the own one: give it back */
  takeLane(spawnId: string, mine: boolean, owner: string | null): void {
    if (this.room()?.started || (owner && !mine)) return;
    this.coop.pick(mine ? null : spawnId);
  }

  /** The camera to the lane's spawn */
  flyTo(spawnId: string): void {
    const spawn = this.gameState.getSpawnPoints().find((s) => s.id === spawnId);
    if (spawn) this.camera.focusGeo(spawn.lat, spawn.lon);
  }

  async copy(what: 'code' | 'link'): Promise<void> {
    const text = what === 'code' ? this.room()?.code ?? '' : this.coop.inviteLink();
    try {
      await navigator.clipboard.writeText(text);
      this.copied.set(what);
      setTimeout(() => this.copied.set(null), COPIED_MS);
    } catch {
      /* no clipboard: the code stays on screen */
    }
  }

  resendMap(): void {
    this.moreOpen.set(false);
    this.coop.shareWorld();
  }

  sendChat(): void {
    this.coop.sendChat(this.chatLine());
    this.chatLine.set('');
  }

  saveRelay(value: string): void {
    const ok = this.coop.setRelaySetting(value);
    this.relayInvalid.set(!ok);
    this.relayProbe.set(null);
    if (!ok) return;
    this.relaySetting.set(this.coop.relaySetting);
    void this.testRelay();
  }

  /** Whether a relay answers where the game would look now (playtest T14) */
  async testRelay(): Promise<void> {
    if (this.relayInvalid()) return;
    this.relayProbe.set({ ok: true, text: 'Trying…', busy: true });
    const result = await this.coop.probeRelay();
    this.relayProbe.set({ ...result, busy: false });
  }

  leave(): void {
    this.intent.set(null);
    this.coop.leave();
  }

  /** The game second a tick stands at */
  desyncSecond(tick: number): string {
    return ((tick * TICK_SUB_STEPS * GameClock.FIXED_STEP_MS) / 1000).toFixed(0);
  }

  close(): void {
    this.uiStore.coopDockOpen.set(false);
  }
}

/** "3:47", the time a standard enemy walks a lane */
function walkTime(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Why a LAN game cannot be joined from here, null when it can */
function lanRefusal(game: LanGame): string | null {
  if (game.protocol !== PROTOCOL_VERSION || game.gameVersion !== BUILD_VERSION) {
    return `The host plays version ${game.gameVersion || 'unknown'}, you play ${BUILD_VERSION}. Update both to the same version.`;
  }
  if (game.players >= MAX_PLAYERS) return 'The room is full.';
  return null;
}
