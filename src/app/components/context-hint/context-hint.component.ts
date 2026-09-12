import { Component, input, ChangeDetectionStrategy } from '@angular/core';
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
 *   [hints]="[{key: 'R', description: 'Rotate'}, {key: 'LMB', description: 'Place'}]"
 *   [warning]="'Too close to street'"
 * />
 */
@Component({
  selector: 'app-context-hint',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './context-hint.component.html',
  styleUrl: './context-hint.component.scss',
  styles: `
    :host {
      ${TD_CSS_VARS}
    }
  `,
})
export class ContextHintComponent {
  /** Array of hint items to display */
  hints = input<HintItem[]>([]);

  /** Optional warning message (displayed in red) */
  warning = input<string | null>(null);
}
