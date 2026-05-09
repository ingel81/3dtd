import { Injectable, WritableSignal, inject } from '@angular/core';
import {
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhongMaterial,
  OctahedronGeometry,
  TorusGeometry,
  DoubleSide,
  BackSide,
  Vector3,
  SphereGeometry,
  Color,
} from 'three';
import { ThreeTilesEngine } from '../three-engine';
import { GeoPosition } from '../models/game.types';
import { HQDamageService } from './combat/hq-damage.service';
import { UIStore } from '../store/ui.store';
import { MarkerInstanceManager } from '../three-engine/renderers/marker/marker-instance.manager';
import { MarkerLabelManager } from '../three-engine/renderers/marker/marker-label.manager';

/**
 * SpawnPoint definition - extends GeoPosition for consistent coordinate handling
 */
export interface SpawnPoint extends GeoPosition {
  id: string;
  name: string;
  color: number; // Three.js hex color
}

/**
 * Options for creating a diamond marker (used for placement preview)
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
 * Uses GPU-instanced rendering for diamond bodies, rings, ground glow, and labels.
 * Total: 4 draw calls for all markers (diamond + ring + ground + label).
 */
@Injectable({ providedIn: 'root' })
export class MarkerVisualizationService {
  // ========================================
  // INJECTED SERVICES
  // ========================================

  private readonly hqDamage = inject(HQDamageService);
  private readonly uiStore = inject(UIStore);

  // ========================================
  // STATE
  // ========================================

  /** GPU-instanced marker renderer (diamonds, rings, ground glow) */
  private markerManager: MarkerInstanceManager | null = null;

  /** GPU-instanced label renderer (billboard text) */
  private labelManager: MarkerLabelManager | null = null;

  /** Height debug markers group (small spheres for terrain height debugging) */
  private heightDebugGroup: Group | null = null;

  /** Reference to the 3D engine */
  private engine: ThreeTilesEngine | null = null;

  /** Base coordinates for relative height calculations */
  private baseCoords: GeoPosition | null = null;

  /** Height debug visibility state (from UIStore) */
  private heightDebugVisible: WritableSignal<boolean> | null = null;

  /** Spawn counter for label numbering */
  private spawnCounter = 0;

  // ========================================
  // INITIALIZATION
  // ========================================

  /**
   * Initialize marker visualization service
   */
  initialize(
    engine: ThreeTilesEngine,
    baseCoords: GeoPosition,
    heightDebugVisible: WritableSignal<boolean>
  ): void {
    this.engine = engine;
    this.baseCoords = baseCoords;
    this.heightDebugVisible = heightDebugVisible;

    const overlayGroup = engine.getOverlayGroup();
    this.markerManager = new MarkerInstanceManager(overlayGroup);
    this.labelManager = new MarkerLabelManager(overlayGroup);
  }

  // ========================================
  // BASE MARKER
  // ========================================

  /**
   * Add base/HQ marker at base coordinates
   */
  addBaseMarker(): void {
    if (!this.engine || !this.baseCoords || !this.markerManager || !this.labelManager) return;

    // Remove existing
    this.markerManager.remove('hq');
    this.labelManager.removeLabel('hq');

    const HEIGHT_ABOVE_GROUND = 30;
    const local = this.engine.sync.geoToLocalSimple(this.baseCoords.lat, this.baseCoords.lon, 0);
    const pos = new Vector3(local.x, HEIGHT_ABOVE_GROUND, local.z);

    this.markerManager.add('hq', 'hq', pos, 0x22c55e, 1.2, 0.001);
    this.labelManager.addLabel('hq', 'HQ', pos, '#22c55e', this.getPhaseOffset('hq'));
  }

  /**
   * Remove base marker
   */
  removeBaseMarker(): void {
    if (!this.markerManager || !this.labelManager) return;
    this.markerManager.remove('hq');
    this.labelManager.removeLabel('hq');
  }

  // ========================================
  // SPAWN MARKERS
  // ========================================

  /**
   * Add spawn marker at specified location
   */
  addSpawnMarker(id: string, name: string, lat: number, lon: number, color: number): Group | null {
    if (!this.engine || !this.baseCoords || !this.markerManager || !this.labelManager) return null;

    const HEIGHT_ABOVE_GROUND = 30;
    const originTerrainY = this.engine.getTerrainHeightAtGeo(this.baseCoords.lat, this.baseCoords.lon);
    const terrainY = this.engine.getTerrainHeightAtGeo(lat, lon);
    const local = this.engine.sync.geoToLocalSimple(lat, lon, 0);

    let markerY = HEIGHT_ABOVE_GROUND;
    if (originTerrainY !== null && terrainY !== null) {
      markerY = terrainY - originTerrainY + HEIGHT_ABOVE_GROUND;
    }

    const pos = new Vector3(local.x, markerY, local.z);
    this.spawnCounter++;

    // Convert hex color to CSS string for label outline
    const cssColor = '#' + new Color(color).getHexString();

    const proxy = this.markerManager.add(id, 'spawn', pos, color, 0.8, -0.0015);
    this.labelManager.addLabel(id, name, pos, cssColor, this.getPhaseOffset(id));

    return proxy;
  }

  /**
   * Remove spawn marker by ID
   */
  removeSpawnMarker(spawnId: string): void {
    if (!this.markerManager || !this.labelManager) return;
    this.markerManager.remove(spawnId);
    this.labelManager.removeLabel(spawnId);
  }

  /**
   * Clear all spawn markers
   */
  clearSpawnMarkers(): void {
    if (!this.markerManager || !this.labelManager) return;

    // Get all spawn proxies to find their ids
    const proxies = this.markerManager.getAllSpawnProxies();
    for (const proxy of proxies) {
      const id = proxy.name.replace('spawnMarker_', '');
      this.markerManager.remove(id);
      this.labelManager.removeLabel(id);
    }
    this.spawnCounter = 0;
  }

  /**
   * Get all spawn markers (proxy groups for backward compatibility)
   */
  getSpawnMarkers(): Group[] {
    return this.markerManager?.getAllSpawnProxies() ?? [];
  }

  /**
   * Get base marker (proxy group)
   */
  getBaseMarker(): Group | null {
    return this.markerManager?.getBaseProxy() ?? null;
  }

  // ========================================
  // HEIGHT DEBUG MARKERS
  // ========================================

  /**
   * Add height debug marker (small sphere)
   */
  addHeightDebugMarker(position: Vector3, height: number | null, isHit: boolean): void {
    if (!this.engine) return;

    const overlayGroup = this.engine.getOverlayGroup();

    if (!this.heightDebugGroup) {
      this.heightDebugGroup = new Group();
      this.heightDebugGroup.name = 'heightDebugGroup';
      this.heightDebugGroup.visible = this.heightDebugVisible?.() ?? false;
      overlayGroup.add(this.heightDebugGroup);
    }

    const geometry = new SphereGeometry(1, 8, 8);
    const material = new MeshBasicMaterial({
      color: isHit ? 0x00ff00 : 0xff0000,
      transparent: true,
      opacity: 0.7,
      depthTest: true,
    });

    const marker = new Mesh(geometry, material);
    marker.position.copy(position);
    marker.position.y += 2;
    marker.renderOrder = 10;

    this.heightDebugGroup.add(marker);
  }

  /**
   * Clear all height debug markers
   */
  clearHeightDebugMarkers(): void {
    if (!this.heightDebugGroup || !this.engine) return;

    const overlayGroup = this.engine.getOverlayGroup();

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

    overlayGroup.remove(this.heightDebugGroup);
    this.heightDebugGroup = null;
  }

  /**
   * Toggle height debug markers visibility
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
   * Animate markers (GPU shader handles rotation, pulsing, bobbing).
   * Updates shader uniforms via managers.
   */
  animateMarkers(_deltaTime: number): void {
    if (!this.engine || !this.markerManager || !this.labelManager) return;

    const camera = this.engine.getCamera();
    const changedIds = this.markerManager.update(camera);

    // Sync label positions for markers whose proxy was moved (e.g. snap-to-path)
    for (const id of changedIds) {
      const proxy = this.markerManager.getProxy(id);
      if (proxy) {
        this.labelManager.updatePosition(id, proxy.position);
      }
    }

    this.labelManager.update();
  }

  /**
   * Update heights of all markers based on terrain
   */
  updateMarkerHeights(spawnPoints: SpawnPoint[]): void {
    if (!this.engine || !this.baseCoords || !this.markerManager || !this.labelManager) return;

    const HQ_MARKER_HEIGHT = 30;
    const SPAWN_MARKER_HEIGHT = 30;

    const originTerrainY = this.engine.getTerrainHeightAtGeo(this.baseCoords.lat, this.baseCoords.lon);
    if (originTerrainY === null) return;

    // Update base marker
    const baseLocal = this.engine.sync.geoToLocalSimple(this.baseCoords.lat, this.baseCoords.lon, 0);
    const basePos = new Vector3(baseLocal.x, HQ_MARKER_HEIGHT, baseLocal.z);
    this.markerManager.updatePosition('hq', basePos);
    this.labelManager.updatePosition('hq', basePos);

    // Update spawn markers
    for (const spawn of spawnPoints) {
      const terrainY = this.engine.getTerrainHeightAtGeo(spawn.lat, spawn.lon);
      if (terrainY !== null) {
        const local = this.engine.sync.geoToLocalSimple(spawn.lat, spawn.lon, 0);
        const relativeY = terrainY - originTerrainY + SPAWN_MARKER_HEIGHT;
        const pos = new Vector3(local.x, relativeY, local.z);
        this.markerManager.updatePosition(spawn.id, pos);
        this.labelManager.updatePosition(spawn.id, pos);
      }
    }
  }

  /**
   * Clear all markers (spawn, base, debug)
   */
  clearAllMarkers(): void {
    this.markerManager?.clear();
    this.labelManager?.clear();
    this.clearHeightDebugMarkers();
    this.spawnCounter = 0;
  }

  // ========================================
  // DEBUG VISUALIZATION
  // ========================================

  /**
   * Toggle special points debug visualization.
   */
  toggleSpecialPointsDebug(): void {
    this.uiStore.toggleSpecialPointsDebug();
    const visible = this.uiStore.specialPointsDebugVisible();

    if (this.engine) {
      this.engine.effects.setDebugSpheresVisible(visible);

      if (visible) {
        this.spawnHQDebugPoint();
      }
    }
  }

  /**
   * Spawn or update HQ debug point at cached terrain height.
   */
  spawnHQDebugPoint(): void {
    this.hqDamage.spawnDebugPoint();
  }

  /**
   * Update debug sphere visibility based on UI state.
   */
  updateDebugSpheresVisibility(): void {
    if (!this.engine) return;
    this.engine.effects.setDebugSpheresVisible(
      this.uiStore.specialPointsDebugVisible()
    );
  }

  // ========================================
  // PREVIEW MARKER FACTORY (for placement preview, non-instanced)
  // ========================================

  /**
   * Create a diamond marker Group for placement preview (non-instanced).
   * Used by MapPlacementService for cursor-following preview markers.
   */
  createDiamondMarker(options: DiamondMarkerOptions): Group {
    const { color, size = 1, glowIntensity = 1, showRings = true } = options;

    const group = new Group();
    const baseColor = new Color(color);
    const lighterColor = baseColor.clone().lerp(new Color(0xffffff), 0.4);
    const emissiveColor = baseColor.clone().multiplyScalar(0.3);

    const coreGeom = new OctahedronGeometry(8 * size, 0);
    coreGeom.scale(1, 1.8, 1);
    const coreMat = new MeshPhongMaterial({
      color, emissive: emissiveColor, shininess: 100,
      transparent: true, opacity: 0.9, side: DoubleSide,
    });
    const coreMesh = new Mesh(coreGeom, coreMat);
    coreMesh.renderOrder = 3;
    group.add(coreMesh);

    const wireGeom = new OctahedronGeometry(9 * size, 0);
    wireGeom.scale(1, 1.8, 1);
    const wireMat = new MeshBasicMaterial({
      color: lighterColor, wireframe: true,
      transparent: true, opacity: 0.6 * glowIntensity,
    });
    const wireMesh = new Mesh(wireGeom, wireMat);
    wireMesh.renderOrder = 4;
    group.add(wireMesh);

    const glowGeom = new OctahedronGeometry(12 * size, 0);
    glowGeom.scale(1, 1.8, 1);
    const glowMat = new MeshBasicMaterial({
      color, transparent: true,
      opacity: 0.15 * glowIntensity, side: BackSide,
    });
    const glowMesh = new Mesh(glowGeom, glowMat);
    glowMesh.renderOrder = 2;
    group.add(glowMesh);

    if (showRings) {
      const ringGeom = new TorusGeometry(14 * size, 0.8 * size, 8, 32);
      const ringMat = new MeshBasicMaterial({
        color: lighterColor, transparent: true,
        opacity: 0.7 * glowIntensity,
      });
      const ringMesh = new Mesh(ringGeom, ringMat);
      ringMesh.rotation.x = Math.PI / 2;
      ringMesh.renderOrder = 2;
      group.add(ringMesh);

      const ring2Geom = new TorusGeometry(16 * size, 0.5 * size, 8, 32);
      const ring2Mat = new MeshBasicMaterial({
        color: lighterColor, transparent: true,
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
   * Dispose a diamond marker group (for placement preview cleanup).
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
  // CLEANUP
  // ========================================

  /**
   * Dispose all markers and cleanup
   */
  dispose(): void {
    this.markerManager?.dispose();
    this.labelManager?.dispose();
    this.clearHeightDebugMarkers();
    this.markerManager = null;
    this.labelManager = null;
    this.engine = null;
    this.baseCoords = null;
    this.heightDebugVisible = null;
    this.spawnCounter = 0;
  }

  // ========================================
  // PRIVATE
  // ========================================

  /**
   * Get consistent phase offset for a marker id (deterministic from id hash).
   */
  private getPhaseOffset(id: string): number {
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
    }
    return (Math.abs(hash) % 1000) / 1000 * Math.PI * 2;
  }
}
