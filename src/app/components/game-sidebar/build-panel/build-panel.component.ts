import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  output,
  QueryList,
  ViewChildren,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TowerDefenseStore } from '../../../store/tower-defense.store';
import { ResearchStore } from '../../../store/research.store';
import { TOWER_TYPES, TowerTypeConfig, TowerTypeId } from '../../../configs/tower-types.config';
import { canTargetAirEffective } from '../../../entities/tower-targeting.util';
import { canPickTowerCard, isPlacedUnique } from '../../../utils/player-actions';
import { towerSlotKey } from '../../../services/hotkey-map';
import { ModelPreviewService } from '../../../services/infrastructure/model-preview.service';
import { TowerDebugService } from '../../../services/debug/tower-debug.service';
import { openDamageMatrixDialog } from '../../damage-matrix-dialog/open-damage-matrix-dialog';
import { openResearchDialog } from '../../research-dialog/open-research-dialog';
import { TdIconComponent } from '../../icon/icon.component';
import { TdRichTooltipDirective } from '../../tooltip/td-rich-tooltip.directive';
import { TdTooltipData } from '../../tooltip/tooltip-data.types';
import { towerCardTooltip } from '../sidebar-tooltips';

/**
 * BUILD-Sektion der Sidebar: Tower-Karten mit 3D-Preview, im Build-Mode
 * Hinweis und Cancel. Solange ein Tower gewählt ist, bleibt sie per
 * `td-hidden` im DOM, ihre Previews rendern dann nicht. Meldet die
 * Tower-Previews beim ModelPreviewService an und wieder ab.
 */
@Component({
  selector: 'app-sidebar-build-panel',
  standalone: true,
  imports: [MatTooltipModule, TdIconComponent, TdRichTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './build-panel.component.html',
  styleUrl: './build-panel.component.scss',
})
export class SidebarBuildPanelComponent implements AfterViewInit {
  private readonly dialog = inject(MatDialog);
  private readonly modelPreview = inject(ModelPreviewService);
  private readonly towerDebug = inject(TowerDebugService);
  private readonly researchStore = inject(ResearchStore);
  private readonly destroyRef = inject(DestroyRef);
  // The dialog emits commands through the facade, which the game component
  // provides rather than root (openResearchDialog).
  private readonly injector = inject(Injector);

  /** Nothing to research before the Center is built, so no way into the tree either. */
  readonly hasResearchCenter = computed(() => this.researchStore.centerLevel() > 0);
  readonly queuedResearches = computed(() => this.researchStore.queuedResearches().length);

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

    this.destroyRef.onDestroy(() => {
      for (const id of this.towerPreviewIds) {
        this.modelPreview.destroyPreview(id);
      }
    });
  }

  readonly store = inject(TowerDefenseStore);

  readonly towerTypes = input.required<TowerTypeConfig[]>();
  readonly buildMode = input.required<boolean>();
  readonly isGameOver = input.required<boolean>();

  readonly selectTower = output<TowerTypeId>();
  readonly cancelBuild = output<void>();

  isTowerUnlocked(towerId: TowerTypeId): boolean {
    return this.researchStore.isTowerUnlocked(towerId);
  }

  /** Card enabled; the number hotkeys check the same (canPickTowerCard). */
  canPick(tower: TowerTypeConfig): boolean {
    return canPickTowerCard(tower, {
      credits: this.store.credits(),
      gameOver: this.isGameOver(),
      placedUnique: this.store.placedUniqueTypes(),
      isUnlocked: (id) => this.isTowerUnlocked(id),
    });
  }

  /** Number key of the card at this position, null past the ninth. */
  readonly slotKey = towerSlotKey;

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

  getTowerLockTooltip(towerId: TowerTypeId): string {
    const name = this.researchStore.getRequiredResearchName(towerId);
    return name ? `Requires: ${name}` : 'Locked';
  }

  /**
   * Tier hint for the small rune-amber diamonds in the tower-card top-left.
   * Mirrors the research-tree progression depth, capped at 3:
   *   T1 = starter (archer, research-center)
   *   T2 = first unlock layer (gatling, ice, tentacle, poison)
   *   T3 = deeper unlocks (cannon, fire, magic, rocket, lightning, chaos, missile-silo)
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
    'chaos': 3,
    'missile-silo': 3,
  };

  getTowerTier(towerId: TowerTypeId): number {
    return SidebarBuildPanelComponent.TOWER_TIER[towerId] ?? 0;
  }

  /**
   * Returns an array sized to the tier, used purely for *ngFor / @for to
   * render the right number of diamond marks. Content is irrelevant.
   */
  tierMarks(towerId: TowerTypeId): unknown[] {
    return new Array(this.getTowerTier(towerId));
  }

  /** Rich tooltip of a tower card, built in sidebar-tooltips.ts. */
  getTowerCardTooltipData(tower: TowerTypeConfig, index: number): TdTooltipData {
    return towerCardTooltip(tower, {
      alreadyPlaced: this.isPlacedUnique(tower),
      airTargetingUnlocked: this.researchStore.airTargetingUnlocked(),
      hotkey: towerSlotKey(index),
    });
  }

  /** A one-per-map building of this type stands already: its card looks disabled. */
  isPlacedUnique(tower: TowerTypeConfig): boolean {
    return isPlacedUnique(tower, this.store.placedUniqueTypes());
  }

  // Canvas refs for previews
  @ViewChildren('towerPreviewCanvas') towerPreviewCanvases!: QueryList<ElementRef<HTMLCanvasElement>>;
  private readonly towerPreviewIds = new Set<string>();

  /**
   * The BUILD panel, and with it every tower preview, is `display: none`
   * while a tower is selected (`td-hidden` in the template). Tower previews
   * skip rendering meanwhile (see PreviewConfig.isHidden).
   */
  private readonly isBuildPanelHidden = (): boolean => !!this.store.selectedTower();

  ngAfterViewInit(): void {
    // Initialize previews after DOM is ready
    setTimeout(() => this.initTowerPreviews(), 100);

    // Re-initialize tower previews when the list changes
    this.towerPreviewCanvases.changes
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        setTimeout(() => this.initTowerPreviews(), 50);
      });
  }

  private initTowerPreviews(): void {
    if (!this.towerPreviewCanvases) return;

    this.towerPreviewCanvases.forEach((canvasRef) => {
      const canvas = canvasRef.nativeElement;
      const towerId = canvas.getAttribute('data-tower-id') as TowerTypeId;
      if (!towerId) return;

      const towerConfig = TOWER_TYPES[towerId];
      if (!towerConfig) return;

      // Use previewScale from debug overrides for live updates
      const overrides = this.towerDebug.allOverrides()[towerId];
      this.createTowerPreview(canvas, towerId, towerConfig, overrides.previewScale);
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

    this.createTowerPreview(canvasRef.nativeElement, towerId, towerConfig, previewScale);
  }

  private createTowerPreview(
    canvas: HTMLCanvasElement,
    towerId: TowerTypeId,
    towerConfig: TowerTypeConfig,
    previewScale: number,
  ): void {
    // Sync canvas resolution to actual CSS display size to avoid stretching
    const rect = canvas.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      canvas.width = Math.round(rect.width * devicePixelRatio);
      canvas.height = Math.round(rect.height * devicePixelRatio);
    }

    const previewId = `tower-preview-${towerId}`;
    this.towerPreviewIds.add(previewId);
    this.modelPreview.createPreview(
      previewId,
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

  /** Damage-vs-armor chart without a highlighted row. */
  openResearch(): void {
    openResearchDialog(this.dialog, this.injector);
  }

  openDamageMatrix(): void {
    openDamageMatrixDialog(this.dialog);
  }
}
