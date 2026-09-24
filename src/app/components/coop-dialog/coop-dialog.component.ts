import { Component, computed, effect, inject, signal, untracked, ChangeDetectionStrategy } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { UIStore } from '../../store/ui.store';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { TdIconComponent } from '../icon/icon.component';
import { CoopService } from '../../services/coop.service';
import { SPAWN_COLORS } from '../../configs/map-constants.config';
import { TICK_SUB_STEPS } from '../../coop/lockstep';
import { clientLabel } from '../../coop/client-info';
import { relayLabel, type RelaySource } from '../../coop/relay-address';
import { GameClock } from '../../managers/game-state/game-clock';

/** Gap between the info overlay and the docked lobby, px */
const DOCK_GAP_PX = 8;

/**
 * Coop (docs/COOP_PLAN.md, C4): open a room or join one, then the lobby:
 * lanes, ready, start; in the game the players and a chat line. Everything
 * it shows comes from CoopService.
 */
@Component({
  selector: 'app-coop-dialog',
  standalone: true,
  imports: [MatDialogModule, MatTooltipModule, TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './coop-dialog.component.html',
  styleUrl: './coop-dialog.component.scss',
  styles: `
    :host {
      ${TD_CSS_VARS}
    }
  `,
})
export class CoopDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<CoopDialogComponent>);
  private readonly docked = inject<{ docked?: boolean } | null>(MAT_DIALOG_DATA, { optional: true })?.docked ?? false;
  private readonly uiStore = inject(UIStore);
  readonly coop = inject(CoopService);

  readonly name = signal(this.coop.name);
  readonly code = signal(this.coop.roomFromUrl ?? '');
  readonly chatLine = signal('');
  readonly copied = signal(false);
  readonly clientLabel = clientLabel;
  readonly relayLabel = relayLabel;
  readonly relaySourceText: Record<RelaySource, string> = {
    link: ', from the invite link',
    setting: ', your setting',
    config: '',
    auto: '',
  };
  readonly relaySetting = signal(this.coop.relaySetting);
  readonly relayInvalid = signal(false);
  /** The last check of the server field, null before one */
  readonly relayProbe = signal<{ ok: boolean; text: string; busy: boolean } | null>(null);

  readonly me = computed(() => this.coop.room()?.players.find((p) => p.id === this.coop.playerId()) ?? null);
  /**
   * What the start still waits for, in words; null once it can start. The
   * host's Start is the host's ready, so only the others need to say it.
   */
  readonly startHint = computed(() => {
    const room = this.coop.room();
    if (!room) return null;
    if (!this.coop.worldReady()) return this.coop.isHost() ? 'Sending the map…' : "Waiting for the host's map…";
    const noLane = room.players.filter((p) => p.spawnId === null).map((p) => p.name);
    if (noLane.length > 0) return `Waiting for ${noLane.join(', ')} to take a lane.`;
    const notReady = room.players.filter((p) => p.id !== room.hostId && !p.ready).map((p) => p.name);
    if (notReady.length > 0) return `Waiting for ${notReady.join(', ')} to be ready.`;
    if (room.players.length === 1) return this.coop.isHost() ? 'Alone so far: send the invite link to a second player.' : null;
    return this.coop.isHost() ? 'Everyone is ready: start when you like.' : 'Everyone is ready: waiting for the host to start.';
  });
  readonly canStart = computed(() => {
    const room = this.coop.room();
    return !!room && this.coop.isHost() && this.coop.worldReady() && room.players.length > 1
      && room.players.every((p) => p.spawnId !== null && (p.ready || p.id === room.hostId));
  });
  readonly inviteLink = computed(() => (this.coop.room() ? this.coop.inviteLink() : ''));
  /** Fewer spawns on the map than players in the room: someone has no lane */
  readonly tooFewLanes = computed(() => {
    const room = this.coop.room();
    return !!room && room.spawnIds.length > 0 && room.spawnIds.length < room.players.length;
  });

  constructor() {
    // Docked beside the map: below the info overlay (FPS and friends), which
    // grows and folds; its bottom is measured from the top of the map area
    if (this.docked) {
      effect(() => {
        const below = this.uiStore.infoOverlayBottom();
        const mapTop = document.querySelector('.td-canvas-area')?.getBoundingClientRect().top ?? 56;
        const top = Math.round(mapTop + below + DOCK_GAP_PX);
        this.dialogRef.updatePosition({ left: '12px', top: `${top}px` });
        // Its height ends above the window's bottom (styles.scss, .td-coop-docked)
        document.documentElement.style.setProperty('--td-coop-dock-top', `${top}px`);
      });
    }

    // The game starts: the dialog steps aside, for the host (its Start button) and every guest alike
    let before = this.coop.status();
    effect(() => {
      const status = this.coop.status();
      if (status === 'in-game' && before !== 'in-game') untracked(() => this.close());
      before = status;
    });
  }

  /** CSS colour of a lane: the spawn's colour, by its place in the host's list */
  laneColor(spawnId: string | null): string {
    const index = spawnId === null ? -1 : this.coop.room()?.spawnIds.indexOf(spawnId) ?? -1;
    if (index < 0) return 'transparent';
    return `#${SPAWN_COLORS[index % SPAWN_COLORS.length].toString(16).padStart(6, '0')}`;
  }

  laneTaken(spawnId: string): boolean {
    return this.coop.room()?.players.some((p) => p.spawnId === spawnId && p.id !== this.coop.playerId()) ?? false;
  }

  host(): void {
    void this.coop.host(this.name().trim() || 'Player');
  }

  join(): void {
    if (this.code().trim()) void this.coop.join(this.name().trim() || 'Player', this.code());
  }

  async copyInvite(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.inviteLink());
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1500);
    } catch {
      /* no clipboard: the link stays on screen */
    }
  }

  /** Saved and checked at once (playtest T14); an invalid address is not tried */
  /** "2:44", the time a standard enemy walks a lane */
  walkTime(seconds: number): string {
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }

  /** Who has the lane, "" for a free one */
  laneOwner(spawnId: string): string {
    const owner = this.coop.room()?.players.find((p) => p.spawnId === spawnId);
    return owner ? (owner.id === this.coop.playerId() ? 'you' : owner.name) : '';
  }

  /** Host: set spawn `index` anew on the map; the panel stays open beside it */
  moveSpawn(index: number): void {
    this.coop.moveSpawn(index);
  }

  saveRelay(value: string): void {
    const ok = this.coop.setRelaySetting(value);
    this.relayInvalid.set(!ok);
    this.relayProbe.set(null);
    if (!ok) return;
    this.relaySetting.set(this.coop.relaySetting);
    void this.testRelay();
  }

  /** Whether a relay answers where the game would look now: the field's address, or the automatic ones */
  async testRelay(): Promise<void> {
    if (this.relayInvalid()) return;
    this.relayProbe.set({ ok: true, text: 'Trying…', busy: true });
    const result = await this.coop.probeRelay();
    this.relayProbe.set({ ...result, busy: false });
  }

  sendChat(): void {
    this.coop.sendChat(this.chatLine());
    this.chatLine.set('');
  }

  nameOf(playerId: string): string {
    return this.coop.room()?.players.find((p) => p.id === playerId)?.name ?? playerId;
  }

  /** The game second a tick stands at */
  desyncSecond(tick: number): string {
    return ((tick * TICK_SUB_STEPS * GameClock.FIXED_STEP_MS) / 1000).toFixed(0);
  }

  close(): void {
    this.dialogRef.close();
  }
}
