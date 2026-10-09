import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TowerDefenseStore } from '../../../store/tower-defense.store';
import { Tower } from '../../../entities/tower.entity';
import { SellConfirmService } from '../../../services/sell-confirm.service';
import { buildingAbilityRows } from './building-panel';

/**
 * Panel eines gewählten passiven Gebäudes ohne eigenes Panel (das Research
 * Center hat eins): Name, was es tut, die Fähigkeiten, die von ihm starten,
 * mit Taste und Zustand, Verkauf. Keine Stats, kein Targeting, keine
 * Upgrades.
 */
@Component({
  selector: 'app-sidebar-building-panel',
  standalone: true,
  imports: [MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './building-panel.component.html',
  host: { class: 'td-side-section is-fill' },
})
export class SidebarBuildingPanelComponent {
  private readonly store = inject(TowerDefenseStore);
  private readonly sellConfirm = inject(SellConfirmService);

  readonly tower = input.required<Tower>();

  readonly sellTower = output<void>();

  /** The first click on Sell only arms it, see SellConfirmService. */
  readonly sellArmed = computed(() => this.sellConfirm.armedTowerId() === this.tower().id);

  /** Die Fähigkeiten, die von diesem Gebäude starten (Missile Silo: Nuclear Strike) */
  readonly abilities = computed(() =>
    buildingAbilityRows(this.tower().typeConfig.id, this.store.abilities(), this.store.waveActive()),
  );

  /** Verkaufswert, wie im Tower-Detail an `selectedTowerRevision` gebunden. */
  readonly sellValue = computed(() => {
    this.store.selectedTowerRevision();
    return this.tower().getSellValue();
  });

  onSell(): void {
    if (this.sellConfirm.request(this.tower().id)) this.sellTower.emit();
  }
}
