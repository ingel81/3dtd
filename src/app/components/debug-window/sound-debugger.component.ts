import { Component, inject, computed, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DraggableDebugPanelComponent } from './draggable-debug-panel.component';
import { DebugWindowService } from '../../services/debug/debug-window.service';
import { SoundDebugService } from '../../services/debug/sound-debug.service';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { TdIconComponent } from '../icon/icon.component';

@Component({
  selector: 'app-sound-debugger',
  standalone: true,
  imports: [CommonModule, DraggableDebugPanelComponent, TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sound-debugger.component.html',
  styleUrl: './sound-debugger.component.scss',
  styles: `
    :host {
      ${TD_CSS_VARS}
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
