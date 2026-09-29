import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { TD_CSS_VARS } from '../styles/td-theme';
import { BenchmarkService } from './benchmark.service';
import { formatBenchmark, numberCells } from './benchmark-report';

/**
 * The benchmark on screen (TODO E74): while it runs, which measurement and
 * what it does, with Cancel; at the end the table and one button that copies
 * the results as text (formatBenchmark). Top centre of the map.
 */
@Component({
  selector: 'app-benchmark-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './benchmark-panel.component.html',
  styleUrl: './benchmark-panel.component.scss',
  styles: `
    :host {
      ${TD_CSS_VARS}
    }
  `,
})
export class BenchmarkPanelComponent {
  readonly benchmark = inject(BenchmarkService);
  readonly state = this.benchmark.state;

  readonly head = ['Enemies', 'Speed', 'FPS', 'p05', 'Reached', 'Ticks/s', 'Worker', 'Apply/packet'];
  readonly rows = computed(() => this.state().rows.map((row) => numberCells(row)));
  readonly unsettled = computed(() => this.state().rows.some((row) => !row.settled));
  /** The copy went to the clipboard; false when the browser refused it */
  readonly copied = signal<boolean | null>(null);

  async copy(): Promise<void> {
    const { env, rows } = this.state();
    if (!env) return;
    try {
      await navigator.clipboard.writeText(formatBenchmark(env, rows));
      this.copied.set(true);
    } catch {
      this.copied.set(false);
    }
  }

  close(): void {
    this.copied.set(null);
    this.benchmark.dismiss();
  }
}
