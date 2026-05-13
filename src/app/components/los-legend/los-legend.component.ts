import { Component, computed, inject, input, ChangeDetectionStrategy } from '@angular/core';
import { LOS_VIZ_CONFIG, StateAppearance } from '../../configs/los-viz.config';
import { UIStore } from '../../store/ui.store';
import { TD_CSS_VARS } from '../../styles/td-theme';

interface LegendEntry {
  label: string;
  /** Pre-computed CSS rgba string sampled from `LOS_VIZ_CONFIG.states`. */
  swatch: string;
}

/**
 * Linear-RGB 0..1 → CSS sRGB component. Three.js rendert die Cell-Shader-
 * Farben durch den sRGB-Output-Pfad des Renderers; derselbe Gamma-Schritt
 * hier sorgt dafür dass die Swatch farblich zum In-3D-Cell passt.
 */
function linearToSrgb(c: number): number {
  return Math.round(Math.pow(Math.max(0, Math.min(1, c)), 1 / 2.2) * 255);
}

function swatch(state: StateAppearance): string {
  const c = state.color;
  // Alpha im Swatch hochgesetzt damit die Farbe gut lesbar ist
  const a = Math.max(0.6, state.alpha);
  return `rgba(${linearToSrgb(c.r)}, ${linearToSrgb(c.g)}, ${linearToSrgb(c.b)}, ${a.toFixed(2)})`;
}

/**
 * Legende für die GPU-LOS-Coverage-Visualisierung. Best-to-worst
 * Reihenfolge:
 *  1. Ground + Air sichtbar (best)
 *  2. Nur Ground sichtbar
 *  3. Nur Air sichtbar
 *  4. Blockiert (worst)
 *
 * Plus Footer-Note: der schwarze Punkt im Cell-Zentrum markiert Cells
 * die durch reale Geometrie (Gebäude, Hügel) verdeckt sind — versus
 * Cells am Rand der Reichweite.
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

  /**
   * Berechnet die anzuzeigenden Einträge dynamisch je Filter-Mode.
   * Universelle Palette: gold/grün/blau/rot/grau — gleiche Bedeutung
   * unabhängig vom Modus, Legend zeigt nur die Swatches die in dem
   * aktiven Modus überhaupt vorkommen.
   *
   * Filter=Both (4-State): Both / Ground / Air / Blocked
   * Filter=Ground-only:    Ground / Blocked
   * Filter=Air-only:       Air    / Blocked
   * Capability-Gating: Pure-Ground-Tower → kein Air-Swatch usw.
   */
  readonly entries = computed<LegendEntry[]>(() => {
    const states = LOS_VIZ_CONFIG.states;
    const filter = this.uiStore.perTowerLosFilter();
    const g = this.canTargetGround();
    const a = this.canTargetAir();
    const list: LegendEntry[] = [];

    if (filter === 'both') {
      if (g && a) list.push({ label: 'Ground + Air', swatch: swatch(states.both) });
      if (g)      list.push({ label: 'Ground',       swatch: swatch(states.groundOnly) });
      if (a)      list.push({ label: 'Air',          swatch: swatch(states.airOnly) });
      list.push({ label: 'Blocked', swatch: swatch(states.neither) });
    } else if (filter === 'ground' && g) {
      list.push({ label: 'Ground',  swatch: swatch(states.groundOnly) });
      list.push({ label: 'Blocked', swatch: swatch(states.neither) });
    } else if (filter === 'air' && a) {
      list.push({ label: 'Air',     swatch: swatch(states.airOnly) });
      list.push({ label: 'Blocked', swatch: swatch(states.neither) });
    } else {
      // Filter trifft Tower-Capabilities nicht (z.B. Air-only-Filter
      // bei Pure-Ground-Tower) → nur Blocked, leerer Layer.
      list.push({ label: 'Blocked', swatch: swatch(states.neither) });
    }

    return list;
  });
}
