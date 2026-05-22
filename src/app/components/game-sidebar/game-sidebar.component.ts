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
} from '../../configs/tower-types.config';
import { DAMAGE_TYPE_UI, ARMOR_TYPE_UI } from '../../configs/combat/combat-ui.config';
import { DAMAGE_MATRIX } from '../../configs/combat/damage-matrix.config';
import { ARMOR_TYPES, ArmorType, DamageType } from '../../configs/combat/combat.types';
import { RESEARCH_TREE, getResearch } from '../../configs/research/research-tree.config';
import { ResearchConfig, ResearchId } from '../../configs/research/research.types';
import { Tower } from '../../entities/tower.entity';
import { canTargetAirEffective } from '../../entities/tower-targeting.util';
import { ModelPreviewService } from '../../services/infrastructure/model-preview.service';
import { WaveDebugService, WaveGroupDisplay } from '../../services/debug/wave-debug.service';
import { TowerDebugService } from '../../services/debug/tower-debug.service';
import { EnemyDebugService } from '../../services/debug/enemy-debug.service';
import { EnemyTypeId, ENEMY_TYPES } from '../../configs/enemy-types.config';
import { templateObjectForWave } from '../../configs/wave-curriculum.config';
import { AttributionsDialogComponent } from '../attributions-dialog/attributions-dialog.component';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { TdIconComponent } from '../icon/icon.component';
import { TdRichTooltipDirective } from '../tooltip/td-rich-tooltip.directive';
import { TdTooltipData } from '../tooltip/tooltip-data.types';

@Component({
  selector: 'app-game-sidebar',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatTooltipModule,
    TdIconComponent,
    TdRichTooltipDirective,
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
  private readonly modelPreview = inject(ModelPreviewService);
  private readonly waveDebug = inject(WaveDebugService);
  private readonly towerDebug = inject(TowerDebugService);
  private readonly enemyDebug = inject(EnemyDebugService);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    // Update enemy group previews when wave groups change
    effect(() => {
      const groups = this.currentWaveGroups();
      // Also track debug overrides for preview updates
      const overrides = this.enemyDebug.allOverrides();
      for (const g of groups) {
        void overrides[g.enemyType];
      }
      if (this.mixedEnemyCanvases?.length) {
        this.initMixedEnemyPreviews();
      }
    });

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

  // Store — single source of truth
  readonly store = inject(TowerDefenseStore);

  // Inputs
  readonly towerTypes = input.required<TowerTypeConfig[]>();
  readonly buildMode = input.required<boolean>();
  readonly waveActive = input.required<boolean>();
  readonly isGameOver = input.required<boolean>();

  // Wave group display — only consumed by the template while a wave is active,
  // so we don't need curriculum-derived or debug-panel fallbacks. The COMING UP
  // panel handles the setup-phase preview separately.
  readonly currentWaveGroups = computed(() => this.waveDebug.currentWaveGroups());
  readonly isMixedWave = this.waveDebug.isMixedWave;

  /**
   * Wave-number shown in the panel header. During an active wave it's the
   * running wave; during build/setup it's the UPCOMING wave (waveNumber+1)
   * so the panel content (enemy preview, next-wave button) matches the label.
   * Avoids the meaningless "WAVE 0" header at game start.
   */
  readonly displayedWaveNumber = computed(() => {
    const n = this.store.waveNumber();
    return this.waveActive() ? n : n + 1;
  });

  /**
   * Phase 5.16: Show next 2 curriculum-forced waves so the player can
   * prepare their defense (e.g. build Anti-Air before W7 bat_swarm).
   * Returns empty array once we're past the curriculum (NN-loop range).
   */
  readonly upcomingWaves = computed(() => {
    const currentWave = this.store.waveNumber();
    const peeks: { wave: number; name: string; description: string; armorIcons: string }[] = [];
    for (const offset of [1, 2]) {
      const w = currentWave + offset;
      const t = templateObjectForWave(w);
      if (!t) continue;
      const armors = new Set<string>();
      let hasAir = false;
      for (const [enemyId] of t.enemies) {
        const cfg = ENEMY_TYPES[enemyId as EnemyTypeId];
        if (!cfg) continue;
        armors.add(cfg.armorType);
        if (cfg.isAirUnit) hasAir = true;
      }
      const armorIcons = Array.from(armors)
        .map((a) => ARMOR_TYPE_UI[a as keyof typeof ARMOR_TYPE_UI]?.icon ?? '')
        .filter(Boolean)
        .join(' ') + (hasAir ? ' ✈️' : '');
      peeks.push({
        wave: w,
        name: t.name,
        description: t.description,
        armorIcons,
      });
    }
    return peeks;
  });

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

  /**
   * Structured tooltip payload for the tower-card rich tooltip.
   * Matches the design refinement spec — header, stat triple, vs-armor table.
   */
  getTowerCardTooltipData(tower: TowerTypeConfig): TdTooltipData | null {
    if (tower.id === 'research-center') {
      return {
        title: 'Research Center',
        category: 'STRUCTURE',
        accent: 'gold',
        flavor: this.isResearchCenterPlaced()
          ? 'Already placed.'
          : 'Unlocks new towers and upgrade tiers.',
      };
    }
    const dmgUi = DAMAGE_TYPE_UI[tower.damageType];
    const matrix = DAMAGE_MATRIX[tower.damageType as DamageType];
    const stats = tower.attackType === 'beam'
      ? [
          { label: 'DPS', value: String(tower.damagePerSecond ?? 0) },
          { label: 'TYPE', value: 'BEAM' },
          { label: 'RANGE', value: `${tower.range}m` },
        ]
      : [
          { label: 'DMG', value: String(tower.damage) },
          { label: 'RATE', value: `${tower.fireRate}/s` },
          { label: 'RANGE', value: `${tower.range}m` },
        ];
    // Armor identity colors per mockup (tmp/td-components.jsx ArmorChip).
    // The dot color reflects the ARMOR TYPE, not the effectiveness; the dim
    // flag (faded row) communicates "weak matchup" instead.
    const armorColor: Record<string, string> = {
      'unarmored': '#7DBE82',
      'light': '#5BA4D9',
      'heavy': '#C46B3A',
      'fortified': '#5A6258',
      'ethereal': '#9A78C7',
    };
    const armor = ARMOR_TYPES.map(a => {
      const mul = matrix[a as ArmorType];
      const meta = ARMOR_TYPE_UI[a as ArmorType];
      return {
        label: meta.label,
        multiplier: `${mul.toFixed(2)}×`,
        color: armorColor[a] ?? 'var(--td-text-muted)',
        dim: mul < 0.7,
      };
    });
    const accentMap: Record<string, TdTooltipData['accent']> = {
      'physical': 'gold',
      'magic': 'teal',
      'fire': 'fire',
      'cold': 'cold',
      'poison': 'poison',
    };
    // Targeting capability — resolved via canTargetAirEffective so the banner
    // reflects AA-retrofit research (e.g. dual-gatling after aa-retrofit
    // completes flips from ground-only to air-ground with a "via Research"
    // note). Single source of truth shared with combat + AI bots.
    const aaUnlocked = this.researchStore.airTargetingUnlocked();
    const effectiveAir = canTargetAirEffective(tower.id, aaUnlocked);
    const baseAir = tower.canTargetAir === true;
    const ground = tower.canTargetGround !== false;
    const targeting: TdTooltipData['targeting'] =
      effectiveAir && !ground ? { mode: 'air-only' } :
      effectiveAir && ground  ? { mode: 'air-ground', viaResearch: !baseAir } :
                                { mode: 'ground-only' };
    return {
      title: tower.name,
      category: dmgUi.label.toUpperCase(),
      accent: accentMap[tower.damageType] ?? 'gold',
      stats,
      targeting,
      armorTitle: 'vs Armor',
      armor,
    };
  }

  /**
   * Phase 5.16: Legacy string-based tooltip — kept as a fallback / for places
   * that haven't migrated to the rich tooltip directive yet.
   */
  getTowerCardTooltip(tower: TowerTypeConfig): string {
    if (tower.id === 'research-center') {
      return this.isResearchCenterPlaced()
        ? 'Already placed'
        : 'RESEARCH CENTER\nUnlocks new towers and upgrade tiers';
    }
    const dmgUi = DAMAGE_TYPE_UI[tower.damageType];
    const dps = tower.attackType === 'beam'
      ? `${tower.damagePerSecond ?? 0} DPS`
      : `${tower.damage} DMG · ${tower.fireRate}/s`;
    const sep = '────────────────────────';
    const lines: string[] = [
      `${tower.name.toUpperCase()}  ·  ${dmgUi.icon} ${dmgUi.label}`,
      sep,
      `${dps}    RANGE ${tower.range}m`,
      sep,
      'VS ARMOR',
    ];
    const matrix = DAMAGE_MATRIX[tower.damageType as DamageType];
    for (const armor of ARMOR_TYPES) {
      const mul = matrix[armor as ArmorType];
      const armorMeta = ARMOR_TYPE_UI[armor as ArmorType];
      const symbol = mul >= 1.5 ? '✓✓' : mul >= 1.2 ? '✓ ' : mul < 0.7 ? '✗ ' : '· ';
      const label = armorMeta.label.padEnd(10, ' ');
      lines.push(`  ${symbol} ${armorMeta.icon} ${label} ${mul.toFixed(2)}×`);
    }
    return lines.join('\n');
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
    const currentLevel = tower.getUpgradeLevel(upgradeId);
    if (currentLevel >= 20) return 5;
    if (currentLevel >= 15) return 4;
    if (currentLevel >= 10) return 3;
    if (currentLevel >= 5) return 2;
    return 1;
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
  @ViewChildren('mixedEnemyCanvas') mixedEnemyCanvases!: QueryList<ElementRef<HTMLCanvasElement>>;
  private activeMixedPreviewIds: string[] = [];

  ngAfterViewInit(): void {
    // Initialize previews after DOM is ready
    setTimeout(() => this.initPreviews(), 100);

    // Re-initialize tower previews when the list changes
    this.towerPreviewCanvases.changes
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        setTimeout(() => this.initTowerPreviews(), 50);
      });

    // Initialize mixed enemy previews when canvases appear
    this.mixedEnemyCanvases.changes
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        setTimeout(() => this.initMixedEnemyPreviews(), 100);
      });
  }

  ngOnDestroy(): void {
    this.modelPreview.dispose();
  }

  private initPreviews(): void {
    this.modelPreview.initialize();
    this.initMixedEnemyPreviews();
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

  getMixedTotalCount(): number {
    return this.currentWaveGroups().reduce((sum, g) => sum + g.count, 0);
  }

  getArmorIcon(enemyType: EnemyTypeId): string {
    const config = ENEMY_TYPES[enemyType];
    return config?.armorType ? ARMOR_TYPE_UI[config.armorType].icon : '';
  }

  getArmorLabel(enemyType: EnemyTypeId): string {
    const config = ENEMY_TYPES[enemyType];
    return config?.armorType ? ARMOR_TYPE_UI[config.armorType].label : '';
  }

  getArmorWeakTo(enemyType: EnemyTypeId): string {
    const config = ENEMY_TYPES[enemyType];
    return config?.armorType ? ARMOR_TYPE_UI[config.armorType].weakTo : '';
  }

  /**
   * Structured tooltip payload for the enemy-group rich tooltip.
   * Mirrors the tower-card tooltip layout — header (name + armor category),
   * 3-column stats (HP / SPEED / COUNT), and a "vs Damage" table sorted by
   * effectiveness against this enemy's armor. Reuses the armor-row structure
   * for the damage rows so both tooltips share the same visual language.
   */
  getGroupTooltipData(group: WaveGroupDisplay): TdTooltipData | null {
    const enemyConfig = ENEMY_TYPES[group.enemyType];
    if (!enemyConfig) return null;

    const armor = enemyConfig.armorType as ArmorType;
    const armorMeta = ARMOR_TYPE_UI[armor];

    const stats = [
      { label: 'HP', value: String(group.actualHp) },
      { label: 'SPEED', value: `${group.actualSpeed.toFixed(1)}m/s` },
      { label: 'COUNT', value: `×${group.count}` },
    ];

    const damageRows = (Object.keys(DAMAGE_MATRIX) as DamageType[])
      .map((dt) => ({ ui: DAMAGE_TYPE_UI[dt], mul: DAMAGE_MATRIX[dt][armor] }))
      .sort((a, b) => b.mul - a.mul)
      .map((row) => ({
        label: row.ui.label,
        multiplier: `${row.mul.toFixed(2)}×`,
        color: row.ui.color,
        dim: row.mul < 0.7,
      }));

    const armorAccentMap: Record<ArmorType, TdTooltipData['accent']> = {
      unarmored: 'neutral',
      light: 'teal',
      heavy: 'gold',
      fortified: 'health',
      ethereal: 'poison',
    };

    // Surface wave-scaling multipliers as flavor when they differ from 1,
    // so the player can see why HP/speed look inflated mid-run.
    const flavorParts: string[] = [];
    if (group.healthMultiplier !== 1) flavorParts.push(`HP ×${group.healthMultiplier.toFixed(1)}`);
    if (group.speedMultiplier !== 1) flavorParts.push(`Speed ×${group.speedMultiplier.toFixed(2)}`);
    const flavor = flavorParts.length > 0 ? `Scaled: ${flavorParts.join(' · ')}` : undefined;

    return {
      title: group.name,
      category: armorMeta.label.toUpperCase(),
      accent: armorAccentMap[armor] ?? 'neutral',
      stats,
      armorTitle: 'vs Damage',
      armor: damageRows,
      flavor,
    };
  }

  private initMixedEnemyPreviews(): void {
    if (!this.mixedEnemyCanvases) return;

    // Destroy old mixed previews
    for (const id of this.activeMixedPreviewIds) {
      this.modelPreview.destroyPreview(id);
    }
    this.activeMixedPreviewIds = [];

    const groups = this.currentWaveGroups();
    this.mixedEnemyCanvases.forEach((canvasRef) => {
      const canvas = canvasRef.nativeElement;
      const idx = parseInt(canvas.getAttribute('data-group-index') ?? '0', 10);
      const group = groups[idx];
      if (!group) return;

      const enemyConfig = ENEMY_TYPES[group.enemyType];
      if (!enemyConfig) return;

      const overrides = this.enemyDebug.getOverrides(group.enemyType);
      const previewId = `mixed-enemy-${idx}`;
      this.activeMixedPreviewIds.push(previewId);

      this.modelPreview.createPreview(previewId, canvas, {
        modelUrl: enemyConfig.modelUrl,
        scale: overrides?.previewScale ?? enemyConfig.previewScale ?? enemyConfig.scale * 0.5,
        rotationSpeed: 0.4,
        cameraDistance: overrides?.previewCameraDistance ?? enemyConfig.previewCameraDistance ?? 7,
        cameraAngle: overrides?.previewCameraAngle ?? enemyConfig.previewCameraAngle ?? Math.PI / 12,
        offsetY: overrides?.previewOffsetY ?? enemyConfig.previewOffsetY ?? 0,
        animationName: enemyConfig.walkAnimation || enemyConfig.idleAnimation || undefined,
        animationTimeScale: 0.7,
        lightIntensity: 1.3,
        groundModel: true,
      });
    });
  }

  openAttributions(): void {
    this.dialog.open(AttributionsDialogComponent, {
      panelClass: 'td-dialog-panel',
    });
  }
}
