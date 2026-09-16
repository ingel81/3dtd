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
import { OsmStreetService, Street, StreetNetwork, StreetNode } from '../location/osm-street.service';
import type { SegmentRoutes } from '../../utils/route-start';
import { raycastStats } from '../../utils/raycast-stats';
import { UIStore } from '../../store/ui.store';
import { GeoPosition } from '../../models/game.types';
import { canonicalCoords } from '../../utils/geo-utils';
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
  /** Where the click placed it, in its canonical form (canonicalCoords), as checked */
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

/** Where the preview marker stands: scene position, heading without the player's R turn, scale. */
interface PreviewPose {
  x: number;
  y: number;
  z: number;
  heading: number;
  scale: number;
}

/**
 * Turn of the spawn preview while R is held (rad/s): 15 degrees a second,
 * about a second from one limit of the turn range to the other on a
 * straight street (12 to 21 degrees wide).
 */
const TURN_SPEED = Math.PI / 12;

/**
 * Time constant the preview follows its pose with (s), see updatePreview():
 * a step to where the cursor moved, to another street or onto a new ground
 * sample is 90 % made up within about 0.1 s instead of in one jump between
 * two pointer moves. The click places the pose, not what is shown.
 */
const PREVIEW_FOLLOW_S = 0.04;

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

  // The routes a spawn on each street segment ("street id:node index") would
  // get, see previewRouteAt(); and the one under the cursor now, null where
  // no spawn may stand
  private readonly routesFromSegment = new Map<string, SegmentRoutes | null>();
  private currentRoute: PreviewRoute | null = null;

  // Where the preview is shown and the pose it follows (updatePreview), null
  // until the first move after it appears, which it takes at once
  private shownPose: PreviewPose | null = null;
  private targetPose: PreviewPose | null = null;

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
    this.routesFromSegment.clear();
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
    this.routesFromSegment.clear();
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
   * the HQ. The first move after the preview appears puts it there; later
   * ones give the pose it glides to (updatePreview).
   *
   * The cursor counts in the canonical form of its coordinates
   * (canonicalCoords), the one the click places HQ or spawn in: the checks
   * and the preview see the point that is placed, which moves in steps of
   * about a metre.
   */
  updatePreviewPosition(cursorLat: number, cursorLon: number, height: number): void {
    if (!this.previewMarker || !this.engine) return;

    const mode = this.uiStore.mapPlacementMode();
    if (!mode) return;

    // Store current position
    const { lat, lon } = canonicalCoords({ lat: cursorLat, lon: cursorLon });
    this.currentPosition = { lat, lon, height };

    const local = this.engine.sync.geoToLocalSimple(lat, lon, 0);
    const groundY = this.engine.getTerrainHeightAtGeo(lat, lon) ?? 0;
    let validation: { valid: boolean; reason?: string };
    if (mode === 'hq') {
      // The HQ diamond floats above the cursor
      this.followPose({ x: local.x, y: groundY + HEIGHT_ABOVE_GROUND, z: local.z, heading: 0, scale: 1 });
      validation = this.validatePosition(mode, lat, lon);
    } else {
      const check = this.checkSpawn(lat, lon);
      this.currentRoute = check.route ?? null;
      this.followPose(this.spawnPreviewPose(local.x, groundY, local.z));
      validation = check;
    }
    this.previewMarker.visible = true;

    // Colorize
    this.currentValid = validation.valid;
    this.validationReason.set(validation.valid ? null : (validation.reason ?? 'Invalid position'));
    this.colorizePreviewMarker(validation.valid);
  }

  /** The spawn preview's pose: on the route under the cursor, without one at (x, y, z) facing the HQ. */
  private spawnPreviewPose(x: number, y: number, z: number): PreviewPose {
    const route = this.currentRoute;
    if (route) {
      const { pose } = route;
      return { x: pose.x, y: pose.y, z: pose.z, heading: pose.heading, scale: pose.scale };
    }
    let heading = 0;
    if (this.baseCoords) {
      const hq = this.engine!.sync.geoToLocalSimple(this.baseCoords.lat, this.baseCoords.lon, 0);
      heading = provisionalPortalPose(x, y, z, hq.x, hq.z).heading;
    }
    return { x, y, z, heading, scale: 1 };
  }

  /** Let the preview follow `pose`; the first one after it appears it takes at once. */
  private followPose(pose: PreviewPose): void {
    this.targetPose = pose;
    if (!this.shownPose) {
      this.shownPose = { ...pose };
      this.applyShownPose();
    }
  }

  /** Put the preview marker where it is shown, turned by the player's R on a route. */
  private applyShownPose(): void {
    const preview = this.previewMarker!;
    const shown = this.shownPose!;
    const route = this.currentRoute;
    preview.position.set(shown.x, shown.y, shown.z);
    preview.rotation.y = shown.heading + (route ? this.turnOn(route) : 0);
    preview.scale.setScalar(shown.scale);
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
    this.shownPose = null;
    this.targetPose = null;
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
   * Once per frame: turn the spawn preview while R is held, on a route only
   * (off the streets it faces the HQ) up to the limit of the route's turn
   * range, and let the preview glide towards the pose of the last move
   * (PREVIEW_FOLLOW_S), its heading the short way round. The turn comes on
   * top without delay.
   * @param deltaTime Time since the last frame (s)
   */
  updatePreview(deltaTime: number): void {
    const shown = this.shownPose;
    const target = this.targetPose;
    if (!this.previewMarker || !shown || !target) return;

    const route = this.currentRoute;
    if (this.isRotating && route) {
      const turn = this.turnOn(route) + this.turnDirection * TURN_SPEED * deltaTime;
      this.manualTurn = Math.min(route.turn.max, Math.max(route.turn.min, turn));
    }

    const follow = 1 - Math.exp(-deltaTime / PREVIEW_FOLLOW_S);
    shown.x += (target.x - shown.x) * follow;
    shown.y += (target.y - shown.y) * follow;
    shown.z += (target.z - shown.z) * follow;
    shown.scale += (target.scale - shown.scale) * follow;
    const turnLeft = target.heading - shown.heading;
    shown.heading += Math.atan2(Math.sin(turnLeft), Math.cos(turnLeft)) * follow;
    this.applyShownPose();
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
   * preview. The route starts at the click's foot on its nearest segment
   * (SegmentRoutes), so the preview follows the cursor along the street.
   * The routes on from that segment are kept per segment: sliding along a
   * street runs A* at most twice per segment, not once per mouse move.
   */
  private previewRouteAt(nearest: { street: Street; nodeIndex: number }, lat: number, lon: number): PreviewRoute | null {
    const key = `${nearest.street.id}:${nearest.nodeIndex}`;
    let routes = this.routesFromSegment.get(key);
    if (routes === undefined) {
      const hq = this.baseCoords!;
      routes = this.osmService.segmentRoutes(this.streetNetwork!, nearest, hq.lat, hq.lon);
      this.routesFromSegment.set(key, routes);
    }
    return routes && this.buildPreviewRoute(routes.routeFrom(lat, lon));
  }

  /**
   * The portal's pose on `path`, the route from the click to the HQ, as
   * MarkerVisualizationService.placeSpawnPortal will stand it, and its turn
   * range; null for a path of less than two nodes, where there is no route.
   * The corridor there is not measured before the route is built: the pose
   * takes the default width, the placed portal its own.
   */
  private buildPreviewRoute(path: StreetNode[]): PreviewRoute | null {
    const engine = this.engine;
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
    // A column sample per ring point and one at the centre, all in this
    // call: `__raycastStats()` books their rays as `spawnRings`
    const scope = raycastStats.enter('spawnRings');
    try {
      this.distanceRings = new SpawnDistanceRings(this.engine, this.baseCoords, [
        { radiusM: MIN_MANUAL_SPAWN_DISTANCE, color: MIN_RING_COLOR },
        { radiusM: MAX_MANUAL_SPAWN_DISTANCE, color: MAX_RING_COLOR },
      ], resolution);
    } finally {
      raycastStats.exit(scope);
    }
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
