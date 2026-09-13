import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
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
import { SellConfirmService } from '../../../services/sell-confirm.service';
import { openDamageMatrixDialog } from '../../damage-matrix-dialog/open-damage-matrix-dialog';
import { TdIconComponent } from '../../icon/icon.component';
import { damageTypeIcon } from '../../icon/damage-type-icon';
import { targetingStrategiesFor, towerStats, upgradeTierLockReason } from './tower-stats';
import { formatCompact } from '../../../utils/format-compact';

/**
 * How often the panel re-reads the damage dealt (ms). It grows with every hit,
 * far too often for a selectedTowerRevision bump per hit.
 */
const DAMAGE_DEALT_REFRESH_MS = 250;

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
export class SidebarTowerPanelComponent implements OnInit, OnDestroy {
  private readonly dialog = inject(MatDialog);
  private readonly researchStore = inject(ResearchStore);
  private readonly sellConfirm = inject(SellConfirmService);
  readonly store = inject(TowerDefenseStore);

  readonly tower = input.required<Tower>();

  /** The first click on Sell only arms it, see SellConfirmService. */
  readonly sellArmed = computed(() => this.sellConfirm.armedTowerId() === this.tower().id);

  readonly sellTower = output<void>();
  readonly upgradeTower = output<{ tower: Tower; upgradeId: UpgradeId }>();
  readonly changeTargeting = output<{ tower: Tower; strategy: TargetingStrategy }>();
  readonly changeAirSubStrategy = output<{ tower: Tower; strategy: AirSubStrategy }>();

  readonly damageTypeUI = DAMAGE_TYPE_UI;
  readonly damageTypeIcon = damageTypeIcon;
  readonly airSubStrategies = AIR_SUB_STRATEGIES;
  /** Hängt nur an der Tower-Config, darf also memoisiert sein. */
  readonly targetingStrategies = computed(() => targetingStrategiesFor(this.tower().typeConfig));

  /**
   * Stats als Schnappschuss des Towers. Der Tower ist ein mutables Entity;
   * `selectedTowerRevision` zählt bei jedem Kill und Upgrade dieses Towers
   * hoch und rechnet die Werte neu.
   */
  readonly stats = computed(() => {
    this.store.selectedTowerRevision();
    return towerStats(this.tower());
  });

  /** Ticks every DAMAGE_DEALT_REFRESH_MS while the panel is open */
  private readonly dealtTick = signal(0);
  private dealtTimer: ReturnType<typeof setInterval> | null = null;

  /** Damage dealt since the tower was built, compact ("4.3k"). A new tower shows at once. */
  readonly damageDealt = computed(() => {
    this.dealtTick();
    return formatCompact(this.tower().combat.damageDealt);
  });

  ngOnInit(): void {
    this.dealtTimer = setInterval(() => this.dealtTick.update((n) => n + 1), DAMAGE_DEALT_REFRESH_MS);
  }

  ngOnDestroy(): void {
    if (this.dealtTimer !== null) clearInterval(this.dealtTimer);
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

  onSell(): void {
    if (this.sellConfirm.request(this.tower().id)) this.sellTower.emit();
  }

  onUpgradeTower(upgradeId: UpgradeId): void {
    this.upgradeTower.emit({ tower: this.tower(), upgradeId });
  }

  /** Damage-vs-armor chart with this tower's row highlighted. */
  openDamageMatrix(): void {
    openDamageMatrixDialog(this.dialog, this.tower().typeConfig.id);
  }
}
