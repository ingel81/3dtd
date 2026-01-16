import { Injectable, signal } from '@angular/core';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { ThreeTilesEngine } from '../three-engine';
import { StreetNetwork } from './osm-street.service';
import { OsmStreetService } from './osm-street.service';
import { GeoPosition } from '../models/game.types';
import { GameStateManager } from '../managers/game-state.manager';
import { TowerTypeId, TOWER_TYPES } from '../configs/tower-types.config';
import { PLACEMENT_CONFIG } from '../configs/placement.config';

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
  private previewTowerMesh: THREE.Object3D | null = null;

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

  /** Model loaders */
  private gltfLoader = new GLTFLoader();
  private fbxLoader = new FBXLoader();

  /** Cached preview models per tower type */
  private previewModelCache = new Map<TowerTypeId, THREE.Object3D>();

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

    // Clear debounce timer
    if (this.losDebounceTimer !== null) {
      clearTimeout(this.losDebounceTimer);
      this.losDebounceTimer = null;
    }

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

    let model: THREE.Object3D;

    // Check cache
    if (this.previewModelCache.has(typeId)) {
      model = this.previewModelCache.get(typeId)!.clone();
    } else {
      try {
        const url = config.modelUrl.toLowerCase();
        if (url.endsWith('.fbx')) {
          model = await this.fbxLoader.loadAsync(config.modelUrl);
          this.applyFbxMaterials(model);
        } else {
          const gltf = await this.gltfLoader.loadAsync(config.modelUrl);
          model = gltf.scene;
        }
        model.scale.setScalar(config.scale);
        this.makeModelTransparent(model, 0.7);
        this.previewModelCache.set(typeId, model.clone());
      } catch (err) {
        console.error(`[TowerPlacement] Failed to load preview model: ${typeId}`, err);
        this.modelLoading = false;
        return;
      }
    }

    this.previewTowerMesh = model;
    this.previewTowerMesh.visible = false;
    this.engine.getOverlayGroup().add(this.previewTowerMesh);
    this.modelLoading = false;

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

  private applyFbxMaterials(model: THREE.Object3D): void {
    const materialColors: Record<string, number> = {
      'lightwood': 0xc4a574,
      'wood': 0xa0784a,
      'darkwood': 0x6b4423,
      'celing': 0xcd5c5c,
      'ceiling': 0xcd5c5c,
      'roof': 0xcd5c5c,
      'stone': 0x808080,
      'metal': 0x707070,
    };

    model.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        materials.forEach((mat) => {
          const matWithColor = mat as THREE.MeshStandardMaterial;
          if (matWithColor.color) {
            const matName = mat.name.toLowerCase();
            let color: number | undefined;
            for (const [key, value] of Object.entries(materialColors)) {
              if (matName.includes(key)) {
                color = value;
                break;
              }
            }
            matWithColor.color.setHex(color ?? 0xb8956e);
          }
        });
      }
    });
  }

  private makeModelTransparent(model: THREE.Object3D, opacity: number): void {
    model.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        materials.forEach((mat) => {
          mat.transparent = true;
          (mat as THREE.MeshStandardMaterial).opacity = opacity;
          mat.depthWrite = false;
        });
      }
    });
  }

  private colorizePreviewModel(valid: boolean): void {
    if (!this.previewTowerMesh) return;

    const tintColor = valid
      ? new THREE.Color(0.15, 0.8, 0.15)  // Green tint
      : new THREE.Color(0.9, 0.15, 0.15); // Red tint

    this.previewTowerMesh.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        materials.forEach((mat) => {
          const stdMat = mat as THREE.MeshStandardMaterial;
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

    // Update LoS preview (throttled - shows after 200ms of no movement)
    this.updateLoSPreviewDebounced(lat, lon, terrainHeight, typeId);
  }

  /**
   * Update LoS preview with throttle
   * Note: LOS preview is now handled by GlobalRouteGrid visualization
   * This method is kept for potential future per-placement preview
   */
  private updateLoSPreviewDebounced(_lat: number, _lon: number, _height: number, _typeId: TowerTypeId): void {
    // LOS visualization is now global via GlobalRouteGrid
    // Can be toggled via debug menu
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

    // Dispose cached models
    for (const model of this.previewModelCache.values()) {
      model.traverse((child) => {
        if ((child as THREE.Mesh).geometry) {
          (child as THREE.Mesh).geometry.dispose();
        }
        if ((child as THREE.Mesh).material) {
          ((child as THREE.Mesh).material as THREE.Material).dispose();
        }
      });
    }
    this.previewModelCache.clear();

    this.engine = null;
    this.streetNetwork = null;
    this.osmService = null;
    this.baseCoords = null;
    this.spawnPoints = [];
    this.gameState = null;
  }
}
