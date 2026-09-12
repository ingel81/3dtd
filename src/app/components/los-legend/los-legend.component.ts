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
  templateUrl: './los-legend.component.html',
  styleUrl: './los-legend.component.scss',
  styles: `
    :host {
      ${TD_CSS_VARS}
    }
  `,
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
