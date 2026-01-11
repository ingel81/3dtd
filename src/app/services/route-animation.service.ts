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
  // Glow layer (wider, white/pink, behind)
  glowLine: Line2;
  glowMaterial: LineMaterial;
  // Main line (narrower, bright red, in front)
  mainLine: Line2;
  mainMaterial: LineMaterial;
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

  /** Speed of the animated pattern in meters per second */
  private readonly ANIMATION_SPEED = 60;

  /** Number of animation cycles before fade-out */
  private readonly MAX_CYCLES = 3;

  /** Duration of fade-out in milliseconds */
  private readonly FADE_DURATION = 2500;

  /** Height offset above terrain for the animated line */
  private readonly HEIGHT_OFFSET = 1.5;

  // --- MAIN LINE (flowing red dashes) ---
  /** Main line color (vivid red) */
  private readonly MAIN_COLOR = new THREE.Color(0xff2020);
  /** Main line width */
  private readonly MAIN_LINE_WIDTH = 3;
  /** Longer dashes for elongated look */
  private readonly MAIN_DASH_SIZE = 12;
  /** Gaps between dashes */
  private readonly MAIN_GAP_SIZE = 8;

  // --- GLOW LINE (thin soft halo) ---
  /** Glow line color (soft pink-red) */
  private readonly GLOW_COLOR = new THREE.Color(0xff8888);
  /** Glow line width (thinner) */
  private readonly GLOW_LINE_WIDTH = 6;
  /** Continuous glow - no dashes */
  private readonly GLOW_DASHED = false;

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

      const animatedRoute = this.createAnimatedRoute(spawnId, path, this.MAIN_COLOR);
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

      // Animation continues running throughout (including during fade-out)
      const offset = (elapsedTime / 1000) * this.ANIMATION_SPEED;
      route.mainMaterial.dashOffset = -offset;

      // Subtle pulsing for main line (stays red)
      const intensity = 0.5 + Math.sin(elapsedTime * 0.003) * 0.08;
      route.mainMaterial.color.setHSL(0.0, 1.0, intensity);

      // Glow stays steady pink-red
      route.glowMaterial.color.setHSL(0.0, 0.6, 0.55);

      if (elapsedTime >= totalDuration) {
        // Fade out phase - animation still runs but opacity decreases smoothly
        const fadeElapsed = elapsedTime - totalDuration;
        const fadeProgress = Math.min(fadeElapsed / this.FADE_DURATION, 1);
        // Ease-out curve for smoother fade
        const easedFade = 1 - Math.pow(1 - fadeProgress, 2.5);

        route.mainMaterial.opacity = 1.0 * (1 - easedFade);
        route.glowMaterial.opacity = 0.6 * (1 - easedFade);

        if (fadeProgress >= 1) {
          this.stopAnimation();
          return;
        }
      } else {
        // Normal animation phase - steady opacity
        route.mainMaterial.opacity = 0.9;
        route.glowMaterial.opacity = 0.35;
      }
    }
  }

  /**
   * Stop the animation and clean up
   */
  stopAnimation(): void {
    if (!this.overlayGroup) return;

    for (const route of this.animatedRoutes) {
      // Remove and dispose glow line
      this.overlayGroup.remove(route.glowLine);
      if (route.glowLine.geometry) route.glowLine.geometry.dispose();
      if (route.glowMaterial) route.glowMaterial.dispose();
      // Remove and dispose main line
      this.overlayGroup.remove(route.mainLine);
      if (route.mainLine.geometry) route.mainLine.geometry.dispose();
      if (route.mainMaterial) route.mainMaterial.dispose();
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
   * @param color Route color (unused, using configured colors)
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

    // === GLOW LINE (wider, behind, creates halo effect) ===
    const glowGeometry = new LineGeometry();
    glowGeometry.setPositions(positions);
    const glowMaterial = this.createGlowMaterial();
    const glowLine = new Line2(glowGeometry, glowMaterial);
    glowLine.computeLineDistances();
    glowLine.renderOrder = 2; // Behind main line
    glowLine.frustumCulled = false;
    this.overlayGroup.add(glowLine);

    // === MAIN LINE (bright red, in front) ===
    const mainGeometry = new LineGeometry();
    mainGeometry.setPositions(positions);
    const mainMaterial = this.createMainMaterial();
    const mainLine = new Line2(mainGeometry, mainMaterial);
    mainLine.computeLineDistances();
    mainLine.renderOrder = 3; // In front of glow
    mainLine.frustumCulled = false;
    this.overlayGroup.add(mainLine);

    return {
      id,
      glowLine,
      glowMaterial,
      mainLine,
      mainMaterial,
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
   * Create main line material (bright red, dashed)
   */
  private createMainMaterial(): LineMaterial {
    const mat = new LineMaterial({
      color: this.MAIN_COLOR.getHex(),
      linewidth: this.MAIN_LINE_WIDTH,
      transparent: true,
      opacity: 1.0,
      depthTest: true,
      depthWrite: false,
      dashed: true,
      dashSize: this.MAIN_DASH_SIZE,
      gapSize: this.MAIN_GAP_SIZE,
      dashOffset: 0,
      worldUnits: true,
    });

    if (this.engine) {
      const size = this.engine.getRenderer().getSize(new THREE.Vector2());
      mat.resolution.set(size.x, size.y);
    }

    return mat;
  }

  /**
   * Create glow line material (soft continuous halo, behind main)
   */
  private createGlowMaterial(): LineMaterial {
    const mat = new LineMaterial({
      color: this.GLOW_COLOR.getHex(),
      linewidth: this.GLOW_LINE_WIDTH,
      transparent: true,
      opacity: 0.4,
      depthTest: true,
      depthWrite: false,
      dashed: this.GLOW_DASHED,
      worldUnits: true,
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
