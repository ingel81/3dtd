import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { TdIconComponent } from '../icon/icon.component';
import { PingBarsComponent } from '../coop-ui/ping-bars.component';
import { CoopService } from '../../services/coop.service';
import { GameStateManager } from '../../managers/game-state.manager';
import { CameraControlService } from '../../services/camera-control.service';
import { MAX_PLAYERS } from '../../coop/protocol';
import { clientLabel } from '../../coop/client-info';
import { roomTable, type LaneRow } from './coop-dock-view';

/**
 * Lanes and players of the coop room as one table (docs/COOP_UI_REWORK_PLAN.md,
 * U4): a row per lane with its colour, length and the player on it, their
 * ready state and ping, and what the host and the player may do there; the
 * players without a lane after it; a free seat while alone. In the lobby and
 * in the game, the lane tools only in the lobby.
 */
@Component({
  selector: 'app-coop-room-table',
  standalone: true,
  imports: [NgTemplateOutlet, MatTooltipModule, TdIconComponent, PingBarsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './coop-room-table.component.html',
  styleUrl: './coop-room-table.component.scss',
  styles: `
    :host {
      ${TD_CSS_VARS}
    }
  `,
})
export class CoopRoomTableComponent {
  readonly coop = inject(CoopService);
  private readonly gameState = inject(GameStateManager);
  private readonly camera = inject(CameraControlService);

  /** The free seat's invite button: the dock copies the link */
  readonly invite = output<void>();
  /** The dock copied the link a moment ago: the button says so */
  readonly inviteCopied = input(false);

  protected readonly maxPlayers = MAX_PLAYERS;
  protected readonly clientLabel = clientLabel;

  readonly room = this.coop.room;
  readonly table = computed(() => {
    const room = this.room();
    if (!room) return { lanes: [], seatless: [] };
    return roomTable({
      room,
      myId: this.coop.playerId(),
      lanes: this.coop.lanes(),
      latencyOf: (id) => this.coop.latencyTo(id),
      laggingOf: (id) => this.coop.lagging(id),
      leftIds: this.coop.leftIds(),
    });
  });
  readonly freeSeat = computed(() => (this.room()?.players.length ?? 0) < 2);

  /** A free lane: take it; the own one: give it back. Only in the lobby */
  take(lane: LaneRow): void {
    if (this.room()?.started || (lane.player && !lane.player.me)) return;
    this.coop.pick(lane.player?.me ? null : lane.spawnId);
  }

  /** The camera to the lane's spawn */
  flyTo(spawnId: string): void {
    const spawn = this.gameState.getSpawnPoints().find((s) => s.id === spawnId);
    if (spawn) this.camera.focusGeo(spawn.lat, spawn.lon);
  }
}
