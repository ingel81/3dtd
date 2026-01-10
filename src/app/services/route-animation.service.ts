import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { ThreeTilesEngine } from '../three-engine';
import { GeoPosition } from '../models/game.types';
import { SpawnPoint } from './marker-visualization.service';

/**
 * Animated route data for a single spawn path
 */
interface AnimatedRoute {
  id: string;
  animatedLine: Line2;       // Animated dashed line
  animatedMaterial: LineMaterial;
  totalLength: number;
  pointCount: number;
}

/**
 * RouteAnimationService
 *
 * Renders an animated "Knight Rider" effect along enemy routes at game start.
 * A glowing red head with trailing tail runs from spawn to HQ, signaling danger.
 *
 * This is separate from the debug route visualization (static red lines).
 */
@Injectable({ providedIn: 'root' })
export class RouteAnimationService {
  // ========================================
  // CONFIGURATION
  // ========================================

  /** Speed of the animated dashes in meters per second */
  private readonly ANIMATION_SPEED = 250;

  /** Number of animation cycles before fade-out */
  private readonly MAX_CYCLES = 3;

  /** Duration of fade-out in milliseconds */
  private readonly FADE_DURATION = 1500;

  /** Height offset above terrain for the animated line */
  private readonly HEIGHT_OFFSET = 1.5;

  /** Animated line color (bright red-orange) */
  private readonly ANIM_COLOR = new THREE.Color(0xff4422);

  /** Animated line width in pixels */
  private readonly ANIM_LINE_WIDTH = 5;

  /** Dash size for animated line */
  private readonly DASH_SIZE = 15;

  /** Gap size for animated line */
  private readonly GAP_SIZE = 25;

  // ========================================
  // STATE
  // ========================================

  private engine: ThreeTilesEngine | null = null;
  private overlayGroup: THREE.Group | null = null;
  private animatedRoutes: AnimatedRoute[] = [];
  private isAnimating = false;
  private startTime = 0;
  private disposed = false;

  // ========================================
  // INITIALIZATION
  // ========================================

  /**
   * Initialize the route animation service
   * @param engine ThreeTilesEngine instance
   */
  initialize(engine: ThreeTilesEngine): void {
    this.engine = engine;
    this.overlayGroup = engine.getOverlayGroup();
    this.disposed = false;
  }

  // ========================================
  // ANIMATION CONTROL
  // ========================================

  /**
   * Start the route animation
   * @param cachedPaths Map of spawn ID to path (GeoPosition[])
   * @param spawnPoints Array of spawn points (for colors)
   */
  startAnimation(
    cachedPaths: Map<string, GeoPosition[]>,
    spawnPoints: SpawnPoint[]
  ): void {
    if (!this.engine || !this.overlayGroup || this.disposed) return;
    if (cachedPaths.size === 0) return;

    // Clean up any existing animation
    this.stopAnimation();

    // Create animated routes for each path
    for (const [spawnId, path] of cachedPaths) {
      if (path.length < 2) continue;

      const animatedRoute = this.createAnimatedRoute(spawnId, path, this.ANIM_COLOR);
      if (animatedRoute) {
        this.animatedRoutes.push(animatedRoute);
        console.log('[RouteAnimation] Created route', spawnId, '- length:', animatedRoute.totalLength.toFixed(0), 'm');
      }
    }

    if (this.animatedRoutes.length === 0) return;

    // Start animation
    this.isAnimating = true;
    this.startTime = performance.now();

    console.log('[RouteAnimation] Started animation with', this.animatedRoutes.length, 'routes');
  }

  /**
   * Update animation (called every frame)
   * @param deltaTime Time since last frame in milliseconds
   */
  update(deltaTime: number): void {
    if (!this.isAnimating || this.animatedRoutes.length === 0) return;

    const elapsedTime = performance.now() - this.startTime;

    for (const route of this.animatedRoutes) {
      // Calculate total animation duration
      const cycleDuration = (route.totalLength / this.ANIMATION_SPEED) * 1000;
      const totalDuration = cycleDuration * this.MAX_CYCLES;

      if (elapsedTime >= totalDuration) {
        // Animation complete - start fade out
        const fadeElapsed = elapsedTime - totalDuration;
        const fadeProgress = Math.min(fadeElapsed / this.FADE_DURATION, 1);

        route.animatedMaterial.opacity = 1 - fadeProgress;

        if (fadeProgress >= 1) {
          this.stopAnimation();
          return;
        }
      } else {
        // Animate dashes moving along the line (Knight Rider style!)
        // dashOffset moves the dashes - negative = forward direction
        const dashPeriod = this.DASH_SIZE + this.GAP_SIZE;
        const offset = (elapsedTime / 1000) * this.ANIMATION_SPEED;
        route.animatedMaterial.dashOffset = -offset;

        // Pulsing glow effect on brightness
        const pulse = 0.7 + Math.sin(elapsedTime * 0.008) * 0.3;
        route.animatedMaterial.opacity = pulse;

        // Subtle color shift for extra effect
        const hue = 0.02 + Math.sin(elapsedTime * 0.003) * 0.02; // Red to orange shift
        route.animatedMaterial.color.setHSL(hue, 1.0, 0.5);
      }
    }
  }

  /**
   * Stop the animation and clean up
   */
  stopAnimation(): void {
    if (!this.overlayGroup) return;

    for (const route of this.animatedRoutes) {
      this.overlayGroup.remove(route.animatedLine);
      if (route.animatedLine.geometry) route.animatedLine.geometry.dispose();
      if (route.animatedMaterial) route.animatedMaterial.dispose();
    }

    this.animatedRoutes = [];
    this.isAnimating = false;
  }

  /**
   * Check if animation is currently running
   */
  isRunning(): boolean {
    return this.isAnimating;
  }

  // ========================================
  // GEOMETRY CREATION
  // ========================================

  /**
   * Create an animated route from path data
   * @param id Route identifier
   * @param path Path as GeoPosition array
   * @param color Route color
   * @returns AnimatedRoute or null if creation failed
   */
  private createAnimatedRoute(
    id: string,
    path: GeoPosition[],
    color: THREE.Color
  ): AnimatedRoute | null {
    if (!this.engine || !this.overlayGroup) return null;

    // Convert GeoPosition[] to local THREE.Vector3[]
    const rawPoints = this.convertPathToLocalPoints(path);
    if (rawPoints.length < 2) return null;

    // Interpolate for smooth animation (1 point every 2 meters)
    const points = this.interpolatePoints(rawPoints, 2);

    // Calculate total length
    let totalLength = 0;
    for (let i = 1; i < points.length; i++) {
      totalLength += points[i].distanceTo(points[i - 1]);
    }
    if (totalLength < 1) return null;

    // Create positions array
    const positions: number[] = [];
    for (const p of points) {
      positions.push(p.x, p.y, p.z);
    }

    // === ANIMATED LINE (bright, dashed, moving) ===
    const animGeometry = new LineGeometry();
    animGeometry.setPositions(positions);
    const animatedMaterial = this.createAnimatedMaterial(totalLength);
    const animatedLine = new Line2(animGeometry, animatedMaterial);
    animatedLine.computeLineDistances();
    animatedLine.renderOrder = 3;
    animatedLine.frustumCulled = false;

    this.overlayGroup.add(animatedLine);

    return {
      id,
      animatedLine,
      animatedMaterial,
      totalLength,
      pointCount: points.length,
    };
  }

  /**
   * Convert GeoPosition path to local THREE.Vector3 points
   * @param path Path as GeoPosition array
   * @returns Array of local Vector3 points
   */
  private convertPathToLocalPoints(path: GeoPosition[]): THREE.Vector3[] {
    if (!this.engine) return [];

    const points: THREE.Vector3[] = [];
    const origin = this.engine.sync.getOrigin();
    const originTerrainY = this.engine.getTerrainHeightAtGeo(origin.lat, origin.lon) ?? 0;

    for (const pos of path) {
      const local = this.engine.sync.geoToLocalSimple(pos.lat, pos.lon, 0);

      // Sample terrain height at this position (same as PathAndRouteService)
      const terrainY = this.engine.getTerrainHeightAtGeo(pos.lat, pos.lon);
      if (terrainY !== null) {
        local.y = terrainY - originTerrainY + this.HEIGHT_OFFSET;
      } else {
        local.y = this.HEIGHT_OFFSET;
      }

      points.push(local);
    }

    return points;
  }

  /**
   * Create BufferGeometry with position and cumulative distance attributes
   * @param points Array of Vector3 points
   * @returns Geometry and total length
   */
  private createLineGeometryWithDistances(points: THREE.Vector3[]): {
    geometry: THREE.BufferGeometry;
    totalLength: number;
  } {
    const positions: number[] = [];
    const distances: number[] = [];
    let cumulativeDistance = 0;

    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      positions.push(point.x, point.y, point.z);

      if (i > 0) {
        const prev = points[i - 1];
        const segmentLength = point.distanceTo(prev);
        cumulativeDistance += segmentLength;
      }

      distances.push(cumulativeDistance);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aLineDistance', new THREE.Float32BufferAttribute(distances, 1));

    return { geometry, totalLength: cumulativeDistance };
  }

  /**
   * Create animated line material (bright, dashed, will move)
   */
  private createAnimatedMaterial(totalLength: number): LineMaterial {
    const mat = new LineMaterial({
      color: this.ANIM_COLOR.getHex(),
      linewidth: this.ANIM_LINE_WIDTH,
      transparent: true,
      opacity: 1.0,
      depthTest: true,
      depthWrite: false,
      dashed: true,
      dashSize: this.DASH_SIZE,
      gapSize: this.GAP_SIZE,
      dashOffset: 0,
      worldUnits: true, // Use world units for consistent dash size
    });

    if (this.engine) {
      const size = this.engine.getRenderer().getSize(new THREE.Vector2());
      mat.resolution.set(size.x, size.y);
    }

    return mat;
  }

  // ========================================
  // INTERPOLATION
  // ========================================

  /**
   * Interpolate points for smoother animation
   * @param points Original points
   * @param segmentLength Target distance between points in meters
   * @returns Interpolated points array
   */
  private interpolatePoints(points: THREE.Vector3[], segmentLength: number): THREE.Vector3[] {
    if (points.length < 2) return points;

    const result: THREE.Vector3[] = [points[0].clone()];

    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const distance = prev.distanceTo(curr);

      if (distance > segmentLength) {
        // Interpolate intermediate points
        const segments = Math.ceil(distance / segmentLength);
        for (let j = 1; j <= segments; j++) {
          const t = j / segments;
          result.push(new THREE.Vector3().lerpVectors(prev, curr, t));
        }
      } else {
        result.push(curr.clone());
      }
    }

    return result;
  }

  // ========================================
  // CLEANUP
  // ========================================

  /**
   * Dispose all resources
   */
  dispose(): void {
    this.disposed = true;
    this.stopAnimation();
    this.engine = null;
    this.overlayGroup = null;
  }
}
