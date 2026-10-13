import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RenderBenchmarkService } from './render-benchmark.service';
import { RENDER_HEAD, RENDER_VIEWS, formatRenderBenchmark, renderCells } from './render-benchmark';

/**
 * The graphics benchmark on screen: which view it measures, then the table
 * and a button that copies it as text (formatRenderBenchmark). Same card as
 * the benchmark panel.
 */
@Component({
  selector: 'app-render-benchmark-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './render-benchmark-panel.component.html',
  styleUrl: './benchmark-panel.component.scss',
})
export class RenderBenchmarkPanelComponent {
  readonly benchmark = inject(RenderBenchmarkService);
  readonly state = this.benchmark.state;
  readonly total = RENDER_VIEWS.length;

  readonly head = RENDER_HEAD;
  readonly rows = computed(() => this.state().rows.map((row) => renderCells(row)));
  readonly copied = signal<boolean | null>(null);

  async copy(): Promise<void> {
    const { env, rows } = this.state();
    if (!env) return;
    try {
      await navigator.clipboard.writeText(formatRenderBenchmark(env, rows));
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
