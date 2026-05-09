import { Component, inject, input, output, computed, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DebugWindowService } from '../../services/debug/debug-window.service';
import { DebugFacadeService } from '../../services/debug/debug-facade.service';
import { UIStore } from '../../store/ui.store';
import { DevWorldService } from '../../devworld/devworld.service';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { TdIconComponent } from '../icon/icon.component';

@Component({
  selector: 'app-quick-actions',
  standalone: true,
  imports: [CommonModule, MatTooltipModule, TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="td-quick-actions">
      <!-- Route Animation Button -->
      <button class="td-quick-btn route-anim-btn"
              (click)="playRouteAnimation.emit()"
              matTooltip="Play route animation"
              matTooltipPosition="left">
        <td-icon name="route" [size]="18"></td-icon>
      </button>
      <!-- Display Settings Menu (collapsible, expands upward) -->
      <div class="td-display-menu-wrapper">
        <div class="td-display-toggles" [class.expanded]="uiStore.displayMenuExpanded()">
          <button class="td-display-btn" [class.active]="screenShakeEnabled()"
                  (click)="toggleScreenShake()" matTooltip="Screen Shake" matTooltipPosition="left">
            <td-icon name="vibration" [size]="18"></td-icon>
          </button>
          <button class="td-display-btn" [class.active]="healthBarsVisible()"
                  (click)="toggleHealthBars()" matTooltip="Health Bars" matTooltipPosition="left">
            <td-icon name="heart" [size]="18"></td-icon>
          </button>
          <button class="td-display-btn" [class.active]="damageNumbersVisible()"
                  (click)="toggleDamageNumbers()" matTooltip="Damage Numbers" matTooltipPosition="left">
            <td-icon name="pin" [size]="18"></td-icon>
          </button>
        </div>
        <button class="td-quick-btn td-display-toggle-btn"
                [class.active]="uiStore.displayMenuExpanded()"
                (click)="uiStore.toggleDisplayMenu()"
                matTooltip="Display" matTooltipPosition="left">
          <td-icon [name]="uiStore.displayMenuExpanded() ? 'eyeOff' : 'eye'" [size]="18"></td-icon>
        </button>
      </div>
      <!-- Audio Settings Menu (collapsible, expands upward) -->
      <div class="td-audio-menu-wrapper">
        <div class="td-audio-panel" [class.expanded]="uiStore.audioMenuExpanded()">
          <div class="td-audio-row">
            <td-icon class="td-audio-label" name="audio" [size]="14"></td-icon>
            <input type="range" class="td-audio-slider"
                   min="0" max="100" step="1"
                   [value]="uiStore.musicVolume() * 100"
                   (input)="onMusicSlider($event)">
            <button class="td-audio-mute"
                    [class.muted]="uiStore.musicMuted()"
                    (click)="toggleMusicMute()"
                    matTooltip="Mute music" matTooltipPosition="left">
              <td-icon [name]="uiStore.musicMuted() ? 'audioOff' : 'audio'" [size]="14"></td-icon>
            </button>
          </div>
          <div class="td-audio-row">
            <td-icon class="td-audio-label" name="sliders" [size]="14"></td-icon>
            <input type="range" class="td-audio-slider"
                   min="0" max="100" step="1"
                   [value]="uiStore.sfxVolume() * 100"
                   (input)="onSfxSlider($event)">
            <button class="td-audio-mute"
                    [class.muted]="uiStore.sfxMuted()"
                    (click)="toggleSfxMute()"
                    matTooltip="Mute SFX" matTooltipPosition="left">
              <td-icon [name]="uiStore.sfxMuted() ? 'audioOff' : 'audio'" [size]="14"></td-icon>
            </button>
          </div>
        </div>
        <button class="td-quick-btn td-audio-toggle-btn"
                [class.active]="uiStore.audioMenuExpanded()"
                (click)="uiStore.toggleAudioMenu()"
                matTooltip="Audio" matTooltipPosition="left">
          <td-icon [name]="anyMuted() ? 'audioOff' : 'audio'" [size]="18"></td-icon>
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
            <td-icon name="grid" [size]="18"></td-icon>
          </button>
          <button class="td-layer-btn"
                  [class.active]="uiStore.buildingsVisible()"
                  (click)="uiStore.toggleBuildings(); buildingsToggled.emit()"
                  matTooltip="Show buildings"
                  matTooltipPosition="left">
            <td-icon name="tower" [size]="18"></td-icon>
          </button>
          <button class="td-layer-btn"
                  [class.active]="uiStore.streetsVisible()"
                  (click)="uiStore.toggleStreets(); streetsToggled.emit()"
                  matTooltip="Show streets"
                  matTooltipPosition="left">
            <td-icon name="route" [size]="18"></td-icon>
          </button>
          <button class="td-layer-btn"
                  [class.active]="uiStore.routesVisible()"
                  (click)="uiStore.toggleRoutes(); routesToggled.emit()"
                  matTooltip="Show routes"
                  matTooltipPosition="left">
            <td-icon name="chart" [size]="18"></td-icon>
          </button>
        </div>
        <button class="td-quick-btn td-layer-toggle-btn"
                [class.active]="uiStore.layerMenuExpanded()"
                (click)="uiStore.toggleLayerMenu()"
                matTooltip="Layers"
                matTooltipPosition="left">
          <td-icon name="layers" [size]="18"></td-icon>
        </button>
      </div>
      <button class="td-quick-btn" (click)="resetCamera.emit()" matTooltip="Reset camera" matTooltipPosition="left">
        <td-icon name="target" [size]="18"></td-icon>
      </button>
      <!-- Dev Menu (expands upward) -->
      <div class="td-dev-menu-wrapper">
        <div class="td-dev-menu" [class.expanded]="uiStore.devMenuExpanded()">
          <!-- Cheats -->
          <button class="td-dev-btn td-dev-btn-danger"
                  (click)="killAllEnemies.emit()"
                  matTooltip="Kill all enemies"
                  matTooltipPosition="left">
            <td-icon name="skull" [size]="18"></td-icon>
          </button>
          <button class="td-dev-btn td-dev-btn-credits"
                  (click)="addCredits.emit($event)"
                  matTooltip="+1000 Credits (Shift+Click: +100k)"
                  matTooltipPosition="left">
            <td-icon name="coin" [size]="18"></td-icon>
          </button>
          <button class="td-dev-btn td-dev-btn-health"
                  (click)="addHealth.emit($event)"
                  matTooltip="+1000 HP (Shift+Click: +100k)"
                  matTooltipPosition="left">
            <td-icon name="heart" [size]="18"></td-icon>
          </button>
          <button class="td-dev-btn td-dev-btn-research"
                  (click)="completeAllResearch.emit()"
                  matTooltip="Complete all research"
                  matTooltipPosition="left">
            <td-icon name="flask" [size]="18"></td-icon>
          </button>
          <button class="td-dev-btn td-dev-btn-research"
                  (click)="maxUpgradeAllTowers.emit()"
                  matTooltip="Max-upgrade all towers"
                  matTooltipPosition="left">
            <td-icon name="arrowUp" [size]="18"></td-icon>
          </button>
          <div class="td-dev-separator"></div>
          <!-- Terrain & Map -->
          <button class="td-dev-btn"
                  [class.active]="uiStore.heightDebugVisible()"
                  (click)="heightDebugToggled.emit()"
                  matTooltip="Height markers"
                  matTooltipPosition="left">
            <td-icon name="terrain" [size]="18"></td-icon>
          </button>
          <button class="td-dev-btn"
                  [class.active]="uiStore.specialPointsDebugVisible()"
                  (click)="specialPointsDebugToggled.emit()"
                  matTooltip="Special points"
                  matTooltipPosition="left">
            <td-icon name="pin" [size]="18"></td-icon>
          </button>
          <button class="td-dev-btn"
                  (click)="refreshHeights.emit()"
                  matTooltip="Re-raycast heights"
                  matTooltipPosition="left">
            <td-icon name="refresh" [size]="18"></td-icon>
          </button>
          <div class="td-dev-separator"></div>
          <!-- Camera -->
          <button class="td-dev-btn"
                  [class.active]="debugWindows.cameraWindow().isOpen"
                  (click)="debugWindows.toggle('camera')"
                  matTooltip="Camera info"
                  matTooltipPosition="left">
            <td-icon name="eye" [size]="18"></td-icon>
          </button>
          <button class="td-dev-btn"
                  [class.active]="cameraFramingDebug()"
                  (click)="cameraFramingDebugToggled.emit()"
                  matTooltip="Framing guides"
                  matTooltipPosition="left">
            <td-icon name="fullscreen" [size]="18"></td-icon>
          </button>
          <div class="td-dev-separator"></div>
          <!-- Debug Panels -->
          <button class="td-dev-btn"
                  [class.active]="debugWindows.waveWindow().isOpen"
                  (click)="debugWindows.toggle('wave')"
                  matTooltip="Wave spawner"
                  matTooltipPosition="left">
            <td-icon name="wave" [size]="18"></td-icon>
          </button>
          <button class="td-dev-btn"
                  [class.active]="debugWindows.towerWindow().isOpen"
                  (click)="debugWindows.toggle('tower')"
                  matTooltip="Tower inspector"
                  matTooltipPosition="left">
            <td-icon name="tower" [size]="18"></td-icon>
          </button>
          <button class="td-dev-btn"
                  [class.active]="debugWindows.enemyWindow().isOpen"
                  (click)="debugWindows.toggle('enemy')"
                  matTooltip="Enemy inspector"
                  matTooltipPosition="left">
            <td-icon name="bug" [size]="18"></td-icon>
          </button>
          <button class="td-dev-btn"
                  [class.active]="debugWindows.soundWindow().isOpen"
                  (click)="debugWindows.toggle('sound')"
                  matTooltip="Spatial audio"
                  matTooltipPosition="left">
            <td-icon name="audio" [size]="18"></td-icon>
          </button>
          <button class="td-dev-btn"
                  [class.active]="debugWindows.displayWindow().isOpen"
                  (click)="debugWindows.toggle('display')"
                  matTooltip="Display options"
                  matTooltipPosition="left">
            <td-icon name="sliders" [size]="18"></td-icon>
          </button>
          <button class="td-dev-btn"
                  [class.active]="debugWindows.performanceWindow().isOpen"
                  (click)="debugWindows.toggle('performance')"
                  matTooltip="Performance"
                  matTooltipPosition="left">
            <td-icon name="speed" [size]="18"></td-icon>
          </button>
          <button class="td-dev-btn"
                  [class.active]="debugWindows.eventsWindow().isOpen"
                  (click)="debugWindows.toggle('events')"
                  matTooltip="Event bus"
                  matTooltipPosition="left">
            <td-icon name="share" [size]="18"></td-icon>
          </button>
          <button class="td-dev-btn"
                  [class.active]="debugWindows.trainingWindow().isOpen"
                  (click)="debugWindows.toggle('training')"
                  matTooltip="AI Training"
                  matTooltipPosition="left">
            <td-icon name="bulb" [size]="18"></td-icon>
          </button>
          @if (devWorld.isActive) {
            <button class="td-dev-btn"
                    [class.active]="debugWindows.devworldWindow().isOpen"
                    (click)="debugWindows.toggle('devworld')"
                    matTooltip="DevWorld"
                    matTooltipPosition="left">
              <td-icon name="target" [size]="18"></td-icon>
            </button>
          }
        </div>
        <button class="td-quick-btn td-dev-toggle-btn"
                [class.active]="uiStore.devMenuExpanded()"
                (click)="uiStore.toggleDevMenu()"
                matTooltip="Developer options"
                matTooltipPosition="left">
          <td-icon name="text" [size]="18"></td-icon>
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

    /* === Shared: Accordion wrapper + collapse === */
    .td-layer-menu-wrapper,
    .td-display-menu-wrapper,
    .td-dev-menu-wrapper {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 4px;
    }

    .td-layer-toggles,
    .td-display-toggles,
    .td-dev-menu {
      display: flex;
      flex-direction: column;
      gap: 4px;
      overflow: hidden;
      max-height: 0;
      opacity: 0;
      transition: max-height 0.3s ease-out, opacity 0.15s ease;
    }

    .td-layer-toggles.expanded,
    .td-display-toggles.expanded,
    .td-dev-menu.expanded {
      max-height: 100vh;
      opacity: 1;
    }

    /* === Shared: Icon button base — refined glass + bevel === */
    .td-quick-btn,
    .td-layer-btn,
    .td-display-btn,
    .td-dev-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      min-width: 32px;
      min-height: 32px;
      box-sizing: border-box;
      background: var(--td-glass-tint);
      backdrop-filter: blur(8px) saturate(1.1);
      -webkit-backdrop-filter: blur(8px) saturate(1.1);
      border: 1px solid var(--td-frame-dark);
      box-shadow:
        inset 0 1px 0 rgba(122, 133, 128, 0.2),
        inset 0 -1px 0 var(--td-panel-shadow),
        0 1px 0 rgba(0, 0, 0, 0.6);
      color: var(--td-text-secondary);
      cursor: pointer;
      transition: box-shadow 0.18s ease, background 0.15s, color 0.15s;
    }


    .td-quick-btn:hover,
    .td-layer-btn:hover,
    .td-display-btn:hover,
    .td-dev-btn:hover {
      color: var(--td-text-primary);
      box-shadow:
        inset 0 1px 0 rgba(122, 133, 128, 0.2),
        inset 0 -1px 0 var(--td-panel-shadow),
        0 0 0 1px var(--td-frame-mid),
        0 1px 0 rgba(0, 0, 0, 0.6);
    }

    /* === Active states (teal for display/layer/audio, gold for dev) === */
    .td-quick-btn.active,
    .td-layer-btn.active,
    .td-display-btn.active,
    .td-display-toggle-btn.active,
    .td-audio-toggle-btn.active {
      background: linear-gradient(180deg, var(--td-teal-light) 0%, var(--td-teal) 55%, var(--td-teal-dark) 100%);
      color: #0E1612;
      border-color: #11140F;
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.28),
        inset 0 -1px 0 rgba(0, 0, 0, 0.35),
        var(--td-teal-glow);
    }

    .td-layer-toggle-btn.active {
      background: linear-gradient(180deg, var(--td-gold-light) 0%, var(--td-gold) 55%, var(--td-gold-dark) 100%);
      color: #1A140A;
      border-color: #11140F;
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.28),
        inset 0 -1px 0 rgba(0, 0, 0, 0.35),
        var(--td-gold-glow);
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
      background: var(--td-glass-tint);
      backdrop-filter: blur(8px) saturate(1.1);
      -webkit-backdrop-filter: blur(8px) saturate(1.1);
      border: 1px solid var(--td-frame-dark);
      box-shadow:
        inset 0 1px 0 rgba(122, 133, 128, 0.2),
        inset 0 -1px 0 var(--td-panel-shadow),
        var(--td-shadow-soft);
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


    .td-audio-mute:hover {
      color: var(--td-text-primary);
    }

    .td-audio-mute.muted {
      color: var(--td-health-red);
    }

    .td-dev-btn.active,
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

    .td-dev-btn-research {
      border-color: var(--td-teal);
      color: var(--td-teal);
    }

    .td-dev-btn-research:hover {
      background: var(--td-teal);
      color: var(--td-bg-dark);
    }
  `,
})
export class QuickActionsComponent {
  readonly debugWindows = inject(DebugWindowService);
  readonly uiStore = inject(UIStore);
  readonly devWorld = inject(DevWorldService);
  private readonly debugFacade = inject(DebugFacadeService);

  // Input for camera framing debug state (component-local in parent)
  readonly cameraFramingDebug = input.required<boolean>();

  // Display settings — read from shared signals in DebugFacadeService (single source of truth)
  readonly screenShakeEnabled = this.debugFacade.screenShakeEnabled;
  readonly healthBarsVisible = this.debugFacade.healthBarsVisible;
  readonly damageNumbersVisible = this.debugFacade.damageNumbersVisible;

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
  readonly addCredits = output<MouseEvent>();
  readonly addHealth = output<MouseEvent>();
  readonly completeAllResearch = output<void>();
  readonly maxUpgradeAllTowers = output<void>();

  // Audio outputs
  readonly musicVolumeChanged = output<number>();
  readonly sfxVolumeChanged = output<number>();

  // Computed: any channel muted?
  readonly anyMuted = computed(() => this.uiStore.musicMuted() || this.uiStore.sfxMuted());

  toggleScreenShake(): void {
    this.screenShakeToggled.emit(!this.screenShakeEnabled());
  }

  toggleHealthBars(): void {
    this.healthBarsToggled.emit(!this.healthBarsVisible());
  }

  toggleDamageNumbers(): void {
    this.damageNumbersToggled.emit(!this.damageNumbersVisible());
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
