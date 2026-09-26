import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RunSummary } from '../../run-log/run-summary';
import { formatClock } from '../../utils/format-clock';
import { formatCompact } from '../../utils/format-compact';
import { TD_CSS_VARS } from '../../styles/td-theme';

/** One bar of the leaks-per-wave row */
interface LeakBar {
  wave: number;
  leaks: number;
  hqDamage: number;
  /** 0..1 of the worst wave */
  height: number;
}

/**
 * Numbers of the run on the game-over screen: key figures, leaks per wave as
 * a bar row, the three towers that dealt the most damage.
 */
@Component({
  selector: 'app-run-summary',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './run-summary.component.html',
  styleUrl: './run-summary.component.scss',
  styles: `
    :host {
      display: block;
      ${TD_CSS_VARS}
    }
  `,
})
export class RunSummaryComponent {
  readonly summary = input.required<RunSummary>();

  readonly compact = formatCompact;
  readonly runTime = computed(() => formatClock(this.summary().durationMs));

  readonly leakBars = computed<LeakBar[]>(() => {
    const { leaksPerWave, hqDamagePerWave } = this.summary();
    const worst = Math.max(0, ...leaksPerWave);
    return leaksPerWave.map((leaks, i) => ({
      wave: i + 1,
      leaks,
      hqDamage: hqDamagePerWave[i] ?? 0,
      height: worst > 0 ? leaks / worst : 0,
    }));
  });

  readonly totalLeaks = computed(() => this.summary().leaksPerWave.reduce((a, b) => a + b, 0));
}
