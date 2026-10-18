import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { TdIconComponent, type TdIconName } from '../../icon/icon.component';
import { TdRichTooltipDirective } from '../../tooltip/td-rich-tooltip.directive';
import { damageTypeIcon } from '../../icon/damage-type-icon';
import { markShape, shownPeek, type MarkShape, type WavePeek } from './upcoming-waves';
import { injectT } from '../../../i18n/i18n.service';

/**
 * NEXT in the WAVE panel: the coming waves as marks on a thin line, the
 * number under each; each mark's sign says what comes (markShape), the moon
 * above marks a blood moon wave. Under
 * the line two detail lines for one mark (shownPeek): the next wave, the one
 * under the pointer or keyboard focus, or the one clicked last; its card
 * (td-rich-tooltip) on hover.
 */
@Component({
  selector: 'app-wave-timeline',
  standalone: true,
  imports: [TdIconComponent, TdRichTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './wave-timeline.component.html',
  styleUrl: './wave-timeline.component.scss',
})
export class WaveTimelineComponent {
  /** The coming waves, the next one first */
  readonly peeks = input.required<WavePeek[]>();
  protected readonly t = injectT();

  readonly hovered = signal<number | null>(null);
  readonly picked = signal<number | null>(null);

  readonly shown = computed(() => shownPeek(this.peeks(), this.hovered(), this.picked()));

  readonly damageTypeIcon = damageTypeIcon;
  readonly markShape = markShape;
  readonly markIcon: Record<MarkShape, TdIconName> = { ground: 'nextGround', air: 'nextAir', camo: 'nextCamo', boss: 'skull' };

  /** "Wave 7, Bat Swarm, air"; "…, Swift, blood moon" on a blood moon wave */
  markLabel(peek: WavePeek): string {
    const says = this.t().hud.next;
    return [
      this.t().hud.wave.wave(peek.wave),
      peek.name,
      ...(peek.air ? [says.markAir] : []),
      ...(peek.camo ? [says.markCamo] : []),
      ...(peek.mutator ? [peek.mutator] : []),
      ...(peek.bloodMoon ? [says.markBloodMoon] : []),
    ].join(', ');
  }
}
