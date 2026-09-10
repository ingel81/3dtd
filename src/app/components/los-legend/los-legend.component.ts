import { Component, computed, inject, input, ChangeDetectionStrategy } from '@angular/core';
import { UIStore } from '../../store/ui.store';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { buildLosLegendEntries, LosLegendEntry } from './los-legend-entries';

/**
 * Legende für die GPU-LOS-Coverage-Visualisierung: ein Swatch pro Layer,
 * den der Tower zeigt (Ground grün, Air blau), plus Blocked (rot).
 * Einträge kommen aus `buildLosLegendEntries`, das dieselbe Gating-
 * Funktion wie der Layer-Builder nutzt.
 *
 * Eingebunden während Build-Preview UND Tower-Selection.
 */
@Component({
  selector: 'app-los-legend',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="los-legend">
      <div class="los-legend-title">Line of Sight</div>
      <div class="los-legend-row">
        @for (entry of entries(); track entry.label) {
          <div class="los-legend-item">
            <span class="los-legend-swatch" [style.background]="entry.swatch"></span>
            <span class="los-legend-label">{{ entry.label }}</span>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    :host {
      ${TD_CSS_VARS}
      position: fixed;
      bottom: 88px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 999;
      pointer-events: none;
    }

    .los-legend {
      background: var(--td-glass-tint);
      backdrop-filter: blur(8px) saturate(1.1);
      -webkit-backdrop-filter: blur(8px) saturate(1.1);
      border: 1px solid var(--td-frame-mid);
      border-radius: 4px;
      padding: 6px 12px;
      box-shadow:
        inset 0 1px 0 rgba(122, 133, 128, 0.33),
        var(--td-shadow-soft);
      font-family: var(--td-font-body);
    }

    .los-legend-title {
      color: var(--td-gold-light);
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      text-align: center;
      margin-bottom: 4px;
      opacity: 0.85;
    }

    .los-legend-row {
      display: flex;
      gap: 14px;
      justify-content: center;
      flex-wrap: wrap;
      align-items: center;
    }

    .los-legend-item {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .los-legend-swatch {
      width: 12px;
      height: 12px;
      border-radius: 2px;
      border: 1px solid var(--td-frame-dark);
      box-shadow: inset 0 1px 1px rgba(0, 0, 0, 0.35);
      flex-shrink: 0;
    }

    .los-legend-label {
      color: var(--td-text-primary);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.04em;
    }
  `],
})
export class LosLegendComponent {
  private readonly uiStore = inject(UIStore);

  /** Tower kann Ground-Einheiten treffen. */
  canTargetGround = input(true);
  /** Tower kann Air-Einheiten treffen. */
  canTargetAir = input(false);

  /** Einträge je Filter-Mode und Tower-Capabilities, siehe `buildLosLegendEntries`. */
  readonly entries = computed<LosLegendEntry[]>(() =>
    buildLosLegendEntries(
      this.uiStore.perTowerLosFilter(),
      this.canTargetGround(),
      this.canTargetAir(),
    ),
  );
}
