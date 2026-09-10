import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  output,
  QueryList,
  ViewChildren,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TowerDefenseStore } from '../../../store/tower-defense.store';
import { ARMOR_TYPE_UI } from '../../../configs/combat/combat-ui.config';
import { EnemyTypeId, ENEMY_TYPES } from '../../../configs/enemy-types.config';
import { ModelPreviewService } from '../../../services/infrastructure/model-preview.service';
import { WaveDebugService } from '../../../services/debug/wave-debug.service';
import { EnemyDebugService } from '../../../services/debug/enemy-debug.service';
import { TdIconComponent } from '../../icon/icon.component';
import { TdRichTooltipDirective } from '../../tooltip/td-rich-tooltip.directive';
import { enemyGroupTooltip } from '../sidebar-tooltips';
import { peekUpcomingWaves } from './upcoming-waves';

/**
 * WAVE-Sektion der Sidebar: Gegnergruppen der laufenden Welle mit 3D-Preview,
 * Next-Wave-Button und COMING UP aus dem Curriculum. Meldet die Enemy-Previews
 * beim ModelPreviewService an und wieder ab.
 */
@Component({
  selector: 'app-sidebar-wave-panel',
  standalone: true,
  imports: [MatTooltipModule, TdIconComponent, TdRichTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './wave-panel.component.html',
  styleUrl: './wave-panel.component.scss',
})
export class SidebarWavePanelComponent implements AfterViewInit {
  private readonly store = inject(TowerDefenseStore);
  private readonly modelPreview = inject(ModelPreviewService);
  private readonly waveDebug = inject(WaveDebugService);
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

    this.destroyRef.onDestroy(() => this.destroyMixedEnemyPreviews());
  }

  readonly buildMode = input.required<boolean>();
  readonly waveActive = input.required<boolean>();
  readonly isGameOver = input.required<boolean>();

  readonly startWave = output<void>();

  // Wave group display, only consumed by the template while a wave is active,
  // so we don't need curriculum-derived or debug-panel fallbacks. The COMING UP
  // panel handles the setup-phase preview separately.
  readonly currentWaveGroups = this.waveDebug.currentWaveGroups;
  readonly isMixedWave = this.waveDebug.isMixedWave;
  readonly mixedTotalCount = computed(() =>
    this.currentWaveGroups().reduce((sum, g) => sum + g.count, 0)
  );

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

  /** COMING UP: die nächsten zwei Curriculum-Wellen. */
  readonly upcomingWaves = computed(() => peekUpcomingWaves(this.store.waveNumber()));

  readonly groupTooltip = enemyGroupTooltip;

  @ViewChildren('mixedEnemyCanvas') mixedEnemyCanvases!: QueryList<ElementRef<HTMLCanvasElement>>;
  private activeMixedPreviewIds: string[] = [];

  ngAfterViewInit(): void {
    // Initialize previews after DOM is ready
    setTimeout(() => this.initMixedEnemyPreviews(), 100);

    // Initialize mixed enemy previews when canvases appear
    this.mixedEnemyCanvases.changes
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        setTimeout(() => this.initMixedEnemyPreviews(), 100);
      });
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

  private initMixedEnemyPreviews(): void {
    if (!this.mixedEnemyCanvases) return;

    // Destroy old mixed previews
    this.destroyMixedEnemyPreviews();

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

  private destroyMixedEnemyPreviews(): void {
    for (const id of this.activeMixedPreviewIds) {
      this.modelPreview.destroyPreview(id);
    }
    this.activeMixedPreviewIds = [];
  }
}
