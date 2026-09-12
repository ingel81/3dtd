import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TowerDefenseStore } from '../../../store/tower-defense.store';
import { ResearchStore } from '../../../store/research.store';
import { UpgradeId } from '../../../configs/tower-types.config';
import { RESEARCH_TREE, getResearch } from '../../../configs/research/research-tree.config';
import { ActiveResearch, ResearchConfig, ResearchId } from '../../../configs/research/research.types';
import { Tower } from '../../../entities/tower.entity';
import { SellConfirmService } from '../../../services/sell-confirm.service';
import { TdIconComponent } from '../../icon/icon.component';
import {
  missingPrereqNames,
  researchNodeIcon,
  researchProgress,
  researchRemaining,
  researchStatus,
  ResearchStatus,
} from './research-status';

/**
 * Panel des gewählten Research Centers: laufende Forschungen mit
 * Fortschritt, Forschungsbaum, Upgrades des Gebäudes, Verkauf.
 */
@Component({
  selector: 'app-sidebar-research-panel',
  standalone: true,
  imports: [DecimalPipe, MatTooltipModule, TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './research-panel.component.html',
  styleUrl: './research-panel.component.scss',
})
export class SidebarResearchPanelComponent {
  readonly store = inject(TowerDefenseStore);
  readonly researchStore = inject(ResearchStore);
  private readonly sellConfirm = inject(SellConfirmService);

  readonly tower = input.required<Tower>();

  /** The first click on Sell only arms it, see SellConfirmService. */
  readonly sellArmed = computed(() => this.sellConfirm.armedTowerId() === this.tower().id);

  readonly sellTower = output<void>();
  readonly upgradeTower = output<{ tower: Tower; upgradeId: UpgradeId }>();
  readonly startResearch = output<ResearchId>();
  readonly cancelResearch = output<ResearchId>();

  readonly allResearches = Object.values(RESEARCH_TREE);

  /** Verkaufswert; ändert sich mit Upgrades, siehe `selectedTowerRevision`. */
  readonly sellValue = computed(() => {
    this.store.selectedTowerRevision();
    return this.tower().getSellValue();
  });

  getResearchStatus(id: ResearchId): ResearchStatus {
    return researchStatus(
      id,
      this.researchStore.completedResearches(),
      this.researchStore.activeResearches(),
    );
  }

  researchNodeIconName(research: ResearchConfig): string {
    return researchNodeIcon(research, this.getResearchStatus(research.id));
  }

  getActiveResearchProgress(active: ActiveResearch): number {
    return researchProgress(active.duration, this.elapsedOf(active));
  }

  getActiveResearchRemaining(active: ActiveResearch): number {
    return researchRemaining(active.duration, this.elapsedOf(active));
  }

  getResearchName(id: ResearchId): string {
    return getResearch(id)?.name ?? id;
  }

  getMissingPrereqs(id: ResearchId): string {
    return missingPrereqNames(id, this.researchStore.completedResearches());
  }

  onSell(): void {
    if (this.sellConfirm.request(this.tower().id)) this.sellTower.emit();
  }

  onUpgradeTower(upgradeId: UpgradeId): void {
    this.upgradeTower.emit({ tower: this.tower(), upgradeId });
  }

  /**
   * Vergangene Spielzeit aus `researchElapsed` (10 Hz per `research:progress`),
   * nicht aus `active.elapsed`: das zählt der ResearchManager ohne Signal hoch.
   */
  private elapsedOf(active: ActiveResearch): number {
    return this.researchStore.researchElapsed().get(active.researchId) ?? 0;
  }
}
