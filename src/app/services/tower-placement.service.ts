import { Injectable, inject, signal, effect } from '@angular/core';
import { Object3D } from 'three';
import { ThreeTilesEngine } from '../three-engine';
import { StreetNetwork } from './location/osm-street.service';
import { OsmStreetService } from './location/osm-street.service';
import { PathAndRouteService } from './world/path-route.service';
import { GeoPosition } from '../models/game.types';
import { Tower } from '../entities/tower.entity';
import type { GameStateManager } from '../managers/game-state.manager';
import { TowerTypeId, TOWER_TYPES } from '../configs/tower-types.config';
import { GlobalRouteGridService } from './world/global-route-grid.service';
import { AssetManagerService } from './infrastructure/asset-manager.service';
import { UIStore } from '../store/ui.store';
import { TowerDefenseStore } from '../store/tower-defense.store';
import { checkTowerPlacement, TowerPlacementContext, TowerPlacementResult } from '../utils/tower-placement-rules';
import { ResearchStore } from '../store/research.store';
import { TowerLosRegistry } from './tower-los-registry';
import { BuildPreviewLos } from './build-preview-los';
import { makeModelTransparent, tintPreviewModel } from './tower-preview-model';

/**
 * TowerPlacementService
 *
 * Professional tower placement with:
 * - 3D tower preview following mouse cursor
 * - Green/red tint based on placement validity
 * - Line-of-Sight hex grid preview (BuildPreviewLos)
 * - Direct rotation control (tower faces mouse direction)
 *
 * Also the entry point for a placed tower's LOS on the route grid; the work
 * is done by TowerLosRegistry.
 */
@Injectable({ providedIn: 'root' })
export class TowerPlacementService {
  private globalRouteGrid = inject(GlobalRouteGridService);
  private assetManager = inject(AssetManagerService);
  private uiStore = inject(UIStore);
  private store = inject(TowerDefenseStore);
  private pathRouteService = inject(PathAndRouteService);
  private researchStore = inject(ResearchStore);

  // ========================================
  // SIGNALS (UIStore-backed)
  // ========================================

  /** Build mode active — owned by UIStore */
  readonly buildMode = this.uiStore.buildMode;

  /** Selected tower type — owned by UIStore */
  readonly selectedTowerType = this.uiStore.selectedTowerType;

  /** Build validation reason — owned by UIStore */
  readonly validationReason = this.uiStore.buildValidationReason;

  // ========================================
  // LOCAL SIGNALS (service-internal)
  // ========================================

  readonly currentRotation = signal(0);

  // ========================================
  // STATE
  // ========================================

  /** Per-tower LOS on the route grid: registration and refresh. */
  private readonly losRegistry = new TowerLosRegistry(
    this.globalRouteGrid,
    () => this.researchStore.airTargetingUnlocked(),
  );

  /** GPU-LOS-Viz der Build-Preview. */
  private readonly buildPreviewLos = new BuildPreviewLos(
    this.globalRouteGrid,
    () => this.researchStore.airTargetingUnlocked(),
  );

  /** Single preview tower mesh - used throughout placement */
  private previewTowerMesh: Object3D | null = null;

  /**
   * Reactive sync: jedes Mal wenn der User `perTowerLosFilter` im
   * UIStore cycled, applien wir den neuen Mode auf die aktive Build-
   * Preview-Viz. Selection-Viz hat ihr eigenes Pendant in TowerManager.
   */
  private readonly losFilterSync = effect(() => {
    const mode = this.uiStore.perTowerLosFilter();
    this.buildPreviewLos.setFilterMode(mode);
  });

  /** Flag indicating model is being loaded */
  private modelLoading = false;

  /**
   * Bumped by every exitBuildMode. A preview load that finishes after the
   * token moved on belongs to a build mode that is gone: cancelled, or
   * replaced by another type.
   */
  private previewLoadToken = 0;

  /** Queued position update while model was loading */
  private queuedPosition: { lat: number; lon: number; height: number } | null = null;

  /** Current preview position */
  private currentPosition: { lat: number; lon: number; height: number } | null = null;

  /** Rotation speed (radians per second when holding R) */
  private readonly ROTATION_SPEED = Math.PI; // 180 degrees per second

  /** Is currently rotating (R key held) */
  private isRotating = false;

  /** Last validated position (with cached resolvedHeight + validation result) */
  private lastValidation:
    | { lat: number; lon: number; resolvedHeight: number; valid: boolean; reason: string | null }
    | null = null;

  /** Distance (m) the cursor must travel before validation re-runs */
  private static readonly VALIDATION_MOVEMENT_THRESHOLD_M = 1.0;

  /** Track loaded model URLs for reference counting */
  private loadedModelUrls = new Set<string>();

  /** Dependencies */
  private engine: ThreeTilesEngine | null = null;
  private streetNetwork: StreetNetwork | null = null;
  private osmService: OsmStreetService | null = null;
  private baseCoords: GeoPosition | null = null;
  private gameState: GameStateManager | null = null;

  // ========================================
  // INITIALIZATION
  // ========================================

  initialize(
    engine: ThreeTilesEngine,
    streetNetwork: StreetNetwork,
    osmService: OsmStreetService,
    baseCoords: GeoPosition,
    gameState: GameStateManager
  ): void {
    this.engine = engine;
    this.streetNetwork = streetNetwork;
    this.osmService = osmService;
    this.baseCoords = baseCoords;
    this.gameState = gameState;

    // Runs again on every location change; the registry drops what it
    // queued for the previous one.
    this.losRegistry.attach(engine, gameState);
  }

  updateStreetNetwork(streetNetwork: StreetNetwork): void {
    this.streetNetwork = streetNetwork;
  }

  // ========================================
  // BUILD MODE
  // ========================================

  toggleBuildMode(): void {
    if (this.buildMode()) {
      this.exitBuildMode();
    } else {
      // Don't enter build mode here - use selectTowerType
    }
  }

  selectTowerType(typeId: TowerTypeId): void {
    // Clean up any previous state
    this.exitBuildMode();

    this.selectedTowerType.set(typeId);
    this.buildMode.set(true);

    // Deselect any previously selected tower (hides its LOS visualization)
    this.gameState?.towerManager.selectTower(null);

    // Pre-load the preview model
    this.loadPreviewModel(typeId);
  }

  /**
   * Exit build mode - cleanup all previews
   * Called internally after successful placement or externally on cancel (ESC)
   */
  exitBuildMode(): void {
    this.currentPosition = null;
    this.currentRotation.set(0);
    this.lastValidation = null;
    this.validationReason.set(null);
    this.isRotating = false;

    // Drop a preview that is still loading, and the cursor it would apply.
    this.previewLoadToken++;
    this.modelLoading = false;
    this.queuedPosition = null;

    // Clean up preview tower
    this.cleanupPreviewTower();

    // GPU-LOS-Preview-Viz auflösen
    this.buildPreviewLos.dispose();

    this.buildMode.set(false);
  }

  // ========================================
  // PREVIEW MODEL
  // ========================================

  private async loadPreviewModel(typeId: TowerTypeId): Promise<void> {
    // Clean up existing
    this.cleanupPreviewTower();
    this.modelLoading = true;

    const config = TOWER_TYPES[typeId];
    if (!config || !this.engine) {
      this.modelLoading = false;
      return;
    }

    const token = this.previewLoadToken;
    try {
      // Load via AssetManager (cached)
      await this.assetManager.loadModel(config.modelUrl);
      this.loadedModelUrls.add(config.modelUrl);
      // Build mode was left (or switched to another type) while loading.
      if (token !== this.previewLoadToken || !this.engine) return;

      // Clone the model for preview
      const model = this.assetManager.cloneModel(config.modelUrl);
      if (!model) {
        console.error(`[TowerPlacement] Failed to clone model: ${typeId}`);
        return;
      }

      model.scale.setScalar(config.scale);
      // Apply base rotation from config
      model.rotation.y = config.rotationY ?? 0;
      makeModelTransparent(model, 0.7);

      this.previewTowerMesh = model;
      this.previewTowerMesh.visible = false;
      this.engine.getOverlayGroup().add(this.previewTowerMesh);
    } catch (err) {
      console.error(`[TowerPlacement] Failed to load preview model: ${typeId}`, err);
    } finally {
      if (token === this.previewLoadToken) this.modelLoading = false;
    }
    if (token !== this.previewLoadToken) return;

    // Process queued position if any
    if (this.queuedPosition && this.buildMode()) {
      this.updatePreviewPosition(
        this.queuedPosition.lat,
        this.queuedPosition.lon,
        this.queuedPosition.height
      );
      this.queuedPosition = null;
    }
  }

  private cleanupPreviewTower(): void {
    if (this.previewTowerMesh && this.engine) {
      this.engine.getOverlayGroup().remove(this.previewTowerMesh);
      this.previewTowerMesh = null;
    }
  }

  // ========================================
  // PREVIEW POSITION UPDATE
  // ========================================

  private resolvePlacementHeight(lat: number, lon: number, fallbackHeight: number): number {
    if (!this.engine) {
      return fallbackHeight;
    }

    const devProvider = this.engine.getDevTerrainProvider();
    if (!devProvider) {
      return fallbackHeight;
    }

    const local = this.engine.sync.geoToLocalSimple(lat, lon, 0);
    const hit = devProvider.raycastDown(local.x, local.z, 10000);
    return hit ? hit.y : fallbackHeight;
  }

  /**
   * Public wrapper around resolvePlacementHeight — raycasts terrain+buildings
   * and returns the highest surface (rooftop if building is below).
   * Used by the bot so towers land on rooftops in DevWorld.
   */
  getSurfaceHeightAt(lat: number, lon: number, fallbackHeight: number): number {
    return this.resolvePlacementHeight(lat, lon, fallbackHeight);
  }

  /**
   * Update preview position - called on mouse move
   * In normal mode: tower follows cursor with validation coloring
   * In rotation mode: tower stays fixed, only rotation updates
   */
  updatePreviewPosition(lat: number, lon: number, terrainHeight: number): void {
    if (!this.engine) {
      return;
    }

    // If model is still loading, queue this position for later.
    if (this.modelLoading || !this.previewTowerMesh) {
      this.queuedPosition = { lat, lon, height: terrainHeight };
      return;
    }

    // Skip the expensive raycast + validation if the cursor barely moved.
    // Distance approximation (good for <100m at typical latitudes): treat
    // lat-lon deltas as metric via 111320 m/deg and a cos(lat) longitude
    // scale. Cheaper than haversine and allocation-free.
    let resolvedHeight: number;
    let validValid: boolean;
    let validReason: string | null;

    const reuseCache = this.lastValidation !== null
      && this.metersFromLastValidated(lat, lon) < TowerPlacementService.VALIDATION_MOVEMENT_THRESHOLD_M;

    if (reuseCache && this.lastValidation) {
      resolvedHeight = this.lastValidation.resolvedHeight;
      validValid = this.lastValidation.valid;
      validReason = this.lastValidation.reason;
    } else {
      resolvedHeight = this.resolvePlacementHeight(lat, lon, terrainHeight);
      const validation = this.validateTowerPosition(lat, lon);
      validValid = validation.valid;
      validReason = validation.valid ? null : (validation.reason ?? 'Invalid position');
      const previousValid = this.lastValidation?.valid ?? null;
      this.lastValidation = { lat, lon, resolvedHeight, valid: validValid, reason: validReason };
      // Material tint only flips when the valid/invalid result changes.
      if (previousValid === null || previousValid !== validValid) {
        tintPreviewModel(this.previewTowerMesh, validValid);
      }
    }

    this.validationReason.set(validValid ? null : (validReason ?? 'Invalid position'));

    // Store current position for placement
    this.currentPosition = { lat, lon, height: resolvedHeight };

    const typeId = this.selectedTowerType();
    if (!typeId) return;
    const config = TOWER_TYPES[typeId];
    if (!config) return;

    // Get local X/Z position (same as marker service)
    const local = this.engine.sync.geoToLocalSimple(lat, lon, 0);

    // Absolute scene Y — the overlay group no longer carries a terrain offset.
    const relativeY = resolvedHeight;

    // Position the preview tower
    this.previewTowerMesh.position.set(
      local.x,
      relativeY + config.heightOffset,
      local.z
    );

    // Apply rotation (base rotation + user rotation)
    const baseRotation = config.rotationY ?? 0;
    this.previewTowerMesh.rotation.y = baseRotation + this.currentRotation();
    this.previewTowerMesh.visible = true;

    // Update LoS preview only for valid positions (skip calculation for invalid spots)
    if (validValid) {
      this.buildPreviewLos.update(
        this.engine, lat, lon, resolvedHeight, typeId, this.uiStore.perTowerLosFilter(),
      );
    } else {
      // Invalid position — Preview-Viz auflösen (kein Debounce mehr).
      this.buildPreviewLos.dispose();
    }
  }

  /** Approximate meters between (lat, lon) and the last validated sample. */
  private metersFromLastValidated(lat: number, lon: number): number {
    const cache = this.lastValidation!;
    const dLat = (lat - cache.lat) * 111320;
    const dLon = (lon - cache.lon) * 111320 * Math.cos(lat * Math.PI / 180);
    return Math.sqrt(dLat * dLat + dLon * dLon);
  }

  /** Per-Frame-Tick für die GPU-LOS-Preview-Pulse-Animation. */
  tickBuildPreviewViz(timeSeconds: number): void {
    this.buildPreviewLos.tick(timeSeconds);
  }

  // ========================================
  // ROTATION (R key hold)
  // ========================================

  /**
   * Start continuous rotation (called on R key down)
   */
  startRotating(): void {
    this.isRotating = true;
  }

  /**
   * Stop continuous rotation (called on R key up)
   */
  stopRotating(): void {
    this.isRotating = false;
  }

  /**
   * Update rotation - call this in animation loop
   * @param deltaTime Time since last frame in seconds
   */
  updateRotation(deltaTime: number): void {
    if (!this.isRotating || !this.buildMode() || !this.previewTowerMesh) return;

    const newRotation = this.currentRotation() + this.ROTATION_SPEED * deltaTime;
    this.currentRotation.set(newRotation);

    // Apply rotation
    const typeId = this.selectedTowerType();
    const config = typeId ? TOWER_TYPES[typeId] : undefined;
    const baseRotation = config?.rotationY ?? 0;
    this.previewTowerMesh.rotation.y = baseRotation + newRotation;
  }

  hidePreview(): void {
    if (this.previewTowerMesh) {
      this.previewTowerMesh.visible = false;
    }
  }

  // ========================================
  // CLICK HANDLING
  // ========================================

  /**
   * Handle click in build mode - directly places tower if valid
   */
  handleBuildClick(): boolean {
    if (!this.gameState || !this.currentPosition) {
      return false;
    }

    // Validate position
    const validation = this.validateTowerPosition(this.currentPosition.lat, this.currentPosition.lon);
    if (!validation.valid) {
      return false;
    }

    const typeId = this.selectedTowerType();
    if (!typeId) return false;

    // Emit command event — GSM handler places the tower
    this.gameState.getEventBus().emit({
      type: 'command:place-tower',
      position: {
        lat: this.currentPosition.lat,
        lon: this.currentPosition.lon,
        height: this.currentPosition.height,
      },
      typeId,
      rotation: this.currentRotation(),
    });

    // Exit build mode (placement handled by GSM via event)
    this.exitBuildMode();
    return true;
  }

  // ========================================
  // VALIDATION
  // ========================================

  /**
   * Get active enemy routes from PathAndRouteService.
   * Returns array of route paths (each route is GeoPosition[]).
   */
  private getActiveRoutes(): GeoPosition[][] {
    const cachedPaths = this.pathRouteService.getCachedPaths();
    return Array.from(cachedPaths.values());
  }

  /**
   * Prüft eine Position gegen die Platzierungsregeln. Gemeinsamer Pfad für
   * Maus-Vorschau, Klick und Bot (Training-Client); die Regeln selbst stehen
   * in `checkTowerPlacement`.
   */
  validateTowerPosition(lat: number, lon: number): TowerPlacementResult {
    return this.placementChecker()(lat, lon);
  }

  /**
   * Dieselbe Prüfung für viele Positionen hintereinander, für die
   * Kandidatensuche der Bots: Der Kontext (Tower, Spawns, Routen) wird einmal
   * zusammengestellt statt pro Position. Gleiche Regeln, gleiche
   * Distanzformel. Ein Schnappschuss, nach einer Platzierung neu holen.
   */
  placementChecker(): (lat: number, lon: number) => TowerPlacementResult {
    const osmService = this.osmService;
    if (!this.streetNetwork || !osmService || !this.baseCoords) {
      return () => ({ valid: false, reason: 'Service not initialized' });
    }

    if (this.streetNetwork.streets.length === 0) {
      return () => ({ valid: false, reason: 'No streets loaded' });
    }

    const ctx: TowerPlacementContext = {
      bounds: this.streetNetwork.bounds,
      base: this.baseCoords,
      // Aus dem Store-Signal, damit verschobene Spawns sofort gelten
      spawns: this.store.spawnPoints(),
      towers: this.gameState?.towerManager.getAll() ?? [],
      routes: this.getActiveRoutes(),
      geo: osmService,
    };
    return (lat, lon) => checkTowerPlacement(lat, lon, ctx);
  }

  // ========================================
  // PUBLIC GETTERS
  // ========================================

  getRotation(): number {
    return this.currentRotation();
  }

  // ========================================
  // TOWER GRID REGISTRATION (TowerLosRegistry)
  // ========================================

  /**
   * Register a placed tower on the GlobalRouteGrid: LOS resolve of the
   * cells in range, grid registration for targeting, selection viz refresh.
   */
  registerTowerOnGrid(tower: Tower, position: GeoPosition, typeId: TowerTypeId): void {
    this.losRegistry.register(tower, position, typeId);
  }

  /**
   * Unregister a tower from the GlobalRouteGrid.
   */
  unregisterTowerFromGrid(tower: Tower): void {
    this.losRegistry.unregister(tower);
  }

  /**
   * Recompute a tower's LOS now, e.g. after its range grew. Also settles
   * whatever the height-change queue held for it.
   */
  recomputeTowerLOS(tower: Tower): void {
    this.losRegistry.recompute(tower);
  }

  /**
   * recomputeTowerLOS in one of the next frames instead of right away. For
   * callers inside an event handler whose follow-up state the recompute has
   * to see.
   */
  scheduleLosRecompute(tower: Tower): void {
    this.losRegistry.scheduleRecompute(tower);
  }

  /**
   * Clear all tower overlays (LOS visualizations + GlobalRouteGrid registrations)
   * Called on reset to cleanup before starting fresh
   */
  clearAllTowerOverlays(towers: Tower[]): void {
    for (const tower of towers) {
      this.unregisterTowerFromGrid(tower);
    }
  }

  // ========================================
  // CLEANUP
  // ========================================

  dispose(): void {
    this.exitBuildMode();
    this.losRegistry.detach();

    // Release model references from AssetManager
    for (const url of this.loadedModelUrls) {
      this.assetManager.releaseModel(url);
    }
    this.loadedModelUrls.clear();

    this.engine = null;
    this.streetNetwork = null;
    this.osmService = null;
    this.baseCoords = null;
    this.gameState = null;
  }
}
