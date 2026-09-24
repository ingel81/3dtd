import { Component, computed, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { TdIconComponent } from '../icon/icon.component';
import { CoopService } from '../../services/coop.service';
import { SPAWN_COLORS } from '../../configs/map-constants.config';

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
  readonly coop = inject(CoopService);

  readonly name = signal(this.coop.name);
  readonly code = signal(this.coop.roomFromUrl ?? '');
  readonly chatLine = signal('');
  readonly copied = signal(false);

  readonly me = computed(() => this.coop.room()?.players.find((p) => p.id === this.coop.playerId()) ?? null);
  readonly canStart = computed(() => {
    const room = this.coop.room();
    return !!room && this.coop.isHost() && this.coop.worldReady()
      && room.players.length > 0 && room.players.every((p) => p.spawnId !== null && p.ready);
  });
  readonly inviteLink = computed(() => {
    const room = this.coop.room();
    return room ? `${window.location.origin}${window.location.pathname}?room=${room.code}` : '';
  });

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

  sendChat(): void {
    this.coop.sendChat(this.chatLine());
    this.chatLine.set('');
  }

  nameOf(playerId: string): string {
    return this.coop.room()?.players.find((p) => p.id === playerId)?.name ?? playerId;
  }

  close(): void {
    this.dialogRef.close();
  }
}
