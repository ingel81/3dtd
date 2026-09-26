import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { TdIconComponent } from '../icon/icon.component';
import { CoopEntryComponent } from '../coop-entry/coop-entry.component';
import { CoopJoinStepsComponent } from './coop-join-steps.component';
import { CoopRoomTableComponent } from './coop-room-table.component';
import { CoopRoomOptionsComponent } from './coop-room-options.component';
import { CoopLobbyChatComponent } from './coop-lobby-chat.component';
import { CoopService } from '../../services/coop.service';
import { UIStore } from '../../store/ui.store';
import { LocationManagementService } from '../../services/location/location-management.service';
import { TICK_SUB_STEPS } from '../../coop/lockstep';
import { GameClock } from '../../managers/game-state/game-clock';
import { ABILITY_BAR_EDGE_PX, ABILITY_BAR_PX } from '../ability-bar/ability-button';
import { desyncText, dockBanners, roomStatus, startBlocked } from './coop-dock-view';
import { ownsKey } from '../../utils/keyboard-target';

/** How long "Copied" stays on a copy button, ms */
const COPIED_MS = 1200;

/**
 * The coop dock (docs/COOP_PLAN.md, C8, D41; the layout
 * docs/COOP_UI_REWORK_PLAN.md, P5): right of the ability bar, from below
 * the info overlay down to the logo row, without a veil; the map stays
 * usable beside it. Not in a room it opens or joins one (app-coop-entry);
 * joining it shows the handshake (app-coop-join-steps); in the room it
 * holds code and invite, the public listing, who we wait on, one warning,
 * the table of lanes and players, the options and, in a column of its own,
 * the chat. The frame and the foot live here, the parts in their own
 * components. The header chip, Tab and Esc open and close it
 * (UIStore.coopDockOpen); closing leaves the room open.
 */
@Component({
  selector: 'app-coop-dock',
  standalone: true,
  imports: [
    MatTooltipModule, TdIconComponent, CoopEntryComponent, CoopJoinStepsComponent,
    CoopRoomTableComponent, CoopRoomOptionsComponent, CoopLobbyChatComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[style.left.px]': 'left',
    '[style.top.px]': 'top()',
    '[style.--td-dock-top]': "top() + 'px'",
    '[class.is-short]': '!coop.room() || joining()',
    // A region beside the map, not a modal dialog: the focus stays where it was (plan T11)
    role: 'region',
    'aria-labelledby': 'td-coop-dock-title',
    '(document:click)': 'closeMore($event)',
    '(keydown.escape)': 'escapeField($event)',
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
  private readonly locationMgmt = inject(LocationManagementService);
  private readonly more = viewChild<ElementRef<HTMLElement>>('more');

  protected readonly left = ABILITY_BAR_EDGE_PX + ABILITY_BAR_PX.clear;
  /** Level with the ability bar's top: below the info overlay, which grows and folds */
  protected readonly top = computed(() => this.uiStore.infoOverlayBottom() + ABILITY_BAR_PX.clear);

  /** Which copy button shows "Copied" for a moment */
  readonly copied = signal<'code' | 'link' | null>(null);
  readonly moreOpen = signal(false);
  /** Every banner shown, not only the worst */
  readonly allBanners = signal(false);
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
    if (this.coop.intent() !== 'join' || this.room()?.started) return false;
    if (status === 'connecting' || status === 'loading-world') return true;
    return !!this.room() && !this.coop.isHost() && (!this.coop.worldReady() || !this.me()?.spawnId);
  });

  readonly status = computed(() => roomStatus({
    room: this.room(),
    isHost: this.coop.isHost(),
    myId: this.coop.playerId(),
    worldReady: this.coop.worldReady(),
    hostName: this.hostName(),
  }));
  readonly startBlocked = computed(() => startBlocked(this.room(), this.coop.worldReady(), this.coop.lanesWithoutRoute()));

  /** Desync, mixed engines, a map change: the worst first (plan G7) */
  readonly banners = computed(() => {
    const desync = this.coop.desync();
    return dockBanners({
      desync: desync
        ? desyncText(desync.outOfStep, gameSecond(desync.tick), this.coop.playerId(), (id) => this.coop.nameOf(id))
        : null,
      hostChangingMap: this.coop.hostChangingMap(),
      mixedEngines: this.coop.mixedEngines(),
    });
  });

  constructor() {
    // "Copied" goes after a moment; a later copy or closing the dock ends the timer
    effect((onCleanup) => {
      if (!this.copied()) return;
      const timer = setTimeout(() => this.copied.set(null), COPIED_MS);
      onCleanup(() => clearTimeout(timer));
    });
  }

  /** A click beside the More menu closes it */
  closeMore(event: MouseEvent): void {
    const more = this.more()?.nativeElement;
    if (this.moreOpen() && more && !event.composedPath().includes(more)) this.moreOpen.set(false);
  }

  async copy(what: 'code' | 'link'): Promise<void> {
    const text = what === 'code' ? this.room()?.code ?? '' : this.coop.inviteLink();
    try {
      await navigator.clipboard.writeText(text);
      this.copied.set(what);
    } catch {
      /* no clipboard: the code stays on screen */
    }
  }

  resendMap(): void {
    this.moreOpen.set(false);
    this.coop.shareWorld();
  }

  start(): void {
    if (this.startBlocked() === null) this.coop.start();
  }

  readyUp(): void {
    if (this.me()?.spawnId) this.coop.setLobbyReady(true);
  }

  leave(): void {
    this.coop.intent.set(null);
    this.coop.leave();
  }

  /**
   * Esc in a field of the dock (code, name, lobby select) closes the dock too:
   * the Esc chain of the HotkeyService leaves keys a field takes alone
   */
  escapeField(event: Event): void {
    if (!ownsKey(event.target, 'Escape')) return;
    event.preventDefault();
    this.close();
  }

  close(): void {
    this.uiStore.coopDockOpen.set(false);
  }
}

/** The game second a lockstep tick stands at */
function gameSecond(tick: number): string {
  return ((tick * TICK_SUB_STEPS * GameClock.FIXED_STEP_MS) / 1000).toFixed(0);
}
