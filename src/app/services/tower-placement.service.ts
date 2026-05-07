import { Injectable, inject, signal } from '@angular/core';
import { Object3D, InstancedMesh, Mesh, Color, Material, MeshStandardMaterial, Raycaster, Vector3 } from 'three';
import { ThreeTilesEngine } from '../three-engine';
import { StreetNetwork } from './osm-street.service';
import { OsmStreetService } from './osm-street.service';
import { PathAndRouteService } from './path-route.service';
import { GeoPosition } from '../models/game.types';
import { Tower } from '../entities/tower.entity';
import type { GameStateManager } from '../managers/game-state.manager';
import { TowerTypeId, TOWER_TYPES } from '../configs/tower-types.config';
import { PLACEMENT_CONFIG } from '../configs/placement.config';
import { GlobalRouteGridService } from './global-route-grid.service';
import { AssetManagerService } from './asset-manager.service';
import { UIStore } from '../store/ui.store';
import { TowerDefenseStore } from '../store/tower-defense.store';
import { findNearestRouteDistance } from '../utils/geo-utils';

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

  /** LOS preview mesh for placement */
  private losPreviewMesh: InstancedMesh | null = null;

  /** Is LOS preview currently building progressively */
  private losPreviewBuilding = false;

  /** Tower with pending progressive LOS registration */
  private pendingTowerReg: import('../entities/tower.entity').Tower | null = null;

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

  /** Last validated position */
  private lastValidation: { lat: number; lon: number; valid: boolean } | null = null;

  /** Debounce timer for LoS updates */
  private losDebounceTimer: number | null = null;

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

    // Clean up LOS preview
    this.cleanupLosPreview();

    // Clear debounce timer
    if (this.losDebounceTimer !== null) {
      clearTimeout(this.losDebounceTimer);
      this.losDebounceTimer = null;
    }

    this.buildMode.set(false);
  }

  /**
   * Clean up LOS preview mesh
   */
  private cleanupLosPreview(): void {
    // Cancel any ongoing progressive build
    if (this.losPreviewBuilding) {
      this.globalRouteGrid.cancelPreviewBuild();
      this.losPreviewBuilding = false;
    }

    if (this.losPreviewMesh && this.engine) {
      this.engine.getScene().remove(this.losPreviewMesh);
      this.globalRouteGrid.disposePlacementPreview(this.losPreviewMesh);
      this.losPreviewMesh = null;
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

    const resolvedHeight = this.resolvePlacementHeight(lat, lon, terrainHeight);

    // If model is still loading, queue this position for later
    if (this.modelLoading) {
      this.queuedPosition = { lat, lon, height: resolvedHeight };
      return;
    }

    if (!this.previewTowerMesh) {
      this.queuedPosition = { lat, lon, height: resolvedHeight };
      return;
    }

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

    // Validate and colorize
    const validation = this.validateTowerPosition(lat, lon);
    this.validationReason.set(validation.valid ? null : (validation.reason ?? 'Invalid position'));

    if (!this.lastValidation || this.lastValidation.valid !== validation.valid) {
      this.colorizePreviewModel(validation.valid);
      this.lastValidation = { lat, lon, valid: validation.valid };
    }

    // Update LoS preview only for valid positions (skip calculation for invalid spots)
    if (validation.valid) {
      this.updateLoSPreviewDebounced(lat, lon, resolvedHeight, typeId);
    } else {
      // Invalid position - cancel any ongoing preview and hide
      this.cancelAndHideLosPreview();
    }
  }

  /**
   * Cancel and hide LOS preview (for invalid positions)
   */
  private cancelAndHideLosPreview(): void {
    if (this.losDebounceTimer !== null) {
      clearTimeout(this.losDebounceTimer);
      this.losDebounceTimer = null;
    }
    if (this.losPreviewBuilding) {
      this.globalRouteGrid.cancelPreviewBuild();
      this.losPreviewBuilding = false;
    }
    if (this.losPreviewMesh) {
      this.losPreviewMesh.visible = false;
    }
  }

  /**
   * Update LoS preview with debounce (shows after mouse stops moving)
   */
  private updateLoSPreviewDebounced(lat: number, lon: number, height: number, typeId: TowerTypeId): void {
    // Clear existing timer
    if (this.losDebounceTimer !== null) {
      clearTimeout(this.losDebounceTimer);
    }

    // Cancel ongoing preview build and hide when moving
    if (this.losPreviewBuilding) {
      this.globalRouteGrid.cancelPreviewBuild();
      this.losPreviewBuilding = false;
    }
    if (this.losPreviewMesh) {
      this.losPreviewMesh.visible = false;
    }

    // Debounce: wait 150ms before starting preview build at new position
    this.losDebounceTimer = window.setTimeout(() => {
      this.createLosPreview(lat, lon, height, typeId);
      this.losDebounceTimer = null;
    }, 150);
  }

  /**
   * Create LOS preview at position (starts progressive build)
   */
  private createLosPreview(lat: number, lon: number, height: number, typeId: TowerTypeId): void {
    if (!this.engine || !this.globalRouteGrid.isInitialized()) return;

    const config = TOWER_TYPES[typeId];
    if (!config) return;

    const losRaycaster = this.engine.towers.getLosRaycaster();
    if (!losRaycaster) return;

    // Calculate tower position in local coordinates
    const local = this.engine.sync.geoToLocalSimple(lat, lon, height);
    const tipY = local.y + config.heightOffset + config.shootHeight;

    // Check if this is a pure air tower (only targets air, not ground)
    const isPureAirTower = (config.canTargetAir ?? false) && !(config.canTargetGround ?? true);

    // Clean up old preview
    this.cleanupLosPreview();

    // Start progressive preview build (mesh starts empty, fills progressively)
    // Air towers skip LOS checks and show all cells as visible (green)
    this.losPreviewMesh = this.globalRouteGrid.createPlacementPreview(
      local.x,
      local.z,
      tipY,
      config.range,
      losRaycaster,
      isPureAirTower
    );

    if (this.losPreviewMesh) {
      this.engine.getScene().add(this.losPreviewMesh);
      this.losPreviewBuilding = true;
    }
  }

  /**
   * Update method - call each frame
   * Continues progressive tower LOS registration (after placement)
   */
  updateTowerRegistration(): void {
    if (this.pendingTowerReg) {
      this.globalRouteGrid.continueTowerRegistration();
    }
  }

  /**
   * Update method - call each frame during build mode
   * Continues progressive LOS preview building
   */
  updatePreviewBuild(): void {
    if (this.losPreviewBuilding && this.losPreviewMesh) {
      const complete = this.globalRouteGrid.continuePreviewBuild();
      if (complete) {
        this.losPreviewBuilding = false;
      }
    }
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

    const losRaycaster = this.engine.towers.getLosRaycaster();
    if (!losRaycaster) {
      console.warn('[TowerPlacementService] registerTowerOnGrid: no losRaycaster!');
      return;
    }

    // Check if this is a pure air tower (only targets air, not ground)
    const isPureAirTower = (config.canTargetAir ?? false) && !(config.canTargetGround ?? true);

    // Progressive LOS registration — tower stays inactive until complete (no glitches)
    const tLos0 = performance.now();
    tower.losReady = false;
    this.pendingTowerReg = tower;

    this.globalRouteGrid.registerTowerProgressive(
      tower.id,
      terrainPos.x,
      terrainPos.z,
      tipY,
      config.range,
      losRaycaster,
      isPureAirTower,
      (visibleCells: import('../utils/global-route-grid').RouteCell[]) => {
        tower.visibleCells = visibleCells;
        tower.losReady = true;
        this.pendingTowerReg = null;

        // Create LOS visualization (hidden by default, shown on selection)
        tower.losVisualization = this.globalRouteGrid.createTowerVisualization(
          tower.id,
          terrainPos.x,
          terrainPos.z,
          config.range
        );
        if (tower.losVisualization) {
          tower.losVisualization.visible = tower.selected;
          this.engine!.getScene().add(tower.losVisualization);
        }

        // PerfTrace disabled — fired per tower placement (noisy during training)
        void tLos0;
      }
    );
  }

  /**
   * Unregister a tower from the GlobalRouteGrid:
   * - Dispose LOS visualization mesh
   * - Unregister from grid (removes tower visibility from cells)
   */
  unregisterTowerFromGrid(tower: Tower): void {
    // Dispose LOS visualization
    if (tower.losVisualization && this.engine) {
      this.engine.getScene().remove(tower.losVisualization);
      tower.losVisualization.geometry.dispose();
      (tower.losVisualization.material as Material).dispose();
      tower.losVisualization = null;
    }

    // Unregister from GlobalRouteGrid
    this.globalRouteGrid.unregisterTower(tower.id);
    tower.visibleCells = [];
  }

  /**
   * Recompute LOS for a tower after its range has changed (e.g. range upgrade).
   * Unregisters the tower from the grid, then re-registers with the current combat range.
   */
  recomputeTowerLOS(tower: Tower): void {
    if (!this.engine || !this.globalRouteGrid.isInitialized()) return;

    const config = TOWER_TYPES[tower.typeConfig.id as TowerTypeId];
    if (!config) return;

    // Unregister (cleans up old LOS visualization + grid cells)
    this.unregisterTowerFromGrid(tower);

    // Re-register with current (upgraded) range
    const position = tower.position;
    const terrainPos = this.engine.sync.geoToLocalSimple(position.lat, position.lon, position.height ?? 0);
    const tipY = terrainPos.y + config.heightOffset + config.shootHeight;

    const losRaycaster = this.engine.towers.getLosRaycaster();
    if (!losRaycaster) {
      console.warn('[TowerPlacementService] recomputeTowerLOS: no losRaycaster!');
      return;
    }

    const isPureAirTower = (config.canTargetAir ?? false) && !(config.canTargetGround ?? true);

    // Use the tower's current combat range (already upgraded) instead of base config range
    tower.visibleCells = this.globalRouteGrid.registerTower(
      tower.id,
      terrainPos.x,
      terrainPos.z,
      tipY,
      tower.combat.range,
      losRaycaster,
      isPureAirTower
    );

    // Recreate LOS visualization with new range
    tower.losVisualization = this.globalRouteGrid.createTowerVisualization(
      tower.id,
      terrainPos.x,
      terrainPos.z,
      tower.combat.range
    );

    if (tower.losVisualization) {
      // Keep visibility state consistent with selection
      tower.losVisualization.visible = tower.selected;
      this.engine.getScene().add(tower.losVisualization);
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
