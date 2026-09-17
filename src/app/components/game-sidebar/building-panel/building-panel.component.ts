import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { UpperCasePipe } from '@angular/common';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TowerDefenseStore } from '../../../store/tower-defense.store';
import { Tower } from '../../../entities/tower.entity';
import { SellConfirmService } from '../../../services/sell-confirm.service';
import { TdIconComponent } from '../../icon/icon.component';

/**
 * Panel eines gewählten passiven Gebäudes ohne eigenes Panel (das Research
 * Center hat eins): Name, was es tut, Verkauf. Keine Stats, kein Targeting,
 * keine Upgrades.
 */
@Component({
  selector: 'app-sidebar-building-panel',
  standalone: true,
  imports: [UpperCasePipe, MatTooltipModule, TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './building-panel.component.html',
  styleUrl: './building-panel.component.scss',
})
export class SidebarBuildingPanelComponent {
  private readonly store = inject(TowerDefenseStore);
  private readonly sellConfirm = inject(SellConfirmService);

  readonly tower = input.required<Tower>();

  readonly sellTower = output<void>();

  /** The first click on Sell only arms it, see SellConfirmService. */
  readonly sellArmed = computed(() => this.sellConfirm.armedTowerId() === this.tower().id);

  /** Verkaufswert, wie im Tower-Detail an `selectedTowerRevision` gebunden. */
  readonly sellValue = computed(() => {
    this.store.selectedTowerRevision();
    return this.tower().getSellValue();
  });

  onSell(): void {
    if (this.sellConfirm.request(this.tower().id)) this.sellTower.emit();
  }
}
