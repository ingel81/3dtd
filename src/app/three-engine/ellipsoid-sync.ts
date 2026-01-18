import { Vector3, Matrix4 } from 'three';
import { MathUtils } from 'three';
import { WGS84_ELLIPSOID } from '3d-tiles-renderer';
import { ENU_FRAME } from '3d-tiles-renderer/src/three/renderer/math/Ellipsoid.js';
import type { TilesRenderer } from '3d-tiles-renderer';

/**
 * EllipsoidSync - Coordinate transformation utilities for 3DTilesRendererJS
 *
 * Replaces CesiumThreeSync - handles WGS84 ↔ Three.js coordinate transformations
 * using the 3DTilesRendererJS ellipsoid utilities.
 *
 * When ReorientationPlugin is used with recenter:true, the origin (HQ) is at (0,0,0)
 * and coordinates are in meters relative to that origin.
 */
export class EllipsoidSync {
  private tilesRenderer: TilesRenderer | null = null;

  // Origin in radians
  private originLatRad: number;
  private originLonRad: number;
  private originHeight: number;

  // Cached transformation matrices
  private originMatrix = new Matrix4();
  private inverseOriginMatrix = new Matrix4();

  // Temporary vectors for calculations (avoid allocations)
  private tempVec3 = new Vector3();
  private tempMatrix = new Matrix4();

  constructor(originLat: number, originLon: number, originHeight = 0) {
    this.originLatRad = originLat * MathUtils.DEG2RAD;
    this.originLonRad = originLon * MathUtils.DEG2RAD;
    this.originHeight = originHeight;
    this.updateOriginMatrix();
  }

  /**
   * Set the TilesRenderer reference (needed for coordinate transformations)
   */
  setTilesRenderer(tiles: TilesRenderer): void {
    this.tilesRenderer = tiles;
  }

  /**
   * Update origin point (e.g., when game location changes)
   */
  setOrigin(lat: number, lon: number, height = 0): void {
    this.originLatRad = lat * MathUtils.DEG2RAD;
    this.originLonRad = lon * MathUtils.DEG2RAD;
    this.originHeight = height;
    this.updateOriginMatrix();
  }

  private updateOriginMatrix(): void {
    // Get the ENU (East-North-Up) frame at origin using getObjectFrame
    // This combines rotation and position in one call (replaces deprecated getRotationMatrixFromAzElRoll)
    WGS84_ELLIPSOID.getObjectFrame(
      this.originLatRad,
      this.originLonRad,
      this.originHeight,
      0, // azimuth
      0, // elevation
      0, // roll
      this.originMatrix,
      ENU_FRAME
    );

    // Compute inverse for world-to-local transformations
    this.inverseOriginMatrix.copy(this.originMatrix).invert();
  }

  /**
   * Convert WGS84 coordinates to local Three.js coordinates
   *
   * With ReorientationPlugin, tiles are centered on origin, so we calculate
   * the offset from origin in the local ENU frame.
   *
   * @param lat - Latitude in degrees
   * @param lon - Longitude in degrees
   * @param height - Height in meters (above WGS84 ellipsoid)
   * @returns Three.js Vector3 in local coordinates (meters, relative to origin)
   */
  geoToLocal(lat: number, lon: number, height: number): Vector3 {
    const latRad = lat * MathUtils.DEG2RAD;
    const lonRad = lon * MathUtils.DEG2RAD;

    // Get ECEF position for target point
    const targetPos = new Vector3();
    WGS84_ELLIPSOID.getCartographicToPosition(latRad, lonRad, height, targetPos);

    // If we have tiles renderer with group transform, apply it
    if (this.tilesRenderer) {
      // Transform from ECEF to tiles group local space
      const invGroupMatrix = this.tilesRenderer.group.matrixWorld.clone().invert();
      targetPos.applyMatrix4(invGroupMatrix);
    } else {
      // Without tiles renderer, use our own inverse origin matrix
      targetPos.applyMatrix4(this.inverseOriginMatrix);
    }

    return targetPos;
  }

  /**
   * Convert local Three.js coordinates to WGS84
   *
   * This is the inverse of geoToLocalSimple() - uses simple geometry.
   * With ReorientationPlugin (recenter: true):
   * - X = East/West offset (-X = East, +X = West)
   * - Y = Height
   * - Z = North/South offset (+Z = North, -Z = South)
   *
   * @param vec - Three.js Vector3 in local coordinates
   * @returns Object with lat, lon (degrees), height (meters)
   */
  localToGeo(vec: Vector3): { lat: number; lon: number; height: number } {
    const originLat = this.originLatRad * MathUtils.RAD2DEG;
    const originLon = this.originLonRad * MathUtils.RAD2DEG;

    // Earth radius in meters
    const R = 6371000;

    // Convert X offset to longitude delta
    // -X = East, so positive X means West (negative lon delta)
    // At the origin latitude, 1 degree longitude = R * cos(lat) * DEG2RAD meters
    const metersPerDegreeLon = R * Math.cos(originLat * MathUtils.DEG2RAD) * MathUtils.DEG2RAD;
    const lonDelta = -vec.x / metersPerDegreeLon; // Negate because -X = East

    // Convert Z offset to latitude delta
    // +Z = North, so positive Z means positive lat delta
    // 1 degree latitude = R * DEG2RAD meters (approximately)
    const metersPerDegreeLat = R * MathUtils.DEG2RAD;
    const latDelta = vec.z / metersPerDegreeLat;

    return {
      lat: originLat + latDelta,
      lon: originLon + lonDelta,
      height: vec.y + this.originHeight,
    };
  }

  /**
   * Get distance from origin to a geo position (in meters, horizontal only)
   */
  distanceFromOrigin(lat: number, lon: number): number {
    const local = this.geoToLocal(lat, lon, 0);
    return Math.sqrt(local.x * local.x + local.z * local.z);
  }

  /**
   * Calculate heading angle (rotation.y) for Three.js from one geo position to another.
   *
   * This is the PRIMARY method for calculating entity orientation.
   * Uses local 3D coordinates for accurate results at any position.
   *
   * Coordinate system (with ReorientationPlugin + tiles.group.rotation.x = -PI/2):
   * - Local: -X = East, +Z = North, +Y = Up
   * - Geo: +lon = East, +lat = North
   *
   * Three.js rotation.y (counterclockwise from above):
   * - 0 = facing +Z (North)
   * - PI/2 = facing -X (East)
   * - PI or -PI = facing -Z (South)
   * - -PI/2 = facing +X (West)
   *
   * @param fromLat - Start latitude in degrees
   * @param fromLon - Start longitude in degrees
   * @param toLat - Target latitude in degrees
   * @param toLon - Target longitude in degrees
   * @returns Heading in radians for Three.js rotation.y
   */
  calculateHeading(fromLat: number, fromLon: number, toLat: number, toLon: number): number {
    // Convert both points to local coordinates
    const from = this.geoToLocalSimple(fromLat, fromLon, 0);
    const to = this.geoToLocalSimple(toLat, toLon, 0);

    // Calculate direction vector in local space
    const dx = to.x - from.x;
    const dz = to.z - from.z;

    // Skip if too close (prevents NaN/jitter)
    const distSq = dx * dx + dz * dz;
    if (distSq < 0.0001) return 0;

    // Calculate rotation.y: angle from +Z axis
    // atan2(x, z) gives angle from +Z, positive = counterclockwise
    // In our system: -X = East, so moving East means dx < 0
    // atan2(dx, dz) directly gives correct rotation.y
    return Math.atan2(dx, dz);
  }

  /**
   * Calculate heading from geo direction deltas (for efficiency when you already have deltas)
   *
   * @param dLat - Latitude delta (positive = North)
   * @param dLon - Longitude delta (positive = East)
   * @returns Heading in radians for Three.js rotation.y
   */
  calculateHeadingFromDeltas(dLat: number, dLon: number): number {
    // Skip if too small
    if (Math.abs(dLat) < 0.0000001 && Math.abs(dLon) < 0.0000001) return 0;

    // Convert geo deltas to local direction:
    // - dLon > 0 (East) → local dx < 0 (because -X = East)
    // - dLat > 0 (North) → local dz > 0 (because +Z = North)
    // Using simple approximation (accurate enough for small deltas):
    const localDx = -dLon; // East in geo = -X in local
    const localDz = dLat;  // North in geo = +Z in local

    return Math.atan2(localDx, localDz);
  }

  /**
   * Get origin coordinates
   */
  getOrigin(): { lat: number; lon: number; height: number } {
    return {
      lat: this.originLatRad * MathUtils.RAD2DEG,
      lon: this.originLonRad * MathUtils.RAD2DEG,
      height: this.originHeight,
    };
  }

  /**
   * Simple geo to local conversion using Haversine distance
   *
   * This method doesn't depend on tilesRenderer.group.matrixWorld,
   * making it reliable even before the first render.
   *
   * With ReorientationPlugin (recenter: true) + tiles.group.rotation.x = -PI/2:
   * - X = East/West offset (-X = East, +X = West)
   * - Y = Height above origin (+Y = Up)
   * - Z = North/South offset (+Z = North, -Z = South)
   *
   * @param lat - Latitude in degrees
   * @param lon - Longitude in degrees
   * @param height - Height in meters (above ground/ellipsoid)
   * @returns Three.js Vector3 in local coordinates
   */
  geoToLocalSimple(lat: number, lon: number, height: number): Vector3 {
    const originLat = this.originLatRad * MathUtils.RAD2DEG;
    const originLon = this.originLonRad * MathUtils.RAD2DEG;

    // Calculate East offset (X)
    // With ReorientationPlugin: -X = East, +X = West
    const eastDist = this.fastDistance(originLat, originLon, originLat, lon);
    const eastSign = lon > originLon ? -1 : 1; // Inverted: East is negative X

    // Calculate North offset (Z)
    // With ReorientationPlugin + tiles.group.rotation.x = -PI/2:
    // +Z = North, -Z = South
    const northDist = this.fastDistance(originLat, originLon, lat, originLon);
    const northSign = lat > originLat ? 1 : -1;

    return new Vector3(
      eastDist * eastSign, // -X = East
      height - this.originHeight,
      northDist * northSign // +Z = North
    );
  }

  /**
   * @deprecated Use geoToLocalSimple() with overlayGroup instead
   *
   * This method was for adding objects directly inside tilesRenderer.group
   * but that approach doesn't work well due to ECEF coordinates.
   * Use overlayGroup (in scene root) with delta synchronization instead.
   */
  geoToGroupLocal(lat: number, lon: number, height: number): Vector3 {
    const simple = this.geoToLocalSimple(lat, lon, height);
    // Legacy transform - no longer needed with overlayGroup approach
    return new Vector3(simple.x, -simple.z, -simple.y);
  }

  /**
   * Fast distance between two points in meters
   * Uses flat-earth approximation - accurate for <200m (game distances)
   */
  private fastDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const METERS_PER_DEGREE_LAT = 111320;
    const dLat = lat2 - lat1;
    const dLon = lon2 - lon1;
    const metersPerDegreeLon = METERS_PER_DEGREE_LAT * Math.cos(lat1 * MathUtils.DEG2RAD);
    const dx = dLon * metersPerDegreeLon;
    const dy = dLat * METERS_PER_DEGREE_LAT;
    return Math.sqrt(dx * dx + dy * dy);
  }
}
