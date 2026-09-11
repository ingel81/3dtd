import { Component, ChangeDetectionStrategy, ElementRef, afterNextRender, computed, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { TD_CSS_VARS, TD_SCROLLBAR_STYLES, TD_SCROLLBAR_WEBKIT } from '../../styles/td-theme';
import { TowerTypeId } from '../../configs/tower-types.config';
import { ResearchStore } from '../../store/research.store';
import { TdIconComponent } from '../icon/icon.component';
import {
  buildDamageMatrixColumns,
  buildDamageMatrixRows,
  buildEffectivenessLegend,
  countLockedTowers,
} from './damage-matrix-table';

export interface DamageMatrixDialogData {
  /** Zeile dieses Towers wird hervorgehoben (Aufruf aus dem Tower-Panel). */
  towerId?: TowerTypeId;
}

const TITLE_ID = 'td-damage-matrix-title';
const DESC_ID = 'td-damage-matrix-desc';

/**
 * Breit genug für alle fünf Rüstungsspalten ohne horizontales Scrollen. Muss als
 * Dialog-Config gesetzt werden: das Overlay-Pane von MatDialog ist per Klasse
 * auf 560px begrenzt, nur der Inline-Style der Config hebt das auf.
 */
const DIALOG_WIDTH = 'min(880px, 92vw)';

/**
 * Öffnet die Damage-vs-Armor-Tabelle. Esc schließt (MatDialog-Default),
 * der Fokus kehrt danach zum auslösenden Button zurück.
 */
export function openDamageMatrixDialog(
  dialog: MatDialog,
  towerId?: TowerTypeId,
): MatDialogRef<DamageMatrixDialogComponent> {
  return dialog.open<DamageMatrixDialogComponent, DamageMatrixDialogData>(DamageMatrixDialogComponent, {
    panelClass: 'td-dialog-panel',
    width: DIALOG_WIDTH,
    maxWidth: '92vw',
    ariaLabelledBy: TITLE_ID,
    ariaDescribedBy: DESC_ID,
    autoFocus: 'dialog',
    data: { towerId },
  });
}

/**
 * Globale Übersicht der freigeschalteten Tower gegen alle Rüstungstypen.
 * Zellen nutzen dieselben Stufen wie die Schadenszahlen im Kampf (Farben: matrixTierColor).
 * Gesperrte Tower fehlen ganz (das Baumenü zeigt sie als gesperrte Karte), ein
 * Hinweis unter der Tabelle verweist auf die Forschung.
 */
@Component({
  selector: 'app-damage-matrix-dialog',
  standalone: true,
  imports: [MatDialogModule, TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="matrix-dialog">
      <div class="dialog-header">
        <td-icon class="header-icon" name="shield" [size]="18"></td-icon>
        <div class="header-text">
          <h2 [id]="titleId">Damage vs Armor</h2>
          <p class="header-note" [id]="descId">Multiplier on every hit</p>
        </div>
      </div>

      <div class="dialog-content" tabindex="0" role="region" aria-label="Damage multipliers">
        <table class="matrix" [attr.aria-labelledby]="titleId">
          <colgroup>
            <col class="col-tower">
            @for (col of columns; track col.armor) {
              <col>
            }
          </colgroup>
          <thead>
            <tr>
              <th scope="col" class="corner">Tower</th>
              @for (col of columns; track col.armor) {
                <th scope="col">{{ col.label }}</th>
              }
            </tr>
          </thead>
          <tbody>
            <tr class="examples">
              <th scope="row">Enemies</th>
              @for (col of columns; track col.armor) {
                <td>{{ col.examples.join(', ') }}</td>
              }
            </tr>
            @for (row of rows(); track row.towerId) {
              <tr class="tower-row"
                  [class.current]="row.towerId === highlightId"
                  [attr.aria-current]="row.towerId === highlightId ? 'true' : null">
                <th scope="row" [style.--damage-color]="row.damageColor">
                  <span class="tower-name">{{ row.name }}</span>
                  <span class="damage-type">{{ row.damageLabel }}</span>
                </th>
                @for (cell of row.cells; track cell.armor) {
                  <td class="cell" [attr.data-eff]="cell.effectiveness" [style.--tier-color]="cell.color">
                    <span class="value">{{ cell.text }}</span><span class="sr-only"> {{ cell.tierLabel }}</span>
                  </td>
                }
              </tr>
            }
          </tbody>
        </table>
        @if (hasLockedTowers()) {
          <p class="locked-hint">
            <td-icon name="lock" [size]="12"></td-icon>
            More towers unlock through research.
          </p>
        }
      </div>

      <div class="dialog-actions">
        <ul class="legend" aria-label="Tiers">
          @for (entry of legend; track entry.effectiveness) {
            <li>
              <span class="swatch" [style.--tier-color]="entry.color"></span>
              <span>{{ entry.label }}</span>
              @if (entry.range) {
                <span class="legend-range">{{ entry.range }}</span>
              }
            </li>
          }
        </ul>
        <button class="close-btn" (click)="close()">Close</button>
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
      ${TD_CSS_VARS}
    }

    /* Breite kommt aus DIALOG_WIDTH (Dialog-Config) */
    .matrix-dialog {
      max-height: 85vh;
      display: flex;
      flex-direction: column;
      background: var(--td-panel-main);
      border: 1px solid var(--td-frame-dark);
      box-shadow:
        inset 0 1px 0 rgba(122, 133, 128, 0.2),
        inset 0 -1px 0 var(--td-panel-shadow),
        0 1px 0 var(--td-panel-shadow);
      color: var(--td-text-primary);
      font-family: var(--td-font-body);
    }

    .dialog-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 18px;
      border-bottom: 1px solid var(--td-frame-dark);
      flex-shrink: 0;
    }
    .header-icon {
      color: var(--td-gold);
      flex-shrink: 0;
    }
    .header-text {
      display: flex;
      flex-direction: column;
      gap: 3px;
      min-width: 0;
    }
    h2 {
      margin: 0;
      font: 600 14px/1.2 var(--td-font-body);
      color: var(--td-gold);
    }
    .header-note {
      margin: 0;
      font: 11px/1.3 var(--td-font-body);
      color: var(--td-text-muted);
    }

    /* Kein padding-top: der Sticky-Kopf klebt sonst mit Lücke unter dem Rand */
    .dialog-content {
      padding: 0 18px 14px;
      overflow: auto;
      flex: 1;
      min-height: 0;
      scroll-padding-top: 36px;
      ${TD_SCROLLBAR_STYLES}
    }
    .dialog-content:focus-visible {
      outline: 1px solid var(--td-frame-light);
      outline-offset: -1px;
    }
    .dialog-content::-webkit-scrollbar { ${TD_SCROLLBAR_WEBKIT.scrollbar} }
    .dialog-content::-webkit-scrollbar-track { ${TD_SCROLLBAR_WEBKIT.track} }
    .dialog-content::-webkit-scrollbar-thumb { ${TD_SCROLLBAR_WEBKIT.thumb} }
    .dialog-content::-webkit-scrollbar-thumb:hover { ${TD_SCROLLBAR_WEBKIT.thumbHover} }
    .dialog-content::-webkit-scrollbar-corner { ${TD_SCROLLBAR_WEBKIT.corner} }

    /* Feste Aufteilung: Rüstungsspalten gleich breit, lange Gegnerlisten brechen um.
       Horizontal gescrollt wird erst unterhalb von min-width (sehr schmales Fenster). */
    .matrix {
      width: 100%;
      min-width: 600px;
      table-layout: fixed;
      border-collapse: separate;
      border-spacing: 0;
      font: 11px/1.3 var(--td-font-mono);
      color: var(--td-text-secondary);
    }

    .col-tower {
      width: 150px;
    }

    /* Rüstungsnamen bleiben beim Scrollen sichtbar */
    thead th {
      position: sticky;
      top: 0;
      z-index: 1;
      background: var(--td-panel-main);
      padding: 14px 6px 8px;
      font: 600 9px/1 var(--td-font-mono);
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--td-text-secondary);
      text-align: center;
      border-bottom: 1px solid var(--td-rune-amber-muted);
    }
    thead th.corner {
      text-align: left;
      padding-left: 10px;
      color: var(--td-text-muted);
    }

    tbody th {
      text-align: left;
      font-weight: 400;
    }

    /* Gegner je Rüstung: Unterzeile des Kopfs, scrollt mit */
    .examples > * {
      vertical-align: top;
      padding: 7px 6px 10px;
      border-bottom: 1px solid var(--td-frame-dark);
    }
    .examples th {
      padding-left: 10px;
      font: 9px/1.4 var(--td-font-mono);
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--td-text-muted);
    }
    .examples td {
      text-align: center;
      font: 10px/1.4 var(--td-font-body);
      color: var(--td-text-muted);
      text-wrap: balance;
    }

    .tower-row > * {
      padding: 7px 6px;
      vertical-align: middle;
      border-bottom: 1px solid var(--td-panel-shadow);
    }
    .tower-row > th {
      padding: 8px 8px 8px 10px;
    }
    .tower-row:last-child > * {
      border-bottom: none;
    }
    .tower-row:hover > * {
      background: rgba(255, 255, 255, 0.025);
    }

    .tower-name {
      display: block;
      font: 600 12px/1.25 var(--td-font-body);
      color: var(--td-text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    /* Punkt in der Farbe der Schadensart (DAMAGE_TYPE_UI), gedämpft */
    .damage-type {
      display: flex;
      align-items: center;
      gap: 5px;
      margin-top: 3px;
      font: 9px/1 var(--td-font-mono);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--td-text-muted);
    }
    .damage-type::before {
      content: '';
      width: 6px;
      height: 6px;
      border-radius: 1px;
      background: color-mix(in srgb, var(--damage-color) 75%, transparent);
      flex-shrink: 0;
    }

    /* Aufruf aus dem Tower-Panel: gewählter Tower (nach :hover, damit der Tint bleibt) */
    .tower-row.current > * {
      background: color-mix(in srgb, var(--td-teal) 8%, transparent);
    }
    .tower-row.current > th {
      box-shadow: inset 2px 0 0 var(--td-teal-light);
    }
    .tower-row.current .tower-name {
      color: var(--td-teal-light);
    }

    /* Weak und Normal nur als Textfarbe, Strong und Devastating als Chip mit leichtem Tint */
    .cell {
      text-align: center;
    }
    .value {
      display: inline-block;
      min-width: 58px;
      padding: 3px 6px;
      border: 1px solid transparent;
      border-radius: 2px;
      font: 500 11px/1.2 var(--td-font-mono);
      font-variant-numeric: tabular-nums;
      color: var(--tier-color);
    }
    .cell[data-eff='strong'] .value {
      background: color-mix(in srgb, var(--tier-color) 10%, transparent);
      border-color: color-mix(in srgb, var(--tier-color) 28%, transparent);
    }
    .cell[data-eff='devastating'] .value {
      font-weight: 700;
      background: color-mix(in srgb, var(--tier-color) 15%, transparent);
      border-color: color-mix(in srgb, var(--tier-color) 40%, transparent);
    }

    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }

    .locked-hint {
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 12px 0 0 10px;
      font: 11px/1.4 var(--td-font-body);
      color: var(--td-text-muted);
    }

    .dialog-actions {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px 16px;
      padding: 10px 18px;
      border-top: 1px solid var(--td-frame-mid);
      flex-shrink: 0;
    }

    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 16px;
      margin: 0;
      padding: 0;
      list-style: none;
      font: 10px/1 var(--td-font-mono);
      color: var(--td-text-secondary);
    }
    .legend li {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .swatch {
      width: 8px;
      height: 8px;
      border-radius: 1px;
      background: var(--tier-color);
      flex-shrink: 0;
    }
    .legend-range {
      color: var(--td-text-muted);
      font-variant-numeric: tabular-nums;
    }

    .close-btn {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      font-size: 11px;
      font-weight: 500;
      font-family: var(--td-font-mono);
      letter-spacing: 0.06em;
      text-transform: uppercase;
      cursor: pointer;
      background: var(--td-panel-main);
      color: var(--td-text-secondary);
      border: 1px solid var(--td-frame-dark);
      box-shadow:
        inset 0 1px 0 rgba(122, 133, 128, 0.2),
        var(--td-shadow-key);
      transition: box-shadow 0.18s ease, color 0.15s ease;
    }
    .close-btn:hover,
    .close-btn:focus-visible {
      color: var(--td-text-primary);
      box-shadow:
        inset 0 1px 0 rgba(122, 133, 128, 0.2),
        0 0 0 1px var(--td-frame-mid),
        var(--td-shadow-key);
    }
  `,
})
export class DamageMatrixDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<DamageMatrixDialogComponent>);
  private readonly data = inject<DamageMatrixDialogData | null>(MAT_DIALOG_DATA, { optional: true });
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly research = inject(ResearchStore);

  readonly titleId = TITLE_ID;
  readonly descId = DESC_ID;
  readonly columns = buildDamageMatrixColumns();
  private readonly isUnlocked = (id: TowerTypeId): boolean => this.research.isTowerUnlocked(id);
  /** Reaktiv: eine Forschung, die bei offenem Dialog fertig wird, fügt die Zeile sofort ein. */
  readonly rows = computed(() => buildDamageMatrixRows(this.isUnlocked));
  readonly hasLockedTowers = computed(() => countLockedTowers(this.isUnlocked) > 0);
  readonly legend = buildEffectivenessLegend();
  readonly highlightId = this.data?.towerId ?? null;

  constructor() {
    // Bei kleiner Fensterhöhe liegt die hervorgehobene Zeile sonst unter dem Rand
    afterNextRender(() => {
      this.host.nativeElement.querySelector('tr.current')?.scrollIntoView({ block: 'nearest' });
    });
  }

  close(): void {
    this.dialogRef.close();
  }
}
