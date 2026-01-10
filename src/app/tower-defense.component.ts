import {
  Component,
  OnInit,
  OnDestroy,
  AfterViewInit,
  ElementRef,
  ViewChild,
  ViewChildren,
  QueryList,
  signal,
  inject,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef, MatDialog } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ConfigService } from './core/services/config.service';
import { OsmStreetService, Street, StreetNetwork } from './services/osm-street.service';
import { EntityPoolService } from './services/entity-pool.service';
import { ModelPreviewService } from './services/model-preview.service';
import { GeoPosition } from './models/game.types';
import { EnemyTypeId, getAllEnemyTypes, getEnemyType, EnemyTypeConfig } from './models/enemy-types';
import { DebugPanelComponent } from './components/debug-panel.component';
import { LocationDialogComponent } from './components/location-dialog/location-dialog.component';
import { LocationDialogData, LocationDialogResult, LocationConfig, SpawnLocationConfig } from './models/location.types';
import { GeocodingService } from './services/geocoding.service';
// Refactoring services
import { GameUIStateService } from './services/game-ui-state.service';
import { CameraControlService } from './services/camera-control.service';
import { MarkerVisualizationService, SpawnPoint } from './services/marker-visualization.service';
import { PathAndRouteService } from './services/path-route.service';
import { InputHandlerService } from './services/input-handler.service';
import { TowerPlacementService } from './services/tower-placement.service';
import { LocationManagementService } from './services/location-management.service';
import { HeightUpdateService } from './services/height-update.service';
import { EngineInitializationService } from './services/engine-initialization.service';
import { CameraFramingService, GeoPoint } from './services/camera-framing.service';
// New OO Game Engine imports
import { GameStateManager } from './managers/game-state.manager';
import { EnemyManager } from './managers/enemy.manager';
import { TowerManager } from './managers/tower.manager';
import { ProjectileManager } from './managers/projectile.manager';
import { WaveManager, SpawnPoint as WaveSpawnPoint } from './managers/wave.manager';
// Three.js Engine (new 3DTilesRendererJS-based)
import { ThreeTilesEngine } from './three-engine';
import * as THREE from 'three';
// Theme
import { TD_CSS_VARS } from './styles/td-theme';
// Tower config
import { TOWER_TYPES, getAllTowerTypes, TowerTypeConfig, TowerTypeId, UpgradeId } from './configs/tower-types.config';
import { Tower } from './entities/tower.entity';

// Default locations - can be overridden via debug settings
const DEFAULT_CENTER_COORDS = {
  latitude: 49.1726836,
  longitude: 9.2703122,
  height: 400,
};

const DEFAULT_BASE_COORDS = {
  latitude: 49.17326887448299,
  longitude: 9.268588397188681,
};

const DEFAULT_SPAWN_POINTS = [
  {
    id: 'spawn-north',
    name: 'Nord',
    latitude: 49.17554723547113,
    longitude: 9.263870533891945,
  },
  // {
  //   id: 'spawn-south',
  //   name: 'Sued',
  //   latitude: 49.17000237788718,
  //   longitude: 9.266037019764674,
  // },
];

const LOCATION_STORAGE_KEY = 'td_custom_locations_v1';

@Component({
  selector: 'app-tower-defense',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    DebugPanelComponent,
  ],
  providers: [
    GameStateManager,
    EnemyManager,
    TowerManager,
    ProjectileManager,
    WaveManager,
    EntityPoolService,
    ModelPreviewService,
  ],
  template: `
    <div class="td-container" [class.td-fullscreen]="!isDialog">
      <!-- Info Header -->
      <header class="td-header">
        <div class="td-header-left">
          <mat-icon class="td-title-icon">cell_tower</mat-icon>
          <h2 class="td-title">3DTD</h2>
          <button class="td-location-btn" (click)="openLocationDialog()" matTooltip="Spielort ändern">
            <span class="td-location-name">{{ currentLocationName() }}</span>
            <mat-icon class="td-location-edit">edit</mat-icon>
          </button>
        </div>
        <div class="td-header-stats">
          <div class="td-stat hp">
            <mat-icon>favorite</mat-icon>
            <span>{{ gameState.baseHealth() }}</span>
          </div>
          <div class="td-stat credits">
            <mat-icon>paid</mat-icon>
            <span>{{ gameState.credits() }}</span>
          </div>
          <div class="td-stat wave">
            <mat-icon>waves</mat-icon>
            <span>{{ gameState.waveNumber() }}</span>
          </div>
          @if (waveActive()) {
            <div class="td-stat enemies">
              <mat-icon>pest_control</mat-icon>
              <span>{{ gameState.enemiesAlive() }}</span>
            </div>
          }
          <div class="td-stat fps">
            <span>{{ fps() }} FPS</span>
          </div>
          <div class="td-stat tiles">
            <span>{{ tileStats().visible }}/{{ tileStats().total }} Tiles</span>
          </div>
        </div>
        @if (isDialog) {
          <button class="td-close-btn" (click)="close()" matTooltip="Schliessen">
            <mat-icon>close</mat-icon>
          </button>
        }
      </header>

      <!-- Main Content: Canvas + Sidebar -->
      <div class="td-main">
        <!-- Canvas Area -->
        <div class="td-canvas-area">
          @if (loading()) {
            <div class="td-loading-overlay">
              <mat-spinner diameter="48"></mat-spinner>
              <div class="td-loading-title">Lade 3DTD</div>
              <div class="td-loading-steps">
                @for (step of loadingSteps(); track step.id) {
                  <div class="td-loading-step" [class.active]="step.status === 'active'" [class.done]="step.status === 'done'">
                    <mat-icon class="td-step-icon">
                      @if (step.status === 'done') {
                        check_circle
                      } @else if (step.status === 'active') {
                        sync
                      } @else {
                        radio_button_unchecked
                      }
                    </mat-icon>
                    <span class="td-step-label">{{ step.label }}</span>
                    @if (step.detail) {
                      <span class="td-step-detail">({{ step.detail }})</span>
                    }
                  </div>
                }
              </div>
            </div>
          }

          @if (error()) {
            <div class="td-error-overlay">
              <mat-icon class="td-error-icon">error_outline</mat-icon>
              <h3>Fehler</h3>
              <p>{{ error() }}</p>
              <div class="td-token-instructions">
                <p>1. Erstelle ein Projekt in der <a href="https://console.cloud.google.com/" target="_blank">Google Cloud Console</a></p>
                <p>2. Aktiviere die <strong>Map Tiles API</strong></p>
                <p>3. Erstelle einen API Key und trage ihn in <code>appsettings.json</code> ein:</p>
                <pre>"GoogleMapsApiKey": "dein-api-key"</pre>
              </div>
              <button class="td-btn td-btn-gold" (click)="close()">Schliessen</button>
            </div>
          }

          <canvas #gameCanvas class="td-canvas" [class.hidden]="error()"></canvas>

          <!-- Google Attribution (required) -->
          @if (!loading() && !error()) {
            <div class="td-google-logo-container">
              <img src="/assets/images/google-maps-logo.svg" alt="Google Maps" class="td-google-logo">
            </div>
            <div class="td-map-attribution">{{ mapAttribution() }}</div>

            <!-- Compass Overlay -->
            <div class="td-compass-container">
              <div class="td-compass" [style.transform]="'rotate(' + (-compassRotation()) + 'deg)'">
                <svg class="td-compass-svg" viewBox="0 0 64 64">
                  <!-- Background -->
                  <circle cx="32" cy="32" r="30" class="td-compass-bg"/>
                  <!-- Outer ring -->
                  <circle cx="32" cy="32" r="30" class="td-compass-ring"/>
                  <!-- Inner ring -->
                  <circle cx="32" cy="32" r="22" class="td-compass-inner-ring"/>
                  <!-- Major tick marks (N, E, S, W) -->
                  <line x1="32" y1="3" x2="32" y2="10" class="td-compass-tick major" transform="rotate(0 32 32)"/>
                  <line x1="32" y1="3" x2="32" y2="10" class="td-compass-tick major" transform="rotate(90 32 32)"/>
                  <line x1="32" y1="3" x2="32" y2="10" class="td-compass-tick major" transform="rotate(180 32 32)"/>
                  <line x1="32" y1="3" x2="32" y2="10" class="td-compass-tick major" transform="rotate(270 32 32)"/>
                  <!-- Minor tick marks (NE, SE, SW, NW) -->
                  <line x1="32" y1="4" x2="32" y2="8" class="td-compass-tick minor" transform="rotate(45 32 32)"/>
                  <line x1="32" y1="4" x2="32" y2="8" class="td-compass-tick minor" transform="rotate(135 32 32)"/>
                  <line x1="32" y1="4" x2="32" y2="8" class="td-compass-tick minor" transform="rotate(225 32 32)"/>
                  <line x1="32" y1="4" x2="32" y2="8" class="td-compass-tick minor" transform="rotate(315 32 32)"/>
                  <!-- North needle (red) -->
                  <path d="M32 10 L28 32 L32 28 L36 32 Z" class="td-compass-needle-n"/>
                  <!-- South needle (dark) -->
                  <path d="M32 54 L28 32 L32 36 L36 32 Z" class="td-compass-needle-s"/>
                  <!-- Center pivot -->
                  <circle cx="32" cy="32" r="5" class="td-compass-pivot"/>
                  <circle cx="32" cy="32" r="3" class="td-compass-pivot-inner"/>
                </svg>
                <!-- Cardinal direction labels -->
                <span class="td-compass-label td-compass-n">N</span>
                <span class="td-compass-label td-compass-e">O</span>
                <span class="td-compass-label td-compass-s">S</span>
                <span class="td-compass-label td-compass-w">W</span>
              </div>
              <!-- Debug: show heading value -->
              <div class="td-compass-heading-debug">{{ cameraHeading() }}°</div>
            </div>

            <!-- Camera Debug Overlay -->
            @if (cameraDebugEnabled() && cameraDebugInfo(); as cam) {
              <div class="td-camera-debug">
                <div class="td-camera-debug-title">
                  <mat-icon>videocam</mat-icon>
                  <span>Kamera</span>
                </div>
                <div class="td-camera-debug-section">
                  <span class="td-camera-debug-label">Position</span>
                  <div class="td-camera-debug-row">
                    <span class="td-camera-debug-key">X:</span>
                    <span class="td-camera-debug-value">{{ cam.posX | number:'1.0-0' }}m</span>
                  </div>
                  <div class="td-camera-debug-row">
                    <span class="td-camera-debug-key">Y:</span>
                    <span class="td-camera-debug-value">{{ cam.posY | number:'1.0-0' }}m</span>
                  </div>
                  <div class="td-camera-debug-row">
                    <span class="td-camera-debug-key">Z:</span>
                    <span class="td-camera-debug-value">{{ cam.posZ | number:'1.0-0' }}m</span>
                  </div>
                </div>
                <div class="td-camera-debug-section">
                  <span class="td-camera-debug-label">Winkel</span>
                  <div class="td-camera-debug-row">
                    <span class="td-camera-debug-key">Heading:</span>
                    <span class="td-camera-debug-value">{{ cam.heading | number:'1.0-0' }}°</span>
                  </div>
                  <div class="td-camera-debug-row">
                    <span class="td-camera-debug-key">Pitch:</span>
                    <span class="td-camera-debug-value">{{ cam.pitch | number:'1.1-1' }}°</span>
                  </div>
                </div>
                <div class="td-camera-debug-section">
                  <span class="td-camera-debug-label">Abstand</span>
                  <div class="td-camera-debug-row">
                    <span class="td-camera-debug-key">Höhe:</span>
                    <span class="td-camera-debug-value">{{ cam.altitude | number:'1.0-0' }}m</span>
                  </div>
                  <div class="td-camera-debug-row">
                    <span class="td-camera-debug-key">Distanz:</span>
                    <span class="td-camera-debug-value">{{ cam.distanceToCenter | number:'1.0-0' }}m</span>
                  </div>
                  <div class="td-camera-debug-row">
                    <span class="td-camera-debug-key">Terrain:</span>
                    <span class="td-camera-debug-value">{{ cam.terrainHeight | number:'1.0-0' }}m</span>
                  </div>
                </div>
                <div class="td-camera-debug-section">
                  <span class="td-camera-debug-label">Optik</span>
                  <div class="td-camera-debug-row">
                    <span class="td-camera-debug-key">FOV:</span>
                    <span class="td-camera-debug-value">{{ cam.fov | number:'1.0-0' }}°</span>
                  </div>
                </div>
              </div>
            }
          }

          <!-- Controls Hint -->
          @if (!loading() && !error()) {
            <div class="td-controls-hint">LMB: Pan | RMB: Rotate | Scroll: Zoom</div>

            <!-- Quick Actions (bottom right) -->
            <div class="td-quick-actions">
              <!-- Layer Toggles (collapsible) -->
              <div class="td-layer-toggles" [class.expanded]="layerMenuExpanded()">
                <button class="td-layer-btn"
                        [class.active]="streetsVisible()"
                        (click)="toggleStreets()"
                        matTooltip="Strassen anzeigen"
                        matTooltipPosition="left">
                  <mat-icon>route</mat-icon>
                </button>
                <button class="td-layer-btn"
                        [class.active]="routesVisible()"
                        (click)="toggleRoutes()"
                        matTooltip="Routen anzeigen"
                        matTooltipPosition="left">
                  <mat-icon>timeline</mat-icon>
                </button>
                <button class="td-layer-btn"
                        [class.active]="towerDebugVisible()"
                        (click)="toggleTowerDebug()"
                        matTooltip="Tower-Schusshoehe anzeigen"
                        matTooltipPosition="left">
                  <mat-icon>gps_fixed</mat-icon>
                </button>
                <button class="td-layer-btn"
                        [class.active]="heightDebugVisible()"
                        (click)="toggleHeightDebug()"
                        matTooltip="Terrain-Hoehen debuggen"
                        matTooltipPosition="left">
                  <mat-icon>terrain</mat-icon>
                </button>
              </div>
              <button class="td-quick-btn td-layer-toggle-btn"
                      [class.active]="layerMenuExpanded()"
                      (click)="toggleLayerMenu()"
                      matTooltip="Ebenen"
                      matTooltipPosition="left">
                <mat-icon>{{ layerMenuExpanded() ? 'layers_clear' : 'layers' }}</mat-icon>
              </button>
              <button class="td-quick-btn" (click)="resetCamera()" matTooltip="Kamera zuruecksetzen" matTooltipPosition="left">
                <mat-icon>my_location</mat-icon>
              </button>
              <!-- Dev Menu (expands right and up) -->
              <div class="td-dev-menu-wrapper">
                <div class="td-dev-menu" [class.expanded]="devMenuExpanded()">
                  <button class="td-dev-btn"
                          [class.active]="debugMode()"
                          (click)="toggleDebug()"
                          matTooltip="Wave-Debug-Panel"
                          matTooltipPosition="left">
                    <mat-icon>timeline</mat-icon>
                  </button>
                  <button class="td-dev-btn"
                          [class.active]="cameraDebugEnabled()"
                          (click)="toggleCameraDebug()"
                          matTooltip="Kamera-Debug-Overlay"
                          matTooltipPosition="left">
                    <mat-icon>videocam</mat-icon>
                  </button>
                  <button class="td-dev-btn"
                          [class.active]="cameraFramingDebug()"
                          (click)="toggleCameraFramingDebug()"
                          matTooltip="Kamera-Framing Debug"
                          matTooltipPosition="left">
                    <mat-icon>crop_free</mat-icon>
                  </button>
                  <button class="td-dev-btn"
                          (click)="resetToDefaultLocation()"
                          matTooltip="Default-Ort laden"
                          matTooltipPosition="left">
                    <mat-icon>home</mat-icon>
                  </button>
                </div>
                <button class="td-quick-btn td-dev-toggle-btn"
                        [class.active]="devMenuExpanded()"
                        (click)="toggleDevMenu()"
                        matTooltip="Entwickler-Optionen"
                        matTooltipPosition="left">
                  <mat-icon>{{ devMenuExpanded() ? 'code_off' : 'code' }}</mat-icon>
                </button>
              </div>
            </div>
          }

          <!-- Gathering Overlay -->
          @if (gatheringPhase()) {
            <div class="td-gathering-overlay">
              <mat-icon>groups</mat-icon>
              <span>Gegner sammeln sich...</span>
            </div>
          }

          <!-- Game Over Overlay -->
          @if (gameState.showGameOverScreen()) {
            <div class="td-gameover-overlay">
              <div class="td-gameover-content">
                <h1>GAME OVER</h1>
                <p>Das HQ wurde zerstoert!</p>
                <button class="td-btn td-btn-green" (click)="restartGame()">
                  <mat-icon>replay</mat-icon>
                  NEUSTART
                </button>
              </div>
            </div>
          }
        </div>

        <!-- Right Sidebar with WC3 Frame -->
        <aside class="td-sidebar">
          <div class="td-sidebar-frame-top"></div>
          <div class="td-sidebar-frame-middle"></div>
          <div class="td-sidebar-frame-bottom"></div>
          <div class="td-sidebar-content">

          <!-- WAVE Section -->
          <section class="td-panel">
            <div class="td-panel-header">WELLE {{ gameState.waveNumber() }}</div>
            <div class="td-panel-content td-wave-section">
              <div class="td-wave-info">
                <div class="td-enemy-preview-container">
                  <canvas #enemyPreviewCanvas class="td-enemy-preview-canvas" width="72" height="72"></canvas>
                </div>
                <div class="td-wave-stats">
                  <div class="td-enemy-name">{{ currentEnemyConfig().name }}</div>
                  <div class="td-stat-row">
                    <span class="td-stat-label">HP</span>
                    <span class="td-stat-value">{{ currentEnemyConfig().baseHp }}</span>
                  </div>
                  <div class="td-stat-row">
                    <span class="td-stat-label">Gegner</span>
                    <span class="td-stat-value">{{ gameState.enemiesAlive() }}</span>
                  </div>
                </div>
              </div>
              <button class="td-action-btn td-btn-green td-wave-btn" (click)="startWave()"
                      [disabled]="waveActive() || buildMode() || isGameOver()">
                <mat-icon>{{ waveActive() ? 'hourglass_empty' : 'play_arrow' }}</mat-icon>
                <span>{{ waveActive() ? 'Welle laeuft...' : 'Naechste Welle' }}</span>
              </button>
            </div>
          </section>

          <!-- BUILD Section -->
          <section class="td-panel">
            <div class="td-panel-header">BAUEN</div>
            <div class="td-panel-content td-build-section">
              @if (buildMode()) {
                <div class="td-build-hint">Klicke neben Strasse</div>
                <button class="td-action-btn td-cancel-btn" (click)="toggleBuildMode()">
                  <mat-icon>close</mat-icon>
                  <span>Abbrechen</span>
                </button>
              } @else {
                <div class="td-tower-grid">
                  @for (tower of towerTypes; track tower.id) {
                    <button class="td-tower-card"
                            [class.disabled]="gameState.credits() < tower.cost"
                            [disabled]="isGameOver() || gameState.credits() < tower.cost"
                            (click)="selectTowerType(tower.id)"
                            [matTooltip]="tower.damage + ' DMG | ' + tower.range + 'm | ' + tower.fireRate + '/s'">
                      <canvas #towerPreviewCanvas
                              class="td-tower-preview-canvas"
                              [attr.data-tower-id]="tower.id"
                              width="120"
                              height="70"></canvas>
                      <span class="td-tower-card-name">{{ tower.name }}</span>
                      <span class="td-tower-card-cost">{{ tower.cost }}</span>
                    </button>
                  }
                </div>
              }
            </div>
          </section>

          <!-- TOWER Section (only when tower selected) -->
          @if (gameState.selectedTower(); as tower) {
            <section class="td-panel td-tower-panel">
              <div class="td-panel-header">{{ tower.typeConfig.name | uppercase }}</div>
              <div class="td-panel-content td-tower-section">
                <div class="td-tower-stats">
                  <div class="td-stat-row">
                    <span class="td-stat-label">Schaden</span>
                    <span class="td-stat-value td-damage">{{ tower.combat.damage }}</span>
                  </div>
                  <div class="td-stat-row">
                    <span class="td-stat-label">Reichweite</span>
                    <span class="td-stat-value">{{ tower.combat.range }}m</span>
                  </div>
                  <div class="td-stat-row">
                    <span class="td-stat-label">Feuerrate</span>
                    <span class="td-stat-value">{{ tower.combat.fireRate }}/s</span>
                  </div>
                  <div class="td-stat-row">
                    <span class="td-stat-label">Kills</span>
                    <span class="td-stat-value td-kills">{{ tower.combat.kills }}</span>
                  </div>
                </div>

                <!-- Upgrades Section -->
                @if (tower.getAvailableUpgrades().length > 0) {
                  <div class="td-upgrades-section">
                    <div class="td-upgrades-title">UPGRADES</div>
                    @for (upgrade of tower.getAvailableUpgrades(); track upgrade.id) {
                      <button
                        class="td-upgrade-btn"
                        [class.td-upgrade-affordable]="gameState.credits() >= upgrade.cost"
                        [disabled]="gameState.credits() < upgrade.cost"
                        (click)="upgradeTower(tower, upgrade.id)"
                        [matTooltip]="upgrade.description"
                      >
                        <mat-icon>bolt</mat-icon>
                        <span class="td-upgrade-name">{{ upgrade.name }}</span>
                        <span class="td-upgrade-cost">{{ upgrade.cost }}</span>
                      </button>
                    }
                  </div>
                }

                <div class="td-tower-actions">
                  <button class="td-action-btn td-btn-sell" (click)="sellSelectedTower()">
                    <mat-icon>sell</mat-icon>
                    <span>Verkaufen</span>
                    <span class="td-cost td-refund">+{{ tower.typeConfig.sellValue }}</span>
                  </button>
                </div>
              </div>
            </section>
          }

          <!-- Debug Section (collapsible) -->
          @if (debugMode()) {
            <section class="td-panel td-debug-panel">
              <div class="td-panel-header">DEBUG</div>
              <div class="td-panel-content">
                <app-td-debug-panel
                  [streetCount]="streetCount()"
                  [enemyCount]="enemyCount()"
                  [enemySpeed]="enemySpeed()"
                  [enemyType]="enemyType()"
                  [enemyTypes]="enemyTypes"
                  [spawnMode]="spawnMode()"
                  [spawnDelay]="spawnDelay()"
                  [useGathering]="useGathering()"
                  [waveActive]="waveActive()"
                  [baseHealth]="gameState.baseHealth()"
                  [debugLog]="debugLog()"
                  (enemyCountChange)="onEnemyCountChange($event)"
                  (enemySpeedChange)="onSpeedChange($event)"
                  (enemyTypeChange)="onEnemyTypeChange($event)"
                  (toggleSpawnMode)="toggleSpawnMode()"
                  (spawnDelayChange)="onSpawnDelayChange($event)"
                  (toggleGathering)="toggleGathering()"
                  (killAll)="killAllEnemies()"
                  (healHq)="healHq()"
                  (clearLog)="clearDebugLog()"
                  (logCamera)="logCameraPosition()"
                />
              </div>
            </section>
          }
          <!-- Footer -->
          <div class="td-sidebar-footer">
            <span class="td-version">v0.1.0</span>
            <a href="https://github.com/ingel81/3dtd" target="_blank" class="td-repo-link" title="GitHub">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
            </a>
            <span class="td-author">@ingel81</span>
          </div>
          </div><!-- /td-sidebar-content -->
        </aside>
      </div>
    </div>
  `,
  styles: `
    :host {
      display: contents;
      ${TD_CSS_VARS}
    }

    /* === Container === */
    .td-container {
      display: flex;
      flex-direction: column;
      width: 90vw;
      max-width: 1400px;
      height: 85vh;
      max-height: 900px;
      background: var(--td-bg-dark);
      border: 2px solid var(--td-frame-mid);
      border-top-color: var(--td-frame-light);
      border-radius: 4px;
      overflow: hidden;
      font-family: 'JetBrains Mono', monospace;
    }

    .td-container.td-fullscreen {
      width: 100vw;
      max-width: 100vw;
      height: 100vh;
      max-height: 100vh;
      border-radius: 0;
      border: none;
    }

    /* === Header === */
    .td-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 4px 12px;
      background:
        linear-gradient(rgba(15, 19, 15, 0.8), rgba(15, 19, 15, 0.8)),
        url('/assets/images/425.jpg') repeat;
      background-size: auto, 64px 64px;
      border-bottom: 3px solid var(--td-panel-shadow);
      border-top: 1px solid var(--td-frame-light);
      box-shadow:
        0 4px 8px rgba(0, 0, 0, 0.5),
        0 2px 4px rgba(0, 0, 0, 0.3),
        inset 0 -2px 4px rgba(0, 0, 0, 0.3);
    }

    /* Textured Background Overlay - fuer Lesbarkeit auf Stein-Textur */
    .td-text-badge {
      background: var(--td-panel-shadow);
      padding: 4px 10px;
      border: 1px solid var(--td-frame-dark);
      border-top-color: var(--td-frame-mid);
    }

    .td-header-left {
      display: flex;
      align-items: center;
      gap: 8px;
      background: var(--td-panel-shadow);
      padding: 4px 10px;
      border: 1px solid var(--td-frame-dark);
      border-top-color: var(--td-frame-mid);
    }

    .td-title-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      color: var(--td-gold);
    }

    .td-title {
      margin: 0;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 1px;
      color: var(--td-gold);
      text-transform: uppercase;
    }

    .td-location-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      margin-left: 8px;
      background: transparent;
      border: 1px solid transparent;
      border-left: 1px solid var(--td-frame-mid);
      color: var(--td-text-secondary);
      cursor: pointer;
      transition: all 0.15s ease;
      border-radius: 0 3px 3px 0;
      font-family: inherit;
      font-size: 10px;
    }

    .td-location-btn:hover {
      border-color: var(--td-gold-dark);
      background: rgba(255, 215, 0, 0.1);
      color: var(--td-gold);
    }

    .td-location-name {
      font-weight: 500;
    }

    .td-location-edit {
      font-size: 12px;
      width: 12px;
      height: 12px;
      opacity: 0.5;
    }

    .td-location-btn:hover .td-location-edit {
      opacity: 1;
    }

    .td-header-stats {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-left: auto;
      margin-right: 8px;
    }

    .td-stat {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      font-size: 11px;
      font-weight: 600;
      background: var(--td-panel-shadow);
      padding: 4px 10px;
      min-width: 50px;
      border: 1px solid var(--td-frame-dark);
      border-top-color: var(--td-frame-mid);
    }

    .td-stat mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }

    .td-stat.hp { color: var(--td-health-red); }
    .td-stat.credits { color: var(--td-gold); }
    .td-stat.wave { color: var(--td-teal); }
    .td-stat.enemies { color: var(--td-warn-orange); }
    .td-stat.fps, .td-stat.tiles { color: var(--td-text-secondary); font-size: 10px; min-width: auto; }

    .td-close-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      background: var(--td-panel-shadow);
      border: 1px solid var(--td-frame-mid);
      border-top-color: var(--td-frame-light);
      border-bottom-color: var(--td-frame-dark);
      color: var(--td-text-secondary);
      cursor: pointer;
      transition: all 0.15s;
    }

    .td-close-btn mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }

    .td-close-btn:hover {
      background: var(--td-health-red);
      color: var(--td-text-primary);
    }

    /* === Main Layout === */
    .td-main {
      flex: 1;
      display: flex;
      overflow: visible; /* Allow canvas-area children to extend beyond bounds */
    }

    /* === Canvas Area === */
    .td-canvas-area {
      flex: 1;
      position: relative;
      background: var(--td-panel-shadow);
      overflow: visible; /* Allow quick-actions to extend beyond bounds */
    }

    .td-canvas {
      width: 100%;
      height: 100%;
    }

    .td-canvas.hidden {
      visibility: hidden;
    }

    .td-controls-hint {
      position: absolute;
      bottom: 5px;
      left: 120px;
      font-size: 11px;
      color: var(--td-text-secondary);
      background: rgba(20, 24, 21, 0.85);
      padding: 4px 8px;
      border-radius: 3px;
      border: 1px solid var(--td-frame-dark);
      z-index: 5;
    }

    /* Google Logo (bottom left) */
    .td-google-logo-container {
      position: absolute;
      bottom: 5px;
      left: 10px;
      z-index: 5;
    }

    .td-google-logo {
      height: 16px;
      width: auto;
      display: block;
    }

    /* Map Attribution (bottom right) */
    .td-map-attribution {
      position: absolute;
      bottom: 5px;
      right: 10px;
      padding: 0 6px;
      background: rgba(255, 255, 255, 0.7);
      border-radius: 2px;
      font-size: 9px;
      color: #444;
      z-index: 5;
      max-width: 500px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* Compass (top right) - SVG-based */
    .td-compass-container {
      position: absolute;
      top: 12px;
      right: 12px;
      z-index: 5;
      pointer-events: none;
    }

    .td-compass {
      position: relative;
      width: 64px;
      height: 64px;
      transition: transform 0.15s ease-out;
      filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.5));
    }

    .td-compass-svg {
      width: 100%;
      height: 100%;
    }

    .td-compass-bg {
      fill: radial-gradient(circle, rgba(20, 24, 21, 0.95) 0%, rgba(15, 18, 16, 0.9) 100%);
      fill: rgba(20, 24, 21, 0.92);
    }

    .td-compass-ring {
      fill: none;
      stroke: var(--td-gold);
      stroke-width: 2;
    }

    .td-compass-inner-ring {
      fill: none;
      stroke: rgba(212, 175, 55, 0.3);
      stroke-width: 1;
    }

    .td-compass-tick {
      stroke: var(--td-text-secondary);
      stroke-width: 1.5;
      stroke-linecap: round;
    }

    .td-compass-tick.major {
      stroke: var(--td-gold);
      stroke-width: 2;
    }

    .td-compass-tick.minor {
      stroke: rgba(212, 175, 55, 0.5);
      stroke-width: 1;
    }

    .td-compass-needle-n {
      fill: var(--td-health-red);
      filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5));
    }

    .td-compass-needle-s {
      fill: rgba(180, 180, 180, 0.6);
      filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.3));
    }

    .td-compass-pivot {
      fill: var(--td-gold);
    }

    .td-compass-pivot-inner {
      fill: rgba(20, 24, 21, 0.9);
    }

    /* Cardinal direction labels */
    .td-compass-label {
      position: absolute;
      font-size: 9px;
      font-weight: 700;
      color: var(--td-text-secondary);
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
      pointer-events: none;
    }

    .td-compass-label.td-compass-n {
      top: 11px;
      left: 50%;
      transform: translateX(-50%);
      color: var(--td-health-red);
      font-size: 10px;
    }

    .td-compass-label.td-compass-e {
      top: 50%;
      right: 10px;
      transform: translateY(-50%);
    }

    .td-compass-label.td-compass-s {
      bottom: 11px;
      left: 50%;
      transform: translateX(-50%);
    }

    .td-compass-label.td-compass-w {
      top: 50%;
      left: 10px;
      transform: translateY(-50%);
    }

    .td-compass-heading-debug {
      font-size: 10px;
      color: var(--td-gold);
      background: rgba(20, 24, 21, 0.85);
      padding: 2px 6px;
      border-radius: 3px;
      font-family: 'JetBrains Mono', monospace;
      margin-top: 4px;
      text-align: center;
    }

    /* Camera Debug Overlay (top right, below compass) */
    .td-camera-debug {
      position: absolute;
      top: 88px;
      right: 12px;
      z-index: 5;
      background: rgba(20, 24, 21, 0.92);
      border: 1px solid var(--td-frame-mid);
      border-radius: 6px;
      padding: 8px 10px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      min-width: 140px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
    }

    .td-camera-debug-title {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--td-gold);
      font-weight: 600;
      font-size: 12px;
      margin-bottom: 8px;
      padding-bottom: 6px;
      border-bottom: 1px solid var(--td-frame-dark);
    }

    .td-camera-debug-title mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }

    .td-camera-debug-section {
      margin-bottom: 6px;
    }

    .td-camera-debug-section:last-child {
      margin-bottom: 0;
    }

    .td-camera-debug-label {
      display: block;
      color: var(--td-text-muted);
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 2px;
    }

    .td-camera-debug-row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      padding: 1px 0;
    }

    .td-camera-debug-key {
      color: var(--td-text-secondary);
    }

    .td-camera-debug-value {
      color: var(--td-text-primary);
      font-weight: 500;
    }

    /* Quick Actions (right side, above attribution) */
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

    .td-layer-toggles {
      display: flex;
      flex-direction: column;
      gap: 4px;
      overflow: hidden;
      max-height: 0;
      opacity: 0;
      transition: max-height 0.2s ease, opacity 0.15s ease;
    }

    .td-layer-toggles.expanded {
      max-height: 160px; /* 4 buttons × 32px + 3 gaps × 4px + margin */
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

    /* === Dev Menu (expands inline, pushes buttons left) === */
    .td-dev-menu-wrapper {
      display: flex;
      flex-direction: row;
      align-items: flex-end;
    }

    .td-dev-menu {
      display: flex;
      flex-direction: column;
      gap: 4px;
      max-width: 0;
      overflow: hidden;
      opacity: 0;
      transition: all 0.2s ease;
    }

    .td-dev-menu.expanded {
      max-width: 40px;
      margin-right: 4px;
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

    /* === Sidebar === */
    .td-sidebar {
      width: 300px;
      position: relative;
      display: flex;
      flex-direction: column;
    }

    .td-sidebar-content {
      flex: 1;
      background:
        linear-gradient(rgba(15, 19, 15, 0.75), rgba(15, 19, 15, 0.75)),
        url('/assets/images/425.jpg') repeat;
      background-size: auto, 100px 100px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 8px;
      overflow-y: auto;
      position: relative;
      z-index: 1;
      border-left: 4px solid var(--td-panel-shadow);
      box-shadow:
        -6px 0 12px rgba(0, 0, 0, 0.5),
        -3px 0 6px rgba(0, 0, 0, 0.3),
        inset 4px 0 8px rgba(0, 0, 0, 0.4);
    }

    .td-sidebar-footer {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 6px 8px;
      margin-top: auto;
      font-size: 10px;
      color: var(--td-text-muted);
      opacity: 0.6;
    }

    .td-sidebar-footer:hover {
      opacity: 1;
    }

    .td-sidebar-footer a {
      color: var(--td-text-secondary);
      text-decoration: none;
      display: flex;
      align-items: center;
    }

    .td-sidebar-footer a:hover {
      color: var(--td-text-primary);
    }

    /* === Panel (WC3 Style) === */
    .td-panel {
      background: var(--td-panel-main);
      border-top: 1px solid var(--td-frame-light);
      border-left: 1px solid var(--td-frame-mid);
      border-right: 1px solid var(--td-frame-dark);
      border-bottom: 2px solid var(--td-frame-dark);
    }

    .td-panel-header {
      padding: 6px 10px;
      background: var(--td-panel-secondary);
      border-bottom: 1px solid var(--td-frame-dark);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 1px;
      color: var(--td-gold);
      text-transform: uppercase;
    }

    .td-panel-content {
      padding: 8px;
    }

    /* === Status Panel === */
    .td-stat-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
    }

    .td-stat-row:last-child {
      margin-bottom: 0;
    }

    .td-stat-label {
      font-size: 10px;
      color: var(--td-text-muted);
      width: 50px;
    }

    .td-stat-value {
      font-size: 12px;
      font-weight: 600;
      color: var(--td-text-primary);
    }

    .td-stat-value.td-gold { color: var(--td-gold); }
    .td-stat-value.td-orange { color: var(--td-warn-orange); }

    /* HP Bar */
    .td-hp-bar {
      flex: 1;
      height: 10px;
      background: var(--td-hp-bg);
      border: 1px solid var(--td-frame-dark);
      border-top-color: var(--td-frame-mid);
    }

    .td-hp-fill {
      height: 100%;
      background: var(--td-hp-fill);
      transition: width 0.3s ease;
    }

    /* === Actions Panel === */
    .td-actions {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .td-action-btn {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 8px 10px;
      background: var(--td-panel-secondary);
      border: 1px solid var(--td-frame-mid);
      border-top-color: var(--td-frame-light);
      border-bottom-color: var(--td-frame-dark);
      color: var(--td-text-primary);
      font-family: inherit;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s;
    }

    .td-action-btn mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      color: var(--td-teal);
    }

    .td-action-btn:hover:not(:disabled) {
      background: var(--td-frame-mid);
    }

    .td-action-btn.active {
      background: var(--td-gold-dark);
      color: var(--td-bg-dark);
    }

    .td-action-btn.active mat-icon {
      color: var(--td-bg-dark);
    }

    .td-action-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .td-action-btn.td-btn-green:not(:disabled) {
      background: var(--td-green);
      color: var(--td-bg-dark);
    }

    .td-action-btn.td-btn-green mat-icon {
      color: var(--td-bg-dark);
    }

    .td-action-btn.td-btn-green:hover:not(:disabled) {
      filter: brightness(1.1);
    }

    .td-build-hint {
      padding: 4px 8px;
      background: var(--td-warn-orange);
      color: var(--td-bg-dark);
      font-size: 10px;
      font-weight: 600;
      text-align: center;
      animation: td-pulse 1.5s ease-in-out infinite;
    }

    @keyframes td-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.7; }
    }

    /* === Wave Section === */
    .td-wave-section {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .td-wave-info {
      display: flex;
      gap: 12px;
      align-items: center;
    }

    .td-enemy-preview-container {
      flex-shrink: 0;
      width: 72px;
      height: 72px;
      background: linear-gradient(135deg, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0.2) 100%);
      border: 1px solid var(--td-frame-dark);
      border-radius: 4px;
      overflow: hidden;
    }

    .td-enemy-preview-canvas {
      width: 100%;
      height: 100%;
      display: block;
    }

    .td-enemy-name {
      font-size: 11px;
      font-weight: 600;
      color: var(--td-warn-orange);
      margin-bottom: 4px;
    }

    .td-wave-stats {
      display: flex;
      flex-direction: column;
      gap: 4px;
      flex: 1;
    }

    .td-stat-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 2px 0;
    }

    .td-stat-label {
      color: var(--td-text-secondary);
      font-size: 10px;
      text-transform: uppercase;
    }

    .td-stat-value {
      color: var(--td-text-primary);
      font-size: 12px;
      font-weight: 600;
    }

    .td-wave-btn {
      margin-top: 4px;
    }

    /* === Build Section === */
    .td-build-section {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .td-tower-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 6px;
    }

    .td-tower-card {
      position: relative;
      display: flex;
      flex-direction: column;
      padding: 0;
      background: var(--td-panel-secondary);
      border: 1px solid var(--td-frame-mid);
      border-top-color: var(--td-frame-light);
      border-bottom-color: var(--td-frame-dark);
      cursor: pointer;
      transition: all 0.15s ease;
      font-family: inherit;
      border-radius: 3px;
      overflow: hidden;
    }

    .td-tower-card:hover:not(:disabled) {
      border-color: var(--td-gold-dark);
      box-shadow: 0 0 10px rgba(255, 215, 0, 0.3);
    }

    .td-tower-card:disabled,
    .td-tower-card.disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .td-tower-preview-canvas {
      width: 100%;
      height: 70px;
      display: block;
      background: linear-gradient(180deg, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.4) 100%);
    }

    .td-tower-card-name {
      display: block;
      padding: 4px 6px;
      font-size: 9px;
      font-weight: 600;
      color: var(--td-text-secondary);
      text-align: center;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      background: var(--td-panel-main);
      border-top: 1px solid var(--td-frame-dark);
    }

    .td-tower-card-cost {
      position: absolute;
      top: 4px;
      right: 4px;
      padding: 2px 6px;
      background: var(--td-gold-dark);
      color: var(--td-bg-dark);
      font-size: 9px;
      font-weight: 700;
      border-radius: 2px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.4);
    }

    .td-tower-card:hover:not(:disabled) .td-tower-card-name {
      color: var(--td-gold);
    }

    .td-cancel-btn {
      background: var(--td-panel-secondary);
    }

    .td-cancel-btn mat-icon {
      color: var(--td-red);
    }

    .td-cancel-btn:hover {
      background: rgba(244, 67, 54, 0.2);
    }

    .td-cost {
      margin-left: auto;
      padding: 2px 6px;
      background: var(--td-gold-dark);
      color: var(--td-bg-dark);
      font-size: 10px;
      font-weight: 700;
      border-radius: 2px;
    }

    /* === Tower Section === */
    .td-tower-panel {
      border-color: var(--td-teal);
    }

    .td-tower-panel .td-panel-header {
      background: linear-gradient(180deg, var(--td-teal) 0%, rgba(0, 188, 212, 0.3) 100%);
      color: var(--td-bg-dark);
    }

    .td-tower-section {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .td-tower-stats {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--td-frame-dark);
    }

    .td-stat-value.td-damage {
      color: var(--td-red);
    }

    .td-stat-value.td-kills {
      color: var(--td-gold);
    }

    .td-tower-actions {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .td-btn-upgrade {
      background: var(--td-panel-secondary);
    }

    .td-btn-upgrade mat-icon {
      color: var(--td-teal);
    }

    .td-btn-sell {
      background: var(--td-panel-secondary);
    }

    .td-btn-sell mat-icon {
      color: var(--td-red);
    }

    .td-btn-sell:hover:not(:disabled) {
      background: rgba(244, 67, 54, 0.2);
    }

    .td-refund {
      background: var(--td-green);
    }

    /* === Upgrade Section === */
    .td-upgrades-section {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin: 8px 0;
      padding-top: 8px;
      border-top: 1px solid var(--td-frame-dark);
    }

    .td-upgrades-title {
      font-size: 9px;
      font-weight: 600;
      color: var(--td-text-muted);
      letter-spacing: 0.5px;
    }

    .td-upgrade-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      background: var(--td-panel-secondary);
      border: 1px solid var(--td-frame-mid);
      border-top-color: var(--td-frame-light);
      border-bottom-color: var(--td-frame-dark);
      color: var(--td-text-secondary);
      font-size: 11px;
      cursor: pointer;
      transition: all 0.15s;
    }

    .td-upgrade-btn mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
      color: var(--td-gold);
    }

    .td-upgrade-btn:hover:not(:disabled) {
      background: rgba(255, 193, 7, 0.15);
      border-color: var(--td-gold-dark);
    }

    .td-upgrade-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .td-upgrade-btn.td-upgrade-affordable {
      border-color: var(--td-gold-dark);
    }

    .td-upgrade-name {
      flex: 1;
      text-align: left;
    }

    .td-upgrade-cost {
      padding: 2px 6px;
      background: var(--td-gold);
      color: var(--td-bg-dark);
      font-size: 10px;
      font-weight: 600;
      border-radius: 2px;
    }

    .td-upgrade-cost::before {
      content: '';
      display: inline-block;
      width: 8px;
      height: 8px;
      margin-right: 2px;
      background: url('/assets/images/gold.svg') center/contain no-repeat;
      vertical-align: middle;
    }

    /* === Camera Buttons === */
    .td-camera-btns {
      display: flex;
      gap: 4px;
    }

    .td-icon-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      background: var(--td-panel-secondary);
      border: 1px solid var(--td-frame-mid);
      border-top-color: var(--td-frame-light);
      border-bottom-color: var(--td-frame-dark);
      color: var(--td-text-secondary);
      cursor: pointer;
      transition: all 0.15s;
    }

    .td-icon-btn mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .td-icon-btn:hover {
      background: var(--td-frame-mid);
      color: var(--td-text-primary);
    }

    .td-icon-btn.active {
      background: var(--td-teal);
      color: var(--td-bg-dark);
    }

    /* === Debug Panel === */
    .td-debug-panel {
      flex: 1;
      overflow: hidden;
    }

    .td-debug-panel .td-panel-content {
      padding: 0;
      height: 100%;
    }

    /* === Overlays === */
    .td-loading-overlay {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 16px;
      background: color-mix(in srgb, var(--td-bg-dark) 90%, transparent);
      backdrop-filter: blur(2px);
      z-index: 10;
      pointer-events: all; /* Block clicks to canvas below */
    }

    .td-loading-overlay mat-spinner ::ng-deep circle {
      stroke: var(--td-gold) !important;
    }

    .td-loading-title {
      color: var(--td-gold);
      font-size: 18px;
      font-weight: 600;
      margin-top: 12px;
      text-align: center;
    }

    .td-loading-steps {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-top: 16px;
      padding: 16px;
      background: color-mix(in srgb, var(--td-bg-surface) 50%, transparent);
      border-radius: 8px;
      min-width: 240px;
    }

    .td-loading-step {
      display: flex;
      align-items: center;
      gap: 10px;
      color: var(--td-text-tertiary);
      font-size: 13px;
      transition: color 0.2s;
    }

    .td-step-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
      transition: color 0.2s;
    }

    .td-loading-step.active {
      color: var(--td-text-primary);
    }

    .td-loading-step.active .td-step-icon {
      color: var(--td-gold);
      animation: spin 1s linear infinite;
    }

    .td-loading-step.done {
      color: var(--td-text-secondary);
    }

    .td-loading-step.done .td-step-icon {
      color: var(--td-green);
    }

    .td-step-detail {
      color: var(--td-text-tertiary);
      font-size: 11px;
      margin-left: auto;
    }

    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    .td-error-overlay {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 16px;
      background: var(--td-bg-dark);
      z-index: 10;
    }

    .td-error-overlay {
      padding: 40px;
      text-align: center;
    }

    .td-error-icon {
      font-size: 64px;
      width: 64px;
      height: 64px;
      color: var(--td-warn-orange);
    }

    .td-error-overlay h3 {
      font-size: 20px;
      color: var(--td-warn-orange);
      margin: 0;
    }

    .td-error-overlay p {
      color: var(--td-text-secondary);
      max-width: 400px;
    }

    .td-token-instructions {
      background: var(--td-panel-secondary);
      border: 1px solid var(--td-frame-mid);
      padding: 16px;
      text-align: left;
      margin: 16px 0;
    }

    .td-token-instructions p { margin: 8px 0; font-size: 12px; }
    .td-token-instructions a { color: var(--td-teal); }
    .td-token-instructions code {
      background: var(--td-panel-shadow);
      padding: 2px 6px;
      font-size: 11px;
    }
    .td-token-instructions pre {
      background: var(--td-panel-shadow);
      border: 1px solid var(--td-frame-dark);
      padding: 10px;
      font-size: 11px;
      color: var(--td-green);
    }

    /* Generic Buttons */
    .td-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 20px;
      background: var(--td-gold);
      border: none;
      border-top: 1px solid var(--td-edge-highlight);
      border-bottom: 2px solid var(--td-gold-dark);
      color: var(--td-bg-dark);
      font-family: inherit;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.15s;
    }

    .td-btn:hover { filter: brightness(1.1); }

    .td-btn-gold { background: var(--td-gold); border-bottom-color: var(--td-gold-dark); }
    .td-btn-green {
      background: var(--td-green);
      border-bottom-color: var(--td-green-dark);
    }

    /* Gathering Overlay */
    .td-gathering-overlay {
      position: absolute;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 20px;
      background: var(--td-panel-main);
      border: 2px solid var(--td-warn-orange);
      z-index: 10;
      animation: td-pulse 1s ease-in-out infinite;
    }

    .td-gathering-overlay mat-icon {
      color: var(--td-warn-orange);
      font-size: 20px;
      width: 20px;
      height: 20px;
    }

    .td-gathering-overlay span {
      font-size: 12px;
      font-weight: 600;
      color: var(--td-warn-orange);
    }

    /* Game Over Overlay */
    .td-gameover-overlay {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.8);
      z-index: 20;
      animation: td-fade-in 0.5s ease;
    }

    @keyframes td-fade-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .td-gameover-content {
      text-align: center;
      padding: 40px 60px;
      background: var(--td-panel-main);
      border: 3px solid var(--td-health-red);
      box-shadow: 0 0 40px rgba(177, 68, 54, 0.5);
    }

    .td-gameover-content h1 {
      font-size: 48px;
      font-weight: 900;
      color: var(--td-health-red);
      margin: 0 0 16px 0;
      letter-spacing: 6px;
      animation: td-shake 0.5s ease-in-out;
    }

    @keyframes td-shake {
      0%, 100% { transform: translateX(0); }
      20% { transform: translateX(-6px); }
      40% { transform: translateX(6px); }
      60% { transform: translateX(-3px); }
      80% { transform: translateX(3px); }
    }

    .td-gameover-content p {
      font-size: 14px;
      color: var(--td-text-secondary);
      margin: 0 0 24px 0;
    }

    .td-gameover-content .td-btn {
      padding: 12px 28px;
      font-size: 14px;
    }

    .td-gameover-content .td-btn mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }
  `,
})
export class TowerDefenseComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('gameCanvas') gameCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('enemyPreviewCanvas') enemyPreviewCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChildren('towerPreviewCanvas') towerPreviewCanvases!: QueryList<ElementRef<HTMLCanvasElement>>;

  private readonly dialogRef = inject(MatDialogRef<TowerDefenseComponent>, { optional: true });
  private readonly dialog = inject(MatDialog);
  private readonly osmService = inject(OsmStreetService);
  private readonly configService = inject(ConfigService);
  private readonly geocodingService = inject(GeocodingService);
  readonly gameState = inject(GameStateManager);
  private readonly entityPool = inject(EntityPoolService);
  private readonly modelPreview = inject(ModelPreviewService);

  // Refactoring services
  private readonly uiState = inject(GameUIStateService);
  private readonly cameraControl = inject(CameraControlService);
  private readonly markerViz = inject(MarkerVisualizationService);
  private readonly pathRoute = inject(PathAndRouteService);
  private readonly inputHandler = inject(InputHandlerService);
  private readonly towerPlacement = inject(TowerPlacementService);
  private readonly locationMgmt = inject(LocationManagementService);
  private readonly heightUpdate = inject(HeightUpdateService);
  private readonly engineInit = inject(EngineInitializationService);
  private readonly cameraFraming = inject(CameraFramingService);

  // Expose Math and tower config for template
  readonly Math = Math;
  readonly archerTowerConfig = TOWER_TYPES.archer;
  readonly towerTypes = getAllTowerTypes();

  private engine: ThreeTilesEngine | null = null;
  private streetNetwork: StreetNetwork | null = null;

  // Three.js object for streets (merged geometry for performance - 1 draw call instead of 600)
  private streetLinesMesh: THREE.LineSegments | null = null;

  // Proxy signals from services for template compatibility
  readonly loading = this.engineInit.loading;
  readonly tilesLoading = this.engineInit.tilesLoading;
  readonly osmLoading = this.engineInit.osmLoading;
  readonly heightsLoading = this.heightUpdate.heightsLoading;
  readonly heightProgress = this.heightUpdate.heightProgress;
  readonly error = this.engineInit.error;
  readonly loadingStatus = this.engineInit.loadingStatus;
  readonly loadingSteps = this.engineInit.loadingSteps;
  readonly streetsVisible = this.uiState.streetsVisible;
  readonly routesVisible = this.uiState.routesVisible;
  readonly towerDebugVisible = this.uiState.towerDebugVisible;
  readonly debugMode = this.uiState.debugMode;
  readonly heightDebugVisible = this.uiState.heightDebugVisible;
  readonly layerMenuExpanded = this.uiState.layerMenuExpanded;
  readonly devMenuExpanded = this.uiState.devMenuExpanded;
  readonly fps = this.uiState.fps;
  readonly tileStats = this.uiState.tileStats;
  readonly mapAttribution = signal('Map data ©2024 Google');
  readonly debugLog = this.uiState.debugLog;
  readonly buildMode = this.towerPlacement.buildMode;
  readonly selectedTowerType = this.towerPlacement.selectedTowerType;
  readonly editableHqLocation = this.locationMgmt.editableHqLocation;
  readonly editableSpawnLocations = this.locationMgmt.editableSpawnLocations;
  readonly isApplyingLocation = this.locationMgmt.isApplyingLocation;
  // Component-local signals (not moved to services)
  readonly cameraHeading = signal(0); // Compass heading: 0=N, 90=E, 180=S, 270=W
  readonly compassRotation = signal(0); // Accumulated rotation for smooth compass (avoids 0°/360° flip)
  readonly cameraFramingDebug = signal(false); // Debug visualization for camera framing
  readonly cameraDebugEnabled = signal(false); // Camera debug overlay
  readonly cameraDebugInfo = signal<{
    posX: number; posY: number; posZ: number;
    rotX: number; rotY: number; rotZ: number;
    heading: number; pitch: number; altitude: number;
    distanceToCenter: number; fov: number; terrainHeight: number;
  } | null>(null);
  readonly enemySpeed = signal(5);
  readonly streetCount = signal(0);
  readonly enemyCount = signal(2);
  readonly enemyType = signal<EnemyTypeId>('zombie');
  readonly enemyTypes = getAllEnemyTypes();
  readonly spawnMode = signal<'each' | 'random'>('each');
  readonly spawnDelay = signal(300);
  readonly useGathering = signal(false);
  readonly spawnPoints = signal<SpawnPoint[]>([]);
  readonly baseCoords = signal(DEFAULT_BASE_COORDS);
  readonly centerCoords = signal(DEFAULT_CENTER_COORDS);

  readonly waveActive = computed(() => this.gameState.phase() === 'wave');
  readonly isGameOver = computed(() => this.gameState.phase() === 'gameover');
  readonly currentEnemyConfig = computed(() => getEnemyType(this.enemyType()));

  // Location name for header display - smart extraction from address
  readonly currentLocationName = computed(() => {
    const hq = this.editableHqLocation();
    if (!hq) return 'Erlenbach';

    // Try to build smart name from structured address
    if (hq.address) {
      const addr = hq.address;
      const parts: string[] = [];

      // Street + house number
      if (addr.road) {
        parts.push(addr.house_number ? `${addr.road} ${addr.house_number}` : addr.road);
      }

      // City (prefer city > town > village > municipality)
      const city = addr.city || addr.town || addr.village || addr.municipality;
      if (city) {
        parts.push(city);
      }

      if (parts.length > 0) {
        return parts.join(', ');
      }
    }

    // Fall back to displayName
    if (hq.name) {
      return hq.name;
    }

    // Last resort: coordinates
    return `${hq.lat.toFixed(4)}, ${hq.lon.toFixed(4)}`;
  });
  readonly gatheringPhase = signal(false);
  private waveAborted = false;
  readonly gatheringCountdown = signal(0);

  private animationFrameId: number | null = null;

  ngOnInit(): void {
    // Initialize location management (loads from localStorage if available)
    this.locationMgmt.initializeEditableLocations();

    // Sync baseCoords and centerCoords with loaded location from localStorage
    const hq = this.locationMgmt.getCurrentHqLocation();
    if (hq) {
      this.baseCoords.set({
        latitude: hq.lat,
        longitude: hq.lon,
      });
      this.centerCoords.set({
        latitude: hq.lat,
        longitude: hq.lon,
        height: 400,
      });
    }
  }

  ngAfterViewInit(): void {
    this.initEngine();
    // Initialize 3D previews after a short delay to ensure DOM is ready
    setTimeout(() => this.initPreviews(), 100);

    // Re-initialize tower previews when the list changes (e.g., after exiting build mode)
    this.towerPreviewCanvases.changes.subscribe(() => {
      setTimeout(() => this.initTowerPreviews(), 50);
    });
  }

  ngOnDestroy(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    this.entityPool.destroy();
    this.modelPreview.dispose();
    if (this.engine) {
      this.engine.dispose();
      this.engine = null;
    }
  }

  /**
   * Initialize Three.js rendering engine - delegates to EngineInitializationService
   */
  private async initEngine(): Promise<void> {
    try {
      // Get Google Maps API Key
      const apiKey = this.configService.googleMapsApiKey();
      if (!apiKey) {
        this.engineInit.setError('Bitte konfiguriere deinen Google Maps API Key in appsettings.json.');
        this.engineInit.setLoading(false);
        return;
      }

      // Configure engine initialization service
      const canvas = this.gameCanvas.nativeElement;
      const base = this.baseCoords();
      this.engineInit.configure(canvas, apiKey, { lat: base.latitude, lon: base.longitude });

      // Initialize engine via service
      await this.engineInit.initEngine({
        onLoadStreets: () => this.loadStreets(),
        onInitializeServices: () => this.initializeVisualizationServices(),
        onAddBaseMarker: () => this.markerViz.addBaseMarker(),
        onAddPredefinedSpawns: () => this.addPredefinedSpawns(),
        onInitializeGameState: () => this.initializeGameState(),
        onScheduleHeightUpdate: () => this.scheduleOverlayHeightUpdate(),
        onSetupClickHandler: () => this.setupClickHandler(),
        onCreateBuildPreview: () => this.createBuildPreview(),
        onSaveInitialCameraPosition: () => this.saveInitialCameraPosition(),
        onCheckAllLoaded: () => this.checkAllLoaded(),
        // NEW: Get spawn coordinates BEFORE engine init for optimal initial framing
        getSpawnCoordinates: () => this.getSpawnCoordinatesForFraming(),
      });

      // Get engine reference
      this.engine = this.engineInit.getEngine();

      // Register callbacks
      if (this.engine) {
        this.engine.setOnTilesLoadCallback(() => this.onTilesLoaded());
        this.engine.setOnUpdateCallback((deltaTime) => this.onEngineUpdate(deltaTime));
      }

    } catch (err) {
      console.error('[TD] Engine init error:', err);
      this.engineInit.setError(err instanceof Error ? err.message : 'Fehler beim Laden der 3D-Karte');
      this.engineInit.setLoading(false);
    }
  }

  /**
   * Check if all loading is complete - delegates to EngineInitializationService
   */
  private checkAllLoaded(): void {
    this.engineInit.checkAllLoaded(this.heightUpdate.heightsLoading);
  }

  /**
   * Initialize visualization services (markerViz, pathRoute)
   * Must be called after engine and streets are loaded, before markers/spawns are added
   */
  private initializeVisualizationServices(): void {
    const engine = this.engineInit.getEngine();
    if (!engine || !this.streetNetwork) {
      console.warn('[TD] Cannot initialize visualization services - engine or streetNetwork not available');
      return;
    }

    const base = this.baseCoords();
    const baseCoords = { lat: base.latitude, lon: base.longitude };

    // Initialize marker visualization service
    this.markerViz.initialize(engine, baseCoords, this.heightDebugVisible);

    // Initialize path and route service
    this.pathRoute.initialize(
      engine,
      this.streetNetwork,
      baseCoords,
      this.uiState.routesVisible,
      this.osmService,
      this.markerViz.getSpawnMarkers()
    );

    // Initialize camera control service
    this.cameraControl.initialize(engine, { lat: baseCoords.lat, lon: baseCoords.lon });
  }

  /**
   * Setup click handler - delegates to InputHandlerService
   */
  private setupClickHandler(): void {
    // Use engine from service if component's engine reference not yet set
    const engine = this.engine || this.engineInit.getEngine();
    if (!engine) return;

    this.inputHandler.initialize(
      this.gameCanvas.nativeElement,
      engine,
      this.gameState,
      this.towerPlacement.buildMode,
      (lat: number, lon: number, height: number) => this.onTerrainClick(lat, lon, height),
      (lat: number, lon: number, hitPoint: THREE.Vector3) => this.onMouseMove(lat, lon, hitPoint)
    );
  }

  /**
   * Handle terrain click in build mode
   */
  private onTerrainClick(lat: number, lon: number, height: number): void {
    if (this.towerPlacement.placeTower(lat, lon, height)) {
      this.towerPlacement.toggleBuildMode();
    }
  }

  /**
   * Handle mouse move in build mode (for build preview)
   */
  private onMouseMove(lat: number, lon: number, _hitPoint: THREE.Vector3): void {
    this.towerPlacement.updatePreviewPosition(lat, lon);
    this.towerPlacement.updatePreviewValidation(lat, lon);
  }

  /**
   * Create build preview callback (called early in initialization)
   * Actual initialization happens in initializeTowerPlacement() after all dependencies are ready
   */
  private createBuildPreview(): void {
    // No-op: TowerPlacementService is initialized in initializeTowerPlacement()
    // which is called after game state and spawn points are set up
  }

  /**
   * Initialize TowerPlacementService with all required dependencies
   * Must be called after engine, streets, spawns, and game state are ready
   */
  private initializeTowerPlacement(): void {
    // Use engine from service if component's engine reference not yet set
    const engine = this.engine || this.engineInit.getEngine();
    if (!engine || !this.streetNetwork) {
      console.warn('[TD] Cannot initialize TowerPlacement - engine or streetNetwork not available');
      return;
    }

    const base = this.baseCoords();
    const spawnPointsForPlacement = this.spawnPoints().map(sp => ({
      id: sp.id,
      name: sp.name,
      latitude: sp.latitude,
      longitude: sp.longitude,
      color: sp.color,
    }));

    this.towerPlacement.initialize(
      engine,
      this.streetNetwork,
      this.osmService,
      { latitude: base.latitude, longitude: base.longitude },
      spawnPointsForPlacement,
      this.gameState
    );
  }

  /**
   * Load OSM street network
   * @returns Street count
   */
  private async loadStreets(): Promise<number> {
    try {
      const center = this.centerCoords();

      this.streetNetwork = await this.osmService.loadStreets(
        center.latitude,
        center.longitude,
        2000 // 2km radius
      );

      this.streetCount.set(this.streetNetwork.streets.length);
      this.renderStreets();

      return this.streetNetwork.streets.length;
    } catch (err) {
      console.error('Failed to load streets:', err);
      return 0;
    }
  }

  /**
   * Initialize game state with routes
   * @returns Route detail string
   */
  private initializeGameState(): string | undefined {
    // Use engine from service if component's engine reference not yet set
    const engine = this.engine || this.engineInit.getEngine();
    if (!engine || !this.streetNetwork) return undefined;

    const base = this.baseCoords();
    const waveSpawnPoints: WaveSpawnPoint[] = this.spawnPoints().map((sp) => ({
      id: sp.id,
      name: sp.name,
      latitude: sp.latitude,
      longitude: sp.longitude,
    }));

    this.gameState.initialize(
      engine,
      this.streetNetwork,
      { lat: base.latitude, lon: base.longitude },
      waveSpawnPoints,
      this.pathRoute.getCachedPath.bind(this.pathRoute) as any, // Use pathRoute's cache
      (msg: string) => this.uiState.appendDebugLog(msg),
      () => this.onGameOver()
    );

    // Initialize tower placement service (now that all dependencies are ready)
    this.initializeTowerPlacement();

    return this.pathRoute.getRouteDetail();
  }

  /**
   * Schedule overlay height updates
   */
  private async scheduleOverlayHeightUpdate(): Promise<void> {
    // Get engine from service (this.engine may not be set yet during init)
    const engine = this.engineInit.getEngine();
    if (!engine) {
      console.warn('[TD] scheduleOverlayHeightUpdate - no engine from service!');
      return;
    }

    const base = this.baseCoords();

    // Initialize height update service with callbacks
    this.heightUpdate.initialize(
      engine,
      { lat: base.latitude, lon: base.longitude },
      this.engineInit.loadingStatus,
      () => {
        // Update marker heights
        const spawnPointsForMarkers = this.spawnPoints().map(sp => ({
          id: sp.id,
          name: sp.name,
          latitude: sp.latitude,
          longitude: sp.longitude,
          color: sp.color,
        }));
        this.markerViz.updateMarkerHeights(spawnPointsForMarkers);
      },
      () => this.renderStreets(),
      (detail: string) => this.engineInit.setStepDone('finalize', detail),
      (detail: string) => this.engineInit.updateStepDetail('finalize', detail),
      () => this.checkAllLoaded()
    );

    await this.heightUpdate.scheduleOverlayHeightUpdate();
  }

  /**
   * Save current camera position as initial position for reset
   * NOTE: Framing is now done by CameraFramingService BEFORE engine init
   * This method only saves the (already correct) position, no re-framing
   */
  private saveInitialCameraPosition(): void {
    // Show debug visualization if enabled (using old service for now)
    const hq = this.baseCoords();
    const spawns = this.spawnPoints();
    if (spawns.length > 0) {
      const hqCoord = { lat: hq.latitude, lon: hq.longitude };
      const spawnCoords = spawns.map(s => ({ lat: s.latitude, lon: s.longitude }));
      this.cameraControl.showDebugVisualization(hqCoord, spawnCoords, 0.2);
    }

    // Save current position as the initial position (DO NOT re-frame!)
    this.cameraControl.saveInitialPosition();
  }

  private renderStreets(): void {
    // Get engine from service (this.engine may not be set yet during init)
    const engine = this.engine || this.engineInit.getEngine();
    if (!engine || !this.streetNetwork) return;

    const overlayGroup = engine.getOverlayGroup();

    // Remove existing street mesh (single object now instead of 600+ separate lines)
    if (this.streetLinesMesh) {
      overlayGroup.remove(this.streetLinesMesh);
      this.streetLinesMesh.geometry.dispose();
      (this.streetLinesMesh.material as THREE.Material).dispose();
      this.streetLinesMesh = null;
    }

    // Clear height debug markers
    this.markerViz.clearHeightDebugMarkers();

    // Height offset above terrain (0 = directly on terrain)
    const HEIGHT_ABOVE_GROUND = 0.5;

    // Get terrain height at HQ (origin) as reference
    const base = this.baseCoords();
    const originTerrainY = engine.getTerrainHeightAtGeo(base.latitude, base.longitude);
    if (originTerrainY === null) {
      return;
    }

    // Set overlay base Y so overlayGroup is positioned at terrain surface
    engine.setOverlayBaseY(originTerrainY);

    let hits = 0, misses = 0;
    // Always create debug markers (hidden by default) so toggleHeightDebug doesn't need to re-render
    const debugMarkerInterval = 10; // Only show every Nth marker to reduce clutter
    let debugMarkerCount = 0;

    // Collect all line segments for merged geometry (PERFORMANCE: 1 draw call instead of 600+)
    // LineSegments interprets vertices pairwise: [v0-v1], [v2-v3], [v4-v5]...
    const allSegmentVertices: number[] = [];
    let streetCount = 0;

    for (const street of this.streetNetwork.streets) {
      if (street.nodes.length < 2) continue;

      const points: THREE.Vector3[] = [];

      for (const node of street.nodes) {
        // Get terrain height at this position using local raycast
        const terrainY = engine.getTerrainHeightAtGeo(node.lat, node.lon);

        if (terrainY !== null) {
          hits++;
          // Use geoToLocalSimple for X/Z
          const local = engine.sync.geoToLocalSimple(node.lat, node.lon, 0);
          // Y = height difference from origin + offset above ground
          local.y = (terrainY - originTerrainY) + HEIGHT_ABOVE_GROUND;
          points.push(local);

          // Add debug marker (only every Nth point) - always create, visibility controlled separately
          if (debugMarkerCount % debugMarkerInterval === 0) {
            this.markerViz.addHeightDebugMarker(local, terrainY, true);
          }
          debugMarkerCount++;
        } else {
          misses++;
          // Add red debug marker for misses (only every Nth point)
          if (debugMarkerCount % debugMarkerInterval === 0) {
            const localMiss = engine.sync.geoToLocalSimple(node.lat, node.lon, 5);
            this.markerViz.addHeightDebugMarker(localMiss, null, false);
          }
          debugMarkerCount++;
        }
      }

      // Only render street if we have at least 2 points
      if (points.length < 2) continue;

      // Smooth out height anomalies (e.g., hitting buildings instead of ground)
      const smoothedPoints = this.pathRoute.smoothPathHeights(points);

      // Convert connected points to line segments for LineSegments geometry
      // [A, B, C, D] -> segments: [A-B, B-C, C-D] -> vertices: [A, B, B, C, C, D]
      for (let i = 0; i < smoothedPoints.length - 1; i++) {
        const p1 = smoothedPoints[i];
        const p2 = smoothedPoints[i + 1];
        allSegmentVertices.push(p1.x, p1.y, p1.z);
        allSegmentVertices.push(p2.x, p2.y, p2.z);
      }
      streetCount++;
    }

    // Create single merged geometry with all street segments
    if (allSegmentVertices.length > 0) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(allSegmentVertices, 3));

      // Single material for all streets (no more cloning per street!)
      const material = new THREE.LineBasicMaterial({
        color: 0xffd700,
        linewidth: 2,
        depthTest: true,
        depthWrite: false,
        transparent: true,
        opacity: 0.9
      });

      this.streetLinesMesh = new THREE.LineSegments(geometry, material);
      this.streetLinesMesh.visible = this.streetsVisible();
      this.streetLinesMesh.renderOrder = 1;
      this.streetLinesMesh.frustumCulled = false;  // Prevent disappearing at certain angles
      overlayGroup.add(this.streetLinesMesh);
    }

  }



  /**
   * Toggle height debug visualization (just visibility, no re-render)
   */
  toggleHeightDebug(): void {
    this.heightDebugVisible.update((v) => !v);
    this.markerViz.toggleHeightDebug(this.heightDebugVisible());
  }

  /**
   * Called automatically when tiles finish loading (LOD changes)
   * Re-renders terrain-following elements with updated geometry
   */
  private onTilesLoaded(): void {
    if (!this.engine || !this.streetNetwork) return;

    // Re-render streets with new terrain data
    this.renderStreets();

    // Update marker heights via service
    const spawnPointsForMarkers = this.spawnPoints().map(sp => ({
      id: sp.id,
      name: sp.name,
      latitude: sp.latitude,
      longitude: sp.longitude,
      color: sp.color,
    }));
    this.markerViz.updateMarkerHeights(spawnPointsForMarkers);

    // Re-render route lines (clear and re-create)
    this.pathRoute.refreshRouteLines(this.spawnPoints());
  }

  /**
   * Called each frame for animations
   */
  private onEngineUpdate(deltaTime: number): void {
    // Update FPS, tile stats, and attributions
    if (this.engine) {
      this.fps.set(this.engine.getFPS());
      this.tileStats.set(this.engine.getTileStats());

      // Update attributions (throttled - only when tiles change)
      const attr = this.engine.getAttributions();
      if (attr && attr !== this.mapAttribution()) {
        this.mapAttribution.set(attr || 'Map data ©2024 Google');
      }

      // Update compass heading with smooth rotation (avoids 0°/360° flip)
      const heading = Math.round(this.cameraControl.getCameraHeading());
      if (heading !== this.cameraHeading()) {
        const oldHeading = this.cameraHeading();
        this.cameraHeading.set(heading);

        // Calculate shortest rotation delta (handles 0°/360° wrap-around)
        let delta = heading - oldHeading;
        if (delta > 180) delta -= 360;
        if (delta < -180) delta += 360;

        // Accumulate rotation for smooth compass animation
        this.compassRotation.update(rot => rot + delta);
      }

      // Update camera debug info (only when debug overlay is enabled)
      if (this.cameraDebugEnabled()) {
        this.cameraDebugInfo.set(this.cameraControl.getCameraDebugInfo());
      }
    }

    // Animate markers (HQ rotation, spawn pulse)
    this.markerViz.animateMarkers(deltaTime);
  }


  /**
   * Get spawn coordinates for initial camera framing (BEFORE engine init)
   * Returns coordinates without adding them to the scene
   */
  private getSpawnCoordinatesForFraming(): GeoPoint[] {
    const spawns = this.editableSpawnLocations();
    if (spawns.length > 0 && spawns.every(s => s.lat !== 0 && s.lon !== 0)) {
      return spawns.map(s => ({ lat: s.lat, lon: s.lon }));
    }
    return DEFAULT_SPAWN_POINTS.map(s => ({ lat: s.latitude, lon: s.longitude }));
  }

  private addPredefinedSpawns(): number {
    const colors = [0xef4444, 0xf97316, 0x00bcd4, 0xff00ff]; // red, orange, cyan, magenta

    // Use editable spawn locations if available, otherwise defaults
    const spawns = this.editableSpawnLocations();
    let count = 0;
    if (spawns.length > 0 && spawns.every(s => s.lat !== 0 && s.lon !== 0)) {
      spawns.forEach((spawn, index) => {
        this.addSpawnPoint(spawn.id, spawn.name || `Spawn ${index + 1}`, spawn.lat, spawn.lon, colors[index % colors.length]);
        count++;
      });
    } else {
      DEFAULT_SPAWN_POINTS.forEach((spawn, index) => {
        this.addSpawnPoint(spawn.id, spawn.name, spawn.latitude, spawn.longitude, colors[index % colors.length]);
        count++;
      });
    }
    return count;
  }

  /**
   * Add a spawn point (delegates to services)
   */
  addSpawnPoint(id: string, name: string, lat: number, lon: number, color: number): void {
    // Use engine from service if component's engine reference not yet set
    const engine = this.engine || this.engineInit.getEngine();
    if (!engine || !this.streetNetwork) return;

    const spawn: SpawnPoint = { id, name, latitude: lat, longitude: lon, color };
    this.spawnPoints.update((points) => [...points, spawn]);

    // Add visual marker via service
    this.markerViz.addSpawnMarker(id, name, lat, lon, color);

    // Update spawn markers reference in pathRoute service
    this.pathRoute.updateSpawnMarkers(this.markerViz.getSpawnMarkers());

    // Calculate and render path via service
    this.pathRoute.showPathFromSpawn(spawn);
  }

  /**
   * Place tower at specific geo position with known height
   * Height should come from localToGeo(raycastHit) for accuracy
   */
  private placeTowerAt(lat: number, lon: number, height: number): void {
    if (!this.engine) return;

    const position: GeoPosition = { lat, lon, height };
    const typeId = this.selectedTowerType();

    this.gameState.placeTower(position, typeId);
  }

  /**
   * @deprecated Use placeTowerAt with raycast Y instead
   */
  private async placeTower(lat: number, lon: number): Promise<void> {
    if (!this.engine) return;

    // Sample terrain height at placement position
    const terrainHeight = await this.engine.getTerrainHeight(lat, lon);

    const position: GeoPosition = { lat, lon, height: terrainHeight };
    const typeId = this.selectedTowerType();

    // Use the new manager API - it handles rendering automatically
    this.gameState.placeTower(position, typeId);
  }

  /**
   * Toggle build mode - delegates to TowerPlacementService
   */
  toggleBuildMode(): void {
    this.towerPlacement.toggleBuildMode();
  }

  /**
   * Select a tower type and activate build mode - delegates to TowerPlacementService
   */
  selectTowerType(typeId: TowerTypeId): void {
    this.towerPlacement.selectTowerType(typeId);
  }

  /**
   * Initialize all 3D model previews
   */
  private initPreviews(): void {
    this.modelPreview.initialize();
    this.initEnemyPreview();
    this.initTowerPreviews();
  }

  /**
   * Initialize the enemy preview in the wave section
   */
  private initEnemyPreview(): void {
    if (!this.enemyPreviewCanvas?.nativeElement) return;

    const enemyConfig = this.currentEnemyConfig();
    this.modelPreview.createPreview(
      'enemy-preview',
      this.enemyPreviewCanvas.nativeElement,
      {
        modelUrl: enemyConfig.modelUrl,
        scale: enemyConfig.scale * 0.5,
        rotationSpeed: 0.4,
        cameraDistance: 7,
        cameraAngle: Math.PI / 12,
        animationName: enemyConfig.walkAnimation || enemyConfig.idleAnimation || undefined,
        animationTimeScale: 0.7,
        lightIntensity: 1.3,
        groundModel: true,
      }
    );
  }

  /**
   * Initialize tower previews in the build menu
   */
  private initTowerPreviews(): void {
    if (!this.towerPreviewCanvases) return;

    this.towerPreviewCanvases.forEach((canvasRef) => {
      const canvas = canvasRef.nativeElement;
      const towerId = canvas.getAttribute('data-tower-id') as TowerTypeId;
      if (!towerId) return;

      const towerConfig = TOWER_TYPES[towerId];
      if (!towerConfig) return;

      this.modelPreview.createPreview(
        `tower-preview-${towerId}`,
        canvas,
        {
          modelUrl: towerConfig.modelUrl,
          scale: towerConfig.scale * 0.4,
          rotationSpeed: 0.4,
          cameraDistance: 20,
          cameraAngle: Math.PI / 5,
          lightIntensity: 1.2,
        }
      );
    });
  }

  /**
   * Sell the currently selected tower
   */
  sellSelectedTower(): void {
    const tower = this.gameState.selectedTower();
    if (tower) {
      this.gameState.sellTower(tower);
    }
  }

  /**
   * Upgrade a tower with the specified upgrade
   */
  upgradeTower(tower: Tower, upgradeId: UpgradeId): void {
    const upgrade = tower.typeConfig.upgrades.find(u => u.id === upgradeId);
    if (!upgrade) return;

    // Check if we can afford it
    if (this.gameState.credits() < upgrade.cost) {
      return;
    }

    // Check if upgrade can be applied
    if (!tower.canUpgrade(upgradeId)) {
      return;
    }

    // Deduct credits and apply upgrade
    this.gameState.spendCredits(upgrade.cost);
    tower.applyUpgrade(upgradeId);
  }

  /**
   * Startet eine neue Welle mit dem 2-Phasen-System:
   *
   * PHASE 1 - SAMMELN (ca. N * 100ms):
   * - Gegner spawnen nacheinander (100ms Delay)
   * - Stehen still am Spawn-Punkt (paused=true)
   * - Models werden asynchron geladen → verteilt GPU-Last
   *
   * PHASE 2 - ANGRIFF (nach 500ms Pause):
   * - Gegner laufen einzeln los (300ms Delay zwischen jedem)
   * - Walk-Animation startet
   * - Game-Loop beginnt
   */
  startWave(): void {
    if (!this.engine || this.waveActive() || this.isGameOver()) return;

    const spawns = this.spawnPoints();
    if (spawns.length === 0) return;

    const totalEnemies = this.enemyCount();
    const gathering = this.useGathering();

    // Reset abort flag at start of new wave
    this.waveAborted = false;

    this.gameState.beginWave();

    if (gathering) {
      this.gatheringPhase.set(true);
    }

    // Start game loop immediately (enemies will be updated as they spawn)
    this.startGameLoop();

    let spawnedCount = 0;

    const spawnNext = () => {
      // Stop spawning if wave was aborted
      if (this.waveAborted) {
        this.gatheringPhase.set(false);
        return;
      }

      if (spawnedCount >= totalEnemies) {
        if (gathering) {
          // Gathering mode: Start all enemies together after short delay
          setTimeout(() => {
            if (!this.waveAborted) {
              this.gatheringPhase.set(false);
              this.gameState.startAllEnemies(300); // 300ms zwischen jedem Start
            }
          }, 500);
        }
        return;
      }

      // Read current settings live (allows changing during wave)
      const mode = this.spawnMode();
      const speed = this.enemySpeed();

      // Spawn-Punkt auswählen (Verteilt oder Zufällig)
      let currentSpawn: SpawnPoint;
      if (mode === 'each') {
        currentSpawn = spawns[spawnedCount % spawns.length];
      } else {
        currentSpawn = spawns[Math.floor(Math.random() * spawns.length)];
      }

      const spawnPath = this.pathRoute.getCachedPath(currentSpawn.id);

      if (spawnPath && spawnPath.length > 1) {
        // In gathering mode: spawn paused, otherwise spawn and start immediately
        this.gameState.spawnEnemy(spawnPath, this.enemyType(), speed, gathering);
        spawnedCount++;
      }

      // Read delay live for next spawn
      setTimeout(spawnNext, this.spawnDelay());
    };

    spawnNext();
  }

  private startGameLoop(): void {
    const animate = () => {
      if (!this.engine || this.gameState.phase() === 'gameover') {
        this.animationFrameId = null;
        return;
      }

      const currentTime = performance.now();
      this.gameState.update(currentTime);

      if (this.gameState.checkWaveComplete()) {
        this.gameState.endWave();
        this.animationFrameId = null;
        return;
      }

      this.animationFrameId = requestAnimationFrame(animate);
    };

    this.animationFrameId = requestAnimationFrame(animate);
  }

  /**
   * Reset camera - delegates to CameraControlService
   */
  resetCamera(): void {
    this.cameraControl.resetCamera();
  }

  /**
   * Toggle streets visibility - delegates to GameUIStateService
   */
  toggleStreets(): void {
    this.uiState.toggleStreets();
    const visible = this.uiState.streetsVisible();

    // Single mesh now instead of iterating over 600+ lines
    if (this.streetLinesMesh) {
      this.streetLinesMesh.visible = visible;
    }
  }

  /**
   * Toggle routes visibility - delegates to GameUIStateService + PathAndRouteService
   */
  toggleRoutes(): void {
    this.uiState.toggleRoutes();
    this.pathRoute.setRouteLinesVisible(this.uiState.routesVisible());
  }

  /**
   * Toggle tower debug visibility - delegates to GameUIStateService
   */
  toggleTowerDebug(): void {
    this.uiState.toggleTowerDebug();
    const visible = this.uiState.towerDebugVisible();

    if (this.engine) {
      this.engine.towers.setDebugMode(visible);
    }
  }

  /**
   * Toggle debug panel - delegates to GameUIStateService
   */
  toggleDebug(): void {
    this.uiState.toggleDebug();
  }

  /**
   * Toggle camera framing debug visualization
   * Shows bounding boxes for HQ+spawns framing algorithm
   */
  toggleCameraFramingDebug(): void {
    const enabled = this.cameraControl.toggleDebugFraming();
    this.cameraFramingDebug.set(enabled);

    if (enabled) {
      // Show current framing visualization
      const hq = this.baseCoords();
      const spawns = this.spawnPoints();
      if (spawns.length > 0) {
        this.cameraControl.showDebugVisualization(
          { lat: hq.latitude, lon: hq.longitude },
          spawns.map(s => ({ lat: s.latitude, lon: s.longitude })),
          0.2
        );
      }
    }
  }

  /**
   * Toggle camera debug overlay
   * Shows real-time camera position, angles, and other stats
   */
  toggleCameraDebug(): void {
    const enabled = !this.cameraDebugEnabled();
    this.cameraDebugEnabled.set(enabled);

    if (enabled) {
      // Immediately update debug info
      this.cameraDebugInfo.set(this.cameraControl.getCameraDebugInfo());
    } else {
      this.cameraDebugInfo.set(null);
    }
  }

  /**
   * Toggle layer menu - delegates to GameUIStateService
   */
  toggleLayerMenu(): void {
    this.uiState.toggleLayerMenu();
  }

  /**
   * Toggle dev menu - delegates to GameUIStateService
   */
  toggleDevMenu(): void {
    this.uiState.toggleDevMenu();
  }

  resetToDefaultLocation(): void {
    // Use the existing reset method
    this.onResetLocations();

    // Close dev menu
    this.devMenuExpanded.set(false);
  }

  logCameraPosition(): void {
    if (!this.engine) return;

    const camera = this.engine.getCamera();

    const data = {
      position: {
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z,
      },
      hq: this.baseCoords(),
      tiltAngle: 45, // fixed
    };

    const output = JSON.stringify(data, null, 2);

    // Log to debug textarea
    this.appendDebugLog('=== CAMERA ===\n' + output);
  }

  onSpeedChange(value: number): void {
    this.enemySpeed.set(value);
    // Update all existing enemies live (m/s)
    for (const enemy of this.gameState.enemies()) {
      enemy.movement.speedMps = value;
    }
  }

  onEnemyCountChange(value: number): void {
    this.enemyCount.set(value);
  }

  onEnemyTypeChange(typeId: EnemyTypeId): void {
    this.enemyType.set(typeId);
  }

  toggleSpawnMode(): void {
    this.spawnMode.update((mode) => (mode === 'each' ? 'random' : 'each'));
  }

  onSpawnDelayChange(value: number): void {
    this.spawnDelay.set(value);
  }

  toggleGathering(): void {
    this.useGathering.update((v) => !v);
  }

  killAllEnemies(): void {
    // Stop spawning new enemies
    this.waveAborted = true;
    this.gatheringPhase.set(false);

    // Kill all living enemies
    const enemies = this.gameState.enemies();
    for (const enemy of enemies) {
      if (enemy.alive) {
        this.gameState.killEnemy(enemy);
      }
    }

    // End the wave after a short delay (to let death animations play)
    setTimeout(() => {
      if (this.waveActive()) {
        this.gameState.endWave();
      }
    }, 500);
  }

  healHq(): void {
    // HQ auf 100 HP heilen und Feuer stoppen
    this.gameState.healBase();
    this.appendDebugLog('HQ geheilt (100 HP)');
  }

  clearDebugLog(): void {
    this.debugLog.set('');
  }

  appendDebugLog(message: string): void {
    this.debugLog.update((log) => {
      const lines = log.split('\n');
      // Max 50 Zeilen behalten
      if (lines.length > 50) {
        lines.shift();
      }
      return [...lines, message].join('\n');
    });
  }

  close(): void {
    this.dialogRef?.close();
  }

  get isDialog(): boolean {
    return !!this.dialogRef;
  }

  private onGameOver(): void {
    // Stop game loop
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  restartGame(): void {
    this.gameState.reset();
  }


  // ==================== Location Settings Methods ====================

  /**
   * Initialize editable locations from current values or localStorage
   */
  private initializeEditableLocations(): void {
    // Try to load from localStorage
    const savedLocations = this.loadLocationsFromStorage();

    if (savedLocations && savedLocations.hq) {
      this.editableHqLocation.set(savedLocations.hq);
      this.editableSpawnLocations.set(savedLocations.spawns);

      // Apply saved locations
      this.baseCoords.set({
        latitude: savedLocations.hq.lat,
        longitude: savedLocations.hq.lon,
      });
      this.centerCoords.set({
        latitude: savedLocations.hq.lat,
        longitude: savedLocations.hq.lon,
        height: 400,
      });
    } else {
      // Initialize from defaults
      const base = this.baseCoords();
      this.editableHqLocation.set({
        lat: base.latitude,
        lon: base.longitude,
        name: 'Erlenbach (Default)',
      });

      // Convert spawn points to editable format
      const editableSpawns: SpawnLocationConfig[] = DEFAULT_SPAWN_POINTS.map((sp) => ({
        id: sp.id,
        lat: sp.latitude,
        lon: sp.longitude,
        name: sp.name,
      }));
      this.editableSpawnLocations.set(editableSpawns);
    }
  }

  /**
   * Apply new location - full reset like initial load
   * Shows loading overlay and waits for tiles + streets to load
   * CRITICAL: Follow correct reset sequence to avoid ghost entities
   */
  async onApplyNewLocation(data: { hq: LocationConfig; spawn: LocationConfig }): Promise<void> {
    if (!this.engine) {
      console.error('[Location] No engine available');
      return;
    }

    // STEP 1: Show loading overlay and reset steps
    this.loading.set(true);
    this.tilesLoading.set(true);
    this.osmLoading.set(true);
    this.heightsLoading.set(true);
    this.isApplyingLocation.set(true);
    this.heightProgress.set(0);
    this.engineInit.resetLoadingSteps();

    try {
      // STEP 2: Initialize (stop height updates, reset game)
      await this.engineInit.setStepActive('init');
      this.heightUpdate.stopHeightUpdates();
      this.gameState.reset();
      this.appendDebugLog('Spielstand zurückgesetzt');
      this.clearMapEntities();
      this.pathRoute.clearCache();
      this.spawnPoints.set([]);

      // Update engine origin
      this.engine.setOrigin(data.hq.lat, data.hq.lon);
      this.engine.clearDebugHelpers();

      // Update coordinates
      this.baseCoords.set({ latitude: data.hq.lat, longitude: data.hq.lon });
      this.centerCoords.set({ latitude: data.hq.lat, longitude: data.hq.lon, height: 400 });

      // Update editable state
      this.editableHqLocation.set(data.hq);
      const spawnConfig: SpawnLocationConfig = { id: 'spawn-1', ...data.spawn };
      this.editableSpawnLocations.set([spawnConfig]);

      // Compute and apply optimal camera framing IMMEDIATELY (before tiles load)
      const hqCoord: GeoPoint = { lat: data.hq.lat, lon: data.hq.lon };
      const spawnCoords: GeoPoint[] = [{ lat: data.spawn.lat, lon: data.spawn.lon }];
      const initialFrame = this.cameraFraming.computeInitialFrame(hqCoord, spawnCoords, {
        padding: 0.2,
        angle: 70,
        markerRadius: 8,
        estimatedTerrainY: 0,
      });
      this.cameraFraming.setEngine(this.engine);
      this.cameraFraming.applyFrame(initialFrame);

      await this.engineInit.setStepDone('init');

      // Set up tiles loaded callback (runs in background)
      const tilesLoadedPromise = new Promise<void>((resolve) => {
        this.engine!.setOnFirstTilesLoadedCallback(() => {
          this.tilesLoading.set(false);
          this.checkAllLoaded();
          resolve();
        });
      });

      // STEP 3: Load streets in parallel with tiles
      await this.engineInit.setStepActive('streets');
      const streetsPromise = this.osmService.loadStreets(data.hq.lat, data.hq.lon, 2000);

      // Wait for streets to load
      this.streetNetwork = await streetsPromise;
      this.streetCount.set(this.streetNetwork.streets.length);
      this.osmLoading.set(false);
      const streetCnt = this.streetCount();
      await this.engineInit.setStepDone('streets', streetCnt > 0 ? `${streetCnt} Straßen` : undefined);
      this.checkAllLoaded();

      // Wait for tiles to load (with timeout fallback)
      await Promise.race([
        tilesLoadedPromise,
        new Promise<void>((resolve) => setTimeout(() => {
          this.tilesLoading.set(false);
          resolve();
        }, 10000)) // 10 second timeout
      ]);

      // Render streets (now that terrain is available)
      this.renderStreets();

      // STEP 4: Place HQ marker
      await this.engineInit.setStepActive('hq');
      // Reinitialize visualization services with new coordinates
      this.markerViz.initialize(this.engine, { lat: data.hq.lat, lon: data.hq.lon }, this.heightDebugVisible);
      this.pathRoute.initialize(
        this.engine,
        this.streetNetwork!,
        { lat: data.hq.lat, lon: data.hq.lon },
        this.uiState.routesVisible,
        this.osmService,
        this.markerViz.getSpawnMarkers()
      );
      this.cameraControl.initialize(this.engine, { lat: data.hq.lat, lon: data.hq.lon });
      this.markerViz.addBaseMarker();
      await this.engineInit.setStepDone('hq');

      // STEP 5: Place spawn point
      await this.engineInit.setStepActive('spawn');
      this.addSpawnPoint('spawn-1', data.spawn.name?.split(',')[0] || 'Spawn', data.spawn.lat, data.spawn.lon, 0xef4444);
      await this.engineInit.setStepDone('spawn', '1 Punkt');

      // STEP 6: Calculate route
      await this.engineInit.setStepActive('route');
      const base = this.baseCoords();
      const waveSpawnPoints: WaveSpawnPoint[] = this.spawnPoints().map((sp) => ({
        id: sp.id,
        name: sp.name,
        latitude: sp.latitude,
        longitude: sp.longitude,
      }));

      this.gameState.initialize(
        this.engine,
        this.streetNetwork!,
        { lat: base.latitude, lon: base.longitude },
        waveSpawnPoints,
        this.pathRoute.getCachedPaths(),
        (msg: string) => this.appendDebugLog(msg),
        () => this.onGameOver()
      );

      // Re-initialize TowerPlacementService with new location data
      this.initializeTowerPlacement();

      // Get route details for display
      const routeDetail = this.pathRoute.getRouteDetail();
      await this.engineInit.setStepDone('route', routeDetail);

      // STEP 7: Finalize 3D view (waits for tiles + height sync)
      await this.engineInit.setStepActive('finalize');
      this.scheduleOverlayHeightUpdate();

      // STEP 18: Save to localStorage
      this.saveLocationsToStorage();

      // STEP 19: Correct camera Y and save position (after tiles stabilize)
      // Note: flyToCenter() removed - we already applied optimal framing above
      setTimeout(() => {
        // Correct Y position based on actual terrain height
        const realTerrainY = this.engine!.getTerrainHeightAtGeo(data.hq.lat, data.hq.lon) ?? 0;
        if (Math.abs(realTerrainY) > 1) {
          this.cameraFraming.correctTerrainHeight(realTerrainY, 0);
        }
        // Save the corrected position as initial
        this.saveInitialCameraPosition();
      }, 2000);

      this.appendDebugLog(`Geladen: ${this.streetCount()} Strassen`);

      // Loading overlay will be hidden by checkAllLoaded() when heights stabilize
      this.isApplyingLocation.set(false);

    } catch (err) {
      console.error('[Location] Failed to apply location:', err);
      this.appendDebugLog(`Fehler: ${err instanceof Error ? err.message : 'Unbekannt'}`);
      this.error.set(err instanceof Error ? err.message : 'Fehler beim Standortwechsel');

      // On error, force hide overlay and reset states
      this.loading.set(false);
      this.tilesLoading.set(false);
      this.osmLoading.set(false);
      this.heightsLoading.set(false);
      this.isApplyingLocation.set(false);
    }
  }

  /**
   * Open location dialog to change HQ and spawn point
   */
  openLocationDialog(): void {
    const hq = this.editableHqLocation();
    const spawn = this.editableSpawnLocations()[0];

    const dialogData: LocationDialogData = {
      currentLocation: hq
        ? {
            lat: hq.lat,
            lon: hq.lon,
            name: this.currentLocationName(),
            displayName: hq.name || '',
          }
        : null,
      currentSpawn: spawn
        ? {
            id: spawn.id,
            lat: spawn.lat,
            lon: spawn.lon,
            name: spawn.name,
          }
        : null,
      isGameInProgress: this.gameState.phase() !== 'setup' || this.gameState.waveNumber() > 0,
    };

    const dialogRef = this.dialog.open(LocationDialogComponent, {
      data: dialogData,
      panelClass: 'td-dialog-panel',
      disableClose: false,
    });

    dialogRef.afterClosed().subscribe(async (result: LocationDialogResult | null) => {
      if (!result?.confirmed) return;

      // Show loading overlay IMMEDIATELY before any async operations
      this.loading.set(true);
      this.engineInit.resetLoadingSteps();

      let spawnLat = result.spawn.lat;
      let spawnLon = result.spawn.lon;
      let spawnName = result.spawn.name;

      // Generate random spawn if requested
      if (result.spawn.isRandom && this.streetNetwork) {
        // First load streets for the new location to find spawn
        const newNetwork = await this.osmService.loadStreets(result.hq.lat, result.hq.lon, 2000);
        const randomSpawn = this.osmService.findRandomStreetPoint(newNetwork, result.hq.lat, result.hq.lon, 500, 1000);

        if (randomSpawn) {
          spawnLat = randomSpawn.lat;
          spawnLon = randomSpawn.lon;
          spawnName = randomSpawn.streetName || 'Zufälliger Spawn';
          this.appendDebugLog(`Zufälliger Spawn: ${Math.round(randomSpawn.distance)}m entfernt`);
        } else {
          this.appendDebugLog('Kein gültiger Spawn gefunden, verwende Fallback');
          // Fallback: use a point 700m north
          spawnLat = result.hq.lat + 0.0063; // ~700m north
          spawnLon = result.hq.lon;
          spawnName = 'Fallback Spawn';
        }
      }

      // Apply the new location
      await this.onApplyNewLocation({
        hq: {
          lat: result.hq.lat,
          lon: result.hq.lon,
          name: result.hq.displayName,
          address: result.hq.address,
        },
        spawn: {
          lat: spawnLat,
          lon: spawnLon,
          name: spawnName,
        },
      });
    });
  }

  onResetLocations(): void {
    this.onApplyNewLocation({
      hq: { lat: DEFAULT_BASE_COORDS.latitude, lon: DEFAULT_BASE_COORDS.longitude, name: 'Erlenbach (Default)' },
      spawn: { lat: DEFAULT_SPAWN_POINTS[0].latitude, lon: DEFAULT_SPAWN_POINTS[0].longitude, name: DEFAULT_SPAWN_POINTS[0].name },
    });
    localStorage.removeItem(LOCATION_STORAGE_KEY);
  }

  private clearMapEntities(): void {
    if (!this.engine) return;

    const overlayGroup = this.engine.getOverlayGroup();

    // Clear markers via service
    this.markerViz.clearAllMarkers();

    // Clear routes via service
    this.pathRoute.clearAllRoutes();

    // Clear street mesh (single object now)
    if (this.streetLinesMesh) {
      overlayGroup.remove(this.streetLinesMesh);
      this.streetLinesMesh.geometry.dispose();
      (this.streetLinesMesh.material as THREE.Material).dispose();
      this.streetLinesMesh = null;
    }

    // Clear spawn points signal
    this.spawnPoints.set([]);

    // Clear cached paths via service
    this.pathRoute.clearCachedPaths();
  }

  private flyToCenter(): void {
    if (!this.engine) return;

    // Use resetCamera for consistent positioning
    this.resetCamera();
  }

  private saveLocationsToStorage(): void {
    const data = {
      hq: this.editableHqLocation(),
      spawns: this.editableSpawnLocations(),
    };
    localStorage.setItem(LOCATION_STORAGE_KEY, JSON.stringify(data));
  }

  private loadLocationsFromStorage(): { hq: LocationConfig | null; spawns: SpawnLocationConfig[] } | null {
    try {
      const data = localStorage.getItem(LOCATION_STORAGE_KEY);
      if (!data) return null;
      return JSON.parse(data);
    } catch {
      return null;
    }
  }
}
