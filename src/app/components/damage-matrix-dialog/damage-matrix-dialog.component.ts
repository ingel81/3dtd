import { Component, ChangeDetectionStrategy, ElementRef, afterNextRender, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { TD_CSS_VARS, TD_SCROLLBAR_STYLES, TD_SCROLLBAR_WEBKIT } from '../../styles/td-theme';
import { TowerTypeId } from '../../configs/tower-types.config';
import { TdIconComponent } from '../icon/icon.component';
import {
  buildDamageMatrixColumns,
  buildDamageMatrixRows,
  buildEffectivenessLegend,
} from './damage-matrix-table';

export interface DamageMatrixDialogData {
  /** Zeile dieses Towers wird hervorgehoben (Aufruf aus dem Tower-Panel). */
  towerId?: TowerTypeId;
}

const TITLE_ID = 'td-damage-matrix-title';

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
    ariaLabelledBy: TITLE_ID,
    autoFocus: 'dialog',
    data: { towerId },
  });
}

/**
 * Globale Übersicht aller baubaren Tower gegen alle Rüstungstypen.
 * Zellen nutzen dieselben Stufen und Farben wie die Schadenszahlen im Kampf.
 */
@Component({
  selector: 'app-damage-matrix-dialog',
  standalone: true,
  imports: [MatDialogModule, TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="matrix-dialog">
      <div class="dialog-header">
        <td-icon class="header-icon" name="info" [size]="20"></td-icon>
        <h2 [id]="titleId">Damage vs Armor</h2>
      </div>

      <div class="dialog-content" tabindex="0" role="region" aria-label="Damage multipliers">
        <table class="matrix">
          <caption>Multiplier on every hit. Damage numbers in combat use the same tiers.</caption>
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
            @for (row of rows; track row.towerId) {
              <tr [class.current]="row.towerId === highlightId"
                  [attr.aria-current]="row.towerId === highlightId ? 'true' : null">
                <th scope="row">
                  <span class="tower-name">{{ row.name }}</span>
                  <span class="damage-type">{{ row.damageLabel }}</span>
                </th>
                @for (cell of row.cells; track cell.armor) {
                  <td class="cell" [attr.data-eff]="cell.effectiveness" [style.--cell-color]="cell.color">
                    {{ cell.text }}<span class="sr-only"> {{ cell.tierLabel }}</span>
                  </td>
                }
              </tr>
            }
          </tbody>
        </table>
      </div>

      <div class="dialog-actions">
        <ul class="legend" aria-label="Tiers">
          @for (entry of legend; track entry.effectiveness) {
            <li>
              <span class="swatch" [style.--cell-color]="entry.color"></span>
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
      ${TD_CSS_VARS}
    }

    .matrix-dialog {
      width: 640px;
      max-width: 80vw;
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
      gap: 10px;
      padding: 12px 16px;
      border-bottom: 1px solid var(--td-frame-dark);
      flex-shrink: 0;
    }
    .header-icon {
      color: var(--td-gold);
    }
    h2 {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
      color: var(--td-gold);
    }

    /* Kein padding-top: der Sticky-Kopf klebt sonst mit Lücke unter dem Rand */
    .dialog-content {
      padding: 0 12px 12px;
      overflow: auto;
      flex: 1;
      min-height: 0;
      scroll-padding-top: 32px;
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

    .matrix {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      font: 11px/1.3 var(--td-font-mono);
      color: var(--td-text-secondary);
    }

    caption {
      caption-side: top;
      text-align: left;
      padding: 10px 0 8px;
      font: 11px/1.4 var(--td-font-body);
      color: var(--td-text-muted);
    }

    th, td {
      padding: 6px;
      border-bottom: 1px solid var(--td-panel-shadow);
    }

    /* Rüstungsnamen bleiben beim Scrollen sichtbar */
    thead th {
      position: sticky;
      top: 0;
      z-index: 1;
      background: var(--td-panel-main);
      font: 600 9px/1 var(--td-font-mono);
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--td-text-muted);
      text-align: center;
      padding: 8px 6px;
      border-bottom: 1px solid var(--td-rune-amber-muted);
    }
    thead th.corner {
      text-align: left;
    }

    tbody th {
      text-align: left;
      font-weight: 400;
    }

    .examples th,
    .examples td {
      vertical-align: top;
      padding: 6px 4px 8px;
      border-bottom-color: var(--td-frame-dark);
    }
    .examples th {
      padding-left: 6px;
      font: 9px/1.35 var(--td-font-mono);
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--td-text-muted);
    }
    .examples td {
      text-align: center;
      font: 10px/1.35 var(--td-font-body);
      color: var(--td-text-muted);
    }

    .tower-name {
      display: block;
      font: 600 11px/1.2 var(--td-font-body);
      color: var(--td-text-primary);
      white-space: nowrap;
    }
    .damage-type {
      display: block;
      margin-top: 2px;
      font: 9px/1 var(--td-font-mono);
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--td-text-muted);
    }

    tbody tr:not(.examples):hover {
      background: rgba(255, 255, 255, 0.03);
    }

    /* Aufruf aus dem Tower-Panel: gewählter Tower */
    tr.current {
      background: color-mix(in srgb, var(--td-teal) 8%, transparent);
    }
    tr.current th {
      box-shadow: inset 2px 0 0 var(--td-teal-light);
    }
    tr.current .tower-name {
      color: var(--td-teal-light);
    }

    .cell {
      text-align: center;
      font-variant-numeric: tabular-nums;
      color: var(--cell-color);
    }
    .cell[data-eff='strong'],
    .cell[data-eff='devastating'] {
      font-weight: 700;
      background: color-mix(in srgb, var(--cell-color) 12%, transparent);
    }
    .cell[data-eff='devastating'] {
      background: color-mix(in srgb, var(--cell-color) 18%, transparent);
    }

    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }

    .dialog-actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 8px 16px;
      padding: 10px 16px;
      border-top: 1px solid var(--td-frame-mid);
      flex-shrink: 0;
    }

    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 14px;
      margin: 0;
      padding: 0;
      list-style: none;
      font: 10px/1 var(--td-font-mono);
      color: var(--td-text-secondary);
    }
    .legend li {
      display: flex;
      align-items: center;
      gap: 5px;
    }
    .swatch {
      width: 8px;
      height: 8px;
      background: var(--cell-color);
      border: 1px solid var(--td-panel-shadow);
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

  readonly titleId = TITLE_ID;
  readonly columns = buildDamageMatrixColumns();
  readonly rows = buildDamageMatrixRows();
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
