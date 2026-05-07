import { Component, inject, signal, OnDestroy, ChangeDetectionStrategy } from '@angular/core';
import { DraggableDebugPanelComponent } from './draggable-debug-panel.component';
import { DebugWindowService } from '../../services/debug-window.service';
import { PerformanceProfilerService, PerformanceStats } from '../../services/performance-profiler.service';
import { TD_CSS_VARS } from '../../styles/td-theme';

@Component({
  selector: 'app-performance-debugger',
  standalone: true,
  imports: [DraggableDebugPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (windowService.performanceWindow().isOpen) {
      <app-draggable-debug-panel
        windowId="performance"
        title="Performance"
        icon="speed"
        [position]="windowService.performanceWindow().position"
        [zIndex]="windowService.performanceWindow().zIndex"
        (closed)="windowService.close('performance')"
        (positionChange)="windowService.updatePosition('performance', $event)"
        (focused)="windowService.bringToFront('performance')"
      >
        @if (stats(); as s) {
          <div class="perf-content">
            <div class="section">
              <span class="section-label">Frame Budget</span>
              <div class="row">
                <span class="key">FPS</span>
                <span class="value" [class.warn]="s.fps < 30" [class.crit]="s.fps < 15">{{ s.fps }}</span>
              </div>
              <div class="row">
                <span class="key">Frame Time</span>
                <span class="value" [class.warn]="s.frameTime > 12" [class.crit]="s.frameTime > 16">{{ s.frameTime.toFixed(2) }}ms</span>
              </div>
              <div class="row">
                <span class="key">Budget Used</span>
                <span class="value" [class.warn]="s.frameBudgetPct > 70" [class.crit]="s.frameBudgetPct > 95">{{ s.frameBudgetPct.toFixed(0) }}%</span>
              </div>
              <div class="row">
                <span class="key">Bottleneck</span>
                <span class="value bottleneck">{{ s.bottleneck }} ({{ s.bottleneckMs.toFixed(2) }}ms)</span>
              </div>
            </div>

            <div class="section">
              <span class="section-label">Rendering</span>
              <div class="row">
                <span class="key">Draw Calls</span>
                <span class="value">{{ s.drawCalls }}</span>
              </div>
              <div class="row">
                <span class="key">Triangles</span>
                <span class="value">{{ formatTris(s.triangles) }}</span>
              </div>
            </div>

            <div class="section">
              <span class="section-label">Entities</span>
              <div class="row">
                <span class="key">Enemies</span>
                <span class="value">{{ s.enemies }}</span>
              </div>
              <div class="row">
                <span class="key">Towers</span>
                <span class="value">{{ s.towers }}</span>
              </div>
              <div class="row">
                <span class="key">Projectiles</span>
                <span class="value">{{ s.projectiles }}</span>
              </div>
            </div>

            <div class="section">
              <span class="section-label">Memory</span>
              <div class="row">
                <span class="key">Geometries</span>
                <span class="value">{{ s.geometries }}</span>
              </div>
              <div class="row">
                <span class="key">Textures</span>
                <span class="value">{{ s.textures }}</span>
              </div>
            </div>

            <div class="section">
              <span class="section-label">Subsystem Timings</span>
              <div class="row">
                <span class="key">Enemy</span>
                <span class="value" [class.highlight]="s.bottleneck === 'enemy'">{{ s.enemyTotal.toFixed(2) }}ms</span>
              </div>
              <div class="row">
                <span class="key">Tower</span>
                <span class="value" [class.highlight]="s.bottleneck === 'tower'">{{ s.towerUpdate.toFixed(2) }}ms</span>
              </div>
              <div class="row">
                <span class="key">Projectile</span>
                <span class="value" [class.highlight]="s.bottleneck === 'projectile'">{{ s.projectileUpdate.toFixed(2) }}ms</span>
              </div>
              <div class="row">
                <span class="key">Combat</span>
                <span class="value" [class.highlight]="s.bottleneck === 'combat'">{{ s.combatUpdate.toFixed(2) }}ms</span>
              </div>
              <div class="row">
                <span class="key">Events</span>
                <span class="value" [class.highlight]="s.bottleneck === 'events'">{{ s.eventProcessing.toFixed(2) }}ms</span>
              </div>
            </div>

            <div class="section">
              <span class="section-label">Enemy Breakdown</span>
              <div class="row">
                <span class="key">Move</span>
                <span class="value">{{ s.enemyMove.toFixed(2) }}ms</span>
              </div>
              <div class="row">
                <span class="key">Grid</span>
                <span class="value">{{ s.enemyGrid.toFixed(2) }}ms</span>
              </div>
              <div class="row">
                <span class="key">Height</span>
                <span class="value">{{ s.enemyHeight.toFixed(2) }}ms</span>
              </div>
              <div class="row">
                <span class="key">Render</span>
                <span class="value">{{ s.enemyRender.toFixed(2) }}ms</span>
              </div>
            </div>

            <div class="section">
              <label class="checkbox-row">
                <input type="checkbox" [checked]="profiler.consoleLogEnabled()" (change)="toggleConsoleLog()" />
                <span>Console Log (2s)</span>
              </label>
            </div>
          </div>
        }
      </app-draggable-debug-panel>
    }
  `,
  styles: `
    :host {
      ${TD_CSS_VARS}
    }

    .perf-content {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      min-width: 190px;
    }

    .section {
      padding: 6px 0;
      border-bottom: 1px solid var(--td-frame-dark);
    }

    .section:first-child {
      padding-top: 0;
    }

    .section:last-child {
      border-bottom: none;
      padding-bottom: 0;
    }

    .section-label {
      display: block;
      font-size: 9px;
      font-weight: 600;
      color: var(--td-gold);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }

    .row {
      display: flex;
      justify-content: space-between;
      padding: 1px 0;
    }

    .key {
      color: var(--td-text-muted);
    }

    .value {
      color: var(--td-teal);
      font-weight: 600;
      text-align: right;
    }

    .value.warn {
      color: var(--td-gold);
    }

    .value.crit {
      color: var(--td-perf-critical);
    }

    .value.highlight {
      color: var(--td-perf-warning);
      font-weight: 700;
    }

    .bottleneck {
      color: var(--td-perf-warning);
      font-weight: 700;
      text-transform: capitalize;
    }

    .checkbox-row {
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      color: var(--td-text-secondary);
    }

    .checkbox-row input[type="checkbox"] {
      width: 14px;
      height: 14px;
      cursor: pointer;
      accent-color: var(--td-teal);
    }

    .checkbox-row:hover {
      color: var(--td-text-primary);
    }
  `,
})
export class PerformanceDebuggerComponent implements OnDestroy {
  readonly windowService = inject(DebugWindowService);
  readonly profiler = inject(PerformanceProfilerService);

  readonly stats = signal<PerformanceStats | null>(null);
  private updateInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.updateInterval = setInterval(() => {
      const isOpen = this.windowService.performanceWindow().isOpen;
      this.profiler.setProfilingActive(isOpen);
      if (isOpen) {
        this.stats.set(this.profiler.collectStats());
        this.profiler.resetTimings();
      }
    }, 100); // ~10 Hz
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
