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
  template: `
    @if (data(); as d) {
      <div class="td-tooltip">
        <header class="td-tooltip__header">
          <span class="td-tooltip__title" [style.color]="accentColor()">{{ d.title }}</span>
          @if (d.category) {
            <span class="td-tooltip__category">{{ d.category }}</span>
          }
        </header>

        @if (d.stats && d.stats.length > 0) {
          <div class="td-tooltip__stats" [style.grid-template-columns]="statColumns()">
            @for (stat of d.stats; track stat.label) {
              <div class="td-tooltip__stat">
                <dt>{{ stat.label }}</dt>
                <dd>{{ stat.value }}</dd>
              </div>
            }
          </div>
        }

        @if (d.targeting; as t) {
          <div class="td-tooltip__targeting"
               [class.td-tooltip__targeting--air-only]="t.mode === 'air-only'"
               [class.td-tooltip__targeting--air-ground]="t.mode === 'air-ground'"
               [class.td-tooltip__targeting--ground-only]="t.mode === 'ground-only'">
            <td-icon class="td-tooltip__targeting-icon"
                     [name]="targetingIcon(t)" [size]="14"></td-icon>
            <span class="td-tooltip__targeting-label">{{ targetingLabel(t) }}</span>
            @if (t.viaResearch) {
              <span class="td-tooltip__targeting-note">via Research</span>
            }
          </div>
        }

        @if (d.armor && d.armor.length > 0) {
          <div class="td-tooltip__armor">
            @if (d.armorTitle) {
              <h4>{{ d.armorTitle }}</h4>
            }
            @for (row of d.armor; track row.label) {
              <div class="td-tooltip__armor-row" [class.dim]="row.dim">
                <span class="dot" [style.--dot-color]="row.color"></span>
                <span class="armor-label">{{ row.label }}</span>
                <span class="armor-mul">{{ row.multiplier }}</span>
              </div>
            }
          </div>
        }

        @if (d.flavor) {
          <div class="td-tooltip__flavor">{{ d.flavor }}</div>
        }
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
      ${TD_CSS_VARS}
    }

    .td-tooltip {
      width: 260px;
      font-family: var(--td-font-body);
      color: var(--td-text-primary);
      background: rgba(17, 22, 19, 0.92);
      backdrop-filter: blur(8px) saturate(1.1);
      -webkit-backdrop-filter: blur(8px) saturate(1.1);
      border: 1px solid var(--td-frame-dark);
      box-shadow:
        inset 0 1px 0 rgba(122, 133, 128, 0.33),
        var(--td-shadow-soft);
      pointer-events: none;
    }

    .td-tooltip__header {
      padding: 8px 10px;
      background: linear-gradient(180deg, var(--td-panel-dark), var(--td-panel-shadow));
      border-bottom: 1px solid var(--td-rune-amber-muted);
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .td-tooltip__title {
      flex: 1;
      font: 700 12px/1 var(--td-font-mono);
      letter-spacing: 0.06em;
      text-transform: uppercase;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .td-tooltip__category {
      font: 10px/1 var(--td-font-mono);
      color: var(--td-text-muted);
      letter-spacing: 0.05em;
      text-transform: uppercase;
      flex-shrink: 0;
    }

    .td-tooltip__stats {
      display: grid;
      gap: 6px;
      padding: 8px 10px;
      border-bottom: 1px solid var(--td-frame-dark);
    }

    .td-tooltip__stat {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .td-tooltip__stat dt {
      font: 9px/1 var(--td-font-mono);
      color: var(--td-text-muted);
      letter-spacing: 0.08em;
      margin-bottom: 3px;
    }

    .td-tooltip__stat dd {
      font: 600 14px/1 var(--td-font-mono);
      color: var(--td-text-primary);
      font-variant-numeric: tabular-nums;
      margin: 0;
    }

    /* Targeting capability banner — sits between stats and armor. Non-dezent
     * by design: icon + full label + accent stripe on the left edge so the
     * spec is readable at a glance. Three modes get distinct accents:
     *   ground-only → neutral grey
     *   air-ground  → teal-dark   (anti-air capable)
     *   air-only    → teal-light  (specialist) */
    .td-tooltip__targeting {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      border-bottom: 1px solid var(--td-frame-dark);
      font: 11px/1.2 var(--td-font-mono);
      color: var(--td-text-primary);
      border-left: 3px solid var(--td-frame-mid);
    }
    .td-tooltip__targeting--air-ground {
      border-left-color: var(--td-teal-dark);
    }
    .td-tooltip__targeting--air-only {
      border-left-color: var(--td-teal-light);
      background: color-mix(in srgb, var(--td-teal) 8%, transparent);
    }
    .td-tooltip__targeting-icon {
      flex-shrink: 0;
      color: var(--td-text-muted);
    }
    .td-tooltip__targeting--air-ground .td-tooltip__targeting-icon {
      color: var(--td-teal-light);
    }
    .td-tooltip__targeting--air-only .td-tooltip__targeting-icon {
      color: var(--td-teal-light);
    }
    .td-tooltip__targeting-label {
      flex: 1;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      font-weight: 700;
    }
    .td-tooltip__targeting-note {
      font: 9px/1 var(--td-font-mono);
      color: var(--td-text-muted);
      letter-spacing: 0.06em;
      text-transform: uppercase;
      padding: 2px 5px;
      border: 1px solid var(--td-frame-dark);
      background: var(--td-panel-shadow);
      flex-shrink: 0;
    }

    .td-tooltip__armor {
      padding: 8px 10px;
      border-bottom: 1px solid var(--td-frame-dark);
    }
    .td-tooltip__armor:last-child {
      border-bottom: none;
    }

    .td-tooltip__armor h4 {
      font: 9px/1 var(--td-font-mono);
      color: var(--td-text-muted);
      letter-spacing: 0.1em;
      text-transform: uppercase;
      margin: 0 0 6px;
    }

    .td-tooltip__armor-row {
      display: flex;
      align-items: center;
      gap: 8px;
      font: 11px/1.4 var(--td-font-mono);
      padding: 3px 0;
      color: var(--td-text-secondary);
    }
    .td-tooltip__armor-row.dim {
      opacity: 0.55;
    }

    .td-tooltip__armor-row .dot {
      width: 8px;
      height: 8px;
      background: var(--dot-color);
      border: 1px solid var(--td-panel-shadow);
      box-shadow: 0 0 4px color-mix(in srgb, var(--dot-color) 40%, transparent);
      flex-shrink: 0;
    }

    .td-tooltip__armor-row .armor-label {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .td-tooltip__armor-row .armor-mul {
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      flex-shrink: 0;
    }

    .td-tooltip__flavor {
      padding: 6px 10px 8px;
      font-style: italic;
      font-size: 11px;
      color: var(--td-text-muted);
      line-height: 1.45;
      font-family: var(--td-font-body);
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
