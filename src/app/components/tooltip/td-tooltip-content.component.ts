import { Component, ChangeDetectionStrategy, input, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { TdTooltipAccent, TdTooltipData, TdTooltipTargeting } from './tooltip-data.types';
import { TdIconComponent, TdIconName } from '../icon/icon.component';

const ACCENT_COLOR_MAP: Record<TdTooltipAccent, string> = {
  gold: 'var(--td-gold-light)',
  teal: 'var(--td-teal-light)',
  fire: 'var(--td-warn-orange)',
  cold: 'var(--td-cold)',
  lightning: 'var(--td-lightning)',
  chaos: 'var(--td-chaos)',
  poison: 'var(--td-green)',
  health: 'var(--td-health-red)',
  neutral: 'var(--td-text-primary)',
};

/**
 * Display-only component for structured tooltips. Driven by TdRichTooltipDirective,
 * which mounts it inside a CDK overlay panel.
 */
@Component({
  selector: 'td-tooltip-content',
  standalone: true,
  imports: [CommonModule, TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './td-tooltip-content.component.html',
  styleUrl: './td-tooltip-content.component.scss',
  styles: `
    :host {
      ${TD_CSS_VARS}
    }
  `,
})
export class TdTooltipContentComponent {
  readonly data = input.required<TdTooltipData>();

  protected readonly accentColor = computed(() =>
    ACCENT_COLOR_MAP[this.data().accent ?? 'neutral']
  );

  /**
   * Stats grid uses 3 columns by default; falls back to fewer if there are
   * fewer items, so stats stay column-balanced rather than stretching one item.
   */
  protected readonly statColumns = computed(() => {
    const count = this.data().stats?.length ?? 0;
    if (count === 0) return '1fr';
    if (count === 1) return '1fr';
    if (count === 2) return '1fr 1fr';
    return 'repeat(3, 1fr)';
  });

  /** Icon for the targeting banner — wind for any air capability, tower (ground unit) otherwise. */
  protected targetingIcon(t: TdTooltipTargeting): TdIconName {
    return t.mode === 'ground-only' ? 'tower' : 'wind';
  }

  /** Spelled-out label for the targeting banner. */
  protected targetingLabel(t: TdTooltipTargeting): string {
    switch (t.mode) {
      case 'air-only':    return 'Air-only';
      case 'air-ground':  return 'Ground and Air';
      case 'ground-only': return 'Ground-only';
    }
  }
}
