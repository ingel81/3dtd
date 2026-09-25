import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TD_CSS_VARS } from '../../styles/td-theme';

/** Four bars below these round trips, three, two, else one (docs/COOP_PLAN.md, C8), ms */
const BAR_LIMITS_MS = [40, 90, 160];

/** Bars lit for a round trip of `ms`; 0 while unknown */
export function pingBarCount(ms: number | null): number {
  if (ms === null) return 0;
  return 4 - BAR_LIMITS_MS.filter((limit) => ms >= limit).length;
}

/**
 * A player's connection as four bars and the round trip in ms, in the lobby
 * and the squad box. Teal; orange when `warn` (a slow connection). Without a
 * value the bars stay dark and the number reads "—".
 */
@Component({
  selector: 'app-ping-bars',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.is-warn]': 'warn()',
    '[attr.aria-label]': "ms() === null ? 'No ping' : ms() + ' ms'",
    role: 'img',
  },
  template: `
    <span class="bars" aria-hidden="true">
      @for (bar of [1, 2, 3, 4]; track bar) {
        <i [class.is-off]="bar > lit()"></i>
      }
    </span>
    <b aria-hidden="true">{{ ms() === null ? '—' : ms() + ' ms' }}</b>
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 66px;
      ${TD_CSS_VARS}
    }
    .bars {
      display: flex;
      align-items: flex-end;
      gap: 2px;
      height: 12px;
    }
    i {
      width: 3px;
      background: var(--td-teal);
    }
    i:nth-child(1) { height: 4px; }
    i:nth-child(2) { height: 7px; }
    i:nth-child(3) { height: 10px; }
    i:nth-child(4) { height: 12px; }
    i.is-off {
      background: var(--td-frame-dark);
    }
    b {
      font: 400 11px var(--td-font-mono);
      white-space: nowrap;
      color: var(--td-text-secondary);
    }
    :host(.is-warn) i:not(.is-off) {
      background: var(--td-warn-orange);
    }
    :host(.is-warn) b {
      color: var(--td-warn-orange);
    }
  `,
})
export class PingBarsComponent {
  /** Round trip, ms; null while unknown */
  readonly ms = input<number | null>(null);
  readonly warn = input(false);
  protected readonly lit = computed(() => pingBarCount(this.ms()));
}
