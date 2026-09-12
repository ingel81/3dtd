import { Component, input, output, ChangeDetectionStrategy } from '@angular/core';
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

/** A text button under the hints (e.g. "Skip" on a first-run tip) */
export interface HintAction {
  id: string;
  label: string;
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

  /** Optional heading, e.g. the title of a first-run tip */
  title = input<string | null>(null);

  /** Optional muted note right of the title, e.g. "1/4" */
  counter = input<string | null>(null);

  /** Optional sentence under the title */
  message = input<string | null>(null);

  /** Text buttons at the bottom; with any, the box takes pointer input */
  actions = input<HintAction[]>([]);

  /** Id of the action button clicked */
  readonly actionClicked = output<string>();
}
