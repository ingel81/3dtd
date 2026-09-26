import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { TdIconComponent } from '../icon/icon.component';
import { CoopService } from '../../services/coop.service';
import { ROOM_OPTION_CHOICES, optionLabel, type RoomOptionKey } from '../../coop/room-options';

/**
 * Mode and options of the coop room (D38): folded, one chip per option;
 * open, a segmented choice each for the host in the lobby, the values read
 * only for everyone else and in the game.
 */
@Component({
  selector: 'app-coop-room-options',
  standalone: true,
  imports: [MatTooltipModule, TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './coop-room-options.component.html',
  styleUrl: './coop-room-options.component.scss',
  styles: `
    :host {
      ${TD_CSS_VARS}
    }
  `,
})
export class CoopRoomOptionsComponent {
  readonly coop = inject(CoopService);

  protected readonly options = ROOM_OPTION_CHOICES;
  protected readonly optionLabel = optionLabel;

  /** Open for the host from the start, who sets them (PLAYTEST T58) */
  readonly open = signal(this.coop.isHost());

  /** The options as chips while folded; cheats warn when not off */
  readonly chips = computed(() => {
    const values = this.coop.options();
    return ROOM_OPTION_CHOICES.map((o) => ({
      key: o.key,
      text: `${o.label} ${optionLabel(o.key, values[o.key])}`,
      warn: o.key === 'cheats' && values.cheats !== 'off',
    }));
  });
  /** The host may set options: in the lobby only */
  readonly canEdit = computed(() => this.coop.isHost() && !this.coop.room()?.started);
  readonly started = computed(() => !!this.coop.room()?.started);

  constructor() {
    // Becoming the host of a new room opens the options, which the host sets
    let wasHost = this.coop.isHost();
    effect(() => {
      const host = this.coop.isHost();
      if (host && !wasHost) this.open.set(true);
      wasHost = host;
    });
  }

  value(key: RoomOptionKey): string {
    return this.coop.options()[key];
  }

  /** A cheat choice other than Off, where the relay does not allow cheats at all */
  cheatsImpossible(key: RoomOptionKey, value: string): boolean {
    return key === 'cheats' && value !== 'off' && !(this.coop.room()?.cheats ?? false);
  }

  choose(key: RoomOptionKey, value: string): void {
    if (this.cheatsImpossible(key, value)) return;
    this.coop.setOption(key, value);
  }
}
