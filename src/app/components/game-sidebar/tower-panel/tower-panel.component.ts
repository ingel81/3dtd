import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { DecimalPipe, UpperCasePipe } from '@angular/common';
import { MatDialog } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TowerDefenseStore } from '../../../store/tower-defense.store';
import { ResearchStore } from '../../../store/research.store';
import {
  AirSubStrategy,
  AIR_SUB_STRATEGIES,
  requiredUpgradeTier,
  TargetingStrategy,
  UpgradeId,
} from '../../../configs/tower-types.config';
import { DAMAGE_TYPE_UI } from '../../../configs/combat/combat-ui.config';
import { Tower } from '../../../entities/tower.entity';
import { openDamageMatrixDialog } from '../../damage-matrix-dialog/damage-matrix-dialog.component';
import { TdIconComponent } from '../../icon/icon.component';
import { damageTypeIcon, targetingStrategiesFor, towerDps, upgradeTierLockReason } from './tower-stats';

/**
 * Tower-Detail der Sidebar für den gewählten Tower (das Research Center hat
 * ein eigenes Panel): Stats, Targeting, Upgrades, Verkauf.
 */
@Component({
  selector: 'app-sidebar-tower-panel',
  standalone: true,
  imports: [DecimalPipe, UpperCasePipe, MatTooltipModule, TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tower-panel.component.html',
  styleUrl: './tower-panel.component.scss',
})
export class SidebarTowerPanelComponent {
  private readonly dialog = inject(MatDialog);
  private readonly researchStore = inject(ResearchStore);
  readonly store = inject(TowerDefenseStore);

  readonly tower = input.required<Tower>();

  readonly sellTower = output<void>();
  readonly upgradeTower = output<{ tower: Tower; upgradeId: UpgradeId }>();
  readonly changeTargeting = output<{ tower: Tower; strategy: TargetingStrategy }>();
  readonly changeAirSubStrategy = output<{ tower: Tower; strategy: AirSubStrategy }>();

  readonly damageTypeUI = DAMAGE_TYPE_UI;
  readonly damageTypeIcon = damageTypeIcon;
  readonly airSubStrategies = AIR_SUB_STRATEGIES;
  /** Hängt nur an der Tower-Config, darf also memoisiert sein. */
  readonly targetingStrategies = computed(() => targetingStrategiesFor(this.tower().typeConfig));

  /** Kein computed: Schaden und Feuerrate ändern sich am Entity ohne Signal. */
  getDps(): number {
    return towerDps(this.tower());
  }

  /**
   * Get the required upgrade tier for the NEXT level of this upgrade.
   * Phase 5.16: 25-level tracks gated in 5-level bands.
   *   L1-5  = Tier 1 (always free)
   *   L6-10 = Tier 2 (requires Advanced Weaponry)
   *   L11-15 = Tier 3 (requires Master Engineering)
   *   L16-20 = Tier 4 (requires Advanced Engineering)
   *   L21-25 = Tier 5 (requires Transcendent Tech)
   */
  getRequiredUpgradeTier(upgradeId: UpgradeId): number {
    return requiredUpgradeTier(this.tower().getUpgradeLevel(upgradeId));
  }

  isUpgradeTierUnlocked(upgradeId: UpgradeId): boolean {
    return this.researchStore.maxUpgradeTier() >= this.getRequiredUpgradeTier(upgradeId);
  }

  getUpgradeTierLockReason(upgradeId: UpgradeId): string | null {
    return upgradeTierLockReason(
      this.getRequiredUpgradeTier(upgradeId),
      this.researchStore.maxUpgradeTier(),
    );
  }

  onChangeTargeting(strategy: TargetingStrategy): void {
    this.changeTargeting.emit({ tower: this.tower(), strategy });
  }

  onChangeAirSubStrategy(strategy: AirSubStrategy): void {
    this.changeAirSubStrategy.emit({ tower: this.tower(), strategy });
  }

  onUpgradeTower(upgradeId: UpgradeId): void {
    this.upgradeTower.emit({ tower: this.tower(), upgradeId });
  }

  /** Damage-vs-armor chart with this tower's row highlighted. */
  openDamageMatrix(): void {
    openDamageMatrixDialog(this.dialog, this.tower().typeConfig.id);
  }
}
