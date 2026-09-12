import { Component, inject, input, output, computed, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DebugWindowService } from '../../services/debug/debug-window.service';
import { DebugFacadeService, FPS_LIMITS } from '../../services/debug/debug-facade.service';
import { DebugStateDumpService } from '../../services/debug/debug-state-dump.service';
import { UIStore } from '../../store/ui.store';
import { DevWorldService } from '../../devworld/devworld.service';
import { TD_BEVEL_GLASS, TD_CSS_VARS, TD_SCROLLBAR_STYLES, TD_SCROLLBAR_WEBKIT } from '../../styles/td-theme';
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
  template: `
    <div class="td-quick-actions">
      <!-- Route Animation Button -->
      <button class="td-quick-btn route-anim-btn"
              (click)="playRouteAnimation.emit()"
              matTooltip="Play route animation"
              matTooltipPosition="left"
              aria-label="Play route animation">
        <td-icon name="route" [size]="18"></td-icon>
      </button>
      <!-- Display settings (panel opens above its toggle) -->
      <div class="td-display-menu-wrapper">
        <div class="td-display-panel" [class.expanded]="uiStore.displayMenuExpanded()">
          <div class="td-settings-head">
            <span>Effects</span>
            @if (!activePreset()) {
              <span class="td-settings-custom">Custom</span>
            }
          </div>
          <div class="td-segmented" role="group" aria-label="Effect quality">
            @for (preset of presetButtons; track preset.id) {
              <button type="button" class="td-segment"
                      [class.active]="activePreset() === preset.id"
                      [attr.aria-pressed]="activePreset() === preset.id"
                      (click)="debugFacade.onVfxPresetSelected(preset.id)"
                      [matTooltip]="preset.hint" matTooltipPosition="above">{{ preset.label }}</button>
            }
          </div>
          @for (row of effectRows; track row.key) {
            <label class="td-setting-row" [matTooltip]="row.hint" matTooltipPosition="left">
              <input type="checkbox" [checked]="vfx()[row.key]" (change)="toggleVfx(row.key)">
              <span>{{ row.label }}</span>
            </label>
          }
          <label class="td-setting-row td-setting-split"
                 matTooltip="Tints the whole picture, an extra full-screen pass" matTooltipPosition="left">
            <span>Color Grading</span>
            <select class="td-setting-select" (change)="onColorGradingChange($event)">
              @for (preset of colorGradingPresets; track preset.id) {
                <option [value]="preset.id" [selected]="vfx().colorGrading === preset.id">{{ preset.label }}</option>
              }
            </select>
          </label>

          <div class="td-settings-head td-settings-divider">
            <span>General</span>
          </div>
          <label class="td-setting-row" matTooltip="Blue tint and ice sparks on slowed enemies" matTooltipPosition="left">
            <input type="checkbox" [checked]="vfx().freezeTint" (change)="toggleVfx('freezeTint')">
            <span>Freeze Tint</span>
          </label>
          <label class="td-setting-row" matTooltip="Nearby explosions, HQ damage and boss deaths shake the view"
                 matTooltipPosition="left">
            <input type="checkbox" [checked]="screenShakeEnabled()"
                   (change)="debugFacade.onScreenShakeToggled(!screenShakeEnabled())">
            <span>Screen Shake</span>
          </label>
          <label class="td-setting-row">
            <input type="checkbox" [checked]="healthBarsVisible()"
                   (change)="debugFacade.onHealthBarsToggled(!healthBarsVisible())">
            <span>Health Bars</span>
          </label>
          <label class="td-setting-row">
            <input type="checkbox" [checked]="damageNumbersVisible()"
                   (change)="debugFacade.onDamageNumbersToggled(!damageNumbersVisible())">
            <span>Damage Numbers</span>
          </label>
          <div class="td-setting-row td-setting-split">
            <span>Frame Limit</span>
            <div class="td-segmented" role="group" aria-label="Frame limit">
              @for (fps of fpsLimits; track fps) {
                <button type="button" class="td-segment"
                        [class.active]="fpsLimit() === fps"
                        [attr.aria-pressed]="fpsLimit() === fps"
                        (click)="debugFacade.onFpsLimitChanged(fps)">{{ fps === 0 ? 'Off' : fps }}</button>
              }
            </div>
          </div>
        </div>
        <button class="td-quick-btn td-display-toggle-btn"
                [class.active]="uiStore.displayMenuExpanded()"
                (click)="uiStore.toggleDisplayMenu()"
                matTooltip="Display" matTooltipPosition="left"
                aria-label="Display" [attr.aria-expanded]="uiStore.displayMenuExpanded()">
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
                   aria-label="Music volume"
                   [value]="uiStore.musicVolume() * 100"
                   (input)="onMusicSlider($event)">
            <button class="td-audio-mute"
                    [class.muted]="uiStore.musicMuted()"
                    (click)="toggleMusicMute()"
                    matTooltip="Mute music" matTooltipPosition="left"
                    aria-label="Mute music" [attr.aria-pressed]="uiStore.musicMuted()">
              <td-icon [name]="uiStore.musicMuted() ? 'audioOff' : 'audio'" [size]="14"></td-icon>
            </button>
          </div>
          <div class="td-audio-row">
            <td-icon class="td-audio-label" name="sliders" [size]="14"></td-icon>
            <input type="range" class="td-audio-slider"
                   min="0" max="100" step="1"
                   aria-label="Sound effects volume"
                   [value]="uiStore.sfxVolume() * 100"
                   (input)="onSfxSlider($event)">
            <button class="td-audio-mute"
                    [class.muted]="uiStore.sfxMuted()"
                    (click)="toggleSfxMute()"
                    matTooltip="Mute SFX" matTooltipPosition="left"
                    aria-label="Mute SFX" [attr.aria-pressed]="uiStore.sfxMuted()">
              <td-icon [name]="uiStore.sfxMuted() ? 'audioOff' : 'audio'" [size]="14"></td-icon>
            </button>
          </div>
        </div>
        <button class="td-quick-btn td-audio-toggle-btn"
                [class.active]="uiStore.audioMenuExpanded()"
                (click)="uiStore.toggleAudioMenu()"
                matTooltip="Audio" matTooltipPosition="left"
                aria-label="Audio" [attr.aria-expanded]="uiStore.audioMenuExpanded()">
          <td-icon [name]="anyMuted() ? 'audioOff' : 'audio'" [size]="18"></td-icon>
        </button>
      </div>
      <!-- Layer Menu (collapsible, expands upward) -->
      <div class="td-layer-menu-wrapper">
        <div class="td-layer-toggles" [class.expanded]="uiStore.layerMenuExpanded()">
          <button class="td-layer-btn"
                  [class.active]="uiStore.spatialGridDebugVisible()"
                  (click)="spatialGridDebugToggled.emit()"
                  matTooltip="Route Grid Overlay. Fill: grey no tower, green covered. Outline: white cell, orange on the ground under a roof, blue bridge deck, pink no height sample (a tower's LOS view leaves it out). Brighter: centre line"
                  matTooltipPosition="left"
                  aria-label="Route Grid Overlay" [attr.aria-pressed]="uiStore.spatialGridDebugVisible()">
            <td-icon name="grid" [size]="18"></td-icon>
          </button>
          <button class="td-layer-btn"
                  [class.active]="uiStore.buildingsVisible()"
                  (click)="uiStore.toggleBuildings(); buildingsToggled.emit()"
                  matTooltip="Show buildings"
                  matTooltipPosition="left"
                  aria-label="Show buildings" [attr.aria-pressed]="uiStore.buildingsVisible()">
            <td-icon name="tower" [size]="18"></td-icon>
          </button>
          <button class="td-layer-btn"
                  [class.active]="uiStore.streetsVisible()"
                  (click)="uiStore.toggleStreets(); streetsToggled.emit()"
                  matTooltip="Show streets"
                  matTooltipPosition="left"
                  aria-label="Show streets" [attr.aria-pressed]="uiStore.streetsVisible()">
            <td-icon name="route" [size]="18"></td-icon>
          </button>
          <button class="td-layer-btn"
                  [class.active]="uiStore.routesVisible()"
                  (click)="uiStore.toggleRoutes(); routesToggled.emit()"
                  matTooltip="Show routes"
                  matTooltipPosition="left"
                  aria-label="Show routes" [attr.aria-pressed]="uiStore.routesVisible()">
            <td-icon name="chart" [size]="18"></td-icon>
          </button>
          <button class="td-layer-btn"
                  [class.active]="uiStore.airRouteVisible()"
                  (click)="airRouteToggled.emit()"
                  matTooltip="Air-route altitude"
                  matTooltipPosition="left"
                  aria-label="Air-route altitude" [attr.aria-pressed]="uiStore.airRouteVisible()">
            <td-icon name="wind" [size]="18"></td-icon>
          </button>
          <button class="td-layer-btn"
                  [class.active]="uiStore.airSpatialGridDebugVisible()"
                  (click)="airSpatialGridDebugToggled.emit()"
                  matTooltip="Air Route Grid Overlay. Fill: grey no tower, blue covered. Outline as in the Route Grid Overlay"
                  matTooltipPosition="left"
                  aria-label="Air Route Grid Overlay" [attr.aria-pressed]="uiStore.airSpatialGridDebugVisible()">
            <td-icon name="gridAir" [size]="18"></td-icon>
          </button>
          <button class="td-layer-btn td-layer-btn-cycle"
                  (click)="perTowerLosFilterCycled.emit()"
                  [matTooltip]="perTowerLosFilterTooltip()"
                  matTooltipPosition="left"
                  [attr.aria-label]="perTowerLosFilterTooltip()">
            <td-icon [name]="perTowerLosFilterIcon()" [size]="18"></td-icon>
          </button>
        </div>
        <button class="td-quick-btn td-layer-toggle-btn"
                [class.active]="uiStore.layerMenuExpanded()"
                (click)="uiStore.toggleLayerMenu()"
                matTooltip="Layers"
                matTooltipPosition="left"
                aria-label="Layers" [attr.aria-expanded]="uiStore.layerMenuExpanded()">
          <td-icon name="layers" [size]="18"></td-icon>
        </button>
      </div>
      <button class="td-quick-btn" (click)="resetCamera.emit()" matTooltip="Reset camera" matTooltipPosition="left"
              aria-label="Reset camera">
        <td-icon name="target" [size]="18"></td-icon>
      </button>
      <!-- Dev Menu: tile grid in four groups, opens above the quick-actions bar -->
      <div class="td-dev-menu-wrapper">
        <div class="td-dev-menu" [class.expanded]="uiStore.devMenuExpanded()">
          <div class="td-dev-group">Map</div>
          <button class="td-dev-tile"
                  [class.active]="uiStore.heightDebugVisible()"
                  (click)="heightDebugToggled.emit()"
                  matTooltip="Height markers"
                  matTooltipPosition="left"
                  aria-label="Height markers">
            <td-icon name="terrain" [size]="18"></td-icon>
            <span>Height</span>
          </button>
          <button class="td-dev-tile"
                  [class.active]="uiStore.specialPointsDebugVisible()"
                  (click)="specialPointsDebugToggled.emit()"
                  matTooltip="Special points"
                  matTooltipPosition="left"
                  aria-label="Special points">
            <td-icon name="pin" [size]="18"></td-icon>
            <span>Points</span>
          </button>
          <button class="td-dev-tile"
                  (click)="refreshHeights.emit()"
                  matTooltip="Re-raycast heights"
                  matTooltipPosition="left"
                  aria-label="Re-raycast heights">
            <td-icon name="refresh" [size]="18"></td-icon>
            <span>Recast</span>
          </button>
          <!-- State dump: JSON download for bug reports -->
          <button class="td-dev-tile"
                  (click)="debugStateDump.dumpAndDownload()"
                  matTooltip="Download state dump (JSON)"
                  matTooltipPosition="left"
                  aria-label="Download state dump">
            <td-icon name="copy" [size]="18"></td-icon>
            <span>Dump</span>
          </button>

          <div class="td-dev-group">View &amp; Panels</div>
          <button class="td-dev-tile"
                  [class.active]="debugWindows.cameraWindow().isOpen"
                  (click)="debugWindows.toggle('camera')"
                  matTooltip="Camera info"
                  matTooltipPosition="left"
                  aria-label="Camera info">
            <td-icon name="eye" [size]="18"></td-icon>
            <span>Camera</span>
          </button>
          <button class="td-dev-tile"
                  [class.active]="cameraFramingDebug()"
                  (click)="cameraFramingDebugToggled.emit()"
                  matTooltip="Framing guides"
                  matTooltipPosition="left"
                  aria-label="Framing guides">
            <td-icon name="fullscreen" [size]="18"></td-icon>
            <span>Frame</span>
          </button>
          <button class="td-dev-tile"
                  [class.active]="debugWindows.displayWindow().isOpen"
                  (click)="debugWindows.toggle('display')"
                  matTooltip="Display options"
                  matTooltipPosition="left"
                  aria-label="Display options">
            <td-icon name="sliders" [size]="18"></td-icon>
            <span>Display</span>
          </button>
          <button class="td-dev-tile"
                  [class.active]="debugWindows.performanceWindow().isOpen"
                  (click)="debugWindows.toggle('performance')"
                  matTooltip="Performance"
                  matTooltipPosition="left"
                  aria-label="Performance">
            <td-icon name="speed" [size]="18"></td-icon>
            <span>Perf</span>
          </button>
          <button class="td-dev-tile"
                  [class.active]="debugWindows.losWindow().isOpen"
                  (click)="debugWindows.toggle('los')"
                  matTooltip="LOS Cubemap"
                  matTooltipPosition="left"
                  aria-label="LOS Cubemap">
            <td-icon name="layers" [size]="18"></td-icon>
            <span>LOS</span>
          </button>
          <button class="td-dev-tile"
                  [class.active]="debugWindows.soundWindow().isOpen"
                  (click)="debugWindows.toggle('sound')"
                  matTooltip="Spatial audio"
                  matTooltipPosition="left"
                  aria-label="Spatial audio">
            <td-icon name="audio" [size]="18"></td-icon>
            <span>Audio</span>
          </button>
          @if (devWorld.isActive) {
            <button class="td-dev-tile"
                    [class.active]="debugWindows.devworldWindow().isOpen"
                    (click)="debugWindows.toggle('devworld')"
                    matTooltip="DevWorld"
                    matTooltipPosition="left"
                    aria-label="DevWorld">
              <td-icon name="target" [size]="18"></td-icon>
              <span>DevWorld</span>
            </button>
          }

          <div class="td-dev-group">Cheats</div>
          <button class="td-dev-tile td-dev-cheat td-dev-cheat-danger"
                  (click)="killAllEnemies.emit()"
                  matTooltip="Kill all enemies"
                  matTooltipPosition="left"
                  aria-label="Kill all enemies">
            <td-icon name="skull" [size]="18"></td-icon>
            <span>Kill</span>
          </button>
          <button class="td-dev-tile td-dev-cheat td-dev-cheat-credits"
                  (click)="addCredits.emit($event)"
                  matTooltip="+1000 Credits (Shift+Click: +100k)"
                  matTooltipPosition="left"
                  aria-label="Add 1000 credits">
            <td-icon name="coin" [size]="18"></td-icon>
            <span>Credits</span>
          </button>
          <button class="td-dev-tile td-dev-cheat td-dev-cheat-health"
                  (click)="addHealth.emit($event)"
                  matTooltip="+1000 HP (Shift+Click: +100k)"
                  matTooltipPosition="left"
                  aria-label="Add 1000 HP">
            <td-icon name="heart" [size]="18"></td-icon>
            <span>+HP</span>
          </button>
          <button class="td-dev-tile td-dev-cheat td-dev-cheat-research"
                  (click)="completeAllResearch.emit()"
                  matTooltip="Complete all research"
                  matTooltipPosition="left"
                  aria-label="Complete all research">
            <td-icon name="flask" [size]="18"></td-icon>
            <span>Research</span>
          </button>
          <button class="td-dev-tile td-dev-cheat td-dev-cheat-research"
                  (click)="maxUpgradeAllTowers.emit()"
                  matTooltip="Max-upgrade all towers"
                  matTooltipPosition="left"
                  aria-label="Max-upgrade all towers">
            <td-icon name="arrowUp" [size]="18"></td-icon>
            <span>Max Up</span>
          </button>

          <div class="td-dev-group">Waves &amp; Inspect</div>
          <button class="td-dev-tile"
                  [class.active]="debugWindows.waveWindow().isOpen"
                  (click)="debugWindows.toggle('wave')"
                  matTooltip="Wave spawner"
                  matTooltipPosition="left"
                  aria-label="Wave spawner">
            <td-icon name="wave" [size]="18"></td-icon>
            <span>Waves</span>
          </button>
          <button class="td-dev-tile"
                  [class.active]="useStaticCurriculum()"
                  (click)="staticCurriculumToggled.emit()"
                  matTooltip="Static curriculum waves (AI-off fallback)"
                  matTooltipPosition="left"
                  aria-label="Static curriculum waves">
            <td-icon name="filing" [size]="18"></td-icon>
            <span>Static</span>
          </button>
          <button class="td-dev-tile"
                  [class.active]="debugWindows.trainingWindow().isOpen"
                  (click)="debugWindows.toggle('training')"
                  matTooltip="AI Training"
                  matTooltipPosition="left"
                  aria-label="AI Training">
            <td-icon name="bulb" [size]="18"></td-icon>
            <span>AI</span>
          </button>
          <button class="td-dev-tile"
                  [class.active]="debugWindows.towerWindow().isOpen"
                  (click)="debugWindows.toggle('tower')"
                  matTooltip="Tower inspector"
                  matTooltipPosition="left"
                  aria-label="Tower inspector">
            <td-icon name="tower" [size]="18"></td-icon>
            <span>Towers</span>
          </button>
          <button class="td-dev-tile"
                  [class.active]="debugWindows.enemyWindow().isOpen"
                  (click)="debugWindows.toggle('enemy')"
                  matTooltip="Enemy inspector"
                  matTooltipPosition="left"
                  aria-label="Enemy inspector">
            <td-icon name="bug" [size]="18"></td-icon>
            <span>Enemies</span>
          </button>
          <button class="td-dev-tile"
                  [class.active]="debugWindows.eventsWindow().isOpen"
                  (click)="debugWindows.toggle('events')"
                  matTooltip="Event bus"
                  matTooltipPosition="left"
                  aria-label="Event bus">
            <td-icon name="share" [size]="18"></td-icon>
            <span>Events</span>
          </button>
        </div>
        <button class="td-quick-btn td-dev-toggle-btn"
                [class.active]="uiStore.devMenuExpanded()"
                (click)="uiStore.toggleDevMenu()"
                matTooltip="Developer options"
                matTooltipPosition="left"
                aria-label="Developer options" [attr.aria-expanded]="uiStore.devMenuExpanded()">
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
      /* Spans from below the compass (top 12px + 88px + clearance) to the
         bottom edge, so the dev menu can cap its height against it and never
         grows into the compass. The buttons sit at the bottom; the empty area
         above them must not eat map drags/clicks. */
      top: 112px;
      bottom: 36px;
      right: 8px;
      display: flex;
      align-items: flex-end;
      gap: 4px;
      z-index: 5;
      pointer-events: none;
    }

    .td-quick-actions > * {
      flex-shrink: 0;
      pointer-events: auto;
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

    /* === Shared: Icon button base — refined glass + bevel === */
    .td-quick-btn,
    .td-layer-btn {
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
    .td-layer-btn:hover {
      color: var(--td-text-primary);
      box-shadow:
        inset 0 1px 0 rgba(122, 133, 128, 0.2),
        inset 0 -1px 0 var(--td-panel-shadow),
        0 0 0 1px var(--td-frame-mid),
        0 1px 0 rgba(0, 0, 0, 0.6);
    }

    /* === Active states (teal for display/layer/audio, gold for the layers
       and dev toggles) === */
    .td-quick-btn.active,
    .td-layer-btn.active,
    .td-segment.active,
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

    .td-layer-toggle-btn.active,
    .td-dev-toggle-btn.active {
      background: linear-gradient(180deg, var(--td-gold-light) 0%, var(--td-gold) 55%, var(--td-gold-dark) 100%);
      color: #1A140A;
      border-color: #11140F;
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.28),
        inset 0 -1px 0 rgba(0, 0, 0, 0.35),
        var(--td-gold-glow);
    }

    /* === Display panel: settings above the display toggle ===
       Out of flow like the dev menu, so it does not push the other buttons
       aside. The wrapper stretches over the whole quick-actions height and
       caps the panel against the compass; on short windows the panel
       scrolls. The wrapper itself lets map drags and clicks through. */
    .td-quick-actions > .td-display-menu-wrapper {
      position: relative;
      align-self: stretch;
      justify-content: flex-end;
      pointer-events: none;
    }

    .td-display-menu-wrapper > * {
      pointer-events: auto;
    }

    .td-display-panel {
      position: absolute;
      right: 0;
      bottom: 36px;
      max-height: calc(100% - 36px);
      width: 212px;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 10px;
      overflow-y: auto;
      background: var(--td-glass-tint);
      backdrop-filter: blur(8px) saturate(1.1);
      -webkit-backdrop-filter: blur(8px) saturate(1.1);
      border: 1px solid var(--td-frame-dark);
      box-shadow:
        inset 0 1px 0 rgba(122, 133, 128, 0.2),
        inset 0 -1px 0 var(--td-panel-shadow),
        var(--td-shadow-soft);
      font-family: var(--td-font-mono);
      font-size: 12px;
      color: var(--td-text-secondary);
      opacity: 0;
      visibility: hidden;
      transform: translateY(8px);
      transition: opacity 0.15s ease, transform 0.15s ease, visibility 0s linear 0.15s;
      ${TD_SCROLLBAR_STYLES}
    }

    .td-display-panel.expanded {
      opacity: 1;
      visibility: visible;
      transform: none;
      transition: opacity 0.15s ease, transform 0.15s ease, visibility 0s;
    }

    .td-settings-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: var(--td-text-tertiary);
    }

    .td-settings-divider {
      border-top: 1px solid var(--td-frame-dark);
      padding-top: 8px;
      margin-top: 4px;
    }

    .td-settings-custom {
      color: var(--td-text-muted);
    }

    .td-setting-row {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 20px;
      white-space: nowrap;
      cursor: pointer;
    }

    .td-setting-row:hover {
      color: var(--td-text-primary);
    }

    .td-setting-row input[type="checkbox"] {
      width: 14px;
      height: 14px;
      margin: 0;
      cursor: pointer;
      accent-color: var(--td-teal);
    }

    .td-setting-split {
      justify-content: space-between;
      cursor: default;
    }

    .td-setting-select {
      background: var(--td-panel-secondary);
      color: var(--td-text-primary);
      border: 1px solid var(--td-frame-dark);
      border-top-color: var(--td-panel-shadow);
      padding: 2px 4px;
      font-family: inherit;
      font-size: 11px;
      cursor: pointer;
    }

    .td-setting-select:hover {
      border-color: var(--td-frame-mid);
    }

    .td-setting-select:focus-visible {
      outline: 1px solid var(--td-teal);
      outline-offset: 1px;
    }

    .td-segmented {
      display: flex;
    }

    .td-segment {
      flex: 1;
      height: 22px;
      padding: 0 6px;
      font-family: inherit;
      font-size: 11px;
      font-weight: 600;
      color: var(--td-text-secondary);
      background: var(--td-panel-secondary);
      border: 1px solid var(--td-frame-dark);
      cursor: pointer;
    }

    .td-segment + .td-segment {
      border-left: none;
    }

    .td-segment:hover {
      color: var(--td-text-primary);
    }

    .td-segment:focus-visible {
      outline: 1px solid var(--td-teal-light);
      outline-offset: -2px;
    }

    .td-setting-split .td-segment {
      flex: 0 0 auto;
      min-width: 32px;
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

    .route-anim-btn {
      border-color: var(--td-warn-orange);
      color: var(--td-warn-orange);
    }

    .route-anim-btn:hover {
      background: var(--td-warn-orange);
      color: var(--td-bg-dark);
    }

    /* === Dev menu: tile grid above the quick-actions bar ===
       Glass panel as wide as the bar (6 x 32px + 5 x 4px), right-aligned
       over it, bottom edge 4px above the buttons. Its containing block is
       .td-quick-actions (the wrapper is not positioned). Out of flow like the
       display panel, so it does not push the other buttons aside. Capped at
       the free height between bar and compass; on short windows it scrolls
       instead of overlapping. Four columns, group titles span the row. */
    .td-dev-menu {
      position: absolute;
      right: 0;
      bottom: 36px;
      max-height: calc(100% - 36px);
      width: 212px;
      box-sizing: border-box;
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 4px;
      padding: 6px;
      overflow-x: hidden;
      overflow-y: auto;
      ${TD_BEVEL_GLASS}
      font-family: var(--td-font-mono);
      opacity: 0;
      visibility: hidden;
      transform: translateY(8px);
      transition: opacity 0.15s ease, transform 0.15s ease, visibility 0s linear 0.15s;
      ${TD_SCROLLBAR_STYLES}
    }

    .td-dev-menu.expanded {
      opacity: 1;
      visibility: visible;
      transform: none;
      transition: opacity 0.15s ease, transform 0.15s ease, visibility 0s;
    }

    .td-dev-menu::-webkit-scrollbar,
    .td-display-panel::-webkit-scrollbar {
      ${TD_SCROLLBAR_WEBKIT.scrollbar}
    }

    .td-dev-menu::-webkit-scrollbar-track,
    .td-display-panel::-webkit-scrollbar-track {
      ${TD_SCROLLBAR_WEBKIT.track}
    }

    .td-dev-menu::-webkit-scrollbar-thumb,
    .td-display-panel::-webkit-scrollbar-thumb {
      ${TD_SCROLLBAR_WEBKIT.thumb}
    }

    .td-dev-group {
      grid-column: 1 / -1;
      margin: 4px 2px 0;
      font-size: 8px;
      font-weight: 600;
      line-height: 10px;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--td-text-muted);
    }

    .td-dev-group:first-child {
      margin-top: 2px;
    }

    /* Tile: icon over a short caption. The longest captions (DEVWORLD,
       RESEARCH) measure about 39px in the monospace fallback, the tile is
       44.5px wide inside. */
    .td-dev-tile {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 3px;
      height: 44px;
      min-width: 0;
      padding: 0;
      box-sizing: border-box;
      background: rgba(11, 15, 12, 0.6);
      border: 1px solid var(--td-frame-dark);
      box-shadow: inset 0 1px 0 rgba(122, 133, 128, 0.14);
      color: var(--td-text-secondary);
      font-family: inherit;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s, color 0.15s;
    }

    .td-dev-tile span {
      font-size: 8px;
      line-height: 10px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      white-space: nowrap;
    }

    .td-dev-tile:hover {
      border-color: var(--td-frame-mid);
      color: var(--td-text-primary);
    }

    /* Window open or switch on */
    .td-dev-tile.active {
      background: rgba(194, 160, 85, 0.16);
      border-color: var(--td-gold-dark);
      box-shadow: inset 0 1px 0 rgba(217, 188, 104, 0.18);
      color: var(--td-gold-light);
    }

    /* Cheats: one-shot actions without an active state, coloured by what
       they touch. Hover keeps the colour and draws the border in it. */
    .td-dev-cheat,
    .td-dev-cheat:hover {
      color: var(--cheat-color);
    }

    .td-dev-cheat:hover {
      border-color: var(--cheat-color);
    }

    .td-dev-cheat-danger,
    .td-dev-cheat-health {
      --cheat-color: var(--td-health-red);
    }

    .td-dev-cheat-credits {
      --cheat-color: var(--td-gold);
    }

    .td-dev-cheat-research {
      --cheat-color: var(--td-teal);
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
