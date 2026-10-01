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
import { waveButtonAction } from '../../../coop/room-options';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TowerDefenseStore } from '../../../store/tower-defense.store';
import { UIStore } from '../../../store/ui.store';
import { ResearchStore } from '../../../store/research.store';
import { WaveDirector } from '../../../director/wave-director';
import { SimMirror } from '../../../sim/client/mirror/sim-mirror';
import { EngineInitializationService } from '../../../services/infrastructure/engine-initialization.service';
import { AUTO_WAVE_DELAY_MS } from '../../../utils/auto-wave-countdown';
import { toneWavDataUrl } from '../../../utils/alert-tone';
import { UI_SOUNDS } from '../../../configs/audio.config';
import { ARMOR_TYPE_UI } from '../../../configs/combat/combat-ui.config';
import { EnemyTypeId, ENEMY_TYPES } from '../../../configs/enemy-types.config';
import { TowerTypeId } from '../../../configs/tower-types.config';
import { ModelPreviewService } from '../../../services/infrastructure/model-preview.service';
import { WaveDebugService } from '../../../services/debug/wave-debug.service';
import { EnemyDebugService } from '../../../services/debug/enemy-debug.service';
import { DebugFacadeService } from '../../../services/debug/debug-facade.service';
import { TdIconComponent } from '../../icon/icon.component';
import { TdRichTooltipDirective } from '../../tooltip/td-rich-tooltip.directive';
import { REPLAY_CONFIG } from '../../../configs/replay.config';
import { enemyGroupTooltip, enemyTraitLabel, formatLeak, waveLeakTotal, weakToLabel } from '../sidebar-tooltips';
import {
  WAVE_ALERT_KINDS, WaveAlertAnnouncer, countAntiAirTowers, countAntiEtherealTowers, upcomingWaveAlert, waveAlertView,
  type WaveAlertKind,
} from './wave-alert';
import { NEXT_WAVE_MARKS, peekUpcomingWaves } from './upcoming-waves';
import { waveButtonView } from './wave-button';
import { WaveTimelineComponent } from './wave-timeline.component';
import { ReplayService } from '../../../services/replay.service';
import { COOP } from '../../../services/coop.token';
import { enemyPreviewConfig } from '../../../services/infrastructure/preview-sheets';

/**
 * WAVE-Sektion der Sidebar: Gegnergruppen der laufenden Welle mit 3D-Preview,
 * Next-Wave-Button mit Auto-Start-Schalter und NEXT als Zeitleiste aus dem
 * Campaign. Meldet die Enemy-Previews beim ModelPreviewService an und wieder
 * ab. Die Fähigkeiten stehen in der Leiste am linken Rand des Spielfelds
 * (app-ability-bar).
 */
@Component({
  selector: 'app-sidebar-wave-panel',
  standalone: true,
  imports: [MatTooltipModule, TdIconComponent, TdRichTooltipDirective, WaveTimelineComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './wave-panel.component.html',
  styleUrl: './wave-panel.component.scss',
})
export class SidebarWavePanelComponent implements AfterViewInit {
  private readonly store = inject(TowerDefenseStore);
  private readonly uiStore = inject(UIStore);
  private readonly researchStore = inject(ResearchStore);
  private readonly waveDirector = inject(WaveDirector);
  private readonly mirror = inject(SimMirror);
  private readonly engineInit = inject(EngineInitializationService);
  private readonly modelPreview = inject(ModelPreviewService);
  private readonly waveDebug = inject(WaveDebugService);
  private readonly enemyDebug = inject(EnemyDebugService);
  /** Display options; the blood moon marks follow its switch */
  private readonly vfx = inject(DebugFacadeService).vfx;
  private readonly destroyRef = inject(DestroyRef);
  /** Coop, where the game runs one: the button means ready (D15) */
  private readonly coop = inject(COOP, { optional: true });
  readonly replay = inject(ReplayService);

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

    // Alert tones: once per wave of each kind and run, see WaveAlertAnnouncer.
    // A later build phase that still points at the same wave stays quiet.
    effect(() => {
      const waveNumber = this.store.waveNumber();
      const alerts = this.waveAlerts();
      untracked(() => {
        for (const kind of WAVE_ALERT_KINDS) {
          const alert = alerts.find((a) => a.kind === kind) ?? null;
          this.alertAnnouncers[kind].update(waveNumber, alert, () => this.playAlertTone(kind));
        }
      });
    });

    this.destroyRef.onDestroy(() => this.destroyMixedEnemyPreviews());
  }

  readonly waveActive = input.required<boolean>();
  readonly isGameOver = input.required<boolean>();

  readonly startWave = output<void>();

  /**
   * Wave the replay link under the button offers: the last one, between
   * waves only (the game-over screen has a button of its own), while the
   * player is offered the replay at all (ReplayService.offered). Null hides
   * it, so it goes the moment the next wave starts.
   */
  readonly replayWave = computed(() =>
    !this.waveActive() && !this.isGameOver() && this.replay.offered() ? this.replay.recordedWave() : null
  );

  /** A saved replay of this map can be loaded: between waves, while the replay is offered at all */
  readonly canLoadReplay = computed(() =>
    !this.waveActive() && !this.isGameOver() && REPLAY_CONFIG.offered && !this.uiStore.coopMapLocked()
  );

  onReplayFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) void this.replay.loadFile(file);
  }

  // Wave group display, only consumed by the template while a wave is active,
  // so we don't need campaign-derived or debug-panel fallbacks. The NEXT
  // timeline handles the preview of the coming waves separately.
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

  /** Coop readiness for the button; null outside a coop game */
  readonly coopReady = computed(() => {
    const coop = this.coop;
    if (!coop?.inGame()) return null;
    const left = coop.leftIds();
    const ready = coop.readyIds();
    const players = coop.roster().filter((p) => !left.has(p.id));
    return {
      ready: ready.has(coop.playerId() ?? ''),
      readyCount: players.filter((p) => ready.has(p.id)).length,
      playerCount: players.length,
      hostStarts: waveButtonAction(coop.options(), coop.isHost()) === 'start',
    };
  });

  /** Label, accessible name, "N left", countdown and bar width of the wave button. */
  readonly waveButton = computed(() =>
    waveButtonView(
      this.displayedWaveNumber(),
      this.waveActive(),
      this.store.waveEnemyTotal(),
      this.store.waveEnemiesLeft(),
      this.store.autoWaveSecondsLeft(),
      this.autoStartSeconds,
      this.coopReady(),
    )
  );

  toggleAutoStart(): void {
    this.uiStore.autoStartWaves.update(on => !on);
  }

  /**
   * NEXT: die nächsten fünf Wellen, wie die Quelle sie kennt.
   * Blutmond-Wellen tragen den Mond, solange der Look an ist.
   */
  readonly upcomingWaves = computed(() =>
    peekUpcomingWaves(
      this.waveDirector.peek({
        fromWave: this.store.waveNumber() + 1,
        count: NEXT_WAVE_MARKS,
      }),
      this.vfx().bloodMoon,
    )
  );

  /**
   * Placed towers that answer each alert kind, air with each owner's research
   * like the wave source counts it. Tower entities and the mirrored research
   * carry no signals: the tower count (placed, sold, reset), the local AA
   * research and the wave number (a partner's research by the next build
   * phase) tell when to recount.
   */
  private readonly answeringTowers = computed(() => {
    this.store.towerCount();
    this.store.waveNumber();
    this.researchStore.airTargetingUnlocked();
    const towers = this.mirror.towers();
    const types = towers.map((t) => t.typeConfig.id as TowerTypeId);
    const air = countAntiAirTowers(towers.map((t) => ({
      typeId: t.typeConfig.id as TowerTypeId,
      airTargetingUnlocked: this.mirror.researchOf(t.ownerId).airTargetingUnlocked,
    })));
    return { air, ethereal: countAntiEtherealTowers(types) };
  });

  /** Air or ethereal enemies in the next or the next-but-one wave, build phase only. */
  private readonly waveAlerts = computed(() => {
    if (this.waveActive() || this.isGameOver()) return [];
    const answering = this.answeringTowers();
    const lastWave = this.store.waveNumber();
    return WAVE_ALERT_KINDS
      .map((kind) => upcomingWaveAlert(kind, lastWave, answering[kind]))
      .filter((alert) => alert !== null);
  });

  readonly waveAlertViews = computed(() => {
    const unlocked = this.researchStore.airTargetingUnlocked();
    return this.waveAlerts().map((alert) => waveAlertView(alert, unlocked));
  });

  private readonly alertAnnouncers: Record<WaveAlertKind, WaveAlertAnnouncer> = {
    air: new WaveAlertAnnouncer(),
    ethereal: new WaveAlertAnnouncer(),
  };

  /**
   * Global one-shot at the SFX volume, registered on first use. Answers
   * whether it came out: false when there is no audio yet or the tone has
   * no buffer, so the wave stays unannounced.
   */
  private async playAlertTone(kind: WaveAlertKind): Promise<boolean> {
    const audio = this.engineInit.getEngine()?.spatialAudio;
    if (!audio) return false;
    const { id, notes, volume } = kind === 'air' ? UI_SOUNDS.airAlert : UI_SOUNDS.etherealAlert;
    if (!audio.getSoundConfig(id)) {
      audio.registerSound(id, toneWavDataUrl(notes), { volume });
    }
    return (await audio.playGlobal(id)) !== null;
  }

  readonly groupTooltip = enemyGroupTooltip;
  readonly formatLeak = formatLeak;
  /** What the running wave costs the HQ if all of it gets through (TODO E49) */
  readonly leakTotal = computed(() => waveLeakTotal(this.currentWaveGroups()));
  /** "Splits into 2 minions on death" under the armor line, null for a type that does not split. */
  readonly enemyTrait = enemyTraitLabel;

  @ViewChildren('mixedEnemyCanvas') mixedEnemyCanvases!: QueryList<ElementRef<HTMLCanvasElement>>;
  private activeMixedPreviewIds: string[] = [];

  /** Run `fn` after `ms` unless the panel is gone by then: a preview made later would render forever */
  private later(fn: () => void, ms: number): void {
    const timer = setTimeout(fn, ms);
    this.destroyRef.onDestroy(() => clearTimeout(timer));
  }

  ngAfterViewInit(): void {
    // Initialize previews after DOM is ready
    this.later(() => this.initMixedEnemyPreviews(), 100);

    // Initialize mixed enemy previews when canvases appear
    this.mixedEnemyCanvases.changes
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.later(() => this.initMixedEnemyPreviews(), 100);
      });
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

      this.modelPreview.createPreview(previewId, canvas, enemyPreviewConfig(enemyConfig, overrides));
    });
  }

  private destroyMixedEnemyPreviews(): void {
    for (const id of this.activeMixedPreviewIds) {
      this.modelPreview.destroyPreview(id);
    }
    this.activeMixedPreviewIds = [];
  }
}
