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
  untracked,
  ViewChildren,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TowerDefenseStore } from '../../../store/tower-defense.store';
import { UIStore } from '../../../store/ui.store';
import { ResearchStore } from '../../../store/research.store';
import { GameStateManager } from '../../../managers/game-state.manager';
import { AUTO_WAVE_DELAY_MS } from '../../../utils/auto-wave-countdown';
import { toneWavDataUrl } from '../../../utils/alert-tone';
import { UI_SOUNDS } from '../../../configs/audio.config';
import { ARMOR_TYPE_UI } from '../../../configs/combat/combat-ui.config';
import { EnemyTypeId, ENEMY_TYPES } from '../../../configs/enemy-types.config';
import { TowerTypeId } from '../../../configs/tower-types.config';
import { ModelPreviewService } from '../../../services/infrastructure/model-preview.service';
import { WaveDebugService } from '../../../services/debug/wave-debug.service';
import { EnemyDebugService } from '../../../services/debug/enemy-debug.service';
import { TdIconComponent } from '../../icon/icon.component';
import { TdRichTooltipDirective } from '../../tooltip/td-rich-tooltip.directive';
import { enemyGroupTooltip, splitTraitLabel, weakToLabel } from '../sidebar-tooltips';
import { calculateTotalDPS } from '../../../ai/core/defense-analyzer';
import { AirAlertAnnouncer, airAlertView, countAntiAirTowers, upcomingAirAlert } from './air-alert';
import { peekUpcomingWaves } from './upcoming-waves';
import { waveButtonView } from './wave-button';

/**
 * WAVE-Sektion der Sidebar: Gegnergruppen der laufenden Welle mit 3D-Preview,
 * Next-Wave-Button und COMING UP aus dem Curriculum. Meldet die Enemy-Previews
 * beim ModelPreviewService an und wieder ab. Die Fähigkeiten stehen in der
 * Leiste am linken Rand des Spielfelds (app-ability-bar).
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
  private readonly uiStore = inject(UIStore);
  private readonly researchStore = inject(ResearchStore);
  private readonly gameState = inject(GameStateManager);
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

    // Air alert tone: once per air wave and run, see AirAlertAnnouncer. A
    // later build phase that still points at the same wave stays quiet.
    effect(() => {
      const waveNumber = this.store.waveNumber();
      const alert = this.airAlert();
      untracked(() => this.airAlertAnnouncer.update(waveNumber, alert, () => this.playAirAlertTone()));
    });

    this.destroyRef.onDestroy(() => this.destroyMixedEnemyPreviews());
  }

  readonly waveActive = input.required<boolean>();
  readonly isGameOver = input.required<boolean>();

  readonly startWave = output<void>();

  // Wave group display, only consumed by the template while a wave is active,
  // so we don't need curriculum-derived or debug-panel fallbacks. The COMING UP
  // panel handles the setup-phase preview separately.
  readonly currentWaveGroups = this.waveDebug.currentWaveGroups;

  /**
   * Wave the button names. During an active wave it's the running wave;
   * during build/setup it's the UPCOMING wave (waveNumber+1), the one a
   * press starts. Avoids a meaningless "WAVE 0" at game start.
   */
  readonly displayedWaveNumber = computed(() => {
    const n = this.store.waveNumber();
    return this.waveActive() ? n : n + 1;
  });

  /** Auto-start of the next wave, persisted in the UI state */
  readonly autoStart = this.uiStore.autoStartWaves;
  readonly autoStartSeconds = AUTO_WAVE_DELAY_MS / 1000;

  /** Label, accessible name, "N left", countdown and bar width of the wave button. */
  readonly waveButton = computed(() =>
    waveButtonView(
      this.displayedWaveNumber(),
      this.waveActive(),
      this.store.waveEnemyTotal(),
      this.store.waveEnemiesLeft(),
      this.store.autoWaveSecondsLeft(),
      this.autoStartSeconds,
    )
  );

  toggleAutoStart(): void {
    this.uiStore.autoStartWaves.update(on => !on);
  }

  /**
   * Tower DPS the director sizes a wave by (calculateTotalDPS). Tower
   * entities carry no signals: building and selling, an upgrade of the
   * selected tower (upgrades go through it) and finished research tell when
   * to recount. An unchanged value changes nothing downstream.
   */
  private readonly towerDps = computed(() => {
    this.store.towerCount();
    this.store.selectedTowerRevision();
    this.researchStore.completedResearches();
    return calculateTotalDPS(this.gameState.towerManager.getAll());
  });

  /** COMING UP: die nächsten zwei Wellen, nach W30 das, was davon bekannt ist. */
  readonly upcomingWaves = computed(() => peekUpcomingWaves(this.store.waveNumber(), this.towerDps()));

  /**
   * Placed towers that hit air. Tower entities carry no signals: the tower
   * count (placed, sold, reset) and the AA research tell when to recount.
   */
  private readonly antiAirTowers = computed(() => {
    this.store.towerCount();
    const unlocked = this.researchStore.airTargetingUnlocked();
    const types = this.gameState.towerManager.getAll().map((t) => t.typeConfig.id as TowerTypeId);
    return countAntiAirTowers(types, unlocked);
  });

  /** Air in the next or the next-but-one wave, build phase only. */
  private readonly airAlert = computed(() =>
    this.waveActive() || this.isGameOver()
      ? null
      : upcomingAirAlert(this.store.waveNumber(), this.antiAirTowers())
  );

  readonly airAlertView = computed(() => {
    const alert = this.airAlert();
    return alert ? airAlertView(alert, this.researchStore.airTargetingUnlocked()) : null;
  });

  private readonly airAlertAnnouncer = new AirAlertAnnouncer();

  /**
   * Global one-shot at the SFX volume, registered on first use. Answers
   * whether it came out: false when there is no audio yet or the tone has
   * no buffer, so the wave stays unannounced.
   */
  private async playAirAlertTone(): Promise<boolean> {
    const audio = this.gameState.tilesEngine?.spatialAudio;
    if (!audio) return false;
    const { id, notes, volume } = UI_SOUNDS.airAlert;
    if (!audio.getSoundConfig(id)) {
      audio.registerSound(id, toneWavDataUrl(notes), { volume });
    }
    return (await audio.playGlobal(id)) !== null;
  }

  readonly groupTooltip = enemyGroupTooltip;
  /** "Splits into 2 minions on death" under the armor line, null for a type that does not split. */
  readonly splitTrait = splitTraitLabel;

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
    return config?.armorType ? weakToLabel([[config.armorType, 1]]) : '';
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
        animationName: enemyConfig.walkAnimation || undefined,
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
