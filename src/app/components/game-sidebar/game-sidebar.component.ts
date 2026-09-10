import {
  Component,
  input,
  output,
  OnDestroy,
  inject,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TowerDefenseStore } from '../../store/tower-defense.store';
import { ResearchStore } from '../../store/research.store';
import {
  TargetingStrategyConfig,
  TowerTypeConfig,
  TowerTypeId,
  UpgradeId,
  TargetingStrategy,
  TARGETING_STRATEGIES,
  AirSubStrategy,
  AIR_SUB_STRATEGIES,
  requiredUpgradeTier,
} from '../../configs/tower-types.config';
import { DAMAGE_TYPE_UI } from '../../configs/combat/combat-ui.config';
import { RESEARCH_TREE, getResearch } from '../../configs/research/research-tree.config';
import { ResearchConfig, ResearchId } from '../../configs/research/research.types';
import { Tower } from '../../entities/tower.entity';
import { ModelPreviewService } from '../../services/infrastructure/model-preview.service';
import { AttributionsDialogComponent } from '../attributions-dialog/attributions-dialog.component';
import { openDamageMatrixDialog } from '../damage-matrix-dialog/damage-matrix-dialog.component';
import { ConfigService } from '../../core/services/config.service';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { TdIconComponent } from '../icon/icon.component';
import { SidebarWavePanelComponent } from './wave-panel/wave-panel.component';
import { SidebarBuildPanelComponent } from './build-panel/build-panel.component';

@Component({
  selector: 'app-game-sidebar',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatTooltipModule,
    TdIconComponent,
    SidebarWavePanelComponent,
    SidebarBuildPanelComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './game-sidebar.component.html',
  styleUrl: './game-sidebar.component.scss',
  styles: `
    :host {
      display: contents;
      ${TD_CSS_VARS}
    }
  `,
})
export class GameSidebarComponent implements OnDestroy {
  private readonly dialog = inject(MatDialog);
  private readonly config = inject(ConfigService);
  private readonly modelPreview = inject(ModelPreviewService);

  // Store, single source of truth
  readonly store = inject(TowerDefenseStore);

  // Inputs
  readonly towerTypes = input.required<TowerTypeConfig[]>();
  readonly buildMode = input.required<boolean>();
  readonly waveActive = input.required<boolean>();
  readonly isGameOver = input.required<boolean>();

  // Research store reference
  readonly researchStore = inject(ResearchStore);

  // Outputs
  readonly startWave = output<void>();
  readonly cancelBuild = output<void>();
  readonly selectTower = output<TowerTypeId>();
  readonly sellTower = output<void>();
  readonly upgradeTower = output<{ tower: Tower; upgradeId: UpgradeId }>();
  readonly changeTargeting = output<{ tower: Tower; strategy: TargetingStrategy }>();
  readonly changeAirSubStrategy = output<{ tower: Tower; strategy: AirSubStrategy }>();
  readonly startResearch = output<ResearchId>();
  readonly cancelResearch = output<ResearchId>();

  // Research helpers
  readonly isResearchCenter = computed(() =>
    this.store.selectedTower()?.typeConfig.id === 'research-center'
  );

  readonly allResearches = Object.values(RESEARCH_TREE);
  readonly damageTypeUI = DAMAGE_TYPE_UI;

  /**
   * Resolve the td-icon name for a research node based on its current status.
   * Status icons override the per-research config; available nodes use config.
   */
  researchNodeIconName(research: ResearchConfig): string {
    const status = this.getResearchStatus(research.id);
    if (status === 'completed') return 'check';
    if (status === 'active') return 'refresh';
    if (status === 'locked') return 'lock';
    return research.icon; // td-icon name set in research-tree.config
  }

  /** Map a damage-type to its td-icon name (config holds an emoji glyph). */
  private static readonly DAMAGE_TYPE_TD_ICON: Record<string, string> = {
    physical: 'sword',
    pierce: 'target',
    siege: 'bolt',
    magic: 'bolt',
    fire: 'flame',
    ice: 'splash',
    poison: 'skull',
  };
  damageTypeTdIcon(type: string): string {
    return GameSidebarComponent.DAMAGE_TYPE_TD_ICON[type] ?? 'sword';
  }

  getResearchStatus(id: ResearchId): 'completed' | 'active' | 'available' | 'locked' {
    if (this.researchStore.completedResearches().has(id)) return 'completed';
    if (this.researchStore.activeResearches().some(a => a.researchId === id)) return 'active';
    const config = getResearch(id);
    if (!config) return 'locked';
    const allPrereqsMet = config.prerequisites.every(p => this.researchStore.completedResearches().has(p));
    return allPrereqsMet ? 'available' : 'locked';
  }

  getActiveResearchProgress(id: ResearchId): number {
    const active = this.researchStore.activeResearches().find(a => a.researchId === id);
    if (!active) return 0;
    return Math.min(1, active.elapsed / active.duration);
  }

  getActiveResearchRemaining(id: ResearchId): number {
    const active = this.researchStore.activeResearches().find(a => a.researchId === id);
    if (!active) return 0;
    return Math.max(0, active.duration - active.elapsed);
  }

  getResearchName(id: ResearchId): string {
    return getResearch(id)?.name ?? id;
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
  getRequiredUpgradeTier(tower: Tower, upgradeId: UpgradeId): number {
    return requiredUpgradeTier(tower.getUpgradeLevel(upgradeId));
  }

  isUpgradeTierUnlocked(tower: Tower, upgradeId: UpgradeId): boolean {
    const requiredTier = this.getRequiredUpgradeTier(tower, upgradeId);
    return this.researchStore.maxUpgradeTier() >= requiredTier;
  }

  getUpgradeTierLockReason(tower: Tower, upgradeId: UpgradeId): string | null {
    if (this.isUpgradeTierUnlocked(tower, upgradeId)) return null;
    const tier = this.getRequiredUpgradeTier(tower, upgradeId);
    if (tier === 2) return 'Requires: Advanced Weaponry';
    if (tier === 3) return 'Requires: Master Engineering';
    if (tier === 4) return 'Requires: Advanced Engineering';
    if (tier === 5) return 'Requires: Transcendent Tech';
    return null;
  }

  getMissingPrereqs(id: ResearchId): string {
    const config = getResearch(id);
    if (!config) return '';
    const missing = config.prerequisites
      .filter(p => !this.researchStore.completedResearches().has(p))
      .map(p => getResearch(p)?.name ?? p);
    return missing.join(', ');
  }

  /**
   * Die Panels melden ihre Previews selbst an und ab (WAVE: Gegnergruppen,
   * BUILD: Tower-Karten). Der Service lebt so lange wie die Sidebar, ihr
   * Abbau gibt Renderer und Modelle frei.
   */
  ngOnDestroy(): void {
    this.modelPreview.dispose();
  }

  // Targeting strategy config for template
  readonly targetingStrategies = TARGETING_STRATEGIES;
  readonly airSubStrategies = AIR_SUB_STRATEGIES;

  getTargetingStrategies(tower: Tower): TargetingStrategyConfig[] {
    const canTargetAir = tower.typeConfig.canTargetAir ?? false;
    const canTargetGround = tower.typeConfig.canTargetGround ?? true;

    return this.targetingStrategies.filter((strategy) => {
      if (strategy.id === 'air-priority') {
        return canTargetAir && canTargetGround;
      }
      return true;
    });
  }

  onChangeTargeting(tower: Tower, strategy: TargetingStrategy): void {
    this.changeTargeting.emit({ tower, strategy });
  }

  onChangeAirSubStrategy(tower: Tower, strategy: AirSubStrategy): void {
    this.changeAirSubStrategy.emit({ tower, strategy });
  }

  onUpgradeTower(tower: Tower, upgradeId: UpgradeId): void {
    this.upgradeTower.emit({ tower, upgradeId });
  }

  /**
   * Compute effective DPS for the tower-detail tile. Beam towers (Fire) use
   * damagePerSecond directly; projectile towers use damage × fireRate.
   */
  getDps(tower: Tower): number {
    const cfg = tower.typeConfig;
    if (cfg.attackType === 'beam') {
      return cfg.damagePerSecond ?? 0;
    }
    return tower.combat.damage * tower.combat.fireRate;
  }

  /** Open the tile-credentials screen (swap or clear the stored key). */
  openTokenSetup(): void {
    this.config.setupRequested.set(true);
  }

  openAttributions(): void {
    this.dialog.open(AttributionsDialogComponent, {
      panelClass: 'td-dialog-panel',
    });
  }

  /** Damage-vs-armor chart; opened from the tower panel it highlights that tower's row. */
  openDamageMatrix(towerId?: TowerTypeId): void {
    openDamageMatrixDialog(this.dialog, towerId);
  }
}
