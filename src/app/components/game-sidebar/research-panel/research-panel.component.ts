import { ChangeDetectionStrategy, Component, computed, inject, Injector, input, output } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { MatDialog } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TowerDefenseStore } from '../../../store/tower-defense.store';
import { ResearchStore } from '../../../store/research.store';
import { UpgradeId } from '../../../configs/tower-types.config';
import { getResearch } from '../../../configs/research/research-tree.config';
import { ActiveResearch, ResearchId } from '../../../configs/research/research.types';
import { Tower } from '../../../entities/tower.entity';
import { SellConfirmService } from '../../../services/sell-confirm.service';
import { UpgradeHintService } from '../../../services/upgrade-hint.service';
import { TdIconComponent } from '../../icon/icon.component';
import { upgradeHintView } from '../tower-panel/tower-stats';
import { upgradeTrackRefusal } from '../../../utils/player-actions';
import { openResearchDialog } from '../../research-dialog/open-research-dialog';
import { researchProgress, researchRemaining } from './research-status';

/**
 * Panel des gewählten Research Centers: laufende Forschungen mit Fortschritt,
 * Upgrades des Gebäudes, Verkauf, und der Knopf zum Forschungsbaum.
 *
 * Der Baum selbst und die Warteschlange liegen im Dialog
 * (`research-dialog/`), nicht mehr hier: eine flache Liste aller Knoten zeigt
 * die Kanten nicht, an denen man sieht, was hinter was hängt (TODO G3).
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
  private readonly upgradeHint = inject(UpgradeHintService);
  private readonly dialog = inject(MatDialog);
  // Der Dialog braucht einen Injector aus dem Spielbaum, siehe openResearchDialog.
  private readonly injector = inject(Injector);

  readonly tower = input.required<Tower>();

  /** The first click on Sell only arms it, see SellConfirmService. */
  readonly sellArmed = computed(() => this.sellConfirm.armedTowerId() === this.tower().id);

  /** The last U or tile click on the center: the tile it bought flashes, or why it bought nothing */
  readonly hintView = computed(() => upgradeHintView(this.upgradeHint.hint(), this.tower()));

  readonly sellTower = output<void>();
  readonly upgradeTower = output<{ tower: Tower; upgradeId: UpgradeId }>();
  readonly cancelResearch = output<ResearchId>();

  /** Waiting for a slot and the credits, in start order */
  readonly queue = this.researchStore.queuedResearches;

  /** Verkaufswert; ändert sich mit Upgrades, siehe `selectedTowerRevision`. */
  readonly sellValue = computed(() => {
    this.store.selectedTowerRevision();
    return this.tower().getSellValue();
  });

  getActiveResearchProgress(active: ActiveResearch): number {
    return researchProgress(active.duration, this.elapsedOf(active));
  }

  getActiveResearchRemaining(active: ActiveResearch): number {
    return researchRemaining(active.duration, this.elapsedOf(active));
  }

  getResearchName(id: ResearchId): string {
    return getResearch(id)?.name ?? id;
  }

  /** The tree, the queue and the picking live there. */
  openTechTree(): void {
    openResearchDialog(this.dialog, this.injector);
  }

  onSell(): void {
    if (this.sellConfirm.request(this.tower().id)) this.sellTower.emit();
  }

  /** Not buyable right now: the tile looks disabled, a click on it still says why. */
  isUpgradeRefused(upgradeId: UpgradeId): boolean {
    return upgradeTrackRefusal(
      this.tower(), upgradeId, this.store.credits(), this.researchStore.maxUpgradeTier(),
    ) !== null;
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
