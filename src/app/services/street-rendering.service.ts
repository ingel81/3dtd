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

/** Batch size for progressive street rendering (nodes per frame) */
const STREET_BATCH_SIZE = 50;

/** Node prepared for rendering with prev/next context */
interface PreparedNode {
  node: StreetNode;
  prev: StreetNode;
  next: StreetNode;
  isDevWorld: boolean;
  /** For DevWorld: subdivided nodes from this segment */
  subdivided?: StreetNode[];
}

/**
 * StreetRenderingService - Handles street network visualization
 *
 * Extracted from TowerDefenseComponent to reduce god object complexity.
 * Manages:
 * - Merged LineSegments geometry for all streets (1 draw call instead of 600+)
 * - Terrain-following street heights via raycast with segment subdivision
 * - Debug height markers
 * - Street visibility toggle
 *
 * Uses progressive rendering to avoid main-thread stutter:
 * startStreetRender() collects work, continueStreetRender() processes in batches.
 */
@Injectable({ providedIn: 'root' })
export class StreetRenderingService {
  private readonly markerViz = inject(MarkerVisualizationService);
  private readonly pathRoute = inject(PathAndRouteService);
  private readonly devWorld = inject(DevWorldService);
  private readonly uiStore = inject(UIStore);

  /** Single merged mesh for all street segments */
  private streetLinesMesh: LineSegments | null = null;

  /** Old mesh kept visible during progressive rebuild (swap on complete) */
  private oldStreetLinesMesh: LineSegments | null = null;

  /** Flag to prevent concurrent renderStreets calls */
  private isRenderingStreets = false;

  /** Progressive street build state */
  private streetBuildState: {
    engine: ThreeTilesEngine;
    overlayGroup: Group;
    visible: boolean;
    originTerrainY: number;
    heightAboveGround: number;
    streets: StreetNetwork['streets'];
    /** Flat list of all nodes to process (across all streets) */
    allNodes: PreparedNode[];
    currentIndex: number;
    /** Accumulated points per street (for smoothing + segment creation) */
    streetPoints: Map<number, Vector3[]>;
    /** Which street index each node belongs to */
    streetIndices: number[];
    debugMarkerCount: number;
    debugMarkerInterval: number;
    t0: number;
  } | null = null;

  /**
   * Start progressive street rendering.
   * Collects all nodes, then returns immediately.
   * Call continueStreetRender() each frame until complete.
   */
  renderStreets(
    engine: ThreeTilesEngine,
    filteredNetwork: StreetNetwork | null,
    fullNetwork: StreetNetwork | null,
    baseCoords: GeoPosition,
    visible: boolean
  ): void {
    // Guard: Only render when filtered (prevents 16s raycast on unfiltered streets)
    if (!filteredNetwork) return;

    // Cancel any ongoing progressive build and reset guard
    if (this.streetBuildState) {
      this.streetBuildState = null;
      this.isRenderingStreets = false;
    }

    // Prevent concurrent calls
    if (this.isRenderingStreets) return;
    this.isRenderingStreets = true;

    if (!fullNetwork) {
      this.isRenderingStreets = false;
      return;
    }

    const networkToRender = filteredNetwork || fullNetwork;
    const overlayGroup = engine.getOverlayGroup();

    // Height offset above terrain
    const heightAboveGround = this.devWorld.isActive ? 3 : 0.5;

    // Get terrain height at HQ as reference
    const originTerrainY = engine.getTerrainHeightAtGeo(baseCoords.lat, baseCoords.lon);
    if (originTerrainY === null) {
      this.isRenderingStreets = false;
      return;
    }

    // Set overlay base Y
    engine.setOverlayBaseY(originTerrainY);

    // Clear height debug markers
    this.markerViz.clearHeightDebugMarkers();

    // Prepare flat list of all nodes with prev/next context
    const allNodes: PreparedNode[] = [];
    const streetIndices: number[] = [];
    const isDevWorld = this.devWorld.isActive;

    for (let si = 0; si < networkToRender.streets.length; si++) {
      const street = networkToRender.streets[si];
      if (street.nodes.length < 2) continue;

      if (isDevWorld) {
        // DevWorld: subdivide segments, collect all subdivision nodes
        for (let nodeIdx = 0; nodeIdx < street.nodes.length - 1; nodeIdx++) {
          const nodeA = street.nodes[nodeIdx];
          const nodeB = street.nodes[nodeIdx + 1];
          const subdivided = this.subdivideSegment(nodeA, nodeB);
          for (const node of subdivided) {
            allNodes.push({ node, prev: nodeA, next: nodeB, isDevWorld: true });
            streetIndices.push(si);
          }
        }
        // Last node
        const lastNode = street.nodes[street.nodes.length - 1];
        allNodes.push({ node: lastNode, prev: lastNode, next: lastNode, isDevWorld: true });
        streetIndices.push(si);
      } else {
        // Real world: use nodes directly with prev/next for lateral sampling
        const nodes = street.nodes;
        for (let idx = 0; idx < nodes.length; idx++) {
          const node = nodes[idx];
          const prevNode = nodes[Math.max(0, idx - 1)];
          const nextNode = nodes[Math.min(nodes.length - 1, idx + 1)];
          allNodes.push({ node, prev: prevNode, next: nextNode, isDevWorld: false });
          streetIndices.push(si);
        }
      }
    }

    // Keep old mesh visible during progressive rebuild
    this.oldStreetLinesMesh = this.streetLinesMesh;
    this.streetLinesMesh = null;

    // Store state for progressive processing
    this.streetBuildState = {
      engine,
      overlayGroup,
      visible,
      originTerrainY,
      heightAboveGround,
      streets: networkToRender.streets,
      allNodes,
      currentIndex: 0,
      streetPoints: new Map(),
      streetIndices,
      debugMarkerCount: 0,
      debugMarkerInterval: 10,
      t0: performance.now(),
    };

    // If very few nodes, process immediately (no need for progressive)
    if (allNodes.length <= STREET_BATCH_SIZE) {
      while (!this.continueStreetRender()) { /* process all */ }
    }
  }

  /**
   * Continue progressive street rendering.
   * Call each frame from game loop. Returns true when complete.
   */
  continueStreetRender(): boolean {
    if (!this.streetBuildState) return true;

    const s = this.streetBuildState;
    const endIndex = Math.min(s.currentIndex + STREET_BATCH_SIZE, s.allNodes.length);

    for (let i = s.currentIndex; i < endIndex; i++) {
      const prepared = s.allNodes[i];
      const streetIdx = s.streetIndices[i];

      // Get terrain height
      let terrainY: number | null;
      if (prepared.isDevWorld) {
        terrainY = s.engine.getTerrainHeightAtGeo(prepared.node.lat, prepared.node.lon);
      } else {
        terrainY = s.engine.getGroundHeightEstimate(
          prepared.node.lat, prepared.node.lon,
          prepared.prev.lat, prepared.prev.lon,
          prepared.next.lat, prepared.next.lon
        );
      }

      if (terrainY !== null) {
        const local = s.engine.sync.geoToLocalSimple(prepared.node.lat, prepared.node.lon, 0);
        local.y = (terrainY - s.originTerrainY) + s.heightAboveGround;

        // Add to street's point list
        let points = s.streetPoints.get(streetIdx);
        if (!points) {
          points = [];
          s.streetPoints.set(streetIdx, points);
        }
        points.push(local);

        // Debug markers
        if (s.debugMarkerCount % s.debugMarkerInterval === 0) {
          this.markerViz.addHeightDebugMarker(local, terrainY, true);
        }
      } else {
        if (s.debugMarkerCount % s.debugMarkerInterval === 0) {
          const localMiss = s.engine.sync.geoToLocalSimple(prepared.node.lat, prepared.node.lon, 5);
          this.markerViz.addHeightDebugMarker(localMiss, null, false);
        }
      }
      s.debugMarkerCount++;
    }

    s.currentIndex = endIndex;

    // Check if complete
    if (endIndex >= s.allNodes.length) {
      this.finalizeStreetRender(s);
      return true;
    }

    return false;
  }

  /**
   * Finalize street rendering — create mesh, swap old, cleanup
   */
  private finalizeStreetRender(s: NonNullable<typeof this.streetBuildState>): void {
    // Build merged line segments from all street points
    const allSegmentVertices: number[] = [];

    for (const [streetIdx, points] of s.streetPoints) {
      if (points.length < 2) continue;

      // Find street type for smoothing
      const street = s.streets[streetIdx];
      const smoothedPoints = this.pathRoute.smoothPathHeights(points, street?.type);

      for (let i = 0; i < smoothedPoints.length - 1; i++) {
        const p1 = smoothedPoints[i];
        const p2 = smoothedPoints[i + 1];
        allSegmentVertices.push(p1.x, p1.y, p1.z);
        allSegmentVertices.push(p2.x, p2.y, p2.z);
      }
    }

    // Remove old mesh
    if (this.oldStreetLinesMesh) {
      s.overlayGroup.remove(this.oldStreetLinesMesh);
      this.oldStreetLinesMesh.geometry.dispose();
      (this.oldStreetLinesMesh.material as Material).dispose();
      this.oldStreetLinesMesh = null;
    }

    // Create new mesh
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
      this.streetLinesMesh.visible = s.visible;
      this.streetLinesMesh.renderOrder = 1;
      this.streetLinesMesh.frustumCulled = false;
      s.overlayGroup.add(this.streetLinesMesh);
    }

    const totalNodes = s.allNodes.length;
    console.warn(
      `[PerfTrace] renderStreets: ${(performance.now() - s.t0).toFixed(1)}ms (progressive) | nodes=${totalNodes} segments=${allSegmentVertices.length / 6}`
    );

    this.streetBuildState = null;
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
   */
  dispose(overlayGroup: Group): void {
    this.streetBuildState = null;
    if (this.oldStreetLinesMesh) {
      overlayGroup.remove(this.oldStreetLinesMesh);
      this.oldStreetLinesMesh.geometry.dispose();
      (this.oldStreetLinesMesh.material as Material).dispose();
      this.oldStreetLinesMesh = null;
    }
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
    this.oldStreetLinesMesh = null;
    this.isRenderingStreets = false;
    this.streetBuildState = null;
  }

  /**
   * Subdivide a street segment if it's too long
   */
  private subdivideSegment(a: StreetNode, b: StreetNode): StreetNode[] {
    const dLat = b.lat - a.lat;
    const dLon = b.lon - a.lon;
    const approxDist = Math.sqrt(dLat * dLat + dLon * dLon) * 111000;

    if (approxDist <= MAX_SEGMENT_LENGTH) {
      return [a];
    }

    const steps = Math.ceil(approxDist / MAX_SEGMENT_LENGTH);
    const result: StreetNode[] = [];
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      result.push({
        lat: a.lat + dLat * t,
        lon: a.lon + dLon * t,
        id: a.id,
      });
    }
    return result;
  }
}
