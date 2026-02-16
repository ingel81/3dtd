import { Component, inject, input, output, signal, computed, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DebugWindowService } from '../../services/debug-window.service';
import { UIStore } from '../../store/ui.store';
import { DevWorldService } from '../../devworld/devworld.service';
import { TD_CSS_VARS } from '../../styles/td-theme';

@Component({
  selector: 'app-quick-actions',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="td-quick-actions">
      <!-- Route Animation Button -->
      <button class="td-quick-btn route-anim-btn"
              (click)="playRouteAnimation.emit()"
              matTooltip="Play route animation"
              matTooltipPosition="left">
        <mat-icon>moving</mat-icon>
      </button>
      <!-- Display Settings Menu (collapsible, expands upward) -->
      <div class="td-display-menu-wrapper">
        <div class="td-display-toggles" [class.expanded]="uiStore.displayMenuExpanded()">
          <button class="td-display-btn" [class.active]="screenShakeEnabled()"
                  (click)="toggleScreenShake()" matTooltip="Screen Shake" matTooltipPosition="left">
            <mat-icon>vibration</mat-icon>
          </button>
          <button class="td-display-btn" [class.active]="healthBarsVisible()"
                  (click)="toggleHealthBars()" matTooltip="Health Bars" matTooltipPosition="left">
            <mat-icon>monitor_heart</mat-icon>
          </button>
          <button class="td-display-btn" [class.active]="damageNumbersVisible()"
                  (click)="toggleDamageNumbers()" matTooltip="Damage Numbers" matTooltipPosition="left">
            <mat-icon>pin</mat-icon>
          </button>
        </div>
        <button class="td-quick-btn td-display-toggle-btn"
                [class.active]="uiStore.displayMenuExpanded()"
                (click)="uiStore.toggleDisplayMenu()"
                matTooltip="Display" matTooltipPosition="left">
          <mat-icon>{{ uiStore.displayMenuExpanded() ? 'visibility_off' : 'visibility' }}</mat-icon>
        </button>
      </div>
      <!-- Audio Settings Menu (collapsible, expands upward) -->
      <div class="td-audio-menu-wrapper">
        <div class="td-audio-panel" [class.expanded]="uiStore.audioMenuExpanded()">
          <div class="td-audio-row">
            <mat-icon class="td-audio-label">music_note</mat-icon>
            <input type="range" class="td-audio-slider"
                   min="0" max="100" step="1"
                   [value]="uiStore.musicVolume() * 100"
                   (input)="onMusicSlider($event)">
            <button class="td-audio-mute"
                    [class.muted]="uiStore.musicMuted()"
                    (click)="toggleMusicMute()"
                    matTooltip="Mute music" matTooltipPosition="left">
              <mat-icon>{{ uiStore.musicMuted() ? 'music_off' : 'music_note' }}</mat-icon>
            </button>
          </div>
          <div class="td-audio-row">
            <mat-icon class="td-audio-label">graphic_eq</mat-icon>
            <input type="range" class="td-audio-slider"
                   min="0" max="100" step="1"
                   [value]="uiStore.sfxVolume() * 100"
                   (input)="onSfxSlider($event)">
            <button class="td-audio-mute"
                    [class.muted]="uiStore.sfxMuted()"
                    (click)="toggleSfxMute()"
                    matTooltip="Mute SFX" matTooltipPosition="left">
              <mat-icon>{{ uiStore.sfxMuted() ? 'volume_off' : 'volume_up' }}</mat-icon>
            </button>
          </div>
        </div>
        <button class="td-quick-btn td-audio-toggle-btn"
                [class.active]="uiStore.audioMenuExpanded()"
                (click)="uiStore.toggleAudioMenu()"
                matTooltip="Audio" matTooltipPosition="left">
          <mat-icon>{{ anyMuted() ? 'volume_off' : 'volume_up' }}</mat-icon>
        </button>
      </div>
      <!-- Layer Menu (collapsible, expands upward) -->
      <div class="td-layer-menu-wrapper">
        <div class="td-layer-toggles" [class.expanded]="uiStore.layerMenuExpanded()">
          <button class="td-layer-btn"
                  [class.active]="uiStore.spatialGridDebugVisible()"
                  (click)="spatialGridDebugToggled.emit()"
                  matTooltip="Route Grid Overlay"
                  matTooltipPosition="left">
            <mat-icon>grid_on</mat-icon>
          </button>
          <button class="td-layer-btn"
                  [class.active]="uiStore.buildingsVisible()"
                  (click)="uiStore.toggleBuildings(); buildingsToggled.emit()"
                  matTooltip="Show buildings"
                  matTooltipPosition="left">
            <mat-icon>domain</mat-icon>
          </button>
          <button class="td-layer-btn"
                  [class.active]="uiStore.streetsVisible()"
                  (click)="uiStore.toggleStreets(); streetsToggled.emit()"
                  matTooltip="Show streets"
                  matTooltipPosition="left">
            <mat-icon>route</mat-icon>
          </button>
          <button class="td-layer-btn"
                  [class.active]="uiStore.routesVisible()"
                  (click)="uiStore.toggleRoutes(); routesToggled.emit()"
                  matTooltip="Show routes"
                  matTooltipPosition="left">
            <mat-icon>timeline</mat-icon>
          </button>
        </div>
        <button class="td-quick-btn td-layer-toggle-btn"
                [class.active]="uiStore.layerMenuExpanded()"
                (click)="uiStore.toggleLayerMenu()"
                matTooltip="Layers"
                matTooltipPosition="left">
          <mat-icon>{{ uiStore.layerMenuExpanded() ? 'layers_clear' : 'layers' }}</mat-icon>
        </button>
      </div>
      <button class="td-quick-btn" (click)="resetCamera.emit()" matTooltip="Reset camera" matTooltipPosition="left">
        <mat-icon>my_location</mat-icon>
      </button>
      <!-- Dev Menu (expands upward) -->
      <div class="td-dev-menu-wrapper">
        <div class="td-dev-menu" [class.expanded]="uiStore.devMenuExpanded()">
          <!-- Cheats -->
          <button class="td-dev-btn td-dev-btn-danger"
                  (click)="killAllEnemies.emit()"
                  matTooltip="Kill all enemies"
                  matTooltipPosition="left">
            <mat-icon>skull</mat-icon>
          </button>
          <button class="td-dev-btn td-dev-btn-credits"
                  (click)="addCredits.emit()"
                  matTooltip="+1000 Credits"
                  matTooltipPosition="left">
            <mat-icon>payments</mat-icon>
          </button>
          <button class="td-dev-btn td-dev-btn-health"
                  (click)="addHealth.emit()"
                  matTooltip="+1000 HP"
                  matTooltipPosition="left">
            <mat-icon>heart_plus</mat-icon>
          </button>
          <div class="td-dev-separator"></div>
          <!-- Terrain & Map -->
          <button class="td-dev-btn"
                  [class.active]="uiStore.heightDebugVisible()"
                  (click)="heightDebugToggled.emit()"
                  matTooltip="Height markers"
                  matTooltipPosition="left">
            <mat-icon>terrain</mat-icon>
          </button>
          <button class="td-dev-btn"
                  [class.active]="uiStore.specialPointsDebugVisible()"
                  (click)="specialPointsDebugToggled.emit()"
                  matTooltip="Special points"
                  matTooltipPosition="left">
            <mat-icon>place</mat-icon>
          </button>
          <button class="td-dev-btn"
                  (click)="refreshHeights.emit()"
                  matTooltip="Re-raycast heights"
                  matTooltipPosition="left">
            <mat-icon>sync</mat-icon>
          </button>
          <div class="td-dev-separator"></div>
          <!-- Camera -->
          <button class="td-dev-btn"
                  [class.active]="debugWindows.cameraWindow().isOpen"
                  (click)="debugWindows.toggle('camera')"
                  matTooltip="Camera info"
                  matTooltipPosition="left">
            <mat-icon>videocam</mat-icon>
          </button>
          <button class="td-dev-btn"
                  [class.active]="cameraFramingDebug()"
                  (click)="cameraFramingDebugToggled.emit()"
                  matTooltip="Framing guides"
                  matTooltipPosition="left">
            <mat-icon>crop_free</mat-icon>
          </button>
          <div class="td-dev-separator"></div>
          <!-- Debug Panels -->
          <button class="td-dev-btn"
                  [class.active]="debugWindows.waveWindow().isOpen"
                  (click)="debugWindows.toggle('wave')"
                  matTooltip="Wave spawner"
                  matTooltipPosition="left">
            <mat-icon>waves</mat-icon>
          </button>
          <button class="td-dev-btn"
                  [class.active]="debugWindows.towerWindow().isOpen"
                  (click)="debugWindows.toggle('tower')"
                  matTooltip="Tower inspector"
                  matTooltipPosition="left">
            <mat-icon>tower</mat-icon>
          </button>
          <button class="td-dev-btn"
                  [class.active]="debugWindows.enemyWindow().isOpen"
                  (click)="debugWindows.toggle('enemy')"
                  matTooltip="Enemy inspector"
                  matTooltipPosition="left">
            <mat-icon>pest_control</mat-icon>
          </button>
          <button class="td-dev-btn"
                  [class.active]="debugWindows.soundWindow().isOpen"
                  (click)="debugWindows.toggle('sound')"
                  matTooltip="Spatial audio"
                  matTooltipPosition="left">
            <mat-icon>spatial_audio</mat-icon>
          </button>
          <button class="td-dev-btn"
                  [class.active]="debugWindows.displayWindow().isOpen"
                  (click)="debugWindows.toggle('display')"
                  matTooltip="Display options"
                  matTooltipPosition="left">
            <mat-icon>tune</mat-icon>
          </button>
          <button class="td-dev-btn"
                  [class.active]="debugWindows.performanceWindow().isOpen"
                  (click)="debugWindows.toggle('performance')"
                  matTooltip="Performance"
                  matTooltipPosition="left">
            <mat-icon>speed</mat-icon>
          </button>
          <button class="td-dev-btn"
                  [class.active]="debugWindows.eventsWindow().isOpen"
                  (click)="debugWindows.toggle('events')"
                  matTooltip="Event bus"
                  matTooltipPosition="left">
            <mat-icon>hub</mat-icon>
          </button>
          <button class="td-dev-btn"
                  [class.active]="debugWindows.trainingWindow().isOpen"
                  (click)="debugWindows.toggle('training')"
                  matTooltip="AI Training"
                  matTooltipPosition="left">
            <mat-icon>smart_toy</mat-icon>
          </button>
          @if (devWorld.isActive) {
            <button class="td-dev-btn"
                    [class.active]="debugWindows.devworldWindow().isOpen"
                    (click)="debugWindows.toggle('devworld')"
                    matTooltip="DevWorld"
                    matTooltipPosition="left">
              <mat-icon>public</mat-icon>
            </button>
          }
        </div>
        <button class="td-quick-btn td-dev-toggle-btn"
                [class.active]="uiStore.devMenuExpanded()"
                (click)="uiStore.toggleDevMenu()"
                matTooltip="Developer options"
                matTooltipPosition="left">
          <mat-icon>{{ uiStore.devMenuExpanded() ? 'code_off' : 'code' }}</mat-icon>
        </button>
      </div>
    </div>
  `,
  styles: `
    :host {
      display: contents;
      ${TD_CSS_VARS}
    }

    .td-quick-actions {
      position: absolute;
      bottom: 36px;
      right: 8px;
      display: flex;
      align-items: flex-end;
      gap: 4px;
      z-index: 5;
    }

    .td-quick-actions > * {
      flex-shrink: 0;
    }

    .td-layer-menu-wrapper {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 4px;
    }

    .td-layer-toggles {
      display: flex;
      flex-direction: column;
      gap: 4px;
      overflow: hidden;
      max-height: 0;
      opacity: 0;
      transition: max-height 0.3s ease-out, opacity 0.15s ease;
    }

    .td-layer-toggles.expanded {
      max-height: 100vh;
      opacity: 1;
    }

    .td-layer-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      min-width: 32px;
      min-height: 32px;
      box-sizing: border-box;
      background: var(--td-panel-main);
      border: 1px solid var(--td-frame-mid);
      border-top-color: var(--td-frame-light);
      border-bottom-color: var(--td-frame-dark);
      color: var(--td-text-secondary);
      cursor: pointer;
      transition: all 0.15s;
    }

    .td-layer-btn mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .td-layer-btn:hover {
      background: var(--td-frame-mid);
      color: var(--td-text-primary);
    }

    .td-layer-btn.active {
      background: var(--td-teal);
      color: var(--td-bg-dark);
    }

    .td-quick-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      min-width: 32px;
      min-height: 32px;
      box-sizing: border-box;
      background: var(--td-panel-main);
      border: 1px solid var(--td-frame-mid);
      border-top-color: var(--td-frame-light);
      border-bottom-color: var(--td-frame-dark);
      color: var(--td-text-secondary);
      cursor: pointer;
      transition: all 0.15s;
    }

    .td-quick-btn mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .td-quick-btn:hover {
      background: var(--td-frame-mid);
      color: var(--td-text-primary);
    }

    .td-quick-btn.active {
      background: var(--td-teal);
      color: var(--td-bg-dark);
    }

    .td-layer-toggle-btn.active {
      background: var(--td-gold-dark);
      color: var(--td-text-primary);
    }

    .td-display-menu-wrapper {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 4px;
    }

    .td-display-toggles {
      display: flex;
      flex-direction: column;
      gap: 4px;
      overflow: hidden;
      max-height: 0;
      opacity: 0;
      transition: max-height 0.3s ease-out, opacity 0.15s ease;
    }

    .td-display-toggles.expanded {
      max-height: 100vh;
      opacity: 1;
    }

    .td-display-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      min-width: 32px;
      min-height: 32px;
      box-sizing: border-box;
      background: var(--td-panel-main);
      border: 1px solid var(--td-frame-mid);
      border-top-color: var(--td-frame-light);
      border-bottom-color: var(--td-frame-dark);
      color: var(--td-text-secondary);
      cursor: pointer;
      transition: all 0.15s;
    }

    .td-display-btn mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .td-display-btn:hover {
      background: var(--td-frame-mid);
      color: var(--td-text-primary);
    }

    .td-display-btn.active {
      background: var(--td-teal);
      color: var(--td-bg-dark);
    }

    .td-display-toggle-btn.active {
      background: var(--td-teal);
      color: var(--td-bg-dark);
    }

    .td-audio-menu-wrapper {
      position: relative;
    }

    .td-audio-panel {
      position: absolute;
      bottom: calc(100% + 4px);
      right: 0;
      display: flex;
      flex-direction: column;
      gap: 10px;
      background: var(--td-panel-main);
      border: 1px solid var(--td-frame-mid);
      border-top-color: var(--td-frame-light);
      border-bottom-color: var(--td-frame-dark);
      overflow: hidden;
      max-height: 0;
      opacity: 0;
      padding: 0 10px;
      pointer-events: none;
      transition: max-height 0.3s ease-out, opacity 0.15s ease, padding 0.15s ease;
    }

    .td-audio-panel.expanded {
      max-height: 100vh;
      opacity: 1;
      padding: 10px;
      pointer-events: auto;
    }

    .td-audio-row {
      display: flex;
      align-items: center;
      gap: 6px;
      white-space: nowrap;
    }

    .td-audio-label {
      font-size: 14px !important;
      width: 14px !important;
      height: 14px !important;
      color: var(--td-text-secondary);
      flex-shrink: 0;
    }

    .td-audio-slider {
      width: 80px;
      height: 4px;
      -webkit-appearance: none;
      appearance: none;
      background: var(--td-frame-mid);
      border-radius: 2px;
      outline: none;
      cursor: pointer;
    }

    .td-audio-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 12px;
      height: 12px;
      background: var(--td-teal);
      border-radius: 50%;
      cursor: pointer;
    }

    .td-audio-slider::-moz-range-thumb {
      width: 12px;
      height: 12px;
      background: var(--td-teal);
      border-radius: 50%;
      border: none;
      cursor: pointer;
    }

    .td-audio-mute {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      min-width: 20px;
      background: transparent;
      border: none;
      color: var(--td-text-secondary);
      cursor: pointer;
      padding: 0;
      flex-shrink: 0;
    }

    .td-audio-mute mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }

    .td-audio-mute:hover {
      color: var(--td-text-primary);
    }

    .td-audio-mute.muted {
      color: var(--td-health-red);
    }

    .td-audio-toggle-btn.active {
      background: var(--td-teal);
      color: var(--td-bg-dark);
    }

    .td-dev-menu-wrapper {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 4px;
    }

    .td-dev-menu {
      display: flex;
      flex-direction: column;
      gap: 4px;
      overflow: hidden;
      max-height: 0;
      opacity: 0;
      transition: max-height 0.3s ease-out, opacity 0.15s ease;
    }

    .td-dev-menu.expanded {
      max-height: 100vh;
      opacity: 1;
    }

    .td-dev-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      min-width: 32px;
      min-height: 32px;
      box-sizing: border-box;
      background: var(--td-panel-main);
      border: 1px solid var(--td-frame-mid);
      border-top-color: var(--td-frame-light);
      border-bottom-color: var(--td-frame-dark);
      color: var(--td-text-secondary);
      cursor: pointer;
      transition: all 0.15s;
    }

    .td-dev-btn mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .td-dev-btn:hover {
      background: var(--td-frame-mid);
      color: var(--td-text-primary);
    }

    .td-dev-btn.active {
      background: var(--td-gold-dark);
      color: var(--td-text-primary);
    }

    .td-dev-toggle-btn.active {
      background: var(--td-gold-dark);
      color: var(--td-text-primary);
    }

    .route-anim-btn {
      border-color: var(--td-warn-orange);
      color: var(--td-warn-orange);
    }

    .route-anim-btn:hover {
      background: var(--td-warn-orange);
      color: var(--td-bg-dark);
    }

    .td-dev-separator {
      height: 1px;
      background: var(--td-frame-mid);
      margin: 4px 0;
    }

    .td-dev-btn-danger {
      border-color: var(--td-health-red);
      color: var(--td-health-red);
    }

    .td-dev-btn-danger:hover {
      background: var(--td-health-red);
      color: var(--td-text-primary);
    }

    .td-dev-btn-credits {
      border-color: var(--td-gold);
      color: var(--td-gold);
    }

    .td-dev-btn-credits:hover {
      background: var(--td-gold);
      color: var(--td-bg-dark);
    }

    .td-dev-btn-health {
      border-color: var(--td-health-red);
      color: var(--td-health-red);
    }

    .td-dev-btn-health:hover {
      background: var(--td-health-red);
      color: var(--td-text-primary);
    }
  `,
})
export class QuickActionsComponent {
  readonly debugWindows = inject(DebugWindowService);
  readonly uiStore = inject(UIStore);
  readonly devWorld = inject(DevWorldService);

  // Input for camera framing debug state (component-local in parent)
  readonly cameraFramingDebug = input.required<boolean>();

  // Display settings signals (initialized from localStorage)
  readonly screenShakeEnabled = signal(true);
  readonly healthBarsVisible = signal(true);
  readonly damageNumbersVisible = signal(true);

  // Display settings outputs
  readonly screenShakeToggled = output<boolean>();
  readonly healthBarsToggled = output<boolean>();
  readonly damageNumbersToggled = output<boolean>();

  // Outputs for actions that need parent handling
  readonly resetCamera = output<void>();
  readonly buildingsToggled = output<void>();
  readonly streetsToggled = output<void>();
  readonly routesToggled = output<void>();
  readonly heightDebugToggled = output<void>();
  readonly cameraFramingDebugToggled = output<void>();
  readonly specialPointsDebugToggled = output<void>();
  readonly spatialGridDebugToggled = output<void>();
  readonly playRouteAnimation = output<void>();
  readonly refreshHeights = output<void>();
  readonly killAllEnemies = output<void>();
  readonly addCredits = output<void>();
  readonly addHealth = output<void>();

  // Audio outputs
  readonly musicVolumeChanged = output<number>();
  readonly sfxVolumeChanged = output<number>();

  // Computed: any channel muted?
  readonly anyMuted = computed(() => this.uiStore.musicMuted() || this.uiStore.sfxMuted());

  constructor() {
    this.loadDisplayOptions();
  }

  private loadDisplayOptions(): void {
    try {
      const stored = localStorage.getItem('td_display_options');
      if (stored) {
        const opts = JSON.parse(stored);
        if (opts.screenShake === false) this.screenShakeEnabled.set(false);
        if (opts.healthBars === false) this.healthBarsVisible.set(false);
        if (opts.damageNumbers === false) this.damageNumbersVisible.set(false);
      }
    } catch { /* ignore corrupt localStorage */ }
  }

  toggleScreenShake(): void {
    this.screenShakeEnabled.update(v => !v);
    this.screenShakeToggled.emit(this.screenShakeEnabled());
  }

  toggleHealthBars(): void {
    this.healthBarsVisible.update(v => !v);
    this.healthBarsToggled.emit(this.healthBarsVisible());
  }

  toggleDamageNumbers(): void {
    this.damageNumbersVisible.update(v => !v);
    this.damageNumbersToggled.emit(this.damageNumbersVisible());
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
