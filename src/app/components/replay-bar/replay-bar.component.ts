import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TdIconComponent, type TdIconName } from '../icon/icon.component';
import { ReplayService } from '../../services/replay.service';
import { formatReplaySpeed, formatReplayTime } from '../../replay/replay-bar-view';

/**
 * The bar of the wave replay (docs/REPLAY.md, DESIGN_SYSTEM.md "Replay"):
 * title with the wave (to step to the one before or after), a note when the
 * replay stopped matching the game, the HQ health and the enemies on the
 * route at that moment, Exit; play and pause, the progress bar to scrub with the player's
 * commands as ticks, the time, the speeds. Everything goes through
 * ReplayService.
 */
@Component({
  selector: 'app-replay-bar',
  standalone: true,
  imports: [MatTooltipModule, TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './replay-bar.component.html',
  styleUrl: './replay-bar.component.scss',
})
export class ReplayBarComponent {
  readonly replay = inject(ReplayService);

  /** Played to the end: the play button starts over */
  private readonly atEnd = computed(() =>
    !this.replay.playing() && this.replay.durationMs() > 0 && this.replay.timeMs() >= this.replay.durationMs()
  );

  readonly playIcon = computed<TdIconName>(() =>
    this.replay.playing() ? 'pause' : this.atEnd() ? 'refresh' : 'play'
  );

  readonly playLabel = computed(() =>
    this.replay.playing() ? 'Pause the replay' : this.atEnd() ? 'Play the replay again' : 'Play the replay'
  );

  readonly time = computed(() => formatReplayTime(this.replay.timeMs()));
  readonly duration = computed(() => formatReplayTime(this.replay.durationMs()));

  /** Share of the wave played, fills the progress bar */
  readonly progress = computed(() => {
    const duration = this.replay.durationMs();
    return duration > 0 ? (this.replay.timeMs() / duration) * 100 : 0;
  });

  readonly speedLabel = formatReplaySpeed;

  /** A wave before or after the shown one can be replayed */
  readonly hasPrevious = computed(() => this.replay.waves().indexOf(this.replay.wave()) > 0);
  readonly hasNext = computed(() => {
    const waves = this.replay.waves();
    const at = waves.indexOf(this.replay.wave());
    return at >= 0 && at < waves.length - 1;
  });

  /** Where the replay stopped matching the game, m:ss */
  readonly divergedAt = computed(() => formatReplayTime(this.replay.divergedAtMs() ?? 0));

  onScrub(event: Event): void {
    this.replay.seek(Number((event.target as HTMLInputElement).value));
  }
}
