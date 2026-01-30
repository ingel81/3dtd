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
import { StreetNetwork, StreetNode } from './osm-street.service';
import { MarkerVisualizationService } from './marker-visualization.service';
import { PathAndRouteService } from './path-route.service';
import { GeoPosition } from '../models/game.types';
import { DevWorldService } from '../devworld/devworld.service';
import { UIStore } from '../store/ui.store';

/**
 * Maximum distance between street points (in meters).
 * Longer segments are subdivided to follow terrain contour.
 * Smaller values = smoother terrain following but more vertices.
 */
const MAX_SEGMENT_LENGTH = 2;

/**
 * StreetRenderingService - Handles street network visualization
 *
 * Extracted from TowerDefenseComponent to reduce god object complexity.
 * Manages:
 * - Merged LineSegments geometry for all streets (1 draw call instead of 600+)
 * - Terrain-following street heights via raycast with segment subdivision
 * - Debug height markers
 * - Street visibility toggle
 */
@Injectable({ providedIn: 'root' })
export class StreetRenderingService {
  private readonly markerViz = inject(MarkerVisualizationService);
  private readonly pathRoute = inject(PathAndRouteService);
  private readonly devWorld = inject(DevWorldService);
  private readonly uiStore = inject(UIStore);

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
    baseCoords: GeoPosition,
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

    // Remove existing street mesh
    if (this.streetLinesMesh) {
      overlayGroup.remove(this.streetLinesMesh);
      this.streetLinesMesh.geometry.dispose();
      (this.streetLinesMesh.material as Material).dispose();
      this.streetLinesMesh = null;
    }

    // Clear height debug markers
    this.markerViz.clearHeightDebugMarkers();

    // Height offset above terrain - DevWorld needs higher offset due to steep terrain
    const HEIGHT_ABOVE_GROUND = this.devWorld.isActive ? 3 : 0.5;

    // Get terrain height at HQ (origin) as reference
    const originTerrainY = engine.getTerrainHeightAtGeo(baseCoords.lat, baseCoords.lon);
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

      // DevWorld: Subdivide segments for smooth terrain following on steep hills
      // Real World: Use original nodes directly (Google Maps terrain is smoother)
      if (this.devWorld.isActive) {
        // Process each segment between consecutive nodes with subdivision
        for (let nodeIdx = 0; nodeIdx < street.nodes.length - 1; nodeIdx++) {
          const nodeA = street.nodes[nodeIdx];
          const nodeB = street.nodes[nodeIdx + 1];

          // Subdivide segment if too long
          const subdivided = this.subdivideSegment(nodeA, nodeB);

          // Sample terrain height at each subdivided point
          for (const node of subdivided) {
            const terrainY = engine.getTerrainHeightAtGeo(node.lat, node.lon);

            if (terrainY !== null) {
              const local = engine.sync.geoToLocalSimple(node.lat, node.lon, 0);
              local.y = (terrainY - originTerrainY) + HEIGHT_ABOVE_GROUND;
              points.push(local);

              // Add debug marker (only every Nth point)
              if (debugMarkerCount % debugMarkerInterval === 0) {
                this.markerViz.addHeightDebugMarker(local, terrainY, true);
              }
              debugMarkerCount++;
            } else {
              if (debugMarkerCount % debugMarkerInterval === 0) {
                const localMiss = engine.sync.geoToLocalSimple(node.lat, node.lon, 5);
                this.markerViz.addHeightDebugMarker(localMiss, null, false);
              }
              debugMarkerCount++;
            }
          }
        }

        // Add the last node
        const lastNode = street.nodes[street.nodes.length - 1];
        const lastTerrainY = engine.getTerrainHeightAtGeo(lastNode.lat, lastNode.lon);
        if (lastTerrainY !== null) {
          const local = engine.sync.geoToLocalSimple(lastNode.lat, lastNode.lon, 0);
          local.y = (lastTerrainY - originTerrainY) + HEIGHT_ABOVE_GROUND;
          points.push(local);
        }
      } else {
        // Real World: Original behavior - iterate nodes directly
        for (const node of street.nodes) {
          const terrainY = engine.getTerrainHeightAtGeo(node.lat, node.lon);

          if (terrainY !== null) {
            const local = engine.sync.geoToLocalSimple(node.lat, node.lon, 0);
            local.y = (terrainY - originTerrainY) + HEIGHT_ABOVE_GROUND;
            points.push(local);

            if (debugMarkerCount % debugMarkerInterval === 0) {
              this.markerViz.addHeightDebugMarker(local, terrainY, true);
            }
            debugMarkerCount++;
          } else {
            if (debugMarkerCount % debugMarkerInterval === 0) {
              const localMiss = engine.sync.geoToLocalSimple(node.lat, node.lon, 5);
              this.markerViz.addHeightDebugMarker(localMiss, null, false);
            }
            debugMarkerCount++;
          }
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

    // Create street overlay (yellow lines for both real world and DevWorld)
    if (allSegmentVertices.length > 0) {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(allSegmentVertices, 3));

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
      this.streetLinesMesh.frustumCulled = false;
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
   * Toggle street visibility based on UI state signal.
   * Called from component event handler.
   */
  toggleVisibility(): void {
    this.setVisibility(this.uiStore.streetsVisible());
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

  /**
   * Subdivide a segment between two nodes if it's longer than MAX_SEGMENT_LENGTH.
   * Returns array of nodes including the start node (but NOT the end node).
   * This ensures smooth terrain following on hilly terrain.
   *
   * @param nodeA Start node
   * @param nodeB End node
   * @returns Array of subdivided nodes (including nodeA, excluding nodeB)
   */
  private subdivideSegment(nodeA: StreetNode, nodeB: StreetNode): StreetNode[] {
    // Calculate approximate distance in meters using flat-earth approximation
    const METERS_PER_DEGREE = 111320;
    const dLat = nodeB.lat - nodeA.lat;
    const dLon = nodeB.lon - nodeA.lon;
    const avgLat = (nodeA.lat + nodeB.lat) / 2;
    const dx = dLon * METERS_PER_DEGREE * Math.cos(avgLat * Math.PI / 180);
    const dy = dLat * METERS_PER_DEGREE;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // If segment is short enough, just return start node
    if (distance <= MAX_SEGMENT_LENGTH) {
      return [nodeA];
    }

    // Calculate number of subdivisions needed
    const numSegments = Math.ceil(distance / MAX_SEGMENT_LENGTH);
    const result: StreetNode[] = [];

    // Interpolate intermediate points
    for (let i = 0; i < numSegments; i++) {
      const t = i / numSegments;
      result.push({
        id: nodeA.id, // Keep original ID for reference
        lat: nodeA.lat + t * dLat,
        lon: nodeA.lon + t * dLon,
      });
    }

    return result;
  }
}
