import { Injectable } from '@angular/core';
import * as THREE from 'three';
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
 * - THREE.Box3 based bounding box calculation
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
  private static readonly DEFAULT_PADDING = 0.2;

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
    } = config;

    console.log('[CameraFraming] Computing initial frame', {
      hq,
      spawns,
      config: { padding, angle, markerRadius, fov, aspectRatio },
    });

    // Convert geo coordinates to approximate local coordinates
    // HQ is at origin (0, 0, 0)
    const localPoints = this.geoToLocalApproximate(hq, spawns);

    console.log('[CameraFraming] Local points:', localPoints.map(p => ({
      x: p.x.toFixed(1),
      y: p.y.toFixed(1),
      z: p.z.toFixed(1),
    })));

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
      console.warn('[CameraFraming] No engine available, using approximate conversion');
      return this.computeInitialFrame(hq, spawns, config);
    }

    const {
      padding = CameraFramingService.DEFAULT_PADDING,
      angle = CameraFramingService.DEFAULT_ANGLE,
      minSpan = CameraFramingService.DEFAULT_MIN_SPAN,
      markerRadius = CameraFramingService.DEFAULT_MARKER_RADIUS,
      aspectRatio = 16 / 9,
      fov = 75,
    } = config;

    // Get terrain height at HQ
    const terrainY = this.engine.getTerrainHeightAtGeo(hq.lat, hq.lon) ?? 0;

    // Convert using engine's precise sync
    const sync = this.engine.sync;
    const hqLocal = sync.geoToLocalSimple(hq.lat, hq.lon, 0);
    const spawnLocals = spawns.map(s => sync.geoToLocalSimple(s.lat, s.lon, 0));

    // All points including HQ
    const allPoints = [
      new THREE.Vector3(hqLocal.x, 0, hqLocal.z),
      ...spawnLocals.map(s => new THREE.Vector3(s.x, 0, s.z)),
    ];

    // Get camera properties if available
    const camera = this.engine.getCamera();
    const actualFov = camera instanceof THREE.PerspectiveCamera ? camera.fov : fov;
    const actualAspect = camera instanceof THREE.PerspectiveCamera ? camera.aspect : aspectRatio;

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
    points: THREE.Vector3[],
    config: Required<Omit<FrameConfig, 'estimatedTerrainY'>> & { estimatedTerrainY: number }
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
    // 1. BOUNDING BOX with THREE.Box3
    // ========================================

    const box = new THREE.Box3().setFromPoints(points);

    // Expand by marker radius so markers are never cut off
    box.expandByScalar(markerRadius);

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

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

    const angleRad = angle * THREE.MathUtils.DEG2RAD;
    const fovRad = fov * THREE.MathUtils.DEG2RAD;

    // Calculate horizontal FOV from vertical FOV and aspect ratio
    const hFovRad = 2 * Math.atan(aspectRatio * Math.tan(fovRad / 2));
    const tanHalfHFov = Math.tan(hFovRad / 2);

    // Distance to fit X span horizontally
    const distanceForX = (paddedSpanX / 2) / tanHalfHFov;

    // Distance to fit Z span vertically (accounting for camera tilt)
    // When camera is tilted, the Z span appears foreshortened
    const projectedZHeight = paddedSpanZ * Math.sin(angleRad);
    const distanceForZ = (projectedZHeight / 2) / Math.tan(fovRad / 2);

    // Ensure camera is south of all points with buffer
    const minHorizontalOffsetForPosition = (center.z - boundingBox.minZ) + 20;
    const distanceForPosition = minHorizontalOffsetForPosition / Math.cos(angleRad);

    // Use the largest base distance
    const baseDistance = Math.max(distanceForX, distanceForZ, distanceForPosition);

    // Add small margin (5%) for safety
    const cameraDistance = baseDistance * 1.05;

    // ========================================
    // 3. CAMERA POSITION
    // ========================================

    // Split distance into height and horizontal offset
    const cameraHeight = cameraDistance * Math.sin(angleRad);
    const horizontalOffset = cameraDistance * Math.cos(angleRad);

    // Camera direction: perpendicular to the main axis of points
    // For simplicity, use south direction (negative Z)
    // This minimizes horizon visibility in most cases
    const camX = center.x;
    const camZ = center.z - horizontalOffset; // South of center
    const camY = estimatedTerrainY + cameraHeight;

    const lookAtY = estimatedTerrainY;

    console.log('[CameraFraming] Frame computed:', {
      boundingBox: {
        center: { x: center.x.toFixed(1), z: center.z.toFixed(1) },
        span: { x: paddedSpanX.toFixed(0), z: paddedSpanZ.toFixed(0) },
        raw: { minX: boundingBox.minX.toFixed(0), maxX: boundingBox.maxX.toFixed(0), minZ: boundingBox.minZ.toFixed(0), maxZ: boundingBox.maxZ.toFixed(0) },
      },
      distances: {
        forX: distanceForX.toFixed(0),
        forZ: distanceForZ.toFixed(0),
        forPosition: distanceForPosition.toFixed(0),
        base: baseDistance.toFixed(0),
        final: cameraDistance.toFixed(0),
        limiting: baseDistance === distanceForX ? 'X-span' :
                  baseDistance === distanceForZ ? 'Z-span' : 'position',
      },
      camera: {
        pos: { x: camX.toFixed(1), y: camY.toFixed(1), z: camZ.toFixed(1) },
        lookAt: { x: center.x.toFixed(1), y: lookAtY.toFixed(1), z: center.z.toFixed(1) },
        height: cameraHeight.toFixed(0),
        horizontalOffset: horizontalOffset.toFixed(0),
        angle,
      },
      fov: { vertical: fov, horizontal: (hFovRad * 180 / Math.PI).toFixed(0) },
    });

    const frame: CameraFrame = {
      camX,
      camY,
      camZ,
      lookAtX: center.x,
      lookAtY,
      lookAtZ: center.z,
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
   */
  private geoToLocalApproximate(hq: GeoPoint, spawns: GeoPoint[]): THREE.Vector3[] {
    const metersPerDegLat = CameraFramingService.METERS_PER_DEG_LAT;
    const metersPerDegLon = metersPerDegLat * Math.cos(hq.lat * THREE.MathUtils.DEG2RAD);

    const points: THREE.Vector3[] = [];

    // HQ at origin
    points.push(new THREE.Vector3(0, 0, 0));

    // Spawns relative to HQ
    for (const spawn of spawns) {
      const deltaLat = spawn.lat - hq.lat;
      const deltaLon = spawn.lon - hq.lon;

      // Match EllipsoidSync convention:
      // -X = East, +X = West (negate longitude delta)
      // +Z = North, -Z = South (positive latitude delta = positive Z)
      const x = -deltaLon * metersPerDegLon;
      const z = deltaLat * metersPerDegLat;

      points.push(new THREE.Vector3(x, 0, z));
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
    if (!this.engine) {
      console.warn('[CameraFraming] Cannot apply frame - no engine');
      return;
    }

    this.engine.setLocalCameraPosition(
      frame.camX,
      frame.camY,
      frame.camZ,
      frame.lookAtX,
      frame.lookAtY,
      frame.lookAtZ
    );

    console.log('[CameraFraming] Frame applied');
  }

  /**
   * Correct camera Y position after terrain height is known
   * Only adjusts Y, preserving XZ position for smooth transition
   *
   * @param realTerrainY Actual terrain height from engine
   * @param originalEstimate Original estimated terrain height used in frame
   */
  correctTerrainHeight(realTerrainY: number, originalEstimate: number = 0): void {
    if (!this.engine || !this.lastFrame) {
      console.warn('[CameraFraming] Cannot correct height - no engine or frame');
      return;
    }

    const deltaY = realTerrainY - originalEstimate;

    if (Math.abs(deltaY) < 1) {
      console.log('[CameraFraming] Terrain height correction negligible, skipping');
      return;
    }

    const newCamY = this.lastFrame.camY + deltaY;
    const newLookAtY = this.lastFrame.lookAtY + deltaY;

    console.log('[CameraFraming] Correcting terrain height:', {
      delta: deltaY.toFixed(1),
      newCamY: newCamY.toFixed(1),
    });

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
