import { Component, inject, input, output, computed, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DebugWindowService } from '../../services/debug/debug-window.service';
import { DebugFacadeService, FPS_LIMITS } from '../../services/debug/debug-facade.service';
import { DebugStateDumpService } from '../../services/debug/debug-state-dump.service';
import { CellReportService } from '../../services/debug/cell-report.service';
import { CorridorSnapshotService } from '../../services/debug/corridor-snapshot.service';
import { UIStore } from '../../store/ui.store';
import { DevWorldService } from '../../devworld/devworld.service';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { TdIconComponent } from '../icon/icon.component';
import { matchingVfxPreset, type VfxPreset, type VfxSettings } from '../../three-engine/vfx-settings';
import { COLOR_GRADING_PRESETS, type ColorGradingPreset } from '../../three-engine/post-processing/color-grading';

type VfxSwitch = Exclude<keyof VfxSettings, 'colorGrading'>;

/** Quality presets, see VFX_PRESETS. */
const PRESET_BUTTONS: readonly { id: VfxPreset; label: string; hint: string }[] = [
  { id: 'low', label: 'Low', hint: 'No muzzle flashes, trails, impact effects or ground marks' },
  { id: 'medium', label: 'Medium', hint: 'All effects except projectile trails' },
  { id: 'high', label: 'High', hint: 'All effects, bloom and color grading off' },
];

/** The switches the quality presets set, in menu order. */
const EFFECT_ROWS: readonly { key: VfxSwitch; label: string; hint: string }[] = [
  { key: 'muzzleFlash', label: 'Muzzle Flash', hint: 'Flash and light at the barrel of guns, launcher and bow' },
  { key: 'projectileTrails', label: 'Projectile Trails', hint: 'Streaks and particle trails behind projectiles' },
  { key: 'impactEffects', label: 'Impact Effects', hint: 'Explosions, smoke, spark bursts and blood spray at hits' },
  { key: 'groundMarks', label: 'Ground Marks', hint: 'Blood, frost, scorch marks and ooze puddles on the ground' },
  { key: 'bloom', label: 'Bloom', hint: 'Glow around bright surfaces, an extra full-screen pass' },
];

@Component({
  selector: 'app-quick-actions',
  standalone: true,
  imports: [CommonModule, MatTooltipModule, TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './quick-actions.component.html',
  styleUrl: './quick-actions.component.scss',
  styles: `
    :host {
      ${TD_CSS_VARS}
    }
  `,
})
export class QuickActionsComponent {
  readonly debugWindows = inject(DebugWindowService);
  readonly uiStore = inject(UIStore);
  readonly devWorld = inject(DevWorldService);
  readonly debugStateDump = inject(DebugStateDumpService);
  readonly debugFacade = inject(DebugFacadeService);
  readonly cellReport = inject(CellReportService);
  readonly corridorSnapshot = inject(CorridorSnapshotService);

  // Input for camera framing debug state (component-local in parent)
  readonly cameraFramingDebug = input.required<boolean>();

  // Display settings: shared signals in DebugFacadeService (single source of
  // truth, also shown by the Display debug window), changed through its on*() methods
  readonly screenShakeEnabled = this.debugFacade.screenShakeEnabled;
  readonly healthBarsVisible = this.debugFacade.healthBarsVisible;
  readonly damageNumbersVisible = this.debugFacade.damageNumbersVisible;
  readonly bossIntroEnabled = this.debugFacade.bossIntroEnabled;
  readonly fpsLimit = this.debugFacade.fpsLimit;
  readonly vfx = this.debugFacade.vfx;
  /** Preset the effect switches match, null for a mix of the player's own. */
  readonly activePreset = computed(() => matchingVfxPreset(this.vfx()));

  readonly presetButtons = PRESET_BUTTONS;
  readonly effectRows = EFFECT_ROWS;
  readonly colorGradingPresets = COLOR_GRADING_PRESETS;
  readonly fpsLimits = FPS_LIMITS;

  // Per-tower-LOS filter — icon + tooltip computed from the UIStore signal
  // so the button reflects the current mode (both / ground / air).
  readonly perTowerLosFilterIcon = computed<'layers' | 'grid' | 'gridAir'>(() => {
    const mode = this.uiStore.perTowerLosFilter();
    return mode === 'both' ? 'layers' : mode === 'ground' ? 'grid' : 'gridAir';
  });
  readonly perTowerLosFilterTooltip = computed(() => {
    const mode = this.uiStore.perTowerLosFilter();
    const current = mode === 'both' ? 'Both layers' : mode === 'ground' ? 'Ground only' : 'Air only';
    const next = mode === 'both' ? 'Ground only' : mode === 'ground' ? 'Air only' : 'Both layers';
    return `Per-tower LOS: ${current} (click → ${next})`;
  });

  // Outputs for actions that need parent handling
  readonly resetCamera = output<void>();
  readonly buildingsToggled = output<void>();
  readonly streetsToggled = output<void>();
  readonly routesToggled = output<void>();
  readonly heightDebugToggled = output<void>();
  readonly cameraFramingDebugToggled = output<void>();
  readonly specialPointsDebugToggled = output<void>();
  readonly spatialGridDebugToggled = output<void>();
  readonly airSpatialGridDebugToggled = output<void>();
  readonly airRouteToggled = output<void>();
  readonly perTowerLosFilterCycled = output<void>();
  readonly playRouteAnimation = output<void>();
  readonly refreshHeights = output<void>();
  readonly killAllEnemies = output<void>();
  readonly addCredits = output<MouseEvent>();
  readonly addHealth = output<MouseEvent>();
  readonly completeAllResearch = output<void>();
  readonly maxUpgradeAllTowers = output<void>();
  readonly readyAbilities = output<void>();
  readonly readyHero = output<void>();
  readonly photoModeRequested = output<void>();

  // Computed: anything muted? The store's volumes reach the audio by
  // themselves (TowerDefenseComponent)
  readonly anyMuted = computed(() =>
    this.uiStore.masterMuted() || this.uiStore.musicMuted() || this.uiStore.sfxMuted());

  toggleVfx(key: VfxSwitch): void {
    const change: Partial<VfxSettings> = {};
    change[key] = !this.vfx()[key];
    this.debugFacade.onVfxSettingsChanged(change);
  }

  onColorGradingChange(event: Event): void {
    const preset = (event.target as HTMLSelectElement).value as ColorGradingPreset;
    this.debugFacade.onVfxSettingsChanged({ colorGrading: preset });
  }

  // Audio controls: they set the store only
  onMasterSlider(event: Event): void {
    this.uiStore.masterVolume.set((event.target as HTMLInputElement).valueAsNumber / 100);
    this.uiStore.masterMuted.set(false);
  }

  onMusicSlider(event: Event): void {
    this.uiStore.musicVolume.set((event.target as HTMLInputElement).valueAsNumber / 100);
    this.uiStore.musicMuted.set(false);
  }

  onSfxSlider(event: Event): void {
    this.uiStore.sfxVolume.set((event.target as HTMLInputElement).valueAsNumber / 100);
    this.uiStore.sfxMuted.set(false);
  }

  toggleMasterMute(): void {
    this.uiStore.masterMuted.update(v => !v);
  }

  toggleMusicMute(): void {
    this.uiStore.musicMuted.update(v => !v);
  }

  toggleSfxMute(): void {
    this.uiStore.sfxMuted.update(v => !v);
  }
}
