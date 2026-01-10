import { Injectable, WritableSignal } from '@angular/core';
import * as THREE from 'three';
import { ThreeTilesEngine } from '../three-engine';
import { GeoPosition } from '../models/game.types';
import { OsmStreetService, Street, StreetNetwork } from './osm-street.service';
import { SpawnPoint } from './marker-visualization.service';

/**
 * PathAndRouteService
 *
 * Manages path caching, route visualization, and path optimization for the Tower Defense game.
 * Handles route computation, height smoothing, and 3D line rendering.
 */
@Injectable({ providedIn: 'root' })
export class PathAndRouteService {
  // ========================================
  // STATE
  // ========================================

  /** Cached paths from spawn to base (key: spawnId) */
  private cachedPaths = new Map<string, GeoPosition[]>();

  /** 3D route lines for visualization */
  private routeLines: THREE.Line[] = [];

  /** Reference to the 3D engine */
  private engine: ThreeTilesEngine | null = null;

  /** Street network for pathfinding */
  private streetNetwork: StreetNetwork | null = null;

  /** Base coordinates (destination for all paths) */
  private baseCoords: GeoPosition | null = null;

  /** Routes visibility state (from GameUIStateService) */
  private routesVisible: WritableSignal<boolean> | null = null;

  /** OSM service for pathfinding */
  private osmService: OsmStreetService | null = null;

  /** Spawn markers for snap-to-path functionality */
  private spawnMarkers: THREE.Group[] = [];

  // ========================================
  // INITIALIZATION
  // ========================================

  /**
   * Initialize path and route service
   * @param engine ThreeTilesEngine instance
   * @param streetNetwork Street network for pathfinding
   * @param baseCoords Base/HQ coordinates
   * @param routesVisible Signal for routes visibility state
   * @param osmService OSM service for pathfinding
   * @param spawnMarkers Array of spawn markers for snapping
   */
  initialize(
    engine: ThreeTilesEngine,
    streetNetwork: StreetNetwork,
    baseCoords: GeoPosition,
    routesVisible: WritableSignal<boolean>,
    osmService: OsmStreetService,
    spawnMarkers: THREE.Group[]
  ): void {
    this.engine = engine;
    this.streetNetwork = streetNetwork;
    this.baseCoords = baseCoords;
    this.routesVisible = routesVisible;
    this.osmService = osmService;
    this.spawnMarkers = spawnMarkers;
  }

  /**
   * Update spawn markers reference
   * @param spawnMarkers Updated spawn markers array
   */
  updateSpawnMarkers(spawnMarkers: THREE.Group[]): void {
    this.spawnMarkers = spawnMarkers;
  }

  // ========================================
  // PATH CACHING
  // ========================================

  /**
   * Get cached path for spawn point
   * @param spawnId Spawn point ID
   * @returns Cached path or undefined
   */
  getCachedPath(spawnId: string): GeoPosition[] | undefined {
    return this.cachedPaths.get(spawnId);
  }

  /**
   * Cache path for spawn point
   * @param spawnId Spawn point ID
   * @param path Path to cache
   */
  cachePath(spawnId: string, path: GeoPosition[]): void {
    this.cachedPaths.set(spawnId, path);
  }

  /**
   * Clear all cached paths
   */
  clearCache(): void {
    this.cachedPaths.clear();
  }

  /**
   * Clear all cached paths (alias for clearCache)
   */
  clearCachedPaths(): void {
    this.clearCache();
  }

  /**
   * Get all cached paths as a Map
   * @returns Map of spawn ID to path
   */
  getCachedPaths(): Map<string, GeoPosition[]> {
    return this.cachedPaths;
  }

  /**
   * Get detail string for route loading status
   * @returns Route detail string or undefined
   */
  getRouteDetail(): string | undefined {
    if (this.cachedPaths.size === 0) return undefined;

    const totalPoints = Array.from(this.cachedPaths.values()).reduce(
      (sum, path) => sum + path.length,
      0
    );
    return `${this.cachedPaths.size} Routen (${totalPoints} Wegpunkte)`;
  }

  // ========================================
  // ROUTE VISUALIZATION
  // ========================================

  /**
   * Refresh all route lines (re-create from cached paths)
   * @param spawnPoints Current spawn points
   */
  refreshRouteLines(spawnPoints: SpawnPoint[]): void {
    if (!this.engine) return;

    const overlayGroup = this.engine.getOverlayGroup();
    const wasVisible = this.routesVisible?.() ?? false;

    // Remove existing route lines
    for (const line of this.routeLines) {
      overlayGroup.remove(line);
      line.geometry.dispose();
      if (Array.isArray(line.material)) {
        line.material.forEach((m) => m.dispose());
      } else {
        line.material.dispose();
      }
    }
    this.routeLines = [];

    // Re-create route lines for all spawns
    for (const spawn of spawnPoints) {
      this.showPathFromSpawn(spawn);
    }

    // Restore visibility state
    for (const line of this.routeLines) {
      line.visible = wasVisible;
    }
  }

  /**
   * Show path from spawn point to base
   * Creates 3D line visualization and caches path with heights
   * @param spawn Spawn point
   */
  showPathFromSpawn(spawn: SpawnPoint): void {
    if (!this.engine || !this.streetNetwork || !this.osmService || !this.baseCoords) return;

    const path = this.osmService.findPath(
      this.streetNetwork,
      spawn.latitude,
      spawn.longitude,
      this.baseCoords.lat,
      this.baseCoords.lon
    );

    if (path.length < 2) return;

    // Snap spawn marker to actual path start
    const pathStart = path[0];
    if (pathStart) {
      this.snapSpawnMarkerToPathStart(spawn.id, pathStart.lat, pathStart.lon);
    }

    // Convert path to geoPath
    let geoPath = path.map((n) => ({ lat: n.lat, lon: n.lon }));

    // Extend the path along the street to find the optimal turn-off point
    geoPath = this.extendPathToOptimalTurnoff(geoPath, this.baseCoords);

    // Find the closest point to HQ on the path
    let closestSegmentIndex = geoPath.length - 2;
    let closestPointOnSegment: { lat: number; lon: number } | null = null;
    let closestDist = Infinity;

    for (let i = 0; i < geoPath.length - 1; i++) {
      const a = geoPath[i];
      const b = geoPath[i + 1];

      const closest = this.closestPointOnSegment(a, b, {
        lat: this.baseCoords.lat,
        lon: this.baseCoords.lon,
      });
      const dist = this.osmService.haversineDistance(
        closest.lat,
        closest.lon,
        this.baseCoords.lat,
        this.baseCoords.lon
      );

      if (dist < closestDist) {
        closestDist = dist;
        closestSegmentIndex = i;
        closestPointOnSegment = closest;
      }
    }

    // Cut path at the segment and insert the closest point
    geoPath = geoPath.slice(0, closestSegmentIndex + 1);
    if (closestPointOnSegment) {
      const lastPoint = geoPath[geoPath.length - 1];
      const distToLast = this.osmService.haversineDistance(
        closestPointOnSegment.lat,
        closestPointOnSegment.lon,
        lastPoint.lat,
        lastPoint.lon
      );
      if (distToLast > 1) {
        geoPath.push(closestPointOnSegment);
      }
    }

    // Add HQ as final destination
    geoPath.push({ lat: this.baseCoords.lat, lon: this.baseCoords.lon });

    // Create route line in Three.js - on terrain with RELATIVE heights
    const HEIGHT_ABOVE_GROUND = 1;
    const overlayGroup = this.engine.getOverlayGroup();
    const points: THREE.Vector3[] = [];

    // Get origin terrain height as reference
    const origin = this.engine.sync.getOrigin();
    const originTerrainY = this.engine.getTerrainHeightAtGeo(this.baseCoords.lat, this.baseCoords.lon);

    if (originTerrainY === null) {
      // Cache path with default heights (fallback)
      const pathWithHeights: GeoPosition[] = geoPath.map((pos) => ({
        ...pos,
        height: origin.height,
      }));
      this.cachedPaths.set(spawn.id, pathWithHeights);
      return;
    }

    // Track which positions got valid terrain samples
    const validIndices: number[] = [];
    const terrainHeights: number[] = [];

    for (let i = 0; i < geoPath.length; i++) {
      const pos = geoPath[i];
      const terrainY = this.engine.getTerrainHeightAtGeo(pos.lat, pos.lon);
      if (terrainY !== null) {
        const local = this.engine.sync.geoToLocalSimple(pos.lat, pos.lon, 0);
        // Y = height difference from origin + offset above ground
        local.y = terrainY - originTerrainY + HEIGHT_ABOVE_GROUND;
        points.push(local);
        validIndices.push(i);
        terrainHeights.push(terrainY);
      }
    }

    // Smooth out height anomalies
    const smoothedPoints = this.smoothPathHeights(points);

    // Convert smoothed heights back to geo heights and update cached path
    const pathWithHeights: GeoPosition[] = geoPath.map((pos, i) => {
      const smoothedIdx = validIndices.indexOf(i);
      if (smoothedIdx !== -1 && smoothedIdx < smoothedPoints.length) {
        const smoothedLocalY = smoothedPoints[smoothedIdx].y;
        const localTerrainY = smoothedLocalY - HEIGHT_ABOVE_GROUND + originTerrainY;
        const geoHeight = localTerrainY + origin.height;
        return { ...pos, height: geoHeight };
      } else {
        return { ...pos, height: origin.height };
      }
    });
    this.cachedPaths.set(spawn.id, pathWithHeights);

    const geometry = new THREE.BufferGeometry().setFromPoints(smoothedPoints);
    const material = new THREE.LineBasicMaterial({
      color: spawn.color,
      linewidth: 3,
      depthTest: true,
      depthWrite: false,
      transparent: true,
      opacity: 0.9,
    });
    const routeLine = new THREE.Line(geometry, material);
    routeLine.visible = this.routesVisible?.() ?? false;
    routeLine.renderOrder = 1;
    routeLine.frustumCulled = false; // Prevent disappearing at certain angles

    overlayGroup.add(routeLine);
    this.routeLines.push(routeLine);
  }

  /**
   * Clear all route lines
   */
  clearRouteLines(): void {
    if (!this.engine) return;

    const overlayGroup = this.engine.getOverlayGroup();

    for (const line of this.routeLines) {
      overlayGroup.remove(line);
      line.geometry.dispose();
      if (Array.isArray(line.material)) {
        line.material.forEach((m) => m.dispose());
      } else {
        line.material.dispose();
      }
    }

    this.routeLines = [];
  }

  /**
   * Clear all routes (alias for clearRouteLines)
   */
  clearAllRoutes(): void {
    this.clearRouteLines();
  }

  /**
   * Set visibility of all route lines
   * @param visible Visibility state
   */
  setRouteLinesVisible(visible: boolean): void {
    for (const line of this.routeLines) {
      line.visible = visible;
    }
  }

  /**
   * Get all route lines
   */
  getRouteLines(): THREE.Line[] {
    return this.routeLines;
  }

  // ========================================
  // PATH OPTIMIZATION
  // ========================================

  /**
   * Smooth path heights to remove terrain sampling anomalies
   * @param points Path points with potentially noisy heights
   * @returns Smoothed path points
   */
  smoothPathHeights(points: THREE.Vector3[]): THREE.Vector3[] {
    if (points.length < 3) return points;

    const MAX_SLOPE = 0.5; // Max 50% grade (rise/run)
    const MAX_HEIGHT_DIFF = 10; // Max 10m sudden jump

    const result: THREE.Vector3[] = [];

    for (let i = 0; i < points.length; i++) {
      const current = points[i];

      if (i === 0 || i === points.length - 1) {
        // Keep first and last points as-is
        result.push(current.clone());
        continue;
      }

      const prev = points[i - 1];
      const next = points[i + 1];

      // Calculate horizontal distances
      const distToPrev = Math.sqrt(Math.pow(current.x - prev.x, 2) + Math.pow(current.z - prev.z, 2));
      const distToNext = Math.sqrt(Math.pow(next.x - current.x, 2) + Math.pow(next.z - current.z, 2));
      const totalDist = distToPrev + distToNext;

      if (totalDist < 0.001) {
        result.push(current.clone());
        continue;
      }

      // Interpolated Y between prev and next
      const t = distToPrev / totalDist;
      const interpolatedY = prev.y + t * (next.y - prev.y);

      // Check if current Y deviates too much
      const heightDiff = Math.abs(current.y - interpolatedY);

      // Check slope to neighbors
      const slopeToPrev = distToPrev > 0 ? Math.abs(current.y - prev.y) / distToPrev : 0;
      const slopeToNext = distToNext > 0 ? Math.abs(current.y - next.y) / distToNext : 0;

      const isAnomaly = heightDiff > MAX_HEIGHT_DIFF || (slopeToPrev > MAX_SLOPE && slopeToNext > MAX_SLOPE);

      if (isAnomaly) {
        // Replace with interpolated value
        result.push(new THREE.Vector3(current.x, interpolatedY, current.z));
      } else {
        result.push(current.clone());
      }
    }

    return result;
  }

  /**
   * Find closest point on a line segment to a target point
   * @param a Segment start
   * @param b Segment end
   * @param target Target point
   * @returns Closest point on segment
   */
  private closestPointOnSegment(
    a: { lat: number; lon: number },
    b: { lat: number; lon: number },
    target: { lat: number; lon: number }
  ): { lat: number; lon: number } {
    const dx = b.lon - a.lon;
    const dy = b.lat - a.lat;
    const lengthSquared = dx * dx + dy * dy;

    if (lengthSquared === 0) {
      return { lat: a.lat, lon: a.lon };
    }

    // Project target onto the line, clamped to segment
    const t = Math.max(0, Math.min(1, ((target.lon - a.lon) * dx + (target.lat - a.lat) * dy) / lengthSquared));

    return {
      lat: a.lat + t * dy,
      lon: a.lon + t * dx,
    };
  }

  /**
   * Extend path along streets to find optimal 90° turn-off point to HQ
   * @param geoPath Current path
   * @param base Base coordinates (GeoPosition with lat/lon)
   * @returns Extended path
   */
  private extendPathToOptimalTurnoff(
    geoPath: { lat: number; lon: number }[],
    base: GeoPosition
  ): { lat: number; lon: number }[] {
    if (!this.streetNetwork || !this.osmService || geoPath.length < 2) return geoPath;

    const lastPoint = geoPath[geoPath.length - 1];

    // Find streets that contain a node near the last point
    const TOLERANCE = 0.00001; // ~1m tolerance
    const matchingStreets: { street: Street; nodeIndex: number }[] = [];

    for (const street of this.streetNetwork.streets) {
      for (let i = 0; i < street.nodes.length; i++) {
        const node = street.nodes[i];
        if (Math.abs(node.lat - lastPoint.lat) < TOLERANCE && Math.abs(node.lon - lastPoint.lon) < TOLERANCE) {
          matchingStreets.push({ street, nodeIndex: i });
        }
      }
    }

    if (matchingStreets.length === 0) return geoPath;

    // Find best extension
    let bestExtension: { lat: number; lon: number }[] = [];
    let bestClosestDist = this.osmService.haversineDistance(
      lastPoint.lat,
      lastPoint.lon,
      base.lat,
      base.lon
    );

    for (const { street, nodeIndex } of matchingStreets) {
      // Try extending in both directions
      for (const direction of [-1, 1]) {
        const extension: { lat: number; lon: number }[] = [];
        let idx = nodeIndex + direction;
        let foundBetterPoint = false;

        // Extend up to 20 nodes in this direction
        while (idx >= 0 && idx < street.nodes.length && extension.length < 20) {
          const node = street.nodes[idx];

          const distToHQ = this.osmService.haversineDistance(node.lat, node.lon, base.lat, base.lon);

          const prevPoint = extension.length > 0 ? extension[extension.length - 1] : lastPoint;
          const closestOnSeg = this.closestPointOnSegment(
            prevPoint,
            { lat: node.lat, lon: node.lon },
            { lat: base.lat, lon: base.lon }
          );
          const segDistToHQ = this.osmService.haversineDistance(
            closestOnSeg.lat,
            closestOnSeg.lon,
            base.lat,
            base.lon
          );

          if (segDistToHQ < bestClosestDist || distToHQ < bestClosestDist) {
            foundBetterPoint = true;
            extension.push({ lat: node.lat, lon: node.lon });
            idx += direction;
          } else {
            break;
          }
        }

        if (foundBetterPoint && extension.length > 0) {
          let minDist = bestClosestDist;
          for (let i = 0; i < extension.length; i++) {
            const prev = i === 0 ? lastPoint : extension[i - 1];
            const curr = extension[i];
            const closest = this.closestPointOnSegment(prev, curr, {
              lat: base.lat,
              lon: base.lon,
            });
            const dist = this.osmService.haversineDistance(closest.lat, closest.lon, base.lat, base.lon);
            if (dist < minDist) {
              minDist = dist;
            }
          }

          if (minDist < bestClosestDist) {
            bestClosestDist = minDist;
            bestExtension = extension;
          }
        }
      }
    }

    return [...geoPath, ...bestExtension];
  }

  /**
   * Snap spawn marker to actual path start position
   * @param spawnId Spawn point ID
   * @param lat Latitude
   * @param lon Longitude
   */
  private snapSpawnMarkerToPathStart(spawnId: string, lat: number, lon: number): void {
    if (!this.engine) return;

    const marker = this.spawnMarkers.find((m) => m.name === `spawnMarker_${spawnId}`);
    if (!marker) return;

    const local = this.engine.sync.geoToLocalSimple(lat, lon, 0);

    // Keep same Y, only update X and Z to match path start
    marker.position.x = local.x;
    marker.position.z = local.z;
  }

  // ========================================
  // CLEANUP
  // ========================================

  /**
   * Dispose all route lines and cleanup
   */
  dispose(): void {
    this.clearRouteLines();
    this.clearCache();
    this.engine = null;
    this.streetNetwork = null;
    this.baseCoords = null;
    this.routesVisible = null;
    this.osmService = null;
    this.spawnMarkers = [];
  }
}
