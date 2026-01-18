import { Injectable, WritableSignal } from '@angular/core';
import {
  Group,
  Color,
  OctahedronGeometry,
  MeshPhongMaterial,
  DoubleSide,
  BackSide,
  Mesh,
  MeshBasicMaterial,
  TorusGeometry,
  Vector3,
  SphereGeometry,
} from 'three';
import { ThreeTilesEngine } from '../three-engine';
import { GeoPosition } from '../models/game.types';

/**
 * SpawnPoint definition
 */
export interface SpawnPoint {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  color: number; // Three.js hex color
}

/**
 * Options for creating a diamond marker
 */
export interface DiamondMarkerOptions {
  color: number;
  size?: number;
  glowIntensity?: number;
  showRings?: boolean;
}

/**
 * MarkerVisualizationService
 *
 * Manages 3D marker visualization for spawns, base, and debug purposes.
 * Creates and disposes diamond markers with glow effects and rings.
 */
@Injectable({ providedIn: 'root' })
export class MarkerVisualizationService {
  // ========================================
  // STATE
  // ========================================

  /** Spawn markers (diamond markers at spawn points) */
  private spawnMarkers: Group[] = [];

  /** Base/HQ marker (diamond marker at base location) */
  private baseMarker: Group | null = null;

  /** Height debug markers group (small spheres for terrain height debugging) */
  private heightDebugGroup: Group | null = null;

  /** Reference to the 3D engine */
  private engine: ThreeTilesEngine | null = null;

  /** Base coordinates for relative height calculations */
  private baseCoords: GeoPosition | null = null;

  /** Height debug visibility state (from GameUIStateService) */
  private heightDebugVisible: WritableSignal<boolean> | null = null;

  // ========================================
  // INITIALIZATION
  // ========================================

  /**
   * Initialize marker visualization service
   * @param engine ThreeTilesEngine instance
   * @param baseCoords Base/HQ coordinates for relative positioning
   * @param heightDebugVisible Signal for height debug visibility state
   */
  initialize(
    engine: ThreeTilesEngine,
    baseCoords: GeoPosition,
    heightDebugVisible: WritableSignal<boolean>
  ): void {
    this.engine = engine;
    this.baseCoords = baseCoords;
    this.heightDebugVisible = heightDebugVisible;
  }

  // ========================================
  // DIAMOND MARKER FACTORY
  // ========================================

  /**
   * Create a diamond marker with glow effect and optional rings
   * @param options Marker configuration
   * @returns Group containing the marker meshes
   */
  createDiamondMarker(options: DiamondMarkerOptions): Group {
    const { color, size = 1, glowIntensity = 1, showRings = true } = options;

    const group = new Group();

    // Derive colors from base color
    const baseColor = new Color(color);
    const lighterColor = baseColor.clone().lerp(new Color(0xffffff), 0.4);
    const emissiveColor = baseColor.clone().multiplyScalar(0.3);

    // === MAIN DIAMOND (inner core) ===
    const coreGeom = new OctahedronGeometry(8 * size, 0);
    coreGeom.scale(1, 1.8, 1);
    const coreMat = new MeshPhongMaterial({
      color: color,
      emissive: emissiveColor,
      shininess: 100,
      transparent: true,
      opacity: 0.9,
      side: DoubleSide,
    });
    const coreMesh = new Mesh(coreGeom, coreMat);
    coreMesh.renderOrder = 3;
    group.add(coreMesh);

    // === OUTER WIREFRAME (edge glow) ===
    const wireGeom = new OctahedronGeometry(9 * size, 0);
    wireGeom.scale(1, 1.8, 1);
    const wireMat = new MeshBasicMaterial({
      color: lighterColor,
      wireframe: true,
      transparent: true,
      opacity: 0.6 * glowIntensity,
    });
    const wireMesh = new Mesh(wireGeom, wireMat);
    wireMesh.renderOrder = 4;
    group.add(wireMesh);

    // === OUTER GLOW SHELL ===
    const glowGeom = new OctahedronGeometry(12 * size, 0);
    glowGeom.scale(1, 1.8, 1);
    const glowMat = new MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.15 * glowIntensity,
      side: BackSide,
    });
    const glowMesh = new Mesh(glowGeom, glowMat);
    glowMesh.renderOrder = 2;
    group.add(glowMesh);

    if (showRings) {
      // === HORIZONTAL RING ===
      const ringGeom = new TorusGeometry(14 * size, 0.8 * size, 8, 32);
      const ringMat = new MeshBasicMaterial({
        color: lighterColor,
        transparent: true,
        opacity: 0.7 * glowIntensity,
      });
      const ringMesh = new Mesh(ringGeom, ringMat);
      ringMesh.rotation.x = Math.PI / 2;
      ringMesh.renderOrder = 2;
      group.add(ringMesh);

      // === SECOND RING (tilted) ===
      const ring2Geom = new TorusGeometry(16 * size, 0.5 * size, 8, 32);
      const ring2Mat = new MeshBasicMaterial({
        color: lighterColor,
        transparent: true,
        opacity: 0.4 * glowIntensity,
      });
      const ring2Mesh = new Mesh(ring2Geom, ring2Mat);
      ring2Mesh.rotation.x = Math.PI / 2;
      ring2Mesh.rotation.z = Math.PI / 6;
      ring2Mesh.renderOrder = 2;
      group.add(ring2Mesh);
    }

    return group;
  }

  /**
   * Dispose a diamond marker group properly
   * @param marker Marker group to dispose
   */
  disposeDiamondMarker(marker: Group): void {
    marker.traverse((obj) => {
      if ((obj as Mesh).isMesh) {
        (obj as Mesh).geometry.dispose();
        const mat = (obj as Mesh).material;
        if (Array.isArray(mat)) {
          mat.forEach((m) => m.dispose());
        } else {
          mat.dispose();
        }
      }
    });
  }

  // ========================================
  // BASE MARKER
  // ========================================

  /**
   * Add base/HQ marker at base coordinates
   */
  addBaseMarker(): void {
    if (!this.engine || !this.baseCoords) return;

    const overlayGroup = this.engine.getOverlayGroup();

    // Remove existing marker
    if (this.baseMarker) {
      overlayGroup.remove(this.baseMarker);
      this.disposeDiamondMarker(this.baseMarker);
    }

    // Create new marker
    this.baseMarker = this.createDiamondMarker({
      color: 0x22c55e, // Green (matches original HQ marker)
      size: 1.0,
      showRings: true,
      glowIntensity: 1.2,
    });
    this.baseMarker.name = 'baseMarker';

    // Position at base coords
    const HEIGHT_ABOVE_GROUND = 30;
    const local = this.engine.sync.geoToLocalSimple(this.baseCoords.lat, this.baseCoords.lon, 0);
    this.baseMarker.position.set(local.x, HEIGHT_ABOVE_GROUND, local.z);

    overlayGroup.add(this.baseMarker);
  }

  /**
   * Remove base marker
   */
  removeBaseMarker(): void {
    if (!this.baseMarker || !this.engine) return;

    const overlayGroup = this.engine.getOverlayGroup();
    overlayGroup.remove(this.baseMarker);
    this.disposeDiamondMarker(this.baseMarker);
    this.baseMarker = null;
  }

  // ========================================
  // SPAWN MARKERS
  // ========================================

  /**
   * Add spawn marker at specified location
   * @param id Spawn point ID
   * @param name Spawn point name
   * @param lat Latitude
   * @param lon Longitude
   * @param color Marker color (js hex)
   * @returns Created marker group
   */
  addSpawnMarker(id: string, name: string, lat: number, lon: number, color: number): Group | null {
    if (!this.engine || !this.baseCoords) return null;

    const overlayGroup = this.engine.getOverlayGroup();

    // Position marker on terrain with RELATIVE heights
    const HEIGHT_ABOVE_GROUND = 30; // Spawn markers ~30m above ground
    const originTerrainY = this.engine.getTerrainHeightAtGeo(this.baseCoords.lat, this.baseCoords.lon);
    const terrainY = this.engine.getTerrainHeightAtGeo(lat, lon);
    const local = this.engine.sync.geoToLocalSimple(lat, lon, 0);

    // Calculate relative Y (height difference from origin)
    let markerY = HEIGHT_ABOVE_GROUND;
    if (originTerrainY !== null && terrainY !== null) {
      markerY = terrainY - originTerrainY + HEIGHT_ABOVE_GROUND;
    }

    // Create spawn marker - same size as HQ, but no rings
    const marker = this.createDiamondMarker({
      color,
      size: 1.0,
      showRings: false,
      glowIntensity: 0.8,
    });
    marker.name = `spawnMarker_${id}`;
    marker.position.set(local.x, markerY, local.z);

    overlayGroup.add(marker);
    this.spawnMarkers.push(marker);

    return marker;
  }

  /**
   * Remove spawn marker by ID
   * @param spawnId Spawn point ID
   */
  removeSpawnMarker(spawnId: string): void {
    if (!this.engine) return;

    const overlayGroup = this.engine.getOverlayGroup();
    const index = this.spawnMarkers.findIndex((m) => m.name === `spawnMarker_${spawnId}`);

    if (index >= 0) {
      const marker = this.spawnMarkers[index];
      overlayGroup.remove(marker);
      this.disposeDiamondMarker(marker);
      this.spawnMarkers.splice(index, 1);
    }
  }

  /**
   * Clear all spawn markers
   */
  clearSpawnMarkers(): void {
    if (!this.engine) return;

    const overlayGroup = this.engine.getOverlayGroup();

    for (const marker of this.spawnMarkers) {
      overlayGroup.remove(marker);
      this.disposeDiamondMarker(marker);
    }

    this.spawnMarkers = [];
  }

  /**
   * Get all spawn markers
   */
  getSpawnMarkers(): Group[] {
    return this.spawnMarkers;
  }

  /**
   * Get base marker
   */
  getBaseMarker(): Group | null {
    return this.baseMarker;
  }

  // ========================================
  // HEIGHT DEBUG MARKERS
  // ========================================

  /**
   * Add height debug marker (small sphere)
   * @param position World position
   * @param height Terrain height (null if raycast miss)
   * @param isHit Whether raycast hit terrain
   */
  addHeightDebugMarker(position: Vector3, height: number | null, isHit: boolean): void {
    if (!this.engine) return;

    const overlayGroup = this.engine.getOverlayGroup();

    // Create debug group if not exists (hidden by default)
    if (!this.heightDebugGroup) {
      this.heightDebugGroup = new Group();
      this.heightDebugGroup.name = 'heightDebugGroup';
      this.heightDebugGroup.visible = this.heightDebugVisible?.() ?? false;
      overlayGroup.add(this.heightDebugGroup);
    }

    // Create small sphere marker
    const geometry = new SphereGeometry(1, 8, 8);
    const material = new MeshBasicMaterial({
      color: isHit ? 0x00ff00 : 0xff0000, // Green for hits, red for misses
      transparent: true,
      opacity: 0.7,
      depthTest: true,
    });

    const marker = new Mesh(geometry, material);
    marker.position.copy(position);
    marker.position.y += 2; // Slightly above the street
    marker.renderOrder = 10;

    this.heightDebugGroup.add(marker);
  }

  /**
   * Clear all height debug markers
   */
  clearHeightDebugMarkers(): void {
    if (!this.heightDebugGroup || !this.engine) return;

    const overlayGroup = this.engine.getOverlayGroup();

    // Dispose all markers
    this.heightDebugGroup.traverse((obj) => {
      if ((obj as Mesh).isMesh) {
        (obj as Mesh).geometry.dispose();
        const mat = (obj as Mesh).material;
        if (Array.isArray(mat)) {
          mat.forEach((m) => m.dispose());
        } else {
          mat.dispose();
        }
      }
    });

    // Remove from scene
    overlayGroup.remove(this.heightDebugGroup);
    this.heightDebugGroup = null;
  }

  /**
   * Toggle height debug markers visibility
   * @param visible Visibility state
   */
  toggleHeightDebug(visible: boolean): void {
    if (this.heightDebugGroup) {
      this.heightDebugGroup.visible = visible;
    }
  }

  // ========================================
  // ANIMATION & UPDATES
  // ========================================

  /**
   * Animate markers (rotation, pulsing, etc.)
   * @param deltaTime Time since last frame in milliseconds
   */
  animateMarkers(deltaTime: number): void {
    // Rotate base marker (deltaTime is in milliseconds)
    if (this.baseMarker) {
      this.baseMarker.rotation.y += deltaTime * 0.001; // Slow rotation
    }

    // Rotate spawn markers in opposite direction
    for (const marker of this.spawnMarkers) {
      marker.rotation.y -= deltaTime * 0.0015;
    }
  }

  /**
   * Update heights of all markers based on terrain
   * @param spawnPoints Spawn points to update
   */
  updateMarkerHeights(spawnPoints: SpawnPoint[]): void {
    if (!this.engine || !this.baseCoords) return;

    const HQ_MARKER_HEIGHT = 30;
    const SPAWN_MARKER_HEIGHT = 30;

    // Get origin terrain height
    const originTerrainY = this.engine.getTerrainHeightAtGeo(this.baseCoords.lat, this.baseCoords.lon);
    if (originTerrainY === null) return;

    // Update base marker - at origin, so relative height = 0
    if (this.baseMarker) {
      const local = this.engine.sync.geoToLocalSimple(this.baseCoords.lat, this.baseCoords.lon, 0);
      this.baseMarker.position.set(local.x, HQ_MARKER_HEIGHT, local.z);
    }

    // Update spawn markers - relative to origin
    for (let i = 0; i < spawnPoints.length && i < this.spawnMarkers.length; i++) {
      const spawn = spawnPoints[i];
      const marker = this.spawnMarkers[i];

      const terrainY = this.engine.getTerrainHeightAtGeo(spawn.latitude, spawn.longitude);
      if (terrainY !== null) {
        const local = this.engine.sync.geoToLocalSimple(spawn.latitude, spawn.longitude, 0);
        const relativeY = terrainY - originTerrainY + SPAWN_MARKER_HEIGHT;
        marker.position.set(local.x, relativeY, local.z);
      }
    }
  }

  /**
   * Clear all markers (spawn, base, debug)
   */
  clearAllMarkers(): void {
    this.clearSpawnMarkers();
    this.removeBaseMarker();
    this.clearHeightDebugMarkers();
  }

  // ========================================
  // CLEANUP
  // ========================================

  /**
   * Dispose all markers and cleanup
   */
  dispose(): void {
    this.clearAllMarkers();
    this.engine = null;
    this.baseCoords = null;
    this.heightDebugVisible = null;
  }
}
