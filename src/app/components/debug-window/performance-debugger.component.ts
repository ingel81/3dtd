import { Component, inject, signal, OnDestroy, ChangeDetectionStrategy, NgZone } from '@angular/core';
import { DraggableDebugPanelComponent } from './draggable-debug-panel.component';
import { DebugWindowService } from '../../services/debug/debug-window.service';
import { PerformanceProfilerService, PerformanceStats } from '../../services/debug/performance-profiler.service';

/** How often the panel takes a window of numbers, ms: long enough for steady means */
const REFRESH_MS = 500;

@Component({
  selector: 'app-performance-debugger',
  standalone: true,
  imports: [DraggableDebugPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './performance-debugger.component.html',
  styleUrl: './performance-debugger.component.scss',
})
export class PerformanceDebuggerComponent implements OnDestroy {
  readonly windowService = inject(DebugWindowService);
  readonly profiler = inject(PerformanceProfilerService);

  readonly stats = signal<PerformanceStats | null>(null);
  private updateInterval: ReturnType<typeof setInterval> | null = null;
  /** A window's numbers are still on their way from the worker */
  private collecting = false;

  constructor() {
    // Outside the zone: the timer runs while the window is closed too, and in the
    // zone every tick ran change detection; the signal asks for it itself
    this.updateInterval = inject(NgZone).runOutsideAngular(() => setInterval(() => {
      const isOpen = this.windowService.performanceWindow().isOpen;
      this.profiler.setProfilingActive(isOpen);
      if (!isOpen || this.collecting) return;
      this.collecting = true;
      void this.profiler.collectStats()
        .then((stats) => {
          if (this.windowService.performanceWindow().isOpen) this.stats.set(stats);
        })
        .finally(() => (this.collecting = false));
    }, REFRESH_MS));
  }

  ngOnDestroy(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    this.profiler.setProfilingActive(false);
  }

  toggleConsoleLog(): void {
    this.profiler.consoleLogEnabled.update(v => !v);
  }

  formatTris(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
    return `${n}`;
  }
}
