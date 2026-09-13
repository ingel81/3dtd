import { Component, inject, input, output, computed, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DebugWindowService } from '../../services/debug/debug-window.service';
import { DebugFacadeService, FPS_LIMITS } from '../../services/debug/debug-facade.service';
import { DebugStateDumpService } from '../../services/debug/debug-state-dump.service';
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
  { key: 'groundMarks', label: 'Ground Marks', hint: 'Blood, frost and scorch marks on the ground' },
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

  // Input for camera framing debug state (component-local in parent)
  readonly cameraFramingDebug = input.required<boolean>();

  // Static curriculum fallback state (game-store driven, parent passes in)
  readonly useStaticCurriculum = input.required<boolean>();

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
  readonly staticCurriculumToggled = output<void>();
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
  readonly readyNuke = output<void>();
  readonly photoModeRequested = output<void>();

  // Audio outputs
  readonly musicVolumeChanged = output<number>();
  readonly sfxVolumeChanged = output<number>();

  // Computed: any channel muted?
  readonly anyMuted = computed(() => this.uiStore.musicMuted() || this.uiStore.sfxMuted());

  toggleVfx(key: VfxSwitch): void {
    const change: Partial<VfxSettings> = {};
    change[key] = !this.vfx()[key];
    this.debugFacade.onVfxSettingsChanged(change);
  }

  onColorGradingChange(event: Event): void {
    const preset = (event.target as HTMLSelectElement).value as ColorGradingPreset;
    this.debugFacade.onVfxSettingsChanged({ colorGrading: preset });
  }

  // Audio controls
  onMusicSlider(event: Event): void {
    const val = (event.target as HTMLInputElement).valueAsNumber / 100;
    this.uiStore.musicVolume.set(val);
    if (this.uiStore.musicMuted()) this.uiStore.musicMuted.set(false);
    this.musicVolumeChanged.emit(val);
  }

  onSfxSlider(event: Event): void {
    const val = (event.target as HTMLInputElement).valueAsNumber / 100;
    this.uiStore.sfxVolume.set(val);
    if (this.uiStore.sfxMuted()) this.uiStore.sfxMuted.set(false);
    this.sfxVolumeChanged.emit(val);
  }

  toggleMusicMute(): void {
    this.uiStore.musicMuted.update(v => !v);
    this.musicVolumeChanged.emit(this.uiStore.musicMuted() ? 0 : this.uiStore.musicVolume());
  }

  toggleSfxMute(): void {
    this.uiStore.sfxMuted.update(v => !v);
    this.sfxVolumeChanged.emit(this.uiStore.sfxMuted() ? 0 : this.uiStore.sfxVolume());
  }
}
