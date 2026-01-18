import { Injectable, inject, signal } from '@angular/core';
import { Object3D, InstancedMesh, Mesh, Color, MeshStandardMaterial } from 'three';
import { ThreeTilesEngine } from '../three-engine';
import { StreetNetwork } from './osm-street.service';
import { OsmStreetService } from './osm-street.service';
import { GeoPosition } from '../models/game.types';
import { GameStateManager } from '../managers/game-state.manager';
import { TowerTypeId, TOWER_TYPES } from '../configs/tower-types.config';
import { PLACEMENT_CONFIG } from '../configs/placement.config';
import { GlobalRouteGridService } from './global-route-grid.service';
import { AssetManagerService } from './asset-manager.service';

/**
 * SpawnPoint interface
 */
export interface SpawnPoint {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  color: number;
}

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

  // ========================================
  // SIGNALS
  // ========================================

  readonly buildMode = signal(false);
  readonly selectedTowerType = signal<TowerTypeId>('archer');
  readonly currentRotation = signal(0);
  readonly validationReason = signal<string | null>(null);

  // ========================================
  // STATE
  // ========================================

  /** Single preview tower mesh - used throughout placement */
  private previewTowerMesh: Object3D | null = null;

  /** LOS preview mesh for placement */
  private losPreviewMesh: InstancedMesh | null = null;

  /** Is LOS preview currently building progressively */
  private losPreviewBuilding = false;

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
  private baseCoords: { latitude: number; longitude: number } | null = null;
  private spawnPoints: SpawnPoint[] = [];
  private gameState: GameStateManager | null = null;

  // ========================================
  // INITIALIZATION
  // ========================================

  initialize(
    engine: ThreeTilesEngine,
    streetNetwork: StreetNetwork,
    osmService: OsmStreetService,
    baseCoords: { latitude: number; longitude: number },
    spawnPoints: SpawnPoint[],
    gameState: GameStateManager
  ): void {
    this.engine = engine;
    this.streetNetwork = streetNetwork;
    this.osmService = osmService;
    this.baseCoords = baseCoords;
    this.spawnPoints = spawnPoints;
    this.gameState = gameState;
  }

  updateSpawnPoints(spawnPoints: SpawnPoint[]): void {
    this.spawnPoints = spawnPoints;
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
    this.gameState?.deselectAll();

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

  /**
   * Update preview position - called on mouse move
   * In normal mode: tower follows cursor with validation coloring
   * In rotation mode: tower stays fixed, only rotation updates
   */
  updatePreviewPosition(lat: number, lon: number, terrainHeight: number): void {
    if (!this.engine) {
      return;
    }

    // If model is still loading, queue this position for later
    if (this.modelLoading) {
      this.queuedPosition = { lat, lon, height: terrainHeight };
      return;
    }

    if (!this.previewTowerMesh) {
      this.queuedPosition = { lat, lon, height: terrainHeight };
      return;
    }

    // Store current position for placement
    this.currentPosition = { lat, lon, height: terrainHeight };

    const typeId = this.selectedTowerType();
    const config = TOWER_TYPES[typeId];
    if (!config) return;

    // Get local X/Z position (same as marker service)
    const local = this.engine.sync.geoToLocalSimple(lat, lon, 0);

    // Calculate relative Y - height difference from base + tower offset
    const baseTerrainY = this.baseCoords
      ? this.engine.getTerrainHeightAtGeo(this.baseCoords.latitude, this.baseCoords.longitude)
      : 0;
    const relativeY = terrainHeight - (baseTerrainY ?? 0);

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
    this.validationReason.set(validation.valid ? null : (validation.reason ?? 'Ungültige Position'));

    if (!this.lastValidation || this.lastValidation.valid !== validation.valid) {
      this.colorizePreviewModel(validation.valid);
      this.lastValidation = { lat, lon, valid: validation.valid };
    }

    // Update LoS preview only for valid positions (skip calculation for invalid spots)
    if (validation.valid) {
      this.updateLoSPreviewDebounced(lat, lon, terrainHeight, typeId);
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
    const config = TOWER_TYPES[typeId];
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
    if (!this.gameState || !this.currentPosition) return false;

    // Validate position
    const validation = this.validateTowerPosition(this.currentPosition.lat, this.currentPosition.lon);
    if (!validation.valid) {
      return false;
    }

    const position: GeoPosition = {
      lat: this.currentPosition.lat,
      lon: this.currentPosition.lon,
      height: this.currentPosition.height,
    };
    const typeId = this.selectedTowerType();

    // Place the tower with current rotation
    const tower = this.gameState.placeTower(position, typeId, this.currentRotation());

    if (tower) {
      // Success - exit build mode completely
      this.exitBuildMode();
      return true;
    }

    return false;
  }

  // ========================================
  // VALIDATION
  // ========================================

  validateTowerPosition(lat: number, lon: number): { valid: boolean; reason?: string } {
    if (!this.streetNetwork || !this.osmService || !this.baseCoords) {
      return { valid: false, reason: 'Service nicht initialisiert' };
    }

    if (this.streetNetwork.streets.length === 0) {
      return { valid: false, reason: 'Keine Strassen geladen' };
    }

    // Check bounds
    const bounds = this.streetNetwork.bounds;
    const inBounds = lat >= bounds.minLat && lat <= bounds.maxLat &&
                     lon >= bounds.minLon && lon <= bounds.maxLon;
    if (!inBounds) {
      return { valid: false, reason: 'Ausserhalb Spielbereich' };
    }

    // Check distance to base
    const distToBase = this.osmService.haversineDistance(lat, lon, this.baseCoords.latitude, this.baseCoords.longitude);
    if (distToBase < PLACEMENT_CONFIG.MIN_DISTANCE_TO_BASE) {
      return { valid: false, reason: `Zu nah an Basis` };
    }

    // Check distance to spawns
    for (const spawn of this.spawnPoints) {
      const distToSpawn = this.osmService.haversineDistance(lat, lon, spawn.latitude, spawn.longitude);
      if (distToSpawn < PLACEMENT_CONFIG.MIN_DISTANCE_TO_SPAWN) {
        return { valid: false, reason: `Zu nah am Spawn` };
      }
    }

    // Check distance to other towers
    if (this.gameState) {
      for (const tower of this.gameState.towers()) {
        const distToTower = this.osmService.haversineDistance(lat, lon, tower.position.lat, tower.position.lon);
        if (distToTower < PLACEMENT_CONFIG.MIN_DISTANCE_TO_OTHER_TOWER) {
          return { valid: false, reason: `Zu nah an Tower` };
        }
      }
    }

    // Check distance to street (with 3D distance calculation)
    const nearest = this.osmService.findNearestStreetPoint(this.streetNetwork, lat, lon);
    if (!nearest) {
      return { valid: false, reason: 'Keine Strasse gefunden' };
    }

    // Calculate 3D distance including height difference
    let effectiveDistance = nearest.distance;
    let heightDiff = 0;

    if (this.engine && this.currentPosition) {
      // Get tower height (terrain height at tower position)
      const towerHeight = this.currentPosition.height;

      // Get street height at nearest point
      const streetNode = nearest.street.nodes[nearest.nodeIndex];
      const streetHeight = this.engine.getTerrainHeightAtGeo(streetNode.lat, streetNode.lon);

      if (streetHeight !== null) {
        heightDiff = Math.abs(towerHeight - streetHeight);
        // 3D distance: sqrt(horizontal² + vertical²)
        effectiveDistance = Math.sqrt(nearest.distance * nearest.distance + heightDiff * heightDiff);
      }
    }

    if (nearest.distance > PLACEMENT_CONFIG.MAX_DISTANCE_TO_STREET) {
      return { valid: false, reason: 'Zu weit von Strasse' };
    }

    if (effectiveDistance < PLACEMENT_CONFIG.MIN_DISTANCE_TO_STREET) {
      return { valid: false, reason: 'Zu nah an Strasse' };
    }

    return { valid: true };
  }

  // ========================================
  // PUBLIC GETTERS
  // ========================================

  getRotation(): number {
    return this.currentRotation();
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
    this.spawnPoints = [];
    this.gameState = null;
  }
}
