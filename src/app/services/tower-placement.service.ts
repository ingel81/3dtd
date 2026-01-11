import { Injectable, signal, WritableSignal } from '@angular/core';
import * as THREE from 'three';
import { ThreeTilesEngine } from '../three-engine';
import { StreetNetwork } from './osm-street.service';
import { OsmStreetService } from './osm-street.service';
import { GeoPosition } from '../models/game.types';
import { GameStateManager } from '../managers/game-state.manager';
import { TowerTypeId } from '../configs/tower-types.config';

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
 * Manages tower placement validation, build mode, and build preview visualization.
 * Handles tower type selection and placement rules.
 */
@Injectable({ providedIn: 'root' })
export class TowerPlacementService {
  // ========================================
  // CONSTANTS
  // ========================================

  /** Minimum distance from street (must be off-street) */
  private readonly MIN_DISTANCE_TO_STREET = 10;

  /** Maximum distance from street (must be near street) */
  private readonly MAX_DISTANCE_TO_STREET = 50;

  /** Minimum distance from base/HQ */
  private readonly MIN_DISTANCE_TO_BASE = 30;

  /** Minimum distance from spawn points */
  private readonly MIN_DISTANCE_TO_SPAWN = 30;

  // ========================================
  // SIGNALS
  // ========================================

  /** Build mode active state */
  readonly buildMode = signal(false);

  /** Selected tower type for placement */
  readonly selectedTowerType = signal<TowerTypeId>('archer');

  // ========================================
  // STATE
  // ========================================

  /** Build preview mesh (green/red circle on terrain) */
  private buildPreviewMesh: THREE.Mesh | null = null;

  /** Last validation result (cached to avoid redundant material updates) */
  private lastPreviewValidation: boolean | null = null;

  /** Throttle ID for preview validation updates */
  private previewThrottleId: number | null = null;

  /** Last known mouse position for preview (used for throttle and buildMode activation) */
  private lastMouseLat: number | null = null;
  private lastMouseLon: number | null = null;

  /** Debug counter for preview logging */
  private previewDebugCount = 0;

  /** Reference to the 3D engine */
  private engine: ThreeTilesEngine | null = null;

  /** Street network for validation */
  private streetNetwork: StreetNetwork | null = null;

  /** OSM service for distance calculations */
  private osmService: OsmStreetService | null = null;

  /** Base coordinates for validation */
  private baseCoords: { latitude: number; longitude: number } | null = null;

  /** Spawn points for validation */
  private spawnPoints: SpawnPoint[] = [];

  /** Game state manager for tower management */
  private gameState: GameStateManager | null = null;

  // ========================================
  // INITIALIZATION
  // ========================================

  /**
   * Initialize tower placement service
   * @param engine ThreeTilesEngine instance
   * @param streetNetwork Street network for validation
   * @param osmService OSM service for distance calculations
   * @param baseCoords Base/HQ coordinates
   * @param spawnPoints Spawn points array
   * @param gameState Game state manager
   */
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

    this.createBuildPreview();
  }

  /**
   * Update spawn points reference
   * @param spawnPoints Updated spawn points array
   */
  updateSpawnPoints(spawnPoints: SpawnPoint[]): void {
    this.spawnPoints = spawnPoints;
  }

  /**
   * Update street network reference
   * @param streetNetwork Updated street network
   */
  updateStreetNetwork(streetNetwork: StreetNetwork): void {
    this.streetNetwork = streetNetwork;
  }

  // ========================================
  // BUILD MODE
  // ========================================

  /**
   * Toggle build mode on/off
   */
  toggleBuildMode(): void {
    this.buildMode.update((v) => !v);
    if (this.buildMode()) {
      this.gameState?.deselectAll();
    } else {
      // Hide build preview when exiting build mode
      if (this.buildPreviewMesh) {
        this.buildPreviewMesh.visible = false;
      }
      this.lastPreviewValidation = null;
    }
  }

  /**
   * Select a tower type and activate build mode
   * @param typeId Tower type ID
   */
  selectTowerType(typeId: TowerTypeId): void {
    this.selectedTowerType.set(typeId);
    this.buildMode.set(true);
    this.gameState?.deselectAll();

    // Reset stored position to avoid showing preview at stale location
    // Preview will appear once user moves mouse over terrain
    this.lastMouseLat = null;
    this.lastMouseLon = null;
    this.lastPreviewValidation = null;
    if (this.buildPreviewMesh) {
      this.buildPreviewMesh.visible = false;
    }
  }

  /**
   * Show preview at the last known mouse position (if available)
   * Called when buildMode is activated to avoid waiting for mouse move
   */
  private showPreviewAtLastPosition(): void {
    if (this.lastMouseLat !== null && this.lastMouseLon !== null) {
      this.updatePreviewPosition(this.lastMouseLat, this.lastMouseLon);
      this.updatePreviewValidation(this.lastMouseLat, this.lastMouseLon);
    }
  }

  // ========================================
  // BUILD PREVIEW
  // ========================================

  /**
   * Create build preview mesh (green/red circle indicator)
   */
  private createBuildPreview(): void {
    if (!this.engine) return;

    // Clean up existing preview mesh if re-initializing
    if (this.buildPreviewMesh) {
      this.engine.getOverlayGroup().remove(this.buildPreviewMesh);
      this.buildPreviewMesh.geometry.dispose();
      (this.buildPreviewMesh.material as THREE.Material).dispose();
      this.buildPreviewMesh = null;
    }

    // Create a simple circle mesh for preview
    const geometry = new THREE.CircleGeometry(8, 32);
    const material = new THREE.MeshBasicMaterial({
      color: 0x22c55e, // Green by default
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false, // Always visible, even when terrain is in front
    });
    this.buildPreviewMesh = new THREE.Mesh(geometry, material);
    this.buildPreviewMesh.rotation.x = -Math.PI / 2; // Horizontal
    this.buildPreviewMesh.visible = false;
    this.buildPreviewMesh.renderOrder = 100; // Render on top

    // Add to overlay group (synced with tiles movement), not scene root
    this.engine.getOverlayGroup().add(this.buildPreviewMesh);
  }

  /**
   * Update build preview position and visibility
   * @param lat Latitude of preview position
   * @param lon Longitude of preview position
   */
  updatePreviewPosition(lat: number, lon: number): void {
    if (!this.buildPreviewMesh || !this.engine) return;

    // Convert geo to local coordinates (like other overlay objects)
    const local = this.engine.sync.geoToLocalSimple(lat, lon, 0);

    // Get terrain height at this position
    const terrainY = this.engine.getTerrainHeightAtGeo(lat, lon);
    const baseTerrainY = this.baseCoords
      ? this.engine.getTerrainHeightAtGeo(this.baseCoords.latitude, this.baseCoords.longitude)
      : 0;

    // Y = height difference from origin + small offset above ground
    const HEIGHT_ABOVE_GROUND = 1;
    local.y = (terrainY ?? 0) - (baseTerrainY ?? 0) + HEIGHT_ABOVE_GROUND;

    this.buildPreviewMesh.position.copy(local);
    this.buildPreviewMesh.visible = true;
  }

  /**
   * Hide build preview
   */
  hidePreview(): void {
    if (this.buildPreviewMesh) {
      this.buildPreviewMesh.visible = false;
    }
  }

  /**
   * Update preview validation color (green = valid, red = invalid)
   * Stores latest coordinates and uses them in throttled validation
   * @param lat Latitude
   * @param lon Longitude
   */
  updatePreviewValidation(lat: number, lon: number): void {
    // Always store the latest coordinates
    this.lastMouseLat = lat;
    this.lastMouseLon = lon;

    // Throttle validation - only every 30ms, but always use latest coordinates
    if (this.previewThrottleId === null) {
      this.previewThrottleId = window.setTimeout(() => {
        this.previewThrottleId = null;
        if (!this.buildPreviewMesh) return;

        // Use the LATEST stored coordinates, not closure-captured values
        if (this.lastMouseLat === null || this.lastMouseLon === null) return;

        const validation = this.validateTowerPosition(this.lastMouseLat, this.lastMouseLon);
        if (this.lastPreviewValidation !== validation.valid) {
          this.lastPreviewValidation = validation.valid;
          // Update material color
          const material = this.buildPreviewMesh.material as THREE.MeshBasicMaterial;
          material.color.setHex(validation.valid ? 0x22c55e : 0xef4444); // Green or red
        }
      }, 30);
    }
  }

  // ========================================
  // VALIDATION
  // ========================================

  /**
   * Validate tower placement position
   * @param lat Latitude
   * @param lon Longitude
   * @returns Validation result with reason if invalid
   */
  validateTowerPosition(lat: number, lon: number): { valid: boolean; reason?: string } {
    if (!this.streetNetwork || !this.osmService || !this.baseCoords) {
      return { valid: false, reason: 'Service nicht initialisiert' };
    }

    if (this.streetNetwork.streets.length === 0) {
      return { valid: false, reason: 'Keine Strassen geladen' };
    }

    // Check if click is within street network bounds
    const bounds = this.streetNetwork.bounds;
    const inBounds =
      lat >= bounds.minLat && lat <= bounds.maxLat && lon >= bounds.minLon && lon <= bounds.maxLon;
    if (!inBounds) {
      return { valid: false, reason: 'Ausserhalb Spielbereich' };
    }

    // Check distance to base
    const distToBase = this.osmService.haversineDistance(lat, lon, this.baseCoords.latitude, this.baseCoords.longitude);
    if (distToBase < this.MIN_DISTANCE_TO_BASE) {
      return { valid: false, reason: `Zu nah an Basis (${distToBase.toFixed(0)}m)` };
    }

    // Check distance to spawns
    for (const spawn of this.spawnPoints) {
      const distToSpawn = this.osmService.haversineDistance(lat, lon, spawn.latitude, spawn.longitude);
      if (distToSpawn < this.MIN_DISTANCE_TO_SPAWN) {
        return { valid: false, reason: `Zu nah am Spawn (${distToSpawn.toFixed(0)}m)` };
      }
    }

    // Check distance to other towers
    if (this.gameState) {
      for (const tower of this.gameState.towers()) {
        const distToTower = this.osmService.haversineDistance(lat, lon, tower.position.lat, tower.position.lon);
        if (distToTower < 20) {
          return { valid: false, reason: `Zu nah an Tower (${distToTower.toFixed(0)}m)` };
        }
      }
    }

    // Check distance to nearest street
    const nearest = this.osmService.findNearestStreetPoint(this.streetNetwork, lat, lon);
    if (!nearest) {
      return { valid: false, reason: 'Keine Strasse gefunden' };
    }

    if (nearest.distance > this.MAX_DISTANCE_TO_STREET) {
      return {
        valid: false,
        reason: `Zu weit (${nearest.distance.toFixed(0)}m > ${this.MAX_DISTANCE_TO_STREET}m)`,
      };
    }

    if (nearest.distance < this.MIN_DISTANCE_TO_STREET) {
      return { valid: false, reason: 'Nicht auf Strasse bauen' };
    }

    return { valid: true };
  }

  // ========================================
  // TOWER PLACEMENT
  // ========================================

  /**
   * Place tower at specific geo position with validation
   * @param lat Latitude
   * @param lon Longitude
   * @param height Height (from raycast)
   * @returns True if tower was placed successfully
   */
  placeTower(lat: number, lon: number, height: number): boolean {
    if (!this.gameState) return false;

    const validation = this.validateTowerPosition(lat, lon);

    if (!validation.valid) {
      return false;
    }

    const position: GeoPosition = { lat, lon, height };
    const typeId = this.selectedTowerType();

    const tower = this.gameState.placeTower(position, typeId);
    if (tower) {
      return true;
    }

    return false;
  }

  // ========================================
  // CLEANUP
  // ========================================

  /**
   * Dispose build preview and cleanup
   */
  dispose(): void {
    if (this.buildPreviewMesh && this.engine) {
      this.engine.getOverlayGroup().remove(this.buildPreviewMesh);
      this.buildPreviewMesh.geometry.dispose();
      (this.buildPreviewMesh.material as THREE.Material).dispose();
      this.buildPreviewMesh = null;
    }

    if (this.previewThrottleId !== null) {
      clearTimeout(this.previewThrottleId);
      this.previewThrottleId = null;
    }

    this.engine = null;
    this.streetNetwork = null;
    this.osmService = null;
    this.baseCoords = null;
    this.spawnPoints = [];
    this.gameState = null;
    this.lastPreviewValidation = null;
  }
}
