import { Injectable } from '@angular/core';
import { Vector3, Box3, MathUtils, PerspectiveCamera } from 'three';
import { ThreeTilesEngine } from '../three-engine';

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
  /** Marker radius to add to bounds (default: 8) */
  markerRadius?: number;
  /** Estimated terrain height when real height unknown (default: 0) */
  estimatedTerrainY?: number;
  /** Viewport aspect ratio (default: 16/9) */
  aspectRatio?: number;
  /** Vertical FOV in degrees (default: 75) */
  fov?: number;
  /** Additional route points to include in bounding box (optional) */
  routePoints?: GeoPoint[];
}

/**
 * Geographic point
 */
export interface GeoPoint {
  lat: number;
  lon: number;
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
 * - Marker radius consideration
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

  /** Default marker radius in meters */
  private static readonly DEFAULT_MARKER_RADIUS = 8;

  /** Minimum span in meters */
  private static readonly DEFAULT_MIN_SPAN = 50;

  /** Approximate meters per degree latitude */
  private static readonly METERS_PER_DEG_LAT = 111320;

  // ========================================
  // STATE
  // ========================================

  /** Engine reference (optional, for terrain height queries) */
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
      routePoints = [],
    } = config;

    // Convert geo coordinates to approximate local coordinates
    // HQ is at origin (0, 0, 0)
    const localPoints = this.geoToLocalApproximate(hq, spawns, routePoints);

    // Compute frame from local points
    return this.computeFrameFromLocalPoints(
      localPoints,
      {
        padding,
        angle,
        minSpan,
        markerRadius,
        estimatedTerrainY,
        aspectRatio,
        fov,
      }
    );
  }

  /**
   * Compute camera frame using engine's precise coordinate conversion.
   * Use this AFTER engine initialization for accurate framing.
   *
   * @param hq HQ geographic coordinates
   * @param spawns Spawn point coordinates
   * @param config Frame configuration
   * @returns Computed camera frame or null if engine not available
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
      routePoints = [],
    } = config;

    // Get terrain height at HQ
    const terrainY = this.engine.getTerrainHeightAtGeo(hq.lat, hq.lon) ?? 0;

    // Convert using engine's precise sync
    const sync = this.engine.sync;
    const hqLocal = sync.geoToLocalSimple(hq.lat, hq.lon, 0);
    const spawnLocals = spawns.map(s => sync.geoToLocalSimple(s.lat, s.lon, 0));
    const routeLocals = routePoints.map(r => sync.geoToLocalSimple(r.lat, r.lon, 0));

    // All points including HQ, spawns, and route waypoints
    const allPoints = [
      new Vector3(hqLocal.x, 0, hqLocal.z),
      ...spawnLocals.map(s => new Vector3(s.x, 0, s.z)),
      ...routeLocals.map(r => new Vector3(r.x, 0, r.z)),
    ];

    // Get camera properties if available
    const camera = this.engine.getCamera();
    const actualFov = camera instanceof PerspectiveCamera ? camera.fov : fov;
    const actualAspect = camera instanceof PerspectiveCamera ? camera.aspect : aspectRatio;

    return this.computeFrameFromLocalPoints(
      allPoints,
      {
        padding,
        angle,
        minSpan,
        markerRadius,
        estimatedTerrainY: terrainY,
        aspectRatio: actualAspect,
        fov: actualFov,
      }
    );
  }

  /**
   * Compute frame from local 3D points (core algorithm)
   */
  private computeFrameFromLocalPoints(
    points: Vector3[],
    config: Required<Omit<FrameConfig, 'estimatedTerrainY' | 'routePoints'>> & { estimatedTerrainY: number }
  ): CameraFrame {
    const {
      padding,
      angle,
      minSpan,
      markerRadius,
      estimatedTerrainY,
      aspectRatio,
      fov,
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

    const angleRad = angle * MathUtils.DEG2RAD;
    const fovRad = fov * MathUtils.DEG2RAD;
    const halfFov = fovRad / 2;

    // Calculate horizontal FOV from vertical FOV and aspect ratio
    const hFovRad = 2 * Math.atan(aspectRatio * Math.tan(halfFov));
    const tanHalfHFov = Math.tan(hFovRad / 2);

    // Distance to fit X span horizontally
    const distanceForX = (paddedSpanX / 2) / tanHalfHFov;

    // Distance to fit Z span vertically
    // The Z span on the ground projects to spanZ * sin(angle) when viewed from angle
    const projectedZHeight = paddedSpanZ * Math.sin(angleRad);
    const distanceForZFov = (projectedZHeight / 2) / Math.tan(halfFov);

    // CRITICAL: Minimum distance so that the entire Z span is IN FRONT of the camera
    // The camera is positioned south of center by horizontalOffset = distance * cos(angle)
    // The southern edge of the box must not be behind the camera
    // Condition: horizontalOffset >= paddedSpanZ / 2
    // => distance * cos(angle) >= paddedSpanZ / 2
    // => distance >= paddedSpanZ / (2 * cos(angle))
    const minDistForZCoverage = paddedSpanZ / (2 * Math.cos(angleRad));

    // Use the largest requirement with safety margin
    const cameraDistance = Math.max(distanceForX, distanceForZFov, minDistForZCoverage) * 1.15;

    // ========================================
    // 3. CAMERA POSITION
    // ========================================

    const cameraHeight = cameraDistance * Math.sin(angleRad);
    const horizontalOffset = cameraDistance * Math.cos(angleRad);

    // Simple: lookAt at bounding box center, camera south of it
    const lookAtZ = center.z;
    const lookAtY = estimatedTerrainY;

    const camX = center.x;
    const camZ = center.z - horizontalOffset; // Camera south of center
    const camY = estimatedTerrainY + cameraHeight;

    const frame: CameraFrame = {
      camX,
      camY,
      camZ,
      lookAtX: center.x,
      lookAtY,
      lookAtZ,
      boundingBox,
      cameraDistance,
      cameraAngle: angle,
    };

    this.lastFrame = frame;
    return frame;
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

  /**
   * Correct camera Y position after terrain height is known
   * Only adjusts Y, preserving XZ position for smooth transition
   *
   * @param realTerrainY Actual terrain height from engine
   * @param originalEstimate Original estimated terrain height used in frame
   */
  correctTerrainHeight(realTerrainY: number, originalEstimate = 0): void {
    if (!this.engine || !this.lastFrame) {
      return;
    }

    const deltaY = realTerrainY - originalEstimate;

    if (Math.abs(deltaY) < 1) {
      return;
    }

    const newCamY = this.lastFrame.camY + deltaY;
    const newLookAtY = this.lastFrame.lookAtY + deltaY;

    this.engine.setLocalCameraPosition(
      this.lastFrame.camX,
      newCamY,
      this.lastFrame.camZ,
      this.lastFrame.lookAtX,
      newLookAtY,
      this.lastFrame.lookAtZ
    );

    // Update stored frame
    this.lastFrame = {
      ...this.lastFrame,
      camY: newCamY,
      lookAtY: newLookAtY,
    };
  }

  // ========================================
  // ROUTE-INCLUSIVE REFRAMING
  // ========================================

  /**
   * Reframe camera to include all routes in the view.
   * Call this AFTER routes have been calculated to ensure all waypoints are visible.
   *
   * @param hq HQ/base geographic coordinates
   * @param spawns Array of spawn point coordinates
   * @param routePoints All route waypoints to include in frame
   * @param config Frame configuration (optional)
   * @returns true if reframing was applied, false otherwise
   */
  reframeWithRoutes(
    hq: GeoPoint,
    spawns: GeoPoint[],
    routePoints: GeoPoint[],
    config: Omit<FrameConfig, 'routePoints'> = {}
  ): boolean {
    if (routePoints.length === 0) {
      return false;
    }

    const frame = this.computeFrameWithEngine(hq, spawns, {
      ...config,
      routePoints,
    });

    if (frame) {
      this.applyFrame(frame);
      return true;
    }

    return false;
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
