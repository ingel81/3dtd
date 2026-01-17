import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TD_CSS_VARS } from '../../styles/td-theme';

/**
 * A single hint item to display
 */
export interface HintItem {
  /** Key or action (e.g., "R", "LMB", "ESC") */
  key: string;
  /** Description of what the key does */
  description: string;
}

/**
 * ContextHintComponent
 *
 * Reusable hint box displayed at the bottom center of the screen.
 * Shows context-specific hints like keyboard shortcuts and actions.
 * Styled in WC3/Ancient Command aesthetic.
 *
 * Usage:
 * <app-context-hint
 *   [hints]="[{key: 'R', description: 'Rotieren'}, {key: 'LMB', description: 'Platzieren'}]"
 *   [warning]="'Zu nah an Straße'"
 * />
 */
@Component({
  selector: 'app-context-hint',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="context-hint-container" [class.has-warning]="warning()">
      <!-- Warning message (above hints) -->
      <div class="warning-row" [class.visible]="warning()">
        <span class="warning-text">{{ warning() }}</span>
      </div>

      <!-- Hints -->
      <div class="hints-row">
        @for (hint of hints(); track hint.key) {
          <div class="hint-item">
            <span class="hint-key">{{ hint.key }}</span>
            <span class="hint-desc">{{ hint.description }}</span>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    :host {
      ${TD_CSS_VARS}
    }

    .context-hint-container {
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--td-panel-main);
      border-radius: 4px;
      padding: 10px 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      z-index: 1000;
      pointer-events: none;

      /* WC3-style frame: light top, dark bottom */
      border: 1px solid var(--td-frame-mid);
      border-top-color: var(--td-frame-light);
      border-left-color: var(--td-frame-light);
      border-bottom-color: var(--td-frame-dark);
      border-right-color: var(--td-frame-dark);

      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.05),
        0 4px 12px rgba(0, 0, 0, 0.5);
    }

    .context-hint-container.has-warning {
      border-color: var(--td-health-red);
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.05),
        0 4px 12px rgba(0, 0, 0, 0.5),
        0 0 8px rgba(177, 68, 54, 0.3);
    }

    .hints-row {
      display: flex;
      gap: 16px;
      justify-content: center;
      flex-wrap: wrap;
    }

    .hint-item {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .hint-key {
      background: var(--td-panel-secondary);
      color: var(--td-gold);
      padding: 3px 8px;
      border-radius: 3px;
      font-family: 'Segoe UI', sans-serif;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      min-width: 24px;
      text-align: center;

      /* WC3-style inset */
      border: 1px solid var(--td-frame-dark);
      border-top-color: var(--td-panel-shadow);
      border-left-color: var(--td-panel-shadow);
      box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.3);
    }

    .hint-desc {
      color: var(--td-text-secondary);
      font-size: 12px;
      font-weight: 500;
    }

    .warning-row {
      display: flex;
      align-items: center;
      justify-content: center;
      padding-bottom: 6px;
      border-bottom: 1px solid var(--td-frame-dark);
      height: 0;
      overflow: hidden;
      opacity: 0;
      padding-bottom: 0;
      border-bottom: none;
      transition: height 0.15s ease, opacity 0.15s ease, padding 0.15s ease;
    }

    .warning-row.visible {
      height: auto;
      opacity: 1;
      padding-bottom: 6px;
      border-bottom: 1px solid var(--td-frame-dark);
    }

    .warning-text {
      color: var(--td-health-red);
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
  `]
})
export class ContextHintComponent {
  /** Array of hint items to display */
  hints = input<HintItem[]>([]);

  /** Optional warning message (displayed in red) */
  warning = input<string | null>(null);
}
