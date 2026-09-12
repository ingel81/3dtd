import { Injectable, WritableSignal, inject } from '@angular/core';
import {
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhongMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  TorusGeometry,
  DoubleSide,
  BackSide,
  Vector3,
  SphereGeometry,
  Color,
} from 'three';
import { ThreeTilesEngine } from '../../three-engine';
import { GameEventBus, SubscriptionBag } from '../../game-engine';
import { GeoPosition, RouteWaypoint } from '../../models/game.types';
import { HQDamageService } from '../combat/hq-damage.service';
import { UIStore } from '../../store/ui.store';
import { MarkerInstanceManager } from '../../three-engine/renderers/marker/marker-instance.manager';
import { MarkerLabelManager } from '../../three-engine/renderers/marker/marker-label.manager';
import { SpawnPortalManager } from '../../three-engine/renderers/marker/spawn-portal.manager';
import { createPortalFrameGeometry } from '../../three-engine/renderers/marker/spawn-portal-geometry';
import {
  type SpawnPortalPose,
  provisionalPortalPose,
  spawnPortalPose,
} from '../../three-engine/renderers/marker/spawn-portal-pose';
import {
  HQ_MARKER_SCALE,
  MARKER_FLOAT_HEIGHT,
  MARKER_LABEL_OFFSET,
  PORTAL_OPENING_HEIGHT,
  PORTAL_OPENING_WIDTH,
  PORTAL_SETBACK,
  portalLabelHeight,
} from '../../configs/marker-geometry.config';
import { SPAWN_PORTAL_LOOK, type BurstPalette } from '../../configs/visual-effects.config';
import { corridorConfig } from '../../utils/route-corridor';

/** Waypoints from the route start read for a portal's heading, see spawnPortalPose. */
const PORTAL_POSE_WAYPOINTS = 16;

/**
 * An enemy spawning this close to a portal's centre came out of it (m).
 * Enemies start on the route start, PORTAL_SETBACK behind the portal plane.
 */
const SPAWN_MATCH_RADIUS = PORTAL_SETBACK + 6;

/** Spark colours of a portal: white-hot, its colour, its colour darkened. */
function portalPalette(color: number): BurstPalette {
  const c = new Color(color);
  const hot = c.clone().lerp(new Color(0xffffff), 0.65);
  return [
    { r: hot.r, g: hot.g, b: hot.b },
    { r: c.r, g: c.g, b: c.b },
    { r: c.r * 0.5, g: c.g * 0.5, b: c.b * 0.5 },
  ];
}

/**
 * SpawnPoint definition - extends GeoPosition for consistent coordinate handling
 */
export interface SpawnPoint extends GeoPosition {
  id: string;
  name: string;
  color: number; // Three.js hex color
}

/**
 * Options for creating a diamond marker (used for the HQ placement preview)
 */
export interface DiamondMarkerOptions {
  color: number;
  size?: number;
  glowIntensity?: number;
}

/**
 * MarkerVisualizationService
 *
 * Manages the 3D markers: the HQ diamond, a portal on the start of every
 * spawn's route, their labels, and debug markers. GPU-instanced: 3 draw
 * calls for the HQ diamond (body, rings, ground glow), 2 for all spawn
 * portals (frame, energy), 1 for all labels.
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

  /** GPU-instanced HQ diamond renderer (body, rings, ground glow) */
  private markerManager: MarkerInstanceManager | null = null;

  /** GPU-instanced spawn portal renderer (frame, energy) */
  private portalManager: SpawnPortalManager | null = null;

  /** GPU-instanced label renderer (billboard text) */
  private labelManager: MarkerLabelManager | null = null;

  /**
   * Portals standing on a route cell. The others were placed before the
   * cells existed and follow the terrain sample (updateMarkerHeights).
   */
  private readonly portalsOnCells = new Set<string>();

  /** Spark colours per portal, built once when the portal is added */
  private readonly portalPalettes = new Map<string, BurstPalette>();

  /** Height debug markers group (small spheres for terrain height debugging) */
  private heightDebugGroup: Group | null = null;

  /** Reference to the 3D engine */
  private engine: ThreeTilesEngine | null = null;

  /** Base coordinates for relative height calculations */
  private baseCoords: GeoPosition | null = null;

  /** Height debug visibility state (from UIStore) */
  private heightDebugVisible: WritableSignal<boolean> | null = null;

  /** Game events the portals follow, see subscribeToEventBus() */
  private readonly eventBusSubs = new SubscriptionBag();

  private readonly tmpVec = new Vector3();

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

    // A location change initializes again: drop the previous meshes
    this.markerManager?.dispose();
    this.portalManager?.dispose();
    this.labelManager?.dispose();
    this.portalsOnCells.clear();
    this.portalPalettes.clear();

    const overlayGroup = engine.getOverlayGroup();
    this.markerManager = new MarkerInstanceManager(overlayGroup);
    this.portalManager = new SpawnPortalManager(overlayGroup);
    this.labelManager = new MarkerLabelManager(overlayGroup);
  }

  /**
   * Let the portals follow the game: a surge at wave start, the wave's
   * energy while it runs, idle again once it or the game is over, and a
   * burst when an enemy steps through (onEnemySpawned).
   */
  subscribeToEventBus(eventBus: GameEventBus): void {
    this.eventBusSubs.disposeAll();
    this.eventBusSubs.add(eventBus.on('wave:started', () => this.portalManager?.startWave(performance.now())));
    const calmDown = () => this.portalManager?.endWave();
    this.eventBusSubs.add(eventBus.on('wave:completed', calmDown));
    this.eventBusSubs.add(eventBus.on('game:over', calmDown));
    this.eventBusSubs.add(eventBus.on('game:reset', calmDown));
    this.eventBusSubs.add(eventBus.on('enemy:spawned', (event) => this.onEnemySpawned(event.enemy.position)));
  }

  /**
   * Spawn effect when an enemy steps through a portal: a ripple over the
   * surface and the street and sparks thrown out along its facing. Waves
   * reach thousands of enemies, so a portal takes at most one burst per
   * SPAWN_PORTAL_LOOK.burstIntervalMs, and while every portal waits an
   * enemy costs one comparison. No allocation per enemy. Decoration of the
   * impact kind: off together with the impact effects (VFX settings); the
   * portal itself always shows.
   */
  private onEnemySpawned(position: GeoPosition): void {
    const engine = this.engine;
    const portals = this.portalManager;
    if (!engine || !portals) return;
    const now = performance.now();
    if (now < portals.burstReadyMs || !engine.effects.impactEffectsEnabled) return;

    const local = engine.sync.geoToLocalSimpleInto(position.lat, position.lon, 0, this.tmpVec);
    const id = portals.portalNear(local.x, local.z, SPAWN_MATCH_RADIUS);
    if (id === null || !portals.tryBurst(id, now)) return;

    const pose = portals.getPose(id)!;
    const palette = this.portalPalettes.get(id);
    if (!palette) return;
    engine.effects.spawnPortalSparks(
      pose.x,
      pose.y,
      pose.z,
      Math.sin(pose.heading),
      Math.cos(pose.heading),
      (PORTAL_OPENING_WIDTH / 2) * pose.scale,
      PORTAL_OPENING_HEIGHT * pose.scale,
      SPAWN_PORTAL_LOOK.burstParticles,
      palette,
    );
  }

  // ========================================
  // BASE MARKER
  // ========================================

  /**
   * Add base/HQ marker at base coordinates
   */
  addBaseMarker(): void {
    if (!this.engine || !this.baseCoords || !this.markerManager || !this.labelManager) return;

    // Before the old marker goes: without a terrain sample the new one keeps
    // its height (hqMarkerPos), which is gone once it is removed.
    const pos = this.hqMarkerPos();

    // Remove existing
    this.markerManager.remove('hq');
    this.labelManager.removeLabel('hq');

    this.markerManager.add('hq', pos, 0x22c55e, HQ_MARKER_SCALE, 0.001);
    this.labelManager.addLabel('hq', 'HQ', this.hqLabelCentre(pos), '#22c55e', this.getPhaseOffset('hq'));
  }

  /**
   * Scene-space position of the HQ marker.
   *
   * Absolute Y: the overlay group carries no terrain offset any more, so the
   * ground under the HQ has to be part of the position. `addBaseMarker` runs
   * before tiles are guaranteed to be streamed — falling back to 0 there put
   * the marker ~135 m below the surface, i.e. invisible inside the terrain,
   * which is why bookmarked locations came up without their HQ pylon. When
   * the sample is not available yet the marker keeps its current height and
   * the tile-load refresh corrects it.
   */
  private hqMarkerPos(): Vector3 {
    const base = this.baseCoords!;
    const local = this.engine!.sync.geoToLocalSimple(base.lat, base.lon, 0);
    const terrainY = this.engine!.getTerrainHeightAtGeo(base.lat, base.lon);
    const currentY = this.markerManager?.getPosition('hq')?.y;
    const y = terrainY !== null
      ? terrainY + MARKER_FLOAT_HEIGHT
      : currentY ?? MARKER_FLOAT_HEIGHT;
    return new Vector3(local.x, y, local.z);
  }

  /** Centre of the HQ label above the diamond centre `pos`. */
  private hqLabelCentre(pos: Vector3): Vector3 {
    return new Vector3(pos.x, pos.y + MARKER_LABEL_OFFSET, pos.z);
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
  // SPAWN PORTALS
  // ========================================

  /**
   * Add a spawn portal. Until its route is built (placeSpawnPortal) it
   * stands on the spawn point, facing the HQ. Only this spawn's own column
   * matters for its height.
   */
  addSpawnMarker(id: string, name: string, lat: number, lon: number, color: number): void {
    if (!this.engine || !this.baseCoords || !this.portalManager || !this.labelManager) return;

    const terrainY = this.engine.getTerrainHeightAtGeo(lat, lon);
    const local = this.engine.sync.geoToLocalSimple(lat, lon, 0);
    const hq = this.engine.sync.geoToLocalSimple(this.baseCoords.lat, this.baseCoords.lon, 0);
    const pose = provisionalPortalPose(local.x, terrainY ?? 0, local.z, hq.x, hq.z);

    // Convert hex color to CSS string for label outline
    const cssColor = '#' + new Color(color).getHexString();

    this.portalManager.add(id, pose, color);
    this.portalsOnCells.delete(id);
    this.portalPalettes.set(id, portalPalette(color));
    this.labelManager.addLabel(id, name, this.portalLabelCentre(pose), cssColor, this.getPhaseOffset(id));
  }

  /**
   * Stand a spawn portal on the start of its route. PathAndRouteService
   * calls this whenever it builds the route: on the ground at the first
   * waypoint, facing along the route, the opening as wide as the corridor
   * there (spawnPortalPose).
   *
   * @param startGroundY Route cell height at the start, null while the cells
   *   are not built; the portal then stands on the terrain sample there
   */
  placeSpawnPortal(id: string, route: readonly RouteWaypoint[], startGroundY: number | null): void {
    const engine = this.engine;
    const portals = this.portalManager;
    if (!engine || !portals || !this.labelManager) return;
    const current = portals.getPose(id);
    if (!current || route.length < 2) return;

    const count = Math.min(route.length, PORTAL_POSE_WAYPOINTS);
    const points: { x: number; z: number }[] = [];
    for (let i = 0; i < count; i++) {
      const local = engine.sync.geoToLocalSimple(route[i].lat, route[i].lon, 0);
      points.push({ x: local.x, z: local.z });
    }

    const start = route[0];
    const halfWidth = Math.max(
      start.corridorLeft ?? corridorConfig.defaultHalfWidth,
      start.corridorRight ?? corridorConfig.defaultHalfWidth,
    );
    const groundY = startGroundY ?? engine.getTerrainHeightAtGeo(start.lat, start.lon) ?? current.y;
    const pose = spawnPortalPose(points, groundY, 2 * halfWidth);
    if (!pose) return;

    portals.setPose(id, pose);
    if (startGroundY !== null) this.portalsOnCells.add(id);
    else this.portalsOnCells.delete(id);
    this.labelManager.updatePosition(id, this.portalLabelCentre(pose));
  }

  /** Centre of a spawn label above its portal. */
  private portalLabelCentre(pose: SpawnPortalPose): Vector3 {
    return new Vector3(pose.x, pose.y + portalLabelHeight(pose.scale), pose.z);
  }

  /**
   * Remove spawn portal by ID
   */
  removeSpawnMarker(spawnId: string): void {
    if (!this.portalManager || !this.labelManager) return;
    this.portalManager.remove(spawnId);
    this.labelManager.removeLabel(spawnId);
    this.portalsOnCells.delete(spawnId);
    this.portalPalettes.delete(spawnId);
  }

  /**
   * Clear all spawn portals
   */
  clearSpawnMarkers(): void {
    if (!this.portalManager || !this.labelManager) return;

    for (const id of [...this.portalManager.ids()]) {
      this.portalManager.remove(id);
      this.labelManager.removeLabel(id);
    }
    this.portalsOnCells.clear();
    this.portalPalettes.clear();
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
   * Animate markers (the shaders do the motion; this feeds their clocks).
   * Wall time: the markers keep moving while the game is paused.
   */
  animateMarkers(_deltaTime: number): void {
    if (!this.engine || !this.markerManager || !this.portalManager || !this.labelManager) return;

    this.markerManager.update(this.engine.getCamera());
    this.portalManager.update(performance.now());
    this.labelManager.update();
  }

  /**
   * Follow the terrain: the HQ diamond, and the spawn portals that do not
   * stand on a route cell yet. A portal on a cell moves with its route
   * (placeSpawnPortal), which is rebuilt when the cells change.
   */
  updateMarkerHeights(): void {
    if (!this.engine || !this.baseCoords || !this.markerManager || !this.portalManager || !this.labelManager) return;

    // Update base marker
    const basePos = this.hqMarkerPos();
    this.markerManager.updatePosition('hq', basePos);
    this.labelManager.updatePosition('hq', this.hqLabelCentre(basePos));

    for (const id of this.portalManager.ids()) {
      if (this.portalsOnCells.has(id)) continue;
      const pose = this.portalManager.getPose(id)!;
      const geo = this.engine.sync.localToGeo(this.tmpVec.set(pose.x, 0, pose.z));
      const terrainY = this.engine.getTerrainHeightAtGeo(geo.lat, geo.lon);
      if (terrainY === null) continue;
      const moved = { ...pose, y: terrainY };
      this.portalManager.setPose(id, moved);
      this.labelManager.updatePosition(id, this.portalLabelCentre(moved));
    }
  }

  /**
   * Clear all markers (spawn, base, debug)
   */
  clearAllMarkers(): void {
    this.markerManager?.clear();
    this.portalManager?.clear();
    this.labelManager?.clear();
    this.clearHeightDebugMarkers();
    this.portalsOnCells.clear();
    this.portalPalettes.clear();
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
   * Create a diamond marker Group for the HQ placement preview
   * (non-instanced). Used by MapPlacementService for the cursor-following
   * preview; the spawn preview is createPortalPreview().
   */
  createDiamondMarker(options: DiamondMarkerOptions): Group {
    const { color, size = 1, glowIntensity = 1 } = options;

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

    return group;
  }

  /**
   * Create a spawn portal Group for the spawn placement preview
   * (non-instanced): the frame and a flat surface in the opening, at
   * scale 1, standing on its origin and facing +z. Plain Phong/Basic
   * materials, so MapPlacementService can tint and fade it.
   */
  createPortalPreview(color: number): Group {
    const group = new Group();
    const emissive = new Color(color).multiplyScalar(0.3);

    const frameMat = new MeshPhongMaterial({ color, emissive, flatShading: true });
    const frame = new Mesh(createPortalFrameGeometry(), frameMat);
    frame.renderOrder = 3;
    group.add(frame);

    const surfaceGeom = new PlaneGeometry(PORTAL_OPENING_WIDTH, PORTAL_OPENING_HEIGHT);
    surfaceGeom.translate(0, PORTAL_OPENING_HEIGHT / 2, 0);
    const surfaceMat = new MeshBasicMaterial({ color, transparent: true, opacity: 0.6, side: DoubleSide });
    const surface = new Mesh(surfaceGeom, surfaceMat);
    surface.renderOrder = 4;
    group.add(surface);

    return group;
  }

  /**
   * Dispose a placement preview group (diamond or portal).
   */
  disposePreviewMarker(marker: Group): void {
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
    this.eventBusSubs.disposeAll();
    this.markerManager?.dispose();
    this.portalManager?.dispose();
    this.labelManager?.dispose();
    this.clearHeightDebugMarkers();
    this.markerManager = null;
    this.portalManager = null;
    this.labelManager = null;
    this.portalsOnCells.clear();
    this.portalPalettes.clear();
    this.engine = null;
    this.baseCoords = null;
    this.heightDebugVisible = null;
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
