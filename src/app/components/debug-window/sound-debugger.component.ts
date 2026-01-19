import { Component, inject, computed, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { DraggableDebugPanelComponent } from './draggable-debug-panel.component';
import { DebugWindowService } from '../../services/debug-window.service';
import { SoundDebugService } from '../../services/sound-debug.service';
import { TD_CSS_VARS, TD_SCROLLBAR_STYLES, TD_SCROLLBAR_WEBKIT } from '../../styles/td-theme';

@Component({
  selector: 'app-sound-debugger',
  standalone: true,
  imports: [CommonModule, MatIconModule, DraggableDebugPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (windowService.soundWindow().isOpen) {
      <app-draggable-debug-panel
        windowId="sound"
        title="Sound Debug"
        icon="volume_up"
        [position]="windowService.soundWindow().position"
        [zIndex]="windowService.soundWindow().zIndex"
        (closed)="windowService.close('sound')"
        (positionChange)="windowService.updatePosition('sound', $event)"
        (focused)="windowService.bringToFront('sound')"
      >
        <div class="sound-debug-content">
          @if (soundDebug.stats(); as stats) {
            <!-- Active Sounds -->
            <div class="section">
              <div class="section-title">Active</div>
              <div class="stat-row">
                <span class="label">One-Shots</span>
                <span class="value">{{ stats.activeOneShots }}</span>
              </div>
              <div class="stat-row">
                <span class="label">Loops</span>
                <span class="value">{{ stats.activeLoops }}</span>
              </div>
              <div class="stat-row">
                <span class="label">Buffers</span>
                <span class="value">{{ stats.cachedBuffers }}/50</span>
              </div>
            </div>

            <!-- Budget Stats -->
            <div class="section">
              <div class="section-title">Budget</div>
              <div class="stat-row">
                <span class="label">Enemy</span>
                <span class="value" [class.warning]="stats.enemyBudget.current >= stats.enemyBudget.max">
                  {{ stats.enemyBudget.current }}/{{ stats.enemyBudget.max }}
                </span>
                <div class="bar-container">
                  <div class="bar enemy" [style.width.%]="enemyBudgetPercent()"></div>
                </div>
              </div>
              <div class="stat-row">
                <span class="label">Projectile</span>
                <span class="value" [class.warning]="stats.projectileBudget.current >= stats.projectileBudget.max">
                  {{ stats.projectileBudget.current }}/{{ stats.projectileBudget.max }}
                </span>
                <div class="bar-container">
                  <div class="bar projectile" [style.width.%]="projectileBudgetPercent()"></div>
                </div>
              </div>
            </div>
          } @else {
            <div class="section">
              <div class="no-data">
                @if (soundDebug.connected()) {
                  Waiting for data...
                } @else {
                  <mat-icon>link_off</mat-icon>
                  Not connected
                }
              </div>
            </div>
          }

          <!-- Event Log -->
          <div class="section">
            <div class="section-title">
              Events
              <div class="title-actions">
                @if (soundDebug.events().length > 0) {
                  <button class="action-btn" (click)="copyLog()" title="Copy log">
                    <mat-icon>content_copy</mat-icon>
                  </button>
                  <button class="action-btn danger" (click)="soundDebug.clearEvents()" title="Clear events">
                    <mat-icon>delete_sweep</mat-icon>
                  </button>
                }
              </div>
            </div>
            <div class="event-log" #logContainer>
              @for (event of soundDebug.events(); track event.timestamp) {
                <div class="event-line" [class]="soundDebug.getEventTypeClass(event.type)">{{ formatEvent(event) }}</div>
              } @empty {
                <div class="no-events">No events</div>
              }
            </div>
          </div>
        </div>
      </app-draggable-debug-panel>
    }
  `,
  styles: `
    :host {
      ${TD_CSS_VARS}
    }

    .sound-debug-content {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      min-width: 260px;
    }

    .section {
      padding: 8px 0;
      border-bottom: 1px solid var(--td-frame-dark);
    }

    .section:first-child {
      padding-top: 0;
    }

    .section:last-child {
      border-bottom: none;
      padding-bottom: 0;
    }

    .section-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 9px;
      font-weight: 600;
      color: var(--td-gold);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 6px;
    }

    .title-actions {
      display: flex;
      gap: 4px;
    }

    .action-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      padding: 0;
      background: transparent;
      border: none;
      color: var(--td-text-muted);
      cursor: pointer;
      transition: color 0.15s;
    }

    .action-btn mat-icon {
      font-size: 12px;
      width: 12px;
      height: 12px;
    }

    .action-btn:hover {
      color: var(--td-teal);
    }

    .action-btn.danger:hover {
      color: var(--td-health-red);
    }

    .stat-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
    }

    .stat-row:last-child {
      margin-bottom: 0;
    }

    .stat-row .label {
      width: 60px;
      color: var(--td-text-muted);
      flex-shrink: 0;
    }

    .stat-row .value {
      width: 50px;
      color: var(--td-teal);
      font-weight: 600;
      text-align: right;
      flex-shrink: 0;
    }

    .stat-row .value.warning {
      color: var(--td-warn-orange);
    }

    .bar-container {
      flex: 1;
      height: 6px;
      background: var(--td-panel-shadow);
      border-radius: 3px;
      overflow: hidden;
    }

    .bar {
      height: 100%;
      background: var(--td-teal);
      border-radius: 3px;
      transition: width 0.2s ease;
    }

    .bar.warning {
      background: var(--td-warn-orange);
    }

    .bar.enemy {
      background: var(--td-health-red);
    }

    .bar.projectile {
      background: var(--td-gold);
    }

    .no-data {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 12px;
      color: var(--td-text-muted);
      font-size: 10px;
    }

    .no-data mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }

    .event-log {
      max-height: 120px;
      overflow-y: auto;
      overflow-x: hidden;
      font-family: 'JetBrains Mono', monospace;
      font-size: 8px;
      line-height: 1.4;
      ${TD_SCROLLBAR_STYLES}
    }

    .event-log::-webkit-scrollbar {
      ${TD_SCROLLBAR_WEBKIT.scrollbar}
    }

    .event-log::-webkit-scrollbar-track {
      ${TD_SCROLLBAR_WEBKIT.track}
    }

    .event-log::-webkit-scrollbar-thumb {
      ${TD_SCROLLBAR_WEBKIT.thumb}
    }

    .event-log::-webkit-scrollbar-thumb:hover {
      ${TD_SCROLLBAR_WEBKIT.thumbHover}
    }

    .event-line {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      color: var(--td-text-secondary);
    }

    .event-line.event-play { color: var(--td-green); }
    .event-line.event-warning { color: var(--td-warn-orange); }
    .event-line.event-muted { color: var(--td-text-muted); opacity: 0.6; }

    .no-events {
      padding: 8px;
      color: var(--td-text-muted);
      text-align: center;
      font-size: 9px;
    }
  `,
})
export class SoundDebuggerComponent {
  readonly windowService = inject(DebugWindowService);
  readonly soundDebug = inject(SoundDebugService);

  readonly enemyBudgetPercent = computed(() => {
    const stats = this.soundDebug.stats();
    if (!stats) return 0;
    return (stats.enemyBudget.current / stats.enemyBudget.max) * 100;
  });

  readonly projectileBudgetPercent = computed(() => {
    const stats = this.soundDebug.stats();
    if (!stats) return 0;
    return (stats.projectileBudget.current / stats.projectileBudget.max) * 100;
  });

  getEventIcon(type: string): string {
    switch (type) {
      case 'play': return '▶';
      case 'budget_exceeded': return '⚠';
      case 'distance_culled': return '◌';
      default: return '•';
    }
  }

  formatEvent(event: { type: string; soundId: string; timestamp: number; details?: string }): string {
    const time = new Date(event.timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 2,
    });
    const icon = this.getEventIcon(event.type);
    const details = event.details ? ` (${event.details})` : '';
    return `${time} ${icon} ${event.soundId}${details}`;
  }

  copyLog(): void {
    const events = this.soundDebug.events();
    if (events.length === 0) return;

    const logText = events
      .slice()
      .reverse()
      .map(e => this.formatEvent(e))
      .join('\n');

    navigator.clipboard.writeText(logText).then(() => {
      // Optional: could add brief visual feedback here
    });
  }
}
