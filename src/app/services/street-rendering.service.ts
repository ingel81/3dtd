import { Injectable, inject } from '@angular/core';
import {
  Vector3,
  Material,
  LineSegments,
  BufferGeometry,
  Float32BufferAttribute,
  LineBasicMaterial,
  Group,
} from 'three';
import { ThreeTilesEngine } from '../three-engine';
import { StreetNetwork } from './osm-street.service';
import { MarkerVisualizationService } from './marker-visualization.service';
import { PathAndRouteService } from './path-route.service';

/**
 * StreetRenderingService - Handles street network visualization
 *
 * Extracted from TowerDefenseComponent to reduce god object complexity.
 * Manages:
 * - Merged LineSegments geometry for all streets (1 draw call instead of 600+)
 * - Terrain-following street heights via raycast
 * - Debug height markers
 * - Street visibility toggle
 */
@Injectable({ providedIn: 'root' })
export class StreetRenderingService {
  private readonly markerViz = inject(MarkerVisualizationService);
  private readonly pathRoute = inject(PathAndRouteService);

  /** Single merged mesh for all street segments */
  private streetLinesMesh: LineSegments | null = null;

  /** Flag to prevent concurrent renderStreets calls */
  private isRenderingStreets = false;

  /**
   * Render street network with terrain-following heights
   *
   * @param engine The 3D tiles engine for terrain raycasting
   * @param filteredNetwork Filtered street network (near routes) - preferred
   * @param fullNetwork Full street network - fallback
   * @param baseCoords HQ coordinates for origin terrain height
   * @param visible Initial visibility state
   */
  renderStreets(
    engine: ThreeTilesEngine,
    filteredNetwork: StreetNetwork | null,
    fullNetwork: StreetNetwork | null,
    baseCoords: { latitude: number; longitude: number },
    visible: boolean
  ): void {
    // Guard: Only render when filtered (prevents 16s raycast on unfiltered streets)
    if (!filteredNetwork) {
      console.log('[StreetRendering] renderStreets: Skipped - not filtered yet');
      return;
    }

    // Prevent concurrent calls (can happen during loading sequence)
    if (this.isRenderingStreets) {
      return;
    }
    this.isRenderingStreets = true;
    console.time('[StreetRendering] renderStreets');

    if (!fullNetwork) {
      console.timeEnd('[StreetRendering] renderStreets');
      this.isRenderingStreets = false;
      return;
    }

    // Use filtered network if available (much faster), otherwise full network
    const networkToRender = filteredNetwork || fullNetwork;

    const overlayGroup = engine.getOverlayGroup();

    // Remove existing street mesh (single object now instead of 600+ separate lines)
    if (this.streetLinesMesh) {
      overlayGroup.remove(this.streetLinesMesh);
      this.streetLinesMesh.geometry.dispose();
      (this.streetLinesMesh.material as Material).dispose();
      this.streetLinesMesh = null;
    }

    // Clear height debug markers
    this.markerViz.clearHeightDebugMarkers();

    // Height offset above terrain (0 = directly on terrain)
    const HEIGHT_ABOVE_GROUND = 0.5;

    // Get terrain height at HQ (origin) as reference
    const originTerrainY = engine.getTerrainHeightAtGeo(baseCoords.latitude, baseCoords.longitude);
    if (originTerrainY === null) {
      console.timeEnd('[StreetRendering] renderStreets');
      this.isRenderingStreets = false;
      return;
    }

    // Set overlay base Y so overlayGroup is positioned at terrain surface
    engine.setOverlayBaseY(originTerrainY);

    // Always create debug markers (hidden by default) so toggleHeightDebug doesn't need to re-render
    const debugMarkerInterval = 10; // Only show every Nth marker to reduce clutter
    let debugMarkerCount = 0;

    // Collect all line segments for merged geometry (PERFORMANCE: 1 draw call instead of 600+)
    // LineSegments interprets vertices pairwise: [v0-v1], [v2-v3], [v4-v5]...
    const allSegmentVertices: number[] = [];

    for (const street of networkToRender.streets) {
      if (street.nodes.length < 2) continue;

      const points: Vector3[] = [];

      for (const node of street.nodes) {
        // Get terrain height at this position using local raycast
        const terrainY = engine.getTerrainHeightAtGeo(node.lat, node.lon);

        if (terrainY !== null) {
          // Use geoToLocalSimple for X/Z
          const local = engine.sync.geoToLocalSimple(node.lat, node.lon, 0);
          // Y = height difference from origin + offset above ground
          local.y = (terrainY - originTerrainY) + HEIGHT_ABOVE_GROUND;
          points.push(local);

          // Add debug marker (only every Nth point) - always create, visibility controlled separately
          if (debugMarkerCount % debugMarkerInterval === 0) {
            this.markerViz.addHeightDebugMarker(local, terrainY, true);
          }
          debugMarkerCount++;
        } else {
          // Add red debug marker for misses (only every Nth point)
          if (debugMarkerCount % debugMarkerInterval === 0) {
            const localMiss = engine.sync.geoToLocalSimple(node.lat, node.lon, 5);
            this.markerViz.addHeightDebugMarker(localMiss, null, false);
          }
          debugMarkerCount++;
        }
      }

      // Only render street if we have at least 2 points
      if (points.length < 2) continue;

      // Smooth out height anomalies (e.g., hitting buildings instead of ground)
      const smoothedPoints = this.pathRoute.smoothPathHeights(points);

      // Convert connected points to line segments for LineSegments geometry
      // [A, B, C, D] -> segments: [A-B, B-C, C-D] -> vertices: [A, B, B, C, C, D]
      for (let i = 0; i < smoothedPoints.length - 1; i++) {
        const p1 = smoothedPoints[i];
        const p2 = smoothedPoints[i + 1];
        allSegmentVertices.push(p1.x, p1.y, p1.z);
        allSegmentVertices.push(p2.x, p2.y, p2.z);
      }
    }

    // Create single merged geometry with all street segments
    if (allSegmentVertices.length > 0) {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(allSegmentVertices, 3));

      // Single material for all streets (no more cloning per street!)
      const material = new LineBasicMaterial({
        color: 0xffd700,
        linewidth: 2,
        depthTest: true,
        depthWrite: false,
        transparent: true,
        opacity: 0.9
      });

      this.streetLinesMesh = new LineSegments(geometry, material);
      this.streetLinesMesh.visible = visible;
      this.streetLinesMesh.renderOrder = 1;
      this.streetLinesMesh.frustumCulled = false;  // Prevent disappearing at certain angles
      overlayGroup.add(this.streetLinesMesh);
    }
    console.timeEnd('[StreetRendering] renderStreets');
    this.isRenderingStreets = false;
  }

  /**
   * Set street visibility
   */
  setVisibility(visible: boolean): void {
    if (this.streetLinesMesh) {
      this.streetLinesMesh.visible = visible;
    }
  }

  /**
   * Check if streets are currently rendered
   */
  hasStreets(): boolean {
    return this.streetLinesMesh !== null;
  }

  /**
   * Dispose street mesh and cleanup
   * @param overlayGroup The overlay group containing the mesh
   */
  dispose(overlayGroup: Group): void {
    if (this.streetLinesMesh) {
      overlayGroup.remove(this.streetLinesMesh);
      this.streetLinesMesh.geometry.dispose();
      (this.streetLinesMesh.material as Material).dispose();
      this.streetLinesMesh = null;
    }
  }

  /**
   * Reset service state (for location change)
   */
  reset(): void {
    this.streetLinesMesh = null;
    this.isRenderingStreets = false;
  }
}
