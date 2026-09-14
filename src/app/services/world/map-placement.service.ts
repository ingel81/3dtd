import { Injectable, inject, signal } from '@angular/core';
import { Group, Mesh, MeshPhongMaterial, MeshBasicMaterial, Color, Vector2 } from 'three';
import { ThreeTilesEngine } from '../../three-engine';
import { MarkerVisualizationService } from './marker-visualization.service';
import {
  PORTAL_POSE_WAYPOINTS,
  portalCorridorWidth,
  portalLaneOffset,
  portalTurnRange,
  provisionalPortalPose,
  spawnPortalPose,
  type SpawnPortalPose,
} from '../../three-engine/renderers/marker/spawn-portal-pose';
import { SpawnDistanceRings } from '../../three-engine/renderers/spawn-distance-rings';
import { OsmStreetService, Street, StreetNetwork } from '../location/osm-street.service';
import { UIStore } from '../../store/ui.store';
import { GeoPosition } from '../../models/game.types';
import {
  MIN_MANUAL_SPAWN_DISTANCE,
  MAX_MANUAL_SPAWN_DISTANCE,
  MAX_HQ_STREET_DISTANCE,
  MAX_SPAWN_STREET_DISTANCE,
} from '../../configs/map-constants.config';

/**
 * Result of a successful placement click
 */
export interface PlacementResult {
  mode: 'hq' | 'spawn';
  lat: number;
  lon: number;
  height: number;
  /**
   * Heading the player turned the spawn portal to with R (scene rotation
   * about +Y, rad), within the range where the enemies still leave through
   * its opening. Absent if they did not turn it: the portal then faces
   * along its route.
   */
  heading?: number;
}

/** The route a spawn at the cursor would get, as far as its portal needs it. */
interface PreviewRoute {
  /** The portal as it will stand on the route start, facing along the route */
  pose: SpawnPortalPose;
  /** How far R may turn it from pose.heading either way (rad), see portalTurnRange */
  turn: { min: number; max: number };
}

/**
 * Turn of the spawn preview while R is held (rad/s): 15 degrees a second,
 * about a second from one limit of the turn range to the other on a
 * straight street (12 to 21 degrees wide).
 */
const TURN_SPEED = Math.PI / 12;

// Colors for valid/invalid preview, the same for the HQ and a spawn: the
// spawn's own red would not tell a valid place from an invalid one
const VALID_COLOR = 0x22c55e;
const INVALID_COLOR = 0xff0000;
const HEIGHT_ABOVE_GROUND = 30;

// Rings around the HQ while a spawn is placed: the inner one where "Too
// close to HQ" ends in --td-warn-orange, the outer one where "Too far from
// HQ" begins in the preview's valid green
const MIN_RING_COLOR = 0xc96a3a;
const MAX_RING_COLOR = VALID_COLOR;

/**
 * MapPlacementService
 *
 * Handles interactive HQ and spawn point placement on the 3D map.
 * Manages preview marker (follows cursor), position validation,
 * and mode lifecycle. Follows the TowerPlacementService pattern.
 */
@Injectable({ providedIn: 'root' })
export class MapPlacementService {
  private readonly uiStore = inject(UIStore);
  private readonly markerViz = inject(MarkerVisualizationService);
  private readonly osmService = inject(OsmStreetService);

  /** Current validation reason (null when valid) — read by component for context hints */
  readonly validationReason = signal<string | null>(null);

  // Preview marker that follows the cursor
  private previewMarker: Group | null = null;

  // Distance rings (min/max spawn distance from HQ)
  private distanceRings: SpawnDistanceRings | null = null;

  // Current validated position (set on mouse move)
  private currentPosition: { lat: number; lon: number; height: number } | null = null;
  private currentValid = false;

  // Turn the player gave the spawn preview with R, from its route's heading
  // (rad), null until they do; held within each route's turn range
  private manualTurn: number | null = null;
  private turnDirection = 1;
  private isRotating = false;

  // The route a spawn would get, per start node, see previewRouteAt(); and
  // the one under the cursor now, null where no spawn may stand
  private readonly routeFromNode = new Map<number, PreviewRoute | null>();
  private currentRoute: PreviewRoute | null = null;

  // Dependencies (set via initialize)
  private engine: ThreeTilesEngine | null = null;
  private streetNetwork: StreetNetwork | null = null;
  private baseCoords: GeoPosition | null = null;

  // ========================================
  // PUBLIC API
  // ========================================

  /** Current placement mode (delegates to UIStore) */
  placementMode(): 'hq' | 'spawn' | null {
    return this.uiStore.mapPlacementMode();
  }

  /**
   * Initialize with engine and current game state.
   * Called from VisualizationFacade after engine + streets are ready.
   */
  initialize(
    engine: ThreeTilesEngine,
    streetNetwork: StreetNetwork | null,
    baseCoords: GeoPosition,
  ): void {
    this.engine = engine;
    this.streetNetwork = streetNetwork;
    this.baseCoords = baseCoords;
    this.routeFromNode.clear();
  }

  /**
   * Update dependencies after location change.
   */
  updateDependencies(
    streetNetwork: StreetNetwork | null,
    baseCoords: GeoPosition,
  ): void {
    this.streetNetwork = streetNetwork;
    this.baseCoords = baseCoords;
    this.routeFromNode.clear();
  }

  /**
   * Enter placement mode. Creates a preview marker that follows the cursor.
   * @param mode 'hq' to place headquarters, 'spawn' to place spawn point
   */
  startPlacement(mode: 'hq' | 'spawn'): void {
    // Clean up any previous placement
    this.exitPlacementMode();

    // Set mode signal
    this.uiStore.mapPlacementMode.set(mode);

    // Create preview marker (semi-transparent): the HQ diamond or a spawn portal
    this.previewMarker = mode === 'hq'
      ? this.markerViz.createDiamondMarker({ color: VALID_COLOR, size: 0.8, glowIntensity: 0.6 })
      : this.markerViz.createPortalPreview(VALID_COLOR);
    this.previewMarker.name = 'placementPreview';
    this.previewMarker.visible = false;

    // Make semi-transparent
    this.setMarkerOpacity(this.previewMarker, 0.5);

    // Add to overlay group
    if (this.engine) {
      this.engine.getOverlayGroup().add(this.previewMarker);
    }

    // Show distance rings for spawn mode
    if (mode === 'spawn') {
      this.createDistanceRings();
    }
  }

  /**
   * Update preview marker position (called on mouse move).
   * Validates position and colorizes green/red.
   *
   * A spawn preview where a spawn may stand shows its portal as it will
   * stand: on the start of the route it gets, facing along it
   * (spawnPortalPose), turned as far as the player turned it with R within
   * the opening (portalTurnRange). Elsewhere it stands at the cursor facing
   * the HQ.
   */
  updatePreviewPosition(lat: number, lon: number, height: number): void {
    if (!this.previewMarker || !this.engine) return;

    const mode = this.uiStore.mapPlacementMode();
    if (!mode) return;

    // Store current position
    this.currentPosition = { lat, lon, height };

    const local = this.engine.sync.geoToLocalSimple(lat, lon, 0);
    const groundY = this.engine.getTerrainHeightAtGeo(lat, lon) ?? 0;
    let validation: { valid: boolean; reason?: string };
    if (mode === 'hq') {
      // The HQ diamond floats above the cursor
      this.previewMarker.position.set(local.x, groundY + HEIGHT_ABOVE_GROUND, local.z);
      validation = this.validatePosition(mode, lat, lon);
    } else {
      const check = this.checkSpawn(lat, lon);
      this.currentRoute = check.route ?? null;
      this.standSpawnPreview(local.x, groundY, local.z);
      validation = check;
    }
    this.previewMarker.visible = true;

    // Colorize
    this.currentValid = validation.valid;
    this.validationReason.set(validation.valid ? null : (validation.reason ?? 'Invalid position'));
    this.colorizePreviewMarker(validation.valid);
  }

  /** Stand the spawn preview on the route under the cursor, without one at (x, y, z) facing the HQ. */
  private standSpawnPreview(x: number, y: number, z: number): void {
    const preview = this.previewMarker!;
    const route = this.currentRoute;
    if (route) {
      preview.position.set(route.pose.x, route.pose.y, route.pose.z);
      preview.rotation.y = route.pose.heading + this.turnOn(route);
      preview.scale.setScalar(route.pose.scale);
      return;
    }
    preview.position.set(x, y, z);
    preview.scale.setScalar(1);
    if (this.baseCoords) {
      const hq = this.engine!.sync.geoToLocalSimple(this.baseCoords.lat, this.baseCoords.lon, 0);
      preview.rotation.y = provisionalPortalPose(x, y, z, hq.x, hq.z).heading;
    }
  }

  /** The player's turn on `route`, held within its turn range. */
  private turnOn(route: PreviewRoute): number {
    return Math.min(route.turn.max, Math.max(route.turn.min, this.manualTurn ?? 0));
  }

  /**
   * Handle placement click. Returns result if valid, null if invalid.
   * Automatically exits placement mode on success.
   */
  handlePlacementClick(): PlacementResult | null {
    const mode = this.uiStore.mapPlacementMode();
    if (!mode || !this.currentPosition || !this.currentValid) return null;

    const result: PlacementResult = {
      mode,
      lat: this.currentPosition.lat,
      lon: this.currentPosition.lon,
      height: this.currentPosition.height,
    };
    const route = this.currentRoute;
    if (mode === 'spawn' && this.manualTurn !== null && route) result.heading = route.pose.heading + this.turnOn(route);

    this.exitPlacementMode();
    return result;
  }

  /**
   * Exit placement mode, clean up preview marker.
   */
  exitPlacementMode(): void {
    if (this.previewMarker && this.engine) {
      this.engine.getOverlayGroup().remove(this.previewMarker);
      this.markerViz.disposePreviewMarker(this.previewMarker);
      this.previewMarker = null;
    }

    this.removeDistanceRings();
    this.currentPosition = null;
    this.currentValid = false;
    this.currentRoute = null;
    this.manualTurn = null;
    this.turnDirection = 1;
    this.isRotating = false;
    this.validationReason.set(null);
    this.uiStore.mapPlacementMode.set(null);
  }

  // ========================================
  // ROTATION (R key hold, spawn only)
  // ========================================

  /**
   * Start turning the spawn preview (R down). Once turned, the spawn keeps
   * the player's heading instead of facing along its route
   * (handlePlacementClick, MarkerVisualizationService.setPortalHeading),
   * within the range where the enemies still leave through the opening
   * (portalTurnRange). A press that starts at the limit it turns towards
   * turns the other way; the key's auto-repeat while held changes nothing.
   * @returns whether it took the key: only a spawn preview turns
   */
  startRotating(): boolean {
    if (this.uiStore.mapPlacementMode() !== 'spawn' || !this.previewMarker) return false;
    const route = this.currentRoute;
    if (!this.isRotating && route) {
      const limit = this.turnDirection > 0 ? route.turn.max : route.turn.min;
      if (this.turnOn(route) === limit) this.turnDirection = -this.turnDirection;
    }
    this.isRotating = true;
    return true;
  }

  /** Stop turning (R up). */
  stopRotating(): void {
    this.isRotating = false;
  }

  /**
   * Turn the spawn preview while R is held; call once per frame. It turns
   * on a route only (off the streets it faces the HQ) and stops at the
   * limit of the route's turn range.
   * @param deltaTime Time since the last frame (s)
   */
  updateRotation(deltaTime: number): void {
    const route = this.currentRoute;
    if (!this.isRotating || !this.previewMarker || !route) return;
    const turn = this.turnOn(route) + this.turnDirection * TURN_SPEED * deltaTime;
    this.manualTurn = Math.min(route.turn.max, Math.max(route.turn.min, turn));
    this.previewMarker.rotation.y = route.pose.heading + this.manualTurn;
  }

  /**
   * Validate a position for the given placement mode.
   *
   * A spawn stands between the two rings around the HQ and on a street of
   * the loaded network (MAX_SPAWN_STREET_DISTANCE): its route starts on the
   * street nearest to the click. The rings come first, so beyond the outer
   * one the hint says "Too far from HQ" wherever the cursor is. Outside the
   * loaded streets' box only the ways reaching out of it are known; there
   * the hint says the streets are not loaded rather than that there are none.
   */
  validatePosition(mode: 'hq' | 'spawn', lat: number, lon: number): { valid: boolean; reason?: string } {
    // HQ can be placed anywhere — streets will be loaded afterwards via the slow path
    // in MapRelocationService.applyNewHqPosition()
    if (mode === 'hq') {
      if (this.streetNetwork) {
        // If we have a street network, validate proximity only within loaded bounds
        if (this.isInsideStreets(lat, lon)) {
          const nearest = this.osmService.findNearestStreetPoint(this.streetNetwork, lat, lon);
          if (!nearest || nearest.distance > MAX_HQ_STREET_DISTANCE) {
            return { valid: false, reason: 'Too far from streets' };
          }
        }
        // Outside bounds → allow (streets will be loaded for new area)
      }
      // No street network at all → allow
      return { valid: true };
    }

    const { valid, reason } = this.checkSpawn(lat, lon);
    return valid ? { valid } : { valid, reason };
  }

  /**
   * Whether a spawn may stand at (lat, lon), see validatePosition(), and
   * where it may, the route it would get.
   */
  private checkSpawn(lat: number, lon: number): { valid: boolean; reason?: string; route?: PreviewRoute } {
    // Spawn mode: requires loaded street network
    if (!this.streetNetwork) {
      return { valid: false, reason: 'No street network loaded' };
    }
    if (!this.baseCoords) {
      return { valid: false, reason: 'No HQ placed' };
    }

    const distToHq = this.osmService.haversineDistance(
      lat, lon,
      this.baseCoords.lat, this.baseCoords.lon,
    );
    if (distToHq < MIN_MANUAL_SPAWN_DISTANCE) {
      return { valid: false, reason: 'Too close to HQ' };
    }
    if (distToHq > MAX_MANUAL_SPAWN_DISTANCE) {
      return { valid: false, reason: 'Too far from HQ' };
    }

    const nearest = this.osmService.findNearestStreetPoint(this.streetNetwork, lat, lon);
    if (!nearest || nearest.distance > MAX_SPAWN_STREET_DISTANCE) {
      return { valid: false, reason: this.isInsideStreets(lat, lon) ? 'Too far from streets' : 'Streets not loaded here' };
    }
    const route = this.previewRouteAt(nearest, lat, lon);
    if (!route) {
      return { valid: false, reason: 'No route to HQ' };
    }

    return { valid: true, route };
  }

  /**
   * The route a spawn at the click would get, found as the relocation will
   * find it (findPath from the click); null without one, where the
   * relocation would turn the click down without a word after a green
   * preview. The route starts on the nearest segment's first node, so it
   * is remembered per node: sliding along a street asks A* once per
   * segment, not once per mouse move.
   */
  private previewRouteAt(nearest: { street: Street; nodeIndex: number }, lat: number, lon: number): PreviewRoute | null {
    const startId = nearest.street.nodes[nearest.nodeIndex].id;
    let known = this.routeFromNode.get(startId);
    if (known === undefined) {
      known = this.buildPreviewRoute(lat, lon);
      this.routeFromNode.set(startId, known);
    }
    return known;
  }

  /**
   * The portal's pose on the route from (lat, lon) to the HQ, as
   * MarkerVisualizationService.placeSpawnPortal will stand it, and its turn
   * range. The corridor there is not measured before the route is built:
   * the pose takes the default width, the placed portal its own.
   */
  private buildPreviewRoute(lat: number, lon: number): PreviewRoute | null {
    const engine = this.engine;
    const hq = this.baseCoords!;
    const path = this.osmService.findPath(this.streetNetwork!, lat, lon, hq.lat, hq.lon);
    if (!engine || path.length < 2) return null;

    const points = path.slice(0, PORTAL_POSE_WAYPOINTS).map((node) => {
      const p = engine.sync.geoToLocalSimple(node.lat, node.lon, 0);
      return { x: p.x, z: p.z };
    });
    const start = { lat: path[0].lat, lon: path[0].lon };
    const groundY = engine.getTerrainHeightAtGeo(start.lat, start.lon) ?? 0;
    const pose = spawnPortalPose(points, groundY, portalCorridorWidth(start));
    return pose && { pose, turn: portalTurnRange(points, pose, portalLaneOffset(start)) };
  }

  /** Whether the position lies inside the box the street network was loaded for. */
  private isInsideStreets(lat: number, lon: number): boolean {
    const b = this.streetNetwork!.bounds;
    return lat >= b.minLat && lat <= b.maxLat && lon >= b.minLon && lon <= b.maxLon;
  }

  /**
   * Clean up all resources.
   */
  dispose(): void {
    this.exitPlacementMode();
    this.engine = null;
    this.streetNetwork = null;
    this.baseCoords = null;
  }

  // ========================================
  // PRIVATE HELPERS
  // ========================================

  /**
   * Colorize preview marker: green for valid, red for invalid.
   */
  private colorizePreviewMarker(valid: boolean): void {
    if (!this.previewMarker) return;

    const targetColor = valid ? VALID_COLOR : INVALID_COLOR;
    const color = new Color(targetColor);

    this.previewMarker.traverse((obj) => {
      if (!(obj as Mesh).isMesh) return;
      const mat = (obj as Mesh).material;
      if (mat instanceof MeshPhongMaterial) {
        mat.color.copy(color);
        mat.emissive.copy(color.clone().multiplyScalar(0.3));
      } else if (mat instanceof MeshBasicMaterial) {
        mat.color.copy(color.clone().lerp(new Color(0xffffff), 0.4));
      }
    });
  }

  /**
   * Set opacity on all materials in a marker group.
   */
  private setMarkerOpacity(marker: Group, opacity: number): void {
    marker.traverse((obj) => {
      if (!(obj as Mesh).isMesh) return;
      const mat = (obj as Mesh).material;
      if (mat instanceof MeshPhongMaterial || mat instanceof MeshBasicMaterial) {
        mat.transparent = true;
        mat.opacity = Math.min(mat.opacity, opacity);
      }
    });
  }

  // ========================================
  // DISTANCE RINGS (spawn placement)
  // ========================================

  /**
   * Show the min/max distance rings around the HQ for spawn placement
   * feedback, on the ground (SpawnDistanceRings).
   */
  private createDistanceRings(): void {
    if (!this.engine || !this.baseCoords) return;

    const resolution = this.engine.getRenderer().getSize(new Vector2());
    this.distanceRings = new SpawnDistanceRings(this.engine, this.baseCoords, [
      { radiusM: MIN_MANUAL_SPAWN_DISTANCE, color: MIN_RING_COLOR },
      { radiusM: MAX_MANUAL_SPAWN_DISTANCE, color: MAX_RING_COLOR },
    ], resolution);
    this.engine.getOverlayGroup().add(this.distanceRings.group);
  }

  /**
   * Remove distance rings from the scene and dispose resources.
   */
  private removeDistanceRings(): void {
    if (!this.distanceRings) return;
    this.distanceRings.group.removeFromParent();
    this.distanceRings.dispose();
    this.distanceRings = null;
  }
}
