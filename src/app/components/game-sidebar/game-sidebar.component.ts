import {
  Component,
  input,
  output,
  ViewChildren,
  QueryList,
  ElementRef,
  AfterViewInit,
  OnDestroy,
  inject,
  effect,
  computed,
  DestroyRef,
  ChangeDetectionStrategy,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
  TOWER_TYPES,
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
import { canTargetAirEffective } from '../../entities/tower-targeting.util';
import { ModelPreviewService } from '../../services/infrastructure/model-preview.service';
import { TowerDebugService } from '../../services/debug/tower-debug.service';
import { AttributionsDialogComponent } from '../attributions-dialog/attributions-dialog.component';
import { openDamageMatrixDialog } from '../damage-matrix-dialog/damage-matrix-dialog.component';
import { ConfigService } from '../../core/services/config.service';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { TdIconComponent } from '../icon/icon.component';
import { TdRichTooltipDirective } from '../tooltip/td-rich-tooltip.directive';
import { TdTooltipData } from '../tooltip/tooltip-data.types';
import { towerCardTooltip } from './sidebar-tooltips';
import { SidebarWavePanelComponent } from './wave-panel/wave-panel.component';

@Component({
  selector: 'app-game-sidebar',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatTooltipModule,
    TdIconComponent,
    TdRichTooltipDirective,
    SidebarWavePanelComponent,
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
export class GameSidebarComponent implements AfterViewInit, OnDestroy {
  private readonly dialog = inject(MatDialog);
  private readonly config = inject(ConfigService);
  private readonly modelPreview = inject(ModelPreviewService);
  private readonly towerDebug = inject(TowerDebugService);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    // Update tower previews when debug overrides change
    effect(() => {
      // Track selected tower and its overrides
      const typeId = this.towerDebug.selectedTowerId();
      const overrides = this.towerDebug.allOverrides()[typeId];
      // Refresh only the selected tower's preview
      if (this.towerPreviewCanvases) {
        this.refreshTowerPreview(typeId, overrides.previewScale);
      }
    });
  }

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

  isTowerUnlocked(towerId: TowerTypeId): boolean {
    return this.researchStore.isTowerUnlocked(towerId);
  }

  /**
   * Tower targets ONLY air units (e.g. Rocket). Used to give the build-menu
   * card a distinct teal accent so the player sees the specialisation
   * before clicking. Uses `canTargetAirEffective` so research-driven
   * AA-retrofits flip the indicator automatically.
   */
  isAirOnlyTower(tower: TowerTypeConfig): boolean {
    const air = canTargetAirEffective(tower.id, this.researchStore.airTargetingUnlocked());
    const ground = tower.canTargetGround !== false;
    return air && !ground;
  }

  /**
   * Effective air-targeting capability (base config OR unlocked via research).
   * Template uses this for the AA badge on the build-menu card so towers
   * that get AA via aa-retrofit (currently `dual-gatling`) light up the
   * indicator after the research completes.
   */
  canTowerTargetAir(tower: TowerTypeConfig): boolean {
    return canTargetAirEffective(tower.id, this.researchStore.airTargetingUnlocked());
  }

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

  getTowerLockTooltip(towerId: TowerTypeId): string {
    const name = this.researchStore.getRequiredResearchName(towerId);
    return name ? `Requires: ${name}` : 'Locked';
  }

  /**
   * Tier hint for the small rune-amber diamonds in the tower-card top-left.
   * Mirrors the research-tree progression depth, capped at 3:
   *   T1 = starter (archer, research-center)
   *   T2 = first unlock layer (gatling, ice, tentacle, poison)
   *   T3 = deeper unlocks (cannon, fire, magic, rocket)
   */
  private static readonly TOWER_TIER: Record<TowerTypeId, number> = {
    'archer': 1,
    'research-center': 1,
    'dual-gatling': 2,
    'ice': 2,
    'tentacle': 2,
    'poison': 2,
    'cannon': 3,
    'fire': 3,
    'magic': 3,
    'rocket': 3,
    'lightning': 3,
  };

  getTowerTier(towerId: TowerTypeId): number {
    return GameSidebarComponent.TOWER_TIER[towerId] ?? 0;
  }

  /**
   * Returns an array sized to the tier, used purely for *ngFor / @for to
   * render the right number of diamond marks. Content is irrelevant.
   */
  tierMarks(towerId: TowerTypeId): unknown[] {
    return new Array(this.getTowerTier(towerId));
  }

  /** Rich tooltip of a tower card, built in sidebar-tooltips.ts. */
  getTowerCardTooltipData(tower: TowerTypeConfig): TdTooltipData {
    return towerCardTooltip(tower, {
      researchCenterPlaced: this.isResearchCenterPlaced(),
      airTargetingUnlocked: this.researchStore.airTargetingUnlocked(),
    });
  }

  isResearchCenterPlaced(): boolean {
    return this.researchStore.centerPlaced();
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

  // Canvas refs for previews
  @ViewChildren('towerPreviewCanvas') towerPreviewCanvases!: QueryList<ElementRef<HTMLCanvasElement>>;

  /**
   * The BUILD panel, and with it every tower preview, is `display: none`
   * while a tower is selected (`td-hidden` in the template). Tower previews
   * skip rendering meanwhile (see PreviewConfig.isHidden).
   */
  private readonly isBuildPanelHidden = (): boolean => !!this.store.selectedTower();

  ngAfterViewInit(): void {
    // Initialize previews after DOM is ready
    setTimeout(() => this.initPreviews(), 100);

    // Re-initialize tower previews when the list changes
    this.towerPreviewCanvases.changes
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        setTimeout(() => this.initTowerPreviews(), 50);
      });
  }

  ngOnDestroy(): void {
    this.modelPreview.dispose();
  }

  private initPreviews(): void {
    this.modelPreview.initialize();
    this.initTowerPreviews();
  }

  private initTowerPreviews(): void {
    if (!this.towerPreviewCanvases) return;

    this.towerPreviewCanvases.forEach((canvasRef) => {
      const canvas = canvasRef.nativeElement;
      const towerId = canvas.getAttribute('data-tower-id') as TowerTypeId;
      if (!towerId) return;

      const towerConfig = TOWER_TYPES[towerId];
      if (!towerConfig) return;

      // Sync canvas resolution to actual CSS display size to avoid stretching
      const rect = canvas.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        canvas.width = Math.round(rect.width * devicePixelRatio);
        canvas.height = Math.round(rect.height * devicePixelRatio);
      }

      // Use previewScale from debug overrides for live updates
      const overrides = this.towerDebug.allOverrides()[towerId];
      const previewScale = overrides.previewScale;

      this.modelPreview.createPreview(
        `tower-preview-${towerId}`,
        canvas,
        {
          modelUrl: towerConfig.modelUrl,
          scale: previewScale,
          rotationSpeed: 0.4,
          cameraDistance: 20,
          cameraAngle: Math.PI / 5,
          lightIntensity: 1.2,
          isHidden: this.isBuildPanelHidden,
        }
      );
    });
  }

  /**
   * Refresh a specific tower's preview with new scale
   */
  private refreshTowerPreview(towerId: TowerTypeId, previewScale: number): void {
    if (!this.towerPreviewCanvases) return;

    const canvasRef = this.towerPreviewCanvases.find((ref) =>
      ref.nativeElement.getAttribute('data-tower-id') === towerId
    );
    if (!canvasRef) return;

    const towerConfig = TOWER_TYPES[towerId];
    if (!towerConfig) return;

    // Sync canvas resolution to actual CSS display size
    const canvas = canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      canvas.width = Math.round(rect.width * devicePixelRatio);
      canvas.height = Math.round(rect.height * devicePixelRatio);
    }

    this.modelPreview.createPreview(
      `tower-preview-${towerId}`,
      canvas,
      {
        modelUrl: towerConfig.modelUrl,
        scale: previewScale,
        rotationSpeed: 0.4,
        cameraDistance: 20,
        cameraAngle: Math.PI / 5,
        lightIntensity: 1.2,
        isHidden: this.isBuildPanelHidden,
      }
    );
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
