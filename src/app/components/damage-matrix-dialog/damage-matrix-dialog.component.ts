import { Component, ChangeDetectionStrategy, ElementRef, afterNextRender, computed, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { TowerTypeId } from '../../configs/tower-types.config';
import { ResearchStore } from '../../store/research.store';
import { TdIconComponent } from '../icon/icon.component';
import {
  buildDamageMatrixColumns,
  buildDamageMatrixRows,
  buildEffectivenessLegend,
  countLockedTowers,
} from './damage-matrix-table';
import { DAMAGE_MATRIX_DESC_ID, DAMAGE_MATRIX_TITLE_ID } from './open-damage-matrix-dialog';

export interface DamageMatrixDialogData {
  /** Zeile dieses Towers wird hervorgehoben (Aufruf aus dem Tower-Panel). */
  towerId?: TowerTypeId;
}

/**
 * Globale Übersicht der freigeschalteten Tower gegen alle Rüstungstypen.
 * Zellen nutzen dieselben Stufen wie die Schadenszahlen im Kampf (Farben: matrixTierColor).
 * Gesperrte Tower fehlen ganz (das Baumenü zeigt sie als gesperrte Karte), ein
 * Hinweis unter der Tabelle verweist auf die Forschung.
 * Geöffnet über openDamageMatrixDialog.
 */
@Component({
  selector: 'app-damage-matrix-dialog',
  standalone: true,
  imports: [MatDialogModule, TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './damage-matrix-dialog.component.html',
  styleUrl: './damage-matrix-dialog.component.scss',
  styles: `
    :host {
      ${TD_CSS_VARS}
    }
  `,
})
export class DamageMatrixDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<DamageMatrixDialogComponent>);
  private readonly data = inject<DamageMatrixDialogData | null>(MAT_DIALOG_DATA, { optional: true });
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly research = inject(ResearchStore);

  readonly titleId = DAMAGE_MATRIX_TITLE_ID;
  readonly descId = DAMAGE_MATRIX_DESC_ID;
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
