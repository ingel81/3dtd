import {
  Component,
  OnInit,
  OnDestroy,
  AfterViewInit,
  ElementRef,
  ViewChild,
  NgZone,
  signal,
  inject,
  computed,
  effect,
  HostListener,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef, MatDialog } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ConfigService } from './core/services/config.service';
import { OsmStreetService, StreetNetwork } from './services/osm-street.service';
import { EntityPoolService } from './services/entity-pool.service';
import { ModelPreviewService } from './services/model-preview.service';
import { getAllEnemyTypes } from './models/enemy-types';
import { LocationDialogComponent } from './components/location-dialog/location-dialog.component';
import { GameSidebarComponent } from './components/game-sidebar/game-sidebar.component';
import { CompassComponent } from './components/compass/compass.component';
import { GameHeaderComponent } from './components/game-header/game-header.component';
import { CameraDebuggerComponent } from './components/debug-window/camera-debugger.component';
import { WaveDebuggerComponent } from './components/debug-window/wave-debugger.component';
import { QuickActionsComponent } from './components/quick-actions/quick-actions.component';
import { InfoOverlayComponent } from './components/info-overlay/info-overlay.component';
import { ContextHintComponent, HintItem } from './components/context-hint/context-hint.component';
import { DebugWindowService } from './services/debug-window.service';
import { WaveDebugService } from './services/wave-debug.service';
import { LocationDialogData, LocationDialogResult, LocationConfig, SpawnLocationConfig } from './models/location.types';
// Refactoring services
import { GameUIStateService } from './services/game-ui-state.service';
import { CameraControlService } from './services/camera-control.service';
import { MarkerVisualizationService, SpawnPoint } from './services/marker-visualization.service';
import { PathAndRouteService } from './services/path-route.service';
import { InputHandlerService } from './services/input-handler.service';
import { TowerPlacementService } from './services/tower-placement.service';
import { LocationManagementService, DEFAULT_BASE_COORDS, DEFAULT_SPAWN_POINTS } from './services/location-management.service';
import { HeightUpdateService } from './services/height-update.service';
import { EngineInitializationService } from './services/engine-initialization.service';
import { CameraFramingService, GeoPoint } from './services/camera-framing.service';
import { RouteAnimationService } from './services/route-animation.service';
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
import { TOWER_TYPES, getAllTowerTypes, TowerTypeId, UpgradeId } from './configs/tower-types.config';
import { Tower } from './entities/tower.entity';

// Camera center coords (slightly different from HQ location for better view)
const DEFAULT_CENTER_COORDS = {
  latitude: 49.1726836,
  longitude: 9.2703122,
  height: 400,
};

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
    GameSidebarComponent,
    CompassComponent,
    GameHeaderComponent,
    CameraDebuggerComponent,
    WaveDebuggerComponent,
    QuickActionsComponent,
    InfoOverlayComponent,
    ContextHintComponent,
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
      <app-game-header
        [locationName]="currentLocationName()"
        [baseHealth]="gameState.baseHealth()"
        [credits]="gameState.credits()"
        [waveNumber]="gameState.waveNumber()"
        [enemiesAlive]="gameState.enemiesAlive()"
        [waveActive]="waveActive()"
        [isDialog]="isDialog"
        (locationClick)="openLocationDialog()"
        (closeClick)="close()"
      />

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
            <app-compass [rotation]="compassRotation()" [heading]="cameraHeading()" />

            <!-- Debug Windows (draggable) -->
            <app-camera-debugger />
            <app-wave-debugger
              (killAll)="killAllEnemies()"
              (healHq)="healHq()"
              (addCredits)="addDebugCredits()"
            />

            <!-- Info Overlay (top left) -->
            <app-info-overlay
              [fps]="fps()"
              [tileStats]="tileStats()"
              [enemiesAlive]="gameState.enemiesAlive()"
              [activeSounds]="activeSounds()"
              [streetCount]="streetCount()"
            />
          }

          <!-- Controls Hint -->
          @if (!loading() && !error()) {
            <div class="td-controls-hint">LMB: Pan | RMB: Rotate | Scroll: Zoom</div>

            <!-- Quick Actions (bottom right) -->
            <app-quick-actions
              [cameraFramingDebug]="cameraFramingDebug()"
              (resetCamera)="resetCamera()"
              (streetsToggled)="onStreetsToggled()"
              (routesToggled)="onRoutesToggled()"
              (towerDebugToggled)="onTowerDebugToggled()"
              (heightDebugToggled)="toggleHeightDebug()"
              (cameraFramingDebugToggled)="toggleCameraFramingDebug()"
              (resetToDefaultLocation)="resetToDefaultLocation()"
              (specialPointsDebugToggled)="onSpecialPointsDebugToggled()"
              (playRouteAnimation)="onPlayRouteAnimation()"
            />
          }

          <!-- Build Mode Context Hints -->
          @if (buildMode()) {
            <app-context-hint
              [hints]="buildModeHints"
              [warning]="buildModeWarning()"
            />
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

        <!-- Right Sidebar -->
        <app-game-sidebar
          [gameState]="gameState"
          [towerTypes]="towerTypes"
          [buildMode]="buildMode()"
          [waveActive]="waveActive()"
          [isGameOver]="isGameOver()"
          (startWave)="startWave()"
          (cancelBuild)="toggleBuildMode()"
          (selectTower)="selectTowerType($event)"
          (sellTower)="sellSelectedTower()"
          (upgradeTower)="upgradeTower($event.tower, $event.upgradeId)"
        />
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

  private readonly dialogRef = inject(MatDialogRef<TowerDefenseComponent>, { optional: true });
  private readonly dialog = inject(MatDialog);
  private readonly ngZone = inject(NgZone);
  private readonly osmService = inject(OsmStreetService);
  private readonly configService = inject(ConfigService);
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
  private readonly routeAnimation = inject(RouteAnimationService);

  // Debug services
  readonly debugWindows = inject(DebugWindowService);
  readonly waveDebug = inject(WaveDebugService);

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
  // Wave debug settings (proxied from WaveDebugService for backwards compatibility)
  readonly enemySpeed = this.waveDebug.enemySpeed;
  readonly streetCount = this.waveDebug.streetCount;
  readonly enemyCount = this.waveDebug.enemyCount;
  readonly enemyType = this.waveDebug.enemyType;
  readonly enemyTypes = getAllEnemyTypes();
  readonly spawnMode = this.waveDebug.spawnMode;
  readonly spawnDelay = this.waveDebug.spawnDelay;
  readonly useGathering = this.waveDebug.useGathering;
  readonly spawnPoints = signal<SpawnPoint[]>([]);
  readonly baseCoords = signal(DEFAULT_BASE_COORDS);
  readonly centerCoords = signal(DEFAULT_CENTER_COORDS);

  readonly waveActive = computed(() => this.gameState.phase() === 'wave');
  readonly isGameOver = computed(() => this.gameState.phase() === 'gameover');
  readonly currentEnemyConfig = this.waveDebug.currentEnemyConfig;

  // Build mode hints for context hint box
  readonly buildModeHints: HintItem[] = [
    { key: 'R', description: 'Drehen' },
    { key: 'Klick', description: 'Bauen' },
    { key: 'ESC', description: 'Abbruch' },
    { key: 'Warten', description: 'Sichtfeld' },
  ];
  readonly buildModeWarning = computed(() => this.towerPlacement.validationReason());

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
  readonly activeSounds = signal(0);
  private waveAborted = false;
  readonly gatheringCountdown = signal(0);

  private animationFrameId: number | null = null;

  // UI update throttling (avoid updating signals every frame)
  private lastUIUpdateTime = 0;
  private readonly UI_UPDATE_INTERVAL = 100; // ms - update UI stats ~10x per second instead of 60x
  private lastFps = 0;
  private lastActiveSounds = 0;

  constructor() {
    // Effect: Update all existing enemies when speed changes
    effect(() => {
      const speed = this.enemySpeed();
      for (const enemy of this.gameState.enemies()) {
        enemy.movement.speedMps = speed;
      }
    });

    // Effect: Sync wave debug state with game state
    effect(() => {
      const waveActive = this.waveActive();
      const baseHealth = this.gameState.baseHealth();
      const enemiesAlive = this.gameState.enemiesAlive();
      this.waveDebug.syncWaveState(waveActive, baseHealth, enemiesAlive);
    });
  }

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
  }

  /**
   * Handle keyboard events for build mode
   * R (hold) = Rotate tower preview continuously
   * Escape = Cancel build mode
   */
  @HostListener('window:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    // Only handle keys in build mode
    if (!this.towerPlacement.buildMode()) return;

    if (event.key === 'r' || event.key === 'R') {
      event.preventDefault();
      this.towerPlacement.startRotating();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.exitBuildMode();
    }
  }

  @HostListener('window:keyup', ['$event'])
  onKeyUp(event: KeyboardEvent): void {
    if (event.key === 'r' || event.key === 'R') {
      this.towerPlacement.stopRotating();
    }
  }

  /**
   * Exit build mode cleanly - calls service method that handles all cleanup
   */
  private exitBuildMode(): void {
    this.towerPlacement.exitBuildMode();
  }

  ngOnDestroy(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    this.entityPool.destroy();
    this.modelPreview.dispose();
    this.routeAnimation.dispose();
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
      // Get Cesium Ion credentials
      const cesiumToken = this.configService.cesiumIonToken();
      const cesiumAssetId = this.configService.cesiumAssetId();
      if (!cesiumToken) {
        this.engineInit.setError('Bitte konfiguriere deinen Cesium Ion Token in environment.ts.');
        this.engineInit.setLoading(false);
        return;
      }

      // Configure engine initialization service
      const canvas = this.gameCanvas.nativeElement;
      const base = this.baseCoords();
      this.engineInit.configure(canvas, cesiumToken, cesiumAssetId, { lat: base.latitude, lon: base.longitude });

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
    const wasLoading = this.loading();
    const isApplying = this.isApplyingLocation();

    this.engineInit.checkAllLoaded(this.heightUpdate.heightsLoading);
    const isNowLoading = this.loading();

    // console.log('[TD] checkAllLoaded - was:', wasLoading, 'now:', isNowLoading,
    //   'tiles:', this.tilesLoading(), 'osm:', this.osmLoading(),
    //   'heights:', this.heightUpdate.heightsLoading(), 'applying:', isApplying);

    // Start route animation when loading completes (transition from true to false)
    // BUT NOT if we're in the middle of applying a new location!
    if (wasLoading && !isNowLoading && !this.routeAnimation.isRunning() && !isApplying) {
      const cachedPaths = this.pathRoute.getCachedPaths();
      // console.log('[TD] Loading complete, starting route animation. Paths:', cachedPaths.size);
      if (cachedPaths.size > 0) {
        this.routeAnimation.startAnimation(cachedPaths, this.spawnPoints());
      }
    }
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

    // Initialize route animation service
    this.routeAnimation.initialize(engine);
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
   * Handle terrain click in build mode - directly places tower
   */
  private onTerrainClick(_lat: number, _lon: number, _height: number): void {
    // Position is already tracked internally by towerPlacement
    this.towerPlacement.handleBuildClick();
  }

  /**
   * Handle mouse move in build mode (for build preview)
   */
  private onMouseMove(lat: number, lon: number, hitPoint: THREE.Vector3): void {
    const terrainHeight = this.engine?.getTerrainHeightAtGeo(lat, lon) ?? hitPoint.y;
    this.towerPlacement.updatePreviewPosition(lat, lon, terrainHeight);
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

    // Reframe camera to include all route waypoints (routes may curve away from spawn-HQ line)
    this.reframeCameraWithRoutes();

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
      () => this.checkAllLoaded(),
      // Camera correction callback - runs BEFORE overlay hides
      () => {
        // console.log('[TD] Camera correction callback - BEFORE overlay hides');
        this.cameraFraming.setEngine(engine);
        const realTerrainY = engine.getTerrainHeightAtGeo(base.latitude, base.longitude) ?? 0;
        // console.log('[TD] Terrain height at base:', realTerrainY);
        if (Math.abs(realTerrainY) > 1) {
          this.cameraFraming.correctTerrainHeight(realTerrainY, 0);
        }
        this.saveInitialCameraPosition();
      }
    );

    await this.heightUpdate.scheduleOverlayHeightUpdate();
  }

  /**
   * Save current camera position as initial position for reset
   * NOTE: Framing is now done by CameraFramingService after routes are calculated
   * This method only saves the (already correct) position, no re-framing
   */
  private saveInitialCameraPosition(): void {
    // Show debug visualization if enabled (including routes)
    const hq = this.baseCoords();
    const spawns = this.spawnPoints();

    // Extract all route waypoints from cached paths
    const routePoints: { lat: number; lon: number }[] = [];
    const cachedPaths = this.pathRoute.getCachedPaths();
    cachedPaths.forEach((path) => {
      for (const pos of path) {
        routePoints.push({ lat: pos.lat, lon: pos.lon });
      }
    });

    if (spawns.length > 0) {
      const hqCoord = { lat: hq.latitude, lon: hq.longitude };
      const spawnCoords = spawns.map(s => ({ lat: s.latitude, lon: s.longitude }));
      this.cameraControl.showDebugVisualization(hqCoord, spawnCoords, 0.1, routePoints);
    }

    // Get target from last computed frame
    const lastFrame = this.cameraFraming.getLastFrame();
    const target = lastFrame
      ? { x: lastFrame.lookAtX, y: lastFrame.lookAtY, z: lastFrame.lookAtZ }
      : undefined;

    // Save current position and target as the initial position
    this.cameraControl.saveInitialPosition(target);
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

    // Update HQ terrain height and debug points in game state
    this.gameState.onTilesLoaded();
  }

  /**
   * Called each frame for animations (runs outside Angular zone)
   */
  private onEngineUpdate(deltaTime: number): void {
    // Update tower placement rotation (R key held) - deltaTime is in ms, convert to seconds
    this.towerPlacement.updateRotation(deltaTime / 1000);

    // Animate markers (HQ rotation, spawn pulse) - no signals, pure Three.js
    this.markerViz.animateMarkers(deltaTime);

    // Animate route visualization (Knight Rider effect) - no signals, pure Three.js
    this.routeAnimation.update(deltaTime);

    // Throttle UI signal updates to reduce Angular change detection overhead
    const now = performance.now();
    if (now - this.lastUIUpdateTime < this.UI_UPDATE_INTERVAL) {
      return; // Skip UI updates this frame
    }
    this.lastUIUpdateTime = now;

    // Update UI signals only when values changed (runs inside Angular zone for change detection)
    if (this.engine) {
      this.ngZone.run(() => {
        // FPS - only update if changed
        const newFps = this.engine!.getFPS();
        if (newFps !== this.lastFps) {
          this.lastFps = newFps;
          this.fps.set(newFps);
        }

        // Tile stats - only update if changed (compare by reference is fine, engine returns same object if unchanged)
        const newTileStats = this.engine!.getTileStats();
        this.tileStats.set(newTileStats);

        // Active sounds - only update if changed
        const newActiveSounds = this.engine!.spatialAudio.getActiveSoundCount();
        if (newActiveSounds !== this.lastActiveSounds) {
          this.lastActiveSounds = newActiveSounds;
          this.activeSounds.set(newActiveSounds);
        }

        // Attributions - only update if changed
        const attr = this.engine!.getAttributions();
        if (attr && attr !== this.mapAttribution()) {
          this.mapAttribution.set(attr || 'Map data ©2024 Google');
        }

        // Compass heading - only update if changed
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

        // Camera debug info - only when debug overlay is enabled
        if (this.cameraDebugEnabled()) {
          this.cameraDebugInfo.set(this.cameraControl.getCameraDebugInfo());
        }
      });
    }
  }


  /**
   * Reframe camera to include all calculated routes.
   * Routes may curve significantly due to rivers, bridges, or street layout,
   * so the initial frame (based only on spawns + HQ) may not show all waypoints.
   */
  private reframeCameraWithRoutes(): void {
    const base = this.baseCoords();
    const hq: GeoPoint = { lat: base.latitude, lon: base.longitude };

    // Get spawn coordinates
    const spawns: GeoPoint[] = this.spawnPoints().map(sp => ({
      lat: sp.latitude,
      lon: sp.longitude,
    }));

    // Extract all route waypoints from cached paths
    const routePoints: GeoPoint[] = [];
    const cachedPaths = this.pathRoute.getCachedPaths();
    console.log('[Reframe] Cached paths count:', cachedPaths.size);
    cachedPaths.forEach((path, spawnId) => {
      console.log(`[Reframe] Path for ${spawnId}: ${path.length} points`);
      for (const pos of path) {
        routePoints.push({ lat: pos.lat, lon: pos.lon });
      }
    });

    console.log('[Reframe] Total route points:', routePoints.length);
    if (routePoints.length > 0) {
      // Log min/max lat/lon to see the extent
      const lats = routePoints.map(p => p.lat);
      const lons = routePoints.map(p => p.lon);
      console.log('[Reframe] Lat range:', Math.min(...lats), '-', Math.max(...lats));
      console.log('[Reframe] Lon range:', Math.min(...lons), '-', Math.max(...lons));
    }

    // Only reframe if we have route points
    if (routePoints.length > 0) {
      this.cameraFraming.reframeWithRoutes(hq, spawns, routePoints, {
        padding: 0.1,
        angle: 70,
        markerRadius: 8,
      });
    }
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
    // Run game loop outside Angular zone to avoid triggering change detection every frame
    this.ngZone.runOutsideAngular(() => {
      const animate = () => {
        if (!this.engine || this.gameState.phase() === 'gameover') {
          this.animationFrameId = null;
          return;
        }

        const currentTime = performance.now();
        this.gameState.update(currentTime);

        if (this.gameState.checkWaveComplete()) {
          // End wave inside Angular zone to trigger UI updates
          this.ngZone.run(() => {
            this.gameState.endWave();
          });
          this.animationFrameId = null;
          return;
        }

        this.animationFrameId = requestAnimationFrame(animate);
      };

      this.animationFrameId = requestAnimationFrame(animate);
    });
  }

  /**
   * Reset camera - delegates to CameraControlService
   */
  resetCamera(): void {
    this.cameraControl.resetCamera();
  }

  /**
   * Handle streets toggle side effect (visibility already toggled by QuickActionsComponent)
   */
  onStreetsToggled(): void {
    if (this.streetLinesMesh) {
      this.streetLinesMesh.visible = this.uiState.streetsVisible();
    }
  }

  /**
   * Handle routes toggle side effect (visibility already toggled by QuickActionsComponent)
   */
  onRoutesToggled(): void {
    this.pathRoute.setRouteLinesVisible(this.uiState.routesVisible());
  }

  /**
   * Handle tower debug toggle side effect (visibility already toggled by QuickActionsComponent)
   */
  onTowerDebugToggled(): void {
    if (this.engine) {
      this.engine.towers.setDebugMode(this.uiState.towerDebugVisible());
    }
  }

  /**
   * Toggle special points debug (fire position markers, etc.)
   */
  onSpecialPointsDebugToggled(): void {
    this.uiState.toggleSpecialPointsDebug();
    const visible = this.uiState.specialPointsDebugVisible();

    if (this.engine) {
      this.engine.effects.setDebugSpheresVisible(visible);

      // Spawn HQ debug point if enabled and not yet spawned
      if (visible) {
        this.gameState.spawnHQDebugPoint();
      }
    }
  }

  /**
   * Manually trigger route animation playback
   */
  onPlayRouteAnimation(): void {
    const cachedPaths = this.pathRoute.getCachedPaths();
    if (cachedPaths.size > 0) {
      this.routeAnimation.startAnimation(cachedPaths, this.spawnPoints());
      console.log('[TowerDefense] Route animation manually triggered');
    } else {
      console.warn('[TowerDefense] No cached paths available for route animation');
    }
  }

  /**
   * Toggle camera framing debug visualization
   * Shows bounding boxes for HQ+spawns+routes framing algorithm
   */
  toggleCameraFramingDebug(): void {
    const enabled = this.cameraControl.toggleDebugFraming();
    this.cameraFramingDebug.set(enabled);

    if (enabled) {
      // Show current framing visualization (including routes)
      const hq = this.baseCoords();
      const spawns = this.spawnPoints();

      // Extract all route waypoints from cached paths
      const routePoints: { lat: number; lon: number }[] = [];
      const cachedPaths = this.pathRoute.getCachedPaths();
      cachedPaths.forEach((path) => {
        for (const pos of path) {
          routePoints.push({ lat: pos.lat, lon: pos.lon });
        }
      });

      if (spawns.length > 0) {
        this.cameraControl.showDebugVisualization(
          { lat: hq.latitude, lon: hq.longitude },
          spawns.map(s => ({ lat: s.latitude, lon: s.longitude })),
          0.1,
          routePoints
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

  resetToDefaultLocation(): void {
    // Use the existing reset method
    this.onResetLocations();

    // Close dev menu
    this.uiState.devMenuExpanded.set(false);
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

  addDebugCredits(): void {
    this.gameState.credits.update((c) => c + 1000);
    this.appendDebugLog('+1000 Credits (Debug)');
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
    // Stop spawning new enemies
    this.waveAborted = true;
    this.gatheringPhase.set(false);

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
      this.routeAnimation.stopAnimation();
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
      // Use same parameters as initEngine for consistent framing
      const hqCoord: GeoPoint = { lat: data.hq.lat, lon: data.hq.lon };
      const spawnCoords: GeoPoint[] = [{ lat: data.spawn.lat, lon: data.spawn.lon }];

      // Get camera properties from existing engine for accurate framing
      const camera = this.engine.getCamera();
      const aspectRatio = camera.aspect;
      const fov = camera.fov;

      const initialFrame = this.cameraFraming.computeInitialFrame(hqCoord, spawnCoords, {
        padding: 0.1, // Same as initEngine (was 0.2)
        angle: 70,
        markerRadius: 8,
        estimatedTerrainY: 0,
        aspectRatio, // Use actual camera aspect ratio
        fov, // Use actual camera FOV
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
      this.routeAnimation.initialize(this.engine);
      this.markerViz.addBaseMarker();
      await this.engineInit.setStepDone('hq');

      // STEP 5: Place spawn point
      await this.engineInit.setStepActive('spawn');
      // console.log('[Location] Adding spawn point, cached paths before:', this.pathRoute.getCachedPaths().size);
      this.addSpawnPoint('spawn-1', data.spawn.name?.split(',')[0] || 'Spawn', data.spawn.lat, data.spawn.lon, 0xef4444);
      // console.log('[Location] Spawn added, cached paths after:', this.pathRoute.getCachedPaths().size);
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
      // CRITICAL: Must await to ensure height updates complete, camera correction runs,
      // and overlay hides AFTER everything is ready (same as F5-reload path)
      await this.engineInit.setStepActive('finalize');
      await this.scheduleOverlayHeightUpdate();

      // Save to localStorage (after heights are stable)
      this.locationMgmt.saveLocationsToStorage();

      this.appendDebugLog(`Geladen: ${this.streetCount()} Strassen`);

      // Mark location change as complete
      this.isApplyingLocation.set(false);

      // Start route animation NOW (after everything is ready)
      // We do this manually because checkAllLoaded() skips animation while isApplyingLocation is true
      if (!this.routeAnimation.isRunning()) {
        const cachedPaths = this.pathRoute.getCachedPaths();
        // console.log('[Location] Location change complete, starting route animation. Paths:', cachedPaths.size);
        if (cachedPaths.size > 0) {
          this.routeAnimation.startAnimation(cachedPaths, this.spawnPoints());
        }
      }

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
    this.locationMgmt.clearLocationsFromStorage();
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
}
