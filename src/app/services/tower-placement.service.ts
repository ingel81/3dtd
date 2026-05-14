import { Injectable, inject, signal, effect } from '@angular/core';
import { Object3D, Mesh, Color, MeshStandardMaterial, Vector3 } from 'three';
import { ThreeTilesEngine } from '../three-engine';
import { StreetNetwork } from './location/osm-street.service';
import { OsmStreetService } from './location/osm-street.service';
import { PathAndRouteService } from './world/path-route.service';
import { GeoPosition } from '../models/game.types';
import { Tower } from '../entities/tower.entity';
import type { GameStateManager } from '../managers/game-state.manager';
import { TowerTypeId, TOWER_TYPES } from '../configs/tower-types.config';
import { PLACEMENT_CONFIG } from '../configs/placement.config';
import { GlobalRouteGridService } from './world/global-route-grid.service';
import { AssetManagerService } from './infrastructure/asset-manager.service';
import { UIStore } from '../store/ui.store';
import { TowerDefenseStore } from '../store/tower-defense.store';
import { findNearestRouteDistance } from '../utils/geo-utils';
import { TowerLosViz } from '../utils/tower-los-viz';
import { canTargetAirEffective } from '../entities/tower-targeting.util';
import { ResearchStore } from '../store/research.store';
import { losPerf } from '../utils/los-perf';
import { LosResolveContext } from '../utils/gpu-cube-resolve';
import { LOS_VIZ_CONFIG } from '../configs/los-viz.config';

/**
 * TowerPlacementService
 *
 * Professional tower placement with:
 * - 3D tower preview following mouse cursor
 * - Green/red tint based on placement validity
 * - Line-of-Sight hex grid preview
 * - Direct rotation control (tower faces mouse direction)
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

  /** Single preview tower mesh - used throughout placement */
  private previewTowerMesh: Object3D | null = null;

  /**
   * GPU-LOS-Viz für die Build-Preview. Lifecycle: erzeugt bei erstem
   * validen Cursor-Hover, neu gebaut bei jedem Mouse-Move (das Cell-Set
   * ändert sich mit der Tower-Position), disposed beim Verlassen des
   * Build-Mode. Lesson 9 — niemals parallel zur Selection-Viz.
   */
  private buildPreviewViz: TowerLosViz | null = null;
  /** Zuletzt für die Preview-Viz verwendete Tower-XZ — als Move-Schwelle. */
  private buildPreviewLastX = 0;
  private buildPreviewLastZ = 0;

  /**
   * Reactive sync: jedes Mal wenn der User `perTowerLosFilter` im
   * UIStore cycled, applien wir den neuen Mode auf die aktive Build-
   * Preview-Viz. Selection-Viz hat ihr eigenes Pendant in TowerManager.
   */
  private readonly losFilterSync = effect(() => {
    const mode = this.uiStore.perTowerLosFilter();
    this.buildPreviewViz?.setFilterMode(mode);
  });
  /** Bewegung in m bevor das Cell-Set neu gebaut wird. */
  private static readonly BUILD_PREVIEW_REBUILD_THRESHOLD_M = 1.0;

  /** Flag indicating model is being loaded */
  private modelLoading = false;

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

    // When tile-loading promotes previously-unsampled cells (heightSampled
    // flips false → true), any tower whose range covers them has stale LOS
    // data based on the old fallback terrainHeight. Listen for promotions
    // and recompute LOS + viz mesh for each affected tower so the system
    // self-heals as tiles stream in.
    this.globalRouteGrid.setCellsPromotedListener((promoted) =>
      this.onCellsPromoted(promoted),
    );
  }

  private onCellsPromoted(promoted: import('../utils/global-route-grid').RouteCell[]): void {
    if (!this.gameState || !this.engine || promoted.length === 0) return;
    const towers = this.gameState.towerManager.getAll();
    if (towers.length === 0) return;

    // Precompute tower local positions to avoid N*M geo-to-local conversions.
    const towerPositions: { tower: Tower; x: number; z: number; rangeSq: number }[] = [];
    for (const tower of towers) {
      const lp = this.engine.sync.geoToLocalSimple(
        tower.position.lat, tower.position.lon, tower.position.height ?? 0,
      );
      towerPositions.push({
        tower, x: lp.x, z: lp.z,
        rangeSq: tower.combat.range * tower.combat.range,
      });
    }

    // For each promoted cell, find towers whose range covers it and
    // invalidate their cached LOS entry so the upcoming recompute re-raycasts
    // the cell with the now-correct terrainHeight.
    const affectedTowers = new Set<Tower>();
    for (const cell of promoted) {
      for (const t of towerPositions) {
        const distSq = (cell.x - t.x) ** 2 + (cell.z - t.z) ** 2;
        if (distSq > t.rangeSq) continue;
        cell.towerVisibility.delete(t.tower.id);
        cell.airVisibility.delete(t.tower.id);
        affectedTowers.add(t.tower);
      }
    }

    // recomputeTowerLOS disposes the per-tower viz mesh, runs
    // registerTowerIncremental (which raycasts only the cells we just
    // invalidated — cached entries on other cells are reused), then
    // creates a fresh viz mesh that includes the now-sampled cells.
    for (const tower of affectedTowers) {
      this.recomputeTowerLOS(tower);
    }
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

    // Clean up preview tower
    this.cleanupPreviewTower();

    // GPU-LOS-Preview-Viz auflösen
    this.disposeBuildPreviewViz();

    this.buildMode.set(false);
  }

  /**
   * Dispose the active GPU-LOS preview viz, if any.
   */
  private disposeBuildPreviewViz(): void {
    if (this.buildPreviewViz) {
      this.buildPreviewViz.dispose();
      this.buildPreviewViz = null;
    }
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

    try {
      // Load via AssetManager (cached)
      await this.assetManager.loadModel(config.modelUrl);
      this.loadedModelUrls.add(config.modelUrl);

      // Clone the model for preview
      const model = this.assetManager.cloneModel(config.modelUrl);
      if (!model) {
        console.error(`[TowerPlacement] Failed to clone model: ${typeId}`);
        this.modelLoading = false;
        return;
      }

      // Apply FBX materials if needed
      if (this.assetManager.isFbxModel(config.modelUrl)) {
        this.assetManager.applyFbxMaterials(model);
      }

      model.scale.setScalar(config.scale);
      // Apply base rotation from config
      model.rotation.y = config.rotationY ?? 0;
      this.makeModelTransparent(model, 0.7);

      this.previewTowerMesh = model;
      this.previewTowerMesh.visible = false;
      this.engine.getOverlayGroup().add(this.previewTowerMesh);
    } catch (err) {
      console.error(`[TowerPlacement] Failed to load preview model: ${typeId}`, err);
    } finally {
      this.modelLoading = false;
    }

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

  private makeModelTransparent(model: Object3D, opacity: number): void {
    model.traverse((child) => {
      if ((child as Mesh).isMesh) {
        const mesh = child as Mesh;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        materials.forEach((mat) => {
          mat.transparent = true;
          (mat as MeshStandardMaterial).opacity = opacity;
          mat.depthWrite = false;
        });
      }
    });
  }

  private colorizePreviewModel(valid: boolean): void {
    if (!this.previewTowerMesh) return;

    const tintColor = valid
      ? new Color(0.15, 0.8, 0.15)  // Green tint
      : new Color(0.9, 0.15, 0.15); // Red tint

    this.previewTowerMesh.traverse((child) => {
      if ((child as Mesh).isMesh) {
        const mesh = child as Mesh;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        materials.forEach((mat) => {
          const stdMat = mat as MeshStandardMaterial;
          if (stdMat.emissive) {
            stdMat.emissive.copy(tintColor);
            stdMat.emissiveIntensity = 0.5;
          }
        });
      }
    });
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
        this.colorizePreviewModel(validValid);
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

    // Calculate relative Y - height difference from base + tower offset
    const baseTerrainY = this.baseCoords
      ? this.engine.getTerrainHeightAtGeo(this.baseCoords.lat, this.baseCoords.lon)
      : 0;
    const relativeY = resolvedHeight - (baseTerrainY ?? 0);

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
      this.updateLosPreview(lat, lon, resolvedHeight, typeId);
    } else {
      // Invalid position — Preview-Viz auflösen (kein Debounce mehr).
      this.disposeBuildPreviewViz();
    }
  }

  /** Approximate meters between (lat, lon) and the last validated sample. */
  private metersFromLastValidated(lat: number, lon: number): number {
    const cache = this.lastValidation!;
    const dLat = (lat - cache.lat) * 111320;
    const dLon = (lon - cache.lon) * 111320 * Math.cos(lat * Math.PI / 180);
    return Math.sqrt(dLat * dLat + dLon * dLon);
  }

  /**
   * GPU-LOS-Preview-Viz aktualisieren. Wenn die Tower-XZ-Position sich
   * mehr als REBUILD_THRESHOLD verschoben hat → Cell-Set ändert sich,
   * also komplett neu bauen. Sonst nur den TowerTip-Uniform refreshen
   * (triggert auch das move-gated Cube-Render im Mapper).
   */
  private updateLosPreview(lat: number, lon: number, height: number, typeId: TowerTypeId): void {
    if (!this.engine || !this.globalRouteGrid.isInitialized()) return;

    const config = TOWER_TYPES[typeId];
    if (!config) return;

    const local = this.engine.sync.geoToLocalSimple(lat, lon, height);
    const tipY = local.y + config.heightOffset + config.shootHeight;

    const canTargetGround = config.canTargetGround ?? true;
    const canTargetAir = canTargetAirEffective(typeId, this.researchStore.airTargetingUnlocked());
    const range = config.range;
    const airRange = range; // TODO: airRangeMultiplier wenn Config-Feld ergänzt

    // Cells in der Cursor-Region zu `stable` promoten falls noch nicht
    // gesampelt — sonst tauchen sie nicht in der Viz auf (getCellsInRange
    // filtert auf `heightSampled`). Schmal-Variante: stabile Cells werden
    // übersprungen, also kein Raycast pro Move. LOD-Upgrades für stabile
    // Cells laufen separat über den Tile-Streaming-Pfad.
    const tPromoteStart = performance.now();
    this.globalRouteGrid.promoteUnsampledCellsInRadius(
      local.x, local.z, Math.max(range, airRange),
    );
    losPerf.sample('preview/promote', performance.now() - tPromoteStart);

    // Move-Schwelle: nur bei größerer Bewegung neu bauen
    const movedSq =
      (local.x - this.buildPreviewLastX) ** 2 +
      (local.z - this.buildPreviewLastZ) ** 2;
    const threshold = TowerPlacementService.BUILD_PREVIEW_REBUILD_THRESHOLD_M;
    const needsRebuild =
      !this.buildPreviewViz ||
      movedSq > threshold * threshold;

    const tipWorld = new Vector3(local.x, tipY, local.z);

    if (!needsRebuild && this.buildPreviewViz) {
      const tTipStart = performance.now();
      this.buildPreviewViz.updateTowerTip(tipWorld);
      losPerf.sample('preview/tip-only', performance.now() - tTipStart);
      return;
    }

    // Komplett neu bauen — Cell-Set neu sammeln.
    this.disposeBuildPreviewViz();

    const blockerGroup = this.engine.getLosBlockerGroup();
    if (!blockerGroup) return;
    const tGetStart = performance.now();
    const cells = this.globalRouteGrid.getCellsInRange(
      local.x, local.z, Math.max(range, airRange),
    );
    losPerf.sample('preview/getCells', performance.now() - tGetStart, cells.length);
    if (cells.length === 0) return;

    this.buildPreviewViz = new TowerLosViz({
      cells,
      towerTip: tipWorld,
      groundRange: range,
      airRange,
      canTargetGround,
      canTargetAir,
      gridCellSize: this.globalRouteGrid.getCellSize(),
      shadowMapper: this.engine.getTowerShadowMapper(),
      blockerGroup,
    });
    // Apply current per-tower-LOS filter directly — the reactive effect
    // would only fire on signal changes, not on viz (re)creation.
    this.buildPreviewViz.setFilterMode(this.uiStore.perTowerLosFilter());
    this.buildPreviewViz.addTo(this.engine.getScene());
    this.buildPreviewLastX = local.x;
    this.buildPreviewLastZ = local.z;
  }

  /** Per-Frame-Tick für die GPU-LOS-Preview-Pulse-Animation. */
  tickBuildPreviewViz(timeSeconds: number): void {
    this.buildPreviewViz?.tick(timeSeconds);
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

  validateTowerPosition(lat: number, lon: number): { valid: boolean; reason?: string } {
    if (!this.streetNetwork || !this.osmService || !this.baseCoords) {
      return { valid: false, reason: 'Service not initialized' };
    }

    if (this.streetNetwork.streets.length === 0) {
      return { valid: false, reason: 'No streets loaded' };
    }

    // Check bounds
    const bounds = this.streetNetwork.bounds;
    const inBounds = lat >= bounds.minLat && lat <= bounds.maxLat &&
                     lon >= bounds.minLon && lon <= bounds.maxLon;
    if (!inBounds) {
      return { valid: false, reason: 'Ausserhalb Spielbereich' };
    }

    // Check distance to base
    const distToBase = this.osmService.haversineDistance(lat, lon, this.baseCoords.lat, this.baseCoords.lon);
    if (distToBase < PLACEMENT_CONFIG.MIN_DISTANCE_TO_BASE) {
      return { valid: false, reason: `Zu nah an Basis` };
    }

    // Check distance to spawns (read from store signal - always current)
    const currentSpawns = this.store.spawnPoints();
    for (const spawn of currentSpawns) {
      const distToSpawn = this.osmService.haversineDistance(lat, lon, spawn.lat, spawn.lon);
      // TEMP DEBUG - remove after diagnosis
      if (distToSpawn < PLACEMENT_CONFIG.MIN_DISTANCE_TO_SPAWN) {
        console.warn(`[PlacementDebug] BLOCKED spawn="${spawn.name}" spawn=(${spawn.lat.toFixed(6)},${spawn.lon.toFixed(6)}) cursor=(${lat.toFixed(6)},${lon.toFixed(6)}) dist=${distToSpawn.toFixed(1)}m threshold=${PLACEMENT_CONFIG.MIN_DISTANCE_TO_SPAWN}m`);
        return { valid: false, reason: `Zu nah am Spawn` };
      }
    }

    // Check distance to other towers
    if (this.gameState) {
      for (const tower of this.gameState.towerManager.getAll()) {
        const distToTower = this.osmService.haversineDistance(lat, lon, tower.position.lat, tower.position.lon);
        if (distToTower < PLACEMENT_CONFIG.MIN_DISTANCE_TO_OTHER_TOWER) {
          return { valid: false, reason: `Zu nah an Tower` };
        }
      }
    }

    // Check distance to active enemy routes (not all streets)
    const activeRoutes = this.getActiveRoutes();
    if (activeRoutes.length > 0) {
      const routeDistance = findNearestRouteDistance(activeRoutes, lat, lon);
      if (routeDistance < PLACEMENT_CONFIG.MIN_DISTANCE_TO_ROUTE) {
        return { valid: false, reason: 'Zu nah an Route' };
      }
    }
    // If no routes exist yet (before game start), allow placement anywhere

    // Note: Buildings are NOT a collision obstacle — placement service raises
    // tower height to roof level via raycastDown against terrain+buildings,
    // so towers sit naturally on rooftops when positioned over a building.

    return { valid: true };
  }

  /**
   * Validate tower position with explicit height (for bot/API usage)
   */
  validateTowerPositionWithHeight(geoPos: GeoPosition): { valid: boolean; reason?: string } {
    if (!this.streetNetwork || !this.osmService || !this.baseCoords) {
      return { valid: false, reason: 'Service not initialized' };
    }

    if (this.streetNetwork.streets.length === 0) {
      return { valid: false, reason: 'No streets loaded' };
    }

    // Check bounds
    const bounds = this.streetNetwork.bounds;
    const inBounds = geoPos.lat >= bounds.minLat && geoPos.lat <= bounds.maxLat &&
                     geoPos.lon >= bounds.minLon && geoPos.lon <= bounds.maxLon;
    if (!inBounds) {
      return { valid: false, reason: 'Outside play area' };
    }

    // Check distance to base
    const distToBase = this.osmService.haversineDistance(geoPos.lat, geoPos.lon, this.baseCoords.lat, this.baseCoords.lon);
    if (distToBase < PLACEMENT_CONFIG.MIN_DISTANCE_TO_BASE) {
      return { valid: false, reason: `Too close to base` };
    }

    // Check distance to spawns (read from store signal - always current)
    const currentSpawns = this.store.spawnPoints();
    for (const spawn of currentSpawns) {
      const distToSpawn = this.osmService.haversineDistance(geoPos.lat, geoPos.lon, spawn.lat, spawn.lon);
      if (distToSpawn < PLACEMENT_CONFIG.MIN_DISTANCE_TO_SPAWN) {
        return { valid: false, reason: `Too close to spawn` };
      }
    }

    // Check distance to other towers
    if (this.gameState) {
      for (const tower of this.gameState.towerManager.getAll()) {
        const distToTower = this.osmService.haversineDistance(geoPos.lat, geoPos.lon, tower.position.lat, tower.position.lon);
        if (distToTower < PLACEMENT_CONFIG.MIN_DISTANCE_TO_OTHER_TOWER) {
          return { valid: false, reason: `Too close to tower` };
        }
      }
    }

    // Check distance to active enemy routes (not all streets)
    const activeRoutes = this.getActiveRoutes();
    if (activeRoutes.length > 0) {
      const routeDistance = findNearestRouteDistance(activeRoutes, geoPos.lat, geoPos.lon);
      if (routeDistance < PLACEMENT_CONFIG.MIN_DISTANCE_TO_ROUTE) {
        return { valid: false, reason: 'Too close to route' };
      }
    }
    // If no routes exist yet (before game start), allow placement anywhere

    // Note: see validateTowerPosition — buildings are not obstacles;
    // towers are automatically raised to roof level.

    return { valid: true };
  }

  // ========================================
  // PUBLIC GETTERS
  // ========================================

  getRotation(): number {
    return this.currentRotation();
  }

  // ========================================
  // TOWER GRID REGISTRATION (Backend)
  // ========================================

  /**
   * Register a placed tower on the GlobalRouteGrid:
   * - LOS raycasting to determine visible cells
   * - Grid registration for enemy targeting
   * - LOS visualization mesh (hidden by default, shown on selection)
   */
  registerTowerOnGrid(tower: Tower, position: GeoPosition, typeId: TowerTypeId): void {
    if (!this.engine || !this.globalRouteGrid.isInitialized()) return;

    const config = TOWER_TYPES[typeId];
    if (!config) return;

    const terrainPos = this.engine.sync.geoToLocalSimple(position.lat, position.lon, position.height ?? 0);
    const tipY = terrainPos.y + config.heightOffset + config.shootHeight;

    const canTargetGround = config.canTargetGround ?? true;
    const canTargetAir = canTargetAirEffective(
      tower.typeConfig.id as TowerTypeId,
      this.researchStore.airTargetingUnlocked(),
    );

    // Refine cell-Y in the tower's range BEFORE LOS computation. This
    // promotes any still-unsampled cells in the tower's reach using the
    // current tile state, so the cubemap render sees accurate
    // terrainHeight values for sample-Y computation. Cheap: only walks
    // cells inside the radius.
    this.globalRouteGrid.refineCellsInRadius(terrainPos.x, terrainPos.z, config.range);

    const tipWorld = new Vector3(terrainPos.x, tipY, terrainPos.z);
    const ctx = this.buildLosResolveContext(tipWorld, config.range);
    if (!ctx) {
      console.warn('[TowerPlacementService] registerTowerOnGrid: no LOS blocker group');
      return;
    }

    const visibleCells = this.globalRouteGrid.registerTower(
      tower.id,
      terrainPos.x,
      terrainPos.z,
      config.range,
      ctx,
      canTargetGround,
      canTargetAir,
    );
    tower.visibleCells = visibleCells;
    tower.losReady = true;

    // Wenn dieser Tower bereits selected ist (z.B. nach Auto-Select beim
    // Place), die Selection-Viz vom TowerManager refreshen lassen.
    if (tower.selected) {
      this.gameState?.towerManager.refreshSelectionViz(tower);
    }
  }

  /**
   * Renders the tower-shadow cubemap from `tipWorld` with `range` as far,
   * then returns a context the GlobalRouteGrid uses to GPU-resolve cell
   * visibility. `mapper.invalidate()` is hardcoded here so the move-gate
   * never skips a render that the caller needs (a previous build-preview
   * call may have left the cube cached for a different tip).
   */
  private buildLosResolveContext(tipWorld: Vector3, range: number): LosResolveContext | null {
    if (!this.engine) return null;
    const blockerGroup = this.engine.getLosBlockerGroup();
    if (!blockerGroup) return null;
    const mapper = this.engine.getTowerShadowMapper();
    mapper.invalidate();
    mapper.update(tipWorld, range, blockerGroup);
    return {
      cube: mapper.getRenderTarget(),
      referencePos: mapper.getReferencePos(),
      farDistance: mapper.getFarDistance(),
      renderer: mapper.getRenderer(),
      visibilityBias: LOS_VIZ_CONFIG.visibilityBiasMeters,
      emptyDepthEpsilon: LOS_VIZ_CONFIG.emptyDepthEpsilon,
    };
  }

  /**
   * Unregister a tower from the GlobalRouteGrid.
   */
  unregisterTowerFromGrid(tower: Tower): void {
    // Selection-Viz wird vom TowerManager bereinigt (Owner-Pattern).
    this.gameState?.towerManager.onTowerUnregistered(tower);
    this.globalRouteGrid.unregisterTower(tower.id);
    tower.visibleCells = [];
  }

  /**
   * Recompute LOS for a tower after its range has changed (e.g. range upgrade).
   * Uses incremental registration — cells already in the cell-visibility maps
   * keep their cached LoS, only new cells in the annulus get raycasted.
   */
  recomputeTowerLOS(tower: Tower): void {
    if (!this.engine || !this.globalRouteGrid.isInitialized()) return;

    const config = TOWER_TYPES[tower.typeConfig.id as TowerTypeId];
    if (!config) return;

    const position = tower.position;
    const terrainPos = this.engine.sync.geoToLocalSimple(position.lat, position.lon, position.height ?? 0);
    const tipY = terrainPos.y + config.heightOffset + config.shootHeight;

    const canTargetGround = config.canTargetGround ?? true;
    const canTargetAir = canTargetAirEffective(
      tower.typeConfig.id as TowerTypeId,
      this.researchStore.airTargetingUnlocked(),
    );

    const tipWorld = new Vector3(terrainPos.x, tipY, terrainPos.z);
    const ctx = this.buildLosResolveContext(tipWorld, tower.combat.range);
    if (!ctx) {
      console.warn('[TowerPlacementService] recomputeTowerLOS: no LOS blocker group');
      return;
    }

    // Incremental: only sample cells that don't already have a cached entry
    tower.visibleCells = this.globalRouteGrid.registerTowerIncremental(
      tower.id,
      terrainPos.x,
      terrainPos.z,
      tower.combat.range,
      ctx,
      canTargetGround,
      canTargetAir
    );

    // Selection-Viz refreshen, falls dieser Tower selected ist.
    if (tower.selected) {
      this.gameState?.towerManager.refreshSelectionViz(tower);
    }
  }

  /**
   * Drop every tower's GPU-resolved visibility cache and rebuild it
   * against the current tile state. Used by the tile-streaming handler
   * because cubemap renders against newly-streamed (or LOD-promoted)
   * tile geometry need to overwrite the previous results — the per-cell
   * promotion listener only covers unsampled→sampled transitions, not
   * sampled→sampled-with-better-LOD.
   *
   * Cost: one cubemap render + ~500 readPixels per tower. At 10 towers
   * that's a ~50-100 ms spike per tile-load event. Tile loads are rare
   * (a few per minute under aggressive panning) so the spike is OK.
   */
  recomputeAllTowersGroundLOS(): void {
    const towers = this.gameState?.towerManager.getAll();
    if (!towers) return;
    for (const tower of towers) {
      if (!tower.losReady) continue;
      this.globalRouteGrid.clearGroundVisibilityForTower(tower.id);
      this.recomputeTowerLOS(tower);
    }
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
