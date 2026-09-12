import { Injectable } from '@angular/core';
import { Vector3, Box3, MathUtils, PerspectiveCamera } from 'three';
import { ThreeTilesEngine } from '../three-engine';
import { METERS_PER_DEGREE_LAT } from '../utils/geo-utils';
import { fitGroundBox } from '../utils/camera-fit';
import { CAMERA_EDGE_MARGIN } from '../configs/map-constants.config';
import {
  HQ_MARKER_SCALE,
  MARKER_FLOAT_HEIGHT,
  MARKER_LABEL_SIZE,
  MARKER_LABEL_TOP,
  MARKER_RING_RADIUS,
  SPAWN_MARKER_SCALE,
} from '../configs/marker-geometry.config';
import { cameraTimeline } from '../utils/camera-timeline';

/**
 * Represents a computed camera frame (position + lookAt target)
 */
export interface CameraFrame {
  // Camera position
  camX: number;
  camY: number;
  camZ: number;
  // LookAt target
  lookAtX: number;
  lookAtY: number;
  lookAtZ: number;
  // Metadata
  boundingBox: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    centerX: number;
    centerZ: number;
    spanX: number;
    spanZ: number;
  };
  cameraDistance: number;
  cameraAngle: number; // in degrees
}

/**
 * Configuration for frame computation
 */
export interface FrameConfig {
  /** Padding factor (0.2 = 20% extra space) */
  padding?: number;
  /** Camera angle from horizontal in degrees (default: 70) */
  angle?: number;
  /** Minimum span in meters (default: 50) */
  minSpan?: number;
  /** Radius added around every ground point (default: 8) */
  markerRadius?: number;
  /** Estimated terrain height when real height unknown (default: 0) */
  estimatedTerrainY?: number;
  /** Viewport aspect ratio (default: 16/9) */
  aspectRatio?: number;
  /** Vertical FOV in degrees (default: 75) */
  fov?: number;
  /** Gap between padded box and image edge per side, fraction of the image (default: CAMERA_EDGE_MARGIN) */
  edgeMargin?: number;
  /** Additional route points to include in bounding box (optional) */
  routePoints?: GeoPoint[];
  /**
   * Ground height at a local (x, z), the route grid's cells in the game. When
   * given, computeFrameWithEngine sets the frame on the median over its ground
   * points instead of the single terrain sample under the HQ, which can fall
   * into a hole in the mesh (-749 m under central Stuttgart, 2026-09-12).
   */
  groundAt?: (x: number, z: number) => GroundSample | null;
}

/** One ground height for the frame; `reliable` = from a fine enough tile. */
export interface GroundSample {
  y: number;
  reliable: boolean;
}

/**
 * Geographic point
 */
export interface GeoPoint {
  lat: number;
  lon: number;
}

/** Settings of one fit, defaults resolved. */
type FitConfig = Required<Omit<FrameConfig, 'estimatedTerrainY' | 'routePoints' | 'groundAt'>> & {
  estimatedTerrainY: number;
};

/** Fewer reliable ground samples than this and the frame takes all of them. */
const MIN_RELIABLE_GROUND = 3;

/** Median of the finite values, null without any. */
function median(values: readonly (number | null)[]): number | null {
  const finite = values.filter((v): v is number => v !== null && Number.isFinite(v)).sort((a, b) => a - b);
  if (finite.length === 0) return null;
  const mid = finite.length >> 1;
  return finite.length % 2 === 1 ? finite[mid] : (finite[mid - 1] + finite[mid]) / 2;
}

/** Upper bound on the rounds of the raised-point fit, see computeFrameFromLocalPoints(). */
const RAISED_FIT_ROUNDS = 8;

/** The rounds stop once the camera distance changes by less than this (m). */
const RAISED_FIT_TOLERANCE = 0.01;

/**
 * Cap on how far out a raised point's ground stand-in moves, for tiny frames
 * where the camera sits barely above a label.
 */
const MAX_STAND_IN_FACTOR = 4;

/**
 * What must stay in the picture of one diamond marker, as height above the
 * ground: the ring at its four extremes and the upper corners of a label up
 * to twice as wide as tall.
 */
function pushMarkerExtent(centre: Vector3, scale: number, out: Vector3[]): void {
  const r = MARKER_RING_RADIUS * scale;
  out.push(
    new Vector3(centre.x + r, MARKER_FLOAT_HEIGHT, centre.z),
    new Vector3(centre.x - r, MARKER_FLOAT_HEIGHT, centre.z),
    new Vector3(centre.x, MARKER_FLOAT_HEIGHT, centre.z + r),
    new Vector3(centre.x, MARKER_FLOAT_HEIGHT, centre.z - r),
  );
  const top = MARKER_FLOAT_HEIGHT + MARKER_LABEL_TOP;
  out.push(
    new Vector3(centre.x + MARKER_LABEL_SIZE, top, centre.z),
    new Vector3(centre.x - MARKER_LABEL_SIZE, top, centre.z),
  );
}

/** Raised points of the HQ marker and every spawn marker. */
function markerPoints(hq: Vector3, spawns: readonly Vector3[]): Vector3[] {
  const out: Vector3[] = [];
  pushMarkerExtent(hq, HQ_MARKER_SCALE, out);
  for (const spawn of spawns) pushMarkerExtent(spawn, SPAWN_MARKER_SCALE, out);
  return out;
}

/**
 * Ground point on the camera ray through `p` (y = height above the terrain),
 * for a camera at (camX, height, camZ) over the same terrain.
 */
function groundStandIn(p: Vector3, camX: number, camZ: number, height: number): Vector3 {
  const k = p.y < height ? Math.min(height / (height - p.y), MAX_STAND_IN_FACTOR) : MAX_STAND_IN_FACTOR;
  return new Vector3(camX + (p.x - camX) * k, 0, camZ + (p.z - camZ) * k);
}

/**
 * CameraFramingService
 *
 * Computes optimal camera positions to frame game elements.
 * Can work without engine (for initial framing before render).
 *
 * Key features:
 * - Pre-render framing computation (no engine needed)
 * - Box3 based bounding box calculation
 * - HQ and spawn markers framed with their height, see computeFrameFromLocalPoints()
 * - 70° default angle for minimal horizon/tile loading
 * - Perspective-aware viewport fitting
 */
@Injectable({ providedIn: 'root' })
export class CameraFramingService {
  // ========================================
  // CONSTANTS
  // ========================================

  /** Default camera angle from horizontal (70° = steep, minimal horizon) */
  private static readonly DEFAULT_ANGLE = 70;

  /** Default padding factor */
  private static readonly DEFAULT_PADDING = 0.1;

  /** Default radius around every ground point in meters */
  private static readonly DEFAULT_MARKER_RADIUS = 8;

  /** Minimum span in meters */
  private static readonly DEFAULT_MIN_SPAN = 50;

  /** Approximate meters per degree latitude */
  private static readonly METERS_PER_DEG_LAT = METERS_PER_DEGREE_LAT;

  // ========================================
  // STATE
  // ========================================

  /** Engine reference: terrain height, precise coordinates, the camera's lens. */
  private engine: ThreeTilesEngine | null = null;

  /** Last computed frame for reference */
  private lastFrame: CameraFrame | null = null;

  // ========================================
  // INITIALIZATION
  // ========================================

  /**
   * Set engine reference for terrain height queries
   */
  setEngine(engine: ThreeTilesEngine | null): void {
    this.engine = engine;
  }

  /**
   * Get last computed frame
   */
  getLastFrame(): CameraFrame | null {
    return this.lastFrame;
  }

  // ========================================
  // CORE FRAMING COMPUTATION
  // ========================================

  /**
   * Compute initial camera frame from geographic coordinates.
   * Works WITHOUT engine - uses approximate geo-to-local conversion.
   * Use this BEFORE engine initialization for optimal initial camera position.
   *
   * @param hq HQ/base geographic coordinates (will be at local origin)
   * @param spawns Array of spawn point coordinates
   * @param config Frame configuration
   * @returns Computed camera frame
   */
  computeInitialFrame(
    hq: GeoPoint,
    spawns: GeoPoint[],
    config: FrameConfig = {}
  ): CameraFrame {
    const {
      padding = CameraFramingService.DEFAULT_PADDING,
      angle = CameraFramingService.DEFAULT_ANGLE,
      minSpan = CameraFramingService.DEFAULT_MIN_SPAN,
      markerRadius = CameraFramingService.DEFAULT_MARKER_RADIUS,
      estimatedTerrainY = 0,
      aspectRatio = 16 / 9,
      fov = 75,
      edgeMargin = CAMERA_EDGE_MARGIN,
      routePoints = [],
    } = config;

    // Convert geo coordinates to approximate local coordinates
    // HQ is at origin (0, 0, 0), the spawns follow it
    const localPoints = this.geoToLocalApproximate(hq, spawns, routePoints);
    const raised = markerPoints(localPoints[0], localPoints.slice(1, 1 + spawns.length));

    return this.computeFrameFromLocalPoints(localPoints, raised, {
      padding,
      angle,
      minSpan,
      markerRadius,
      estimatedTerrainY,
      aspectRatio,
      fov,
      edgeMargin,
    });
  }

  /**
   * Compute camera frame using engine's precise coordinate conversion and the
   * camera's own lens. Use this AFTER engine initialization for accurate framing.
   *
   * @param hq HQ geographic coordinates
   * @param spawns Spawn point coordinates
   * @param config Frame configuration
   * @returns Computed camera frame, or null while the ground under the HQ is unknown
   */
  computeFrameWithEngine(
    hq: GeoPoint,
    spawns: GeoPoint[],
    config: FrameConfig = {}
  ): CameraFrame | null {
    if (!this.engine) {
      return this.computeInitialFrame(hq, spawns, config);
    }

    const {
      padding = CameraFramingService.DEFAULT_PADDING,
      angle = CameraFramingService.DEFAULT_ANGLE,
      minSpan = CameraFramingService.DEFAULT_MIN_SPAN,
      markerRadius = CameraFramingService.DEFAULT_MARKER_RADIUS,
      aspectRatio = 16 / 9,
      fov = 75,
      edgeMargin = CAMERA_EDGE_MARGIN,
      routePoints = [],
      groundAt,
    } = config;

    // Convert using engine's precise sync
    const sync = this.engine.sync;
    const hqLocal = sync.geoToLocalSimple(hq.lat, hq.lon, 0);
    const hqPoint = new Vector3(hqLocal.x, 0, hqLocal.z);
    const spawnPoints = spawns.map((s) => {
      const local = sync.geoToLocalSimple(s.lat, s.lon, 0);
      return new Vector3(local.x, 0, local.z);
    });
    const routeLocals = routePoints.map(r => sync.geoToLocalSimple(r.lat, r.lon, 0));

    // All points including HQ, spawns, and route waypoints
    const allPoints = [
      hqPoint,
      ...spawnPoints,
      ...routeLocals.map(r => new Vector3(r.x, 0, r.z)),
    ];

    // The ground the frame sits on: the median of the cells under its points,
    // robust against the odd hole in the mesh, from fine tiles where there
    // are enough of them (a cold cache starts on coarse ones). Without cells
    // the sample under the HQ; without that the frame would sit at y = 0,
    // easily hundreds of metres off, and there is no frame.
    const samples = groundAt
      ? allPoints.map((p) => groundAt(p.x, p.z)).filter((s): s is GroundSample => s !== null)
      : [];
    const reliable = samples.filter((s) => s.reliable).map((s) => s.y);
    let source = 'cells-reliable';
    let terrainY = reliable.length >= MIN_RELIABLE_GROUND ? median(reliable) : null;
    if (terrainY === null) {
      source = 'cells';
      terrainY = median(samples.map((s) => s.y));
    }
    if (terrainY === null) {
      source = 'hq-sample';
      terrainY = this.engine.getTerrainHeightAtGeo(hq.lat, hq.lon);
    }
    if (terrainY === null) {
      cameraTimeline.record('framing.noTerrain', { cells: samples.length });
      return null;
    }
    cameraTimeline.record('framing.ground', {
      source,
      y: terrainY,
      reliable: reliable.length,
      cells: samples.length,
      points: allPoints.length,
    });

    // Get camera properties if available
    const camera = this.engine.getCamera();
    const actualFov = camera instanceof PerspectiveCamera ? camera.fov : fov;
    const actualAspect = camera instanceof PerspectiveCamera ? camera.aspect : aspectRatio;

    return this.computeFrameFromLocalPoints(allPoints, markerPoints(hqPoint, spawnPoints), {
      padding,
      angle,
      minSpan,
      markerRadius,
      estimatedTerrainY: terrainY,
      aspectRatio: actualAspect,
      fov: actualFov,
      edgeMargin,
    });
  }

  /**
   * Frame the ground points (y = 0) and the raised points (y = height above
   * the terrain), camera at `angle`, looking north.
   *
   * fitGroundBox fits a flat box on the ground. A raised point is swapped for
   * its ground stand-in, the ground point on the same camera ray: seen from the
   * camera both land on the same pixel, so a frame around the stand-ins frames
   * the raised point. The stand-in depends on the camera, hence rounds: start
   * with the points straight below, frame, move the stand-ins out along the
   * rays of that camera, frame again, until the distance settles.
   */
  private computeFrameFromLocalPoints(ground: Vector3[], raised: Vector3[], config: FitConfig): CameraFrame {
    let frame = this.fitGroundPoints(ground.concat(raised.map((p) => new Vector3(p.x, 0, p.z))), config);
    let rounds = 1;
    while (raised.length > 0 && rounds < RAISED_FIT_ROUNDS) {
      const height = frame.camY - frame.lookAtY;
      const standIns = raised.map((p) => groundStandIn(p, frame.camX, frame.camZ, height));
      const next = this.fitGroundPoints(ground.concat(standIns), config);
      rounds++;
      const settled = Math.abs(next.cameraDistance - frame.cameraDistance) < RAISED_FIT_TOLERANCE;
      frame = next;
      if (settled) break;
    }

    cameraTimeline.record('framing.compute', {
      groundPoints: ground.length,
      raisedPoints: raised.length,
      rounds,
      box: frame.boundingBox,
      padding: config.padding,
      angle: config.angle,
      fov: config.fov,
      aspectRatio: config.aspectRatio,
      edgeMargin: config.edgeMargin,
      estimatedTerrainY: config.estimatedTerrainY,
      distance: frame.cameraDistance,
      cam: [frame.camX, frame.camY, frame.camZ],
      lookAt: [frame.lookAtX, frame.lookAtY, frame.lookAtZ],
    });

    this.lastFrame = frame;
    return frame;
  }

  /** Frame for a set of ground points (y = 0), see fitGroundBox. */
  private fitGroundPoints(points: Vector3[], config: FitConfig): CameraFrame {
    const {
      padding,
      angle,
      minSpan,
      markerRadius,
      estimatedTerrainY,
      aspectRatio,
      fov,
      edgeMargin,
    } = config;

    // ========================================
    // 1. BOUNDING BOX with Box3
    // ========================================

    const box = new Box3().setFromPoints(points);

    // Expand by marker radius so markers are never cut off
    box.expandByScalar(markerRadius);

    const center = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3());

    // Ensure minimum span
    const spanX = Math.max(size.x, minSpan);
    const spanZ = Math.max(size.z, minSpan);

    // Apply padding
    const paddedSpanX = spanX * (1 + padding);
    const paddedSpanZ = spanZ * (1 + padding);

    const boundingBox = {
      minX: center.x - paddedSpanX / 2,
      maxX: center.x + paddedSpanX / 2,
      minZ: center.z - paddedSpanZ / 2,
      maxZ: center.z + paddedSpanZ / 2,
      centerX: center.x,
      centerZ: center.z,
      spanX: paddedSpanX,
      spanZ: paddedSpanZ,
    };

    // ========================================
    // 2. CAMERA DISTANCE CALCULATION
    // ========================================

    // Exact fit of the padded box on the ground, both edges projected, for any
    // aspect ratio. The look-at target moves toward the camera so the near and
    // far edges keep the same margin (see fitGroundBox).
    const { distance: cameraDistance, targetOffset } = fitGroundBox(
      paddedSpanX / 2,
      paddedSpanZ / 2,
      fov,
      aspectRatio,
      angle,
      edgeMargin,
    );

    // ========================================
    // 3. CAMERA POSITION
    // ========================================

    const angleRad = angle * MathUtils.DEG2RAD;
    const cameraHeight = cameraDistance * Math.sin(angleRad);
    const horizontalOffset = cameraDistance * Math.cos(angleRad);

    // Camera south of the target, looking north
    const lookAtZ = center.z + targetOffset;
    const lookAtY = estimatedTerrainY;

    return {
      camX: center.x,
      camY: estimatedTerrainY + cameraHeight,
      camZ: lookAtZ - horizontalOffset,
      lookAtX: center.x,
      lookAtY,
      lookAtZ,
      boundingBox,
      cameraDistance,
      cameraAngle: angle,
    };
  }

  // ========================================
  // COORDINATE CONVERSION
  // ========================================

  /**
   * Approximate geo-to-local conversion (works without engine)
   * HQ is placed at origin (0, 0, 0)
   * @param hq HQ coordinates (origin)
   * @param spawns Spawn point coordinates
   * @param routePoints Optional route waypoints to include in bounding box
   * @returns HQ first, then the spawns in order, then the route points
   */
  private geoToLocalApproximate(hq: GeoPoint, spawns: GeoPoint[], routePoints: GeoPoint[] = []): Vector3[] {
    const metersPerDegLat = CameraFramingService.METERS_PER_DEG_LAT;
    const metersPerDegLon = metersPerDegLat * Math.cos(hq.lat * MathUtils.DEG2RAD);

    const points: Vector3[] = [];

    // HQ at origin
    points.push(new Vector3(0, 0, 0));

    // Spawns relative to HQ
    for (const spawn of spawns) {
      const deltaLat = spawn.lat - hq.lat;
      const deltaLon = spawn.lon - hq.lon;

      // Match EllipsoidSync convention:
      // -X = East, +X = West (negate longitude delta)
      // +Z = North, -Z = South (positive latitude delta = positive Z)
      const x = -deltaLon * metersPerDegLon;
      const z = deltaLat * metersPerDegLat;

      points.push(new Vector3(x, 0, z));
    }

    // Route waypoints relative to HQ (ensures routes that curve away are included)
    for (const route of routePoints) {
      const deltaLat = route.lat - hq.lat;
      const deltaLon = route.lon - hq.lon;

      const x = -deltaLon * metersPerDegLon;
      const z = deltaLat * metersPerDegLat;

      points.push(new Vector3(x, 0, z));
    }

    return points;
  }

  // ========================================
  // FRAME APPLICATION
  // ========================================

  /**
   * Apply a computed frame to the engine's camera
   */
  applyFrame(frame: CameraFrame): void {
    if (!this.engine) return;

    this.engine.setLocalCameraPosition(
      frame.camX,
      frame.camY,
      frame.camZ,
      frame.lookAtX,
      frame.lookAtY,
      frame.lookAtZ
    );
  }

  // ========================================
  // CLEANUP
  // ========================================

  /**
   * Reset service state
   */
  reset(): void {
    this.engine = null;
    this.lastFrame = null;
  }
}
