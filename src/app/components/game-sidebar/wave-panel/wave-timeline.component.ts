import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TdIconComponent } from '../../icon/icon.component';
import { damageTypeIcon } from '../../icon/damage-type-icon';
import { shownPeek, type WavePeek } from './upcoming-waves';

/**
 * NEXT in the WAVE panel: the coming waves as marks on a thin line, the
 * number under each, small icons above for boss, air and blood moon. Under
 * the line one detail line for one mark (shownPeek): the next wave, the one
 * under the pointer or keyboard focus, or the one clicked last.
 */
@Component({
  selector: 'app-wave-timeline',
  standalone: true,
  imports: [MatTooltipModule, TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './wave-timeline.component.html',
  styleUrl: './wave-timeline.component.scss',
})
export class WaveTimelineComponent {
  /** The coming waves, the next one first */
  readonly peeks = input.required<WavePeek[]>();

  readonly hovered = signal<number | null>(null);
  readonly picked = signal<number | null>(null);

  readonly shown = computed(() => shownPeek(this.peeks(), this.hovered(), this.picked()));

  readonly damageTypeIcon = damageTypeIcon;

  /** "Wave 7, Bat Swarm, air"; "…, blood moon" on a blood moon wave */
  markLabel(peek: WavePeek): string {
    return [
      `Wave ${peek.wave}`,
      peek.name,
      ...(peek.air ? ['air'] : []),
      ...(peek.bloodMoon ? ['blood moon'] : []),
    ].join(', ');
  }
}
