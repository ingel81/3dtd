import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { ThreeTilesEngine } from '../three-engine';
import { GeoPosition } from '../models/game.types';

/**
 * Camera debug information for UI display
 */
export interface CameraDebugInfo {
  // Position
  posX: number;
  posY: number;
  posZ: number;
  // Rotation (degrees)
  rotX: number;
  rotY: number;
  rotZ: number;
  // Derived values
  heading: number;      // 0-360, 0=North
  pitch: number;        // Camera tilt angle (degrees from horizontal)
  altitude: number;     // Height above terrain
  distanceToCenter: number; // Distance to lookAt point
  fov: number;          // Field of view
  // Terrain info
  terrainHeight: number;
}

/**
 * CameraControlService
 *
 * Manages camera position, animations, and view controls for the Tower Defense game.
 * Handles camera reset, fly-to animations, and position tracking.
 */
@Injectable({ providedIn: 'root' })
export class CameraControlService {
  // ========================================
  // STATE
  // ========================================

  /** Stored initial camera position for reset functionality */
  private initialCameraPosition: { x: number; y: number; z: number } | null = null;

  /** Reference to the 3D engine */
  private engine: ThreeTilesEngine | null = null;

  /** Base coordinates for fallback positioning */
  private baseCoords: GeoPosition | null = null;

  /** Debug visualization enabled */
  private debugFramingEnabled = false;

  /** Debug meshes for cleanup */
  private debugMeshes: THREE.Object3D[] = [];

  // ========================================
  // INITIALIZATION
  // ========================================

  /**
   * Initialize camera control service with engine reference
   * @param engine ThreeTilesEngine instance
   * @param baseCoords Base/HQ coordinates for fallback positioning
   */
  initialize(engine: ThreeTilesEngine, baseCoords: GeoPosition): void {
    this.engine = engine;
    this.baseCoords = baseCoords;
  }

  // ========================================
  // POSITION MANAGEMENT
  // ========================================

  /**
   * Save current camera position as initial position
   * This is called after engine initialization to store the default view
   */
  saveInitialPosition(): void {
    if (!this.engine) return;

    const camera = this.engine.getCamera();
    this.initialCameraPosition = {
      x: camera.position.x,
      y: camera.position.y,
      z: camera.position.z,
    };

    console.log('[Camera] Initial position captured:', this.initialCameraPosition);
  }

  /**
   * Reset camera to initial position or fallback to base coordinates
   */
  resetCamera(): void {
    if (!this.engine) return;

    // Use stored initial camera position if available
    if (this.initialCameraPosition) {
      const pos = this.initialCameraPosition;
      // Look at terrain level (Y - 400 since camera is 400m above ground)
      const lookAtY = pos.y - 400;
      this.engine.setLocalCameraPosition(pos.x, pos.y, pos.z, 0, lookAtY, 0);
    } else {
      // Fallback: calculate from terrain (less accurate before tiles fully load)
      if (!this.baseCoords) {
        console.warn('[Camera] No base coords available for fallback positioning');
        return;
      }

      const terrainY = this.engine.getTerrainHeightAtGeo(this.baseCoords.lat, this.baseCoords.lon) ?? 0;
      const heightAboveGround = 400;
      const cameraY = terrainY + heightAboveGround;
      this.engine.setLocalCameraPosition(0, cameraY, -heightAboveGround, 0, terrainY, 0);
    }
  }

  // ========================================
  // FRAMING (HQ + SPAWNS)
  // ========================================

  /**
   * Position camera to frame HQ and all spawn points with steep iso view
   * Camera is positioned perpendicular to the HQ-Spawns axis for best visibility
   *
   * @param hq HQ/Base coordinates
   * @param spawns Array of spawn point coordinates
   * @param padding Padding factor (0.2 = 20% extra space around points)
   */
  frameHqAndSpawns(
    hq: { lat: number; lon: number },
    spawns: { lat: number; lon: number }[],
    padding: number = 0.2
  ): void {
    console.log('[Camera Framing] START', { hq, spawns, padding });

    if (!this.engine || spawns.length === 0) {
      console.log('[Camera Framing] ABORT - no engine or spawns', { engine: !!this.engine, spawnsLength: spawns.length });
      return;
    }

    const sync = this.engine.sync;

    // Convert all points to local coordinates (HQ is at origin 0,0,0)
    const hqLocal = sync.geoToLocalSimple(hq.lat, hq.lon, 0);
    const spawnLocals = spawns.map(s => sync.geoToLocalSimple(s.lat, s.lon, 0));

    console.log('[Camera Framing] Local coords:', {
      hqLocal: { x: hqLocal.x.toFixed(1), y: hqLocal.y.toFixed(1), z: hqLocal.z.toFixed(1) },
      spawnLocals: spawnLocals.map(s => ({ x: s.x.toFixed(1), y: s.y.toFixed(1), z: s.z.toFixed(1) }))
    });

    // All points including HQ
    const allPoints = [hqLocal, ...spawnLocals];

    // Calculate bounding box
    let minX = Infinity, maxX = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    for (const p of allPoints) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }

    // Calculate center of all points
    const centerX = (minX + maxX) / 2;
    const centerZ = (minZ + maxZ) / 2;

    // Calculate the span (size of area to show) - keep rectangular!
    const spanX = Math.max(maxX - minX, 50); // Minimum 50m
    const spanZ = Math.max(maxZ - minZ, 50); // Minimum 50m

    // Add padding to each dimension separately (rectangular, not square)
    const paddedSpanX = spanX * (1 + padding);
    const paddedSpanZ = spanZ * (1 + padding);

    // Camera angle: 60° from horizontal (steep top-down view)
    const cameraAngle = 60 * Math.PI / 180; // 60 degrees

    // Get camera properties for optimal fitting
    const camera = this.engine.getCamera();
    const vFov = camera instanceof THREE.PerspectiveCamera ? camera.fov * Math.PI / 180 : 60 * Math.PI / 180;
    const aspect = camera instanceof THREE.PerspectiveCamera ? camera.aspect : 16 / 9;

    // Calculate horizontal FOV from vertical FOV and aspect ratio
    const hFov = 2 * Math.atan(aspect * Math.tan(vFov / 2));

    // Calculate minimum distance to fit X span horizontally
    const distanceForX = (paddedSpanX / 2) / Math.tan(hFov / 2);

    // Calculate minimum distance to fit Z span vertically
    // The Z span appears foreshortened when viewed at an angle
    // Projected height = paddedSpanZ * sin(cameraAngle) approximately
    // But we also need to account for the perspective - far edge is smaller
    // Use a simpler model: the Z span projects to about paddedSpanZ * sin(angle) in screen height
    const projectedZHeight = paddedSpanZ * Math.sin(cameraAngle);
    const distanceForZ = (projectedZHeight / 2) / Math.tan(vFov / 2);

    // Use the larger distance to ensure everything fits
    const cameraDistance = Math.max(distanceForX, distanceForZ);

    // Split distance into height and horizontal offset based on angle
    const cameraHeight = cameraDistance * Math.sin(cameraAngle);
    const horizontalOffset = cameraDistance * Math.cos(cameraAngle);

    // Calculate direction from HQ to spawn centroid (for dynamic camera positioning)
    // Camera will be positioned perpendicular to this axis
    const spawnCentroidX = spawnLocals.reduce((sum, p) => sum + p.x, 0) / spawnLocals.length;
    const spawnCentroidZ = spawnLocals.reduce((sum, p) => sum + p.z, 0) / spawnLocals.length;

    // Direction from HQ to spawn centroid
    const dirX = spawnCentroidX - hqLocal.x;
    const dirZ = spawnCentroidZ - hqLocal.z;
    const dirLength = Math.sqrt(dirX * dirX + dirZ * dirZ);

    // Perpendicular direction (rotate 90°) - camera looks from the side
    // We choose the direction that puts camera "south-ish" when possible
    let perpX: number, perpZ: number;
    if (dirLength > 1) {
      // Perpendicular: rotate direction by 90°
      perpX = -dirZ / dirLength;
      perpZ = dirX / dirLength;

      // Prefer camera to be in southern hemisphere (negative Z in local coords)
      // If perpendicular points north, flip it
      if (perpZ > 0) {
        perpX = -perpX;
        perpZ = -perpZ;
      }
    } else {
      // Fallback: camera from south (like current default)
      perpX = 0;
      perpZ = -1;
    }

    // Camera position: center + perpendicular offset + height
    const camX = centerX + perpX * horizontalOffset;
    const camZ = centerZ + perpZ * horizontalOffset;

    // Get terrain height at center for proper Y positioning
    const terrainY = this.engine.getTerrainHeightAtGeo(hq.lat, hq.lon) ?? 0;
    const camY = terrainY + cameraHeight;
    const lookAtY = terrainY;

    console.log(`[Camera] Framing HQ + ${spawns.length} spawns:`, {
      center: { x: centerX.toFixed(1), z: centerZ.toFixed(1) },
      spans: { x: paddedSpanX.toFixed(0), z: paddedSpanZ.toFixed(0) },
      distances: { forX: distanceForX.toFixed(0), forZ: distanceForZ.toFixed(0), used: cameraDistance.toFixed(0) },
      viewport: { aspect: aspect.toFixed(2), vFov: (vFov * 180 / Math.PI).toFixed(0), hFov: (hFov * 180 / Math.PI).toFixed(0) },
      camera: { x: camX.toFixed(1), y: camY.toFixed(1), z: camZ.toFixed(1), angle: (cameraAngle * 180 / Math.PI).toFixed(0) }
    });

    // Set camera position looking at center of all points
    this.engine.setLocalCameraPosition(camX, camY, camZ, centerX, lookAtY, centerZ);
  }

  /**
   * Get current camera heading (azimuth) in degrees
   * 0° = North, 90° = East, 180° = South, 270° = West
   */
  getCameraHeading(): number {
    if (!this.engine) return 0;

    const camera = this.engine.getCamera();

    // Get camera's forward direction (where it's looking)
    // Camera looks down -Z in its local space
    const direction = new THREE.Vector3(0, 0, -1);
    direction.applyQuaternion(camera.quaternion);

    // Project onto XZ plane (ignore Y component for heading)
    direction.y = 0;
    direction.normalize();

    // Calculate heading from direction
    // In Three.js with our setup: +Z = North, +X = East (after ReorientationPlugin)
    // atan2(x, z) gives angle from +Z axis (North)
    const heading = Math.atan2(direction.x, direction.z) * (180 / Math.PI);

    // Normalize to 0-360
    return (heading + 360) % 360;
  }

  /** Debug: Log camera state */
  debugLogCameraState(): void {
    if (!this.engine) {
      console.log('[Camera Debug] No engine');
      return;
    }
    const camera = this.engine.getCamera();
    const heading = this.getCameraHeading();
    console.log('[Camera Debug]', {
      position: { x: camera.position.x.toFixed(1), y: camera.position.y.toFixed(1), z: camera.position.z.toFixed(1) },
      rotation: { x: (camera.rotation.x * 180/Math.PI).toFixed(1), y: (camera.rotation.y * 180/Math.PI).toFixed(1), z: (camera.rotation.z * 180/Math.PI).toFixed(1) },
      heading: heading.toFixed(1)
    });
  }

  // ========================================
  // FLY-TO ANIMATIONS
  // ========================================

  /**
   * Fly camera to center location (uses resetCamera for consistent positioning)
   */
  flyToCenter(): void {
    this.resetCamera();
  }

  /**
   * Fly camera to specific location
   * @param lat Latitude
   * @param lon Longitude
   * @param height Optional height above terrain (default: 400m)
   * @param duration Optional animation duration in ms (default: instant)
   */
  flyToLocation(lat: number, lon: number, height: number = 400, duration: number = 0): void {
    if (!this.engine) return;

    const terrainY = this.engine.getTerrainHeightAtGeo(lat, lon) ?? 0;
    const cameraY = terrainY + height;

    // For now, we use instant positioning (no animation)
    // TODO: Implement smooth animation with requestAnimationFrame
    this.engine.setLocalCameraPosition(0, cameraY, -height, 0, terrainY, 0);
  }

  // ========================================
  // DEBUG
  // ========================================

  /**
   * Get comprehensive camera debug information
   * Returns all relevant camera stats for debug overlay
   */
  getCameraDebugInfo(): CameraDebugInfo | null {
    if (!this.engine) return null;

    const camera = this.engine.getCamera();

    // Get terrain height at camera XZ position (projected down)
    // Use baseCoords as reference since camera is in local coords
    const terrainHeight = this.baseCoords
      ? (this.engine.getTerrainHeightAtGeo(this.baseCoords.lat, this.baseCoords.lon) ?? 0)
      : 0;

    // Calculate altitude above terrain
    const altitude = camera.position.y - terrainHeight;

    // Calculate pitch (angle from horizontal)
    // Camera looking straight down = -90°, horizontal = 0°
    const pitch = camera.rotation.x * (180 / Math.PI);

    // Calculate distance to center/lookAt point
    // Approximate: use camera height and pitch to estimate
    const pitchRad = Math.abs(camera.rotation.x);
    const distanceToCenter = pitchRad > 0.01 ? altitude / Math.sin(pitchRad) : altitude;

    return {
      posX: camera.position.x,
      posY: camera.position.y,
      posZ: camera.position.z,
      rotX: camera.rotation.x * (180 / Math.PI),
      rotY: camera.rotation.y * (180 / Math.PI),
      rotZ: camera.rotation.z * (180 / Math.PI),
      heading: this.getCameraHeading(),
      pitch: pitch,
      altitude: altitude,
      distanceToCenter: distanceToCenter,
      fov: camera instanceof THREE.PerspectiveCamera ? camera.fov : 60,
      terrainHeight: terrainHeight,
    };
  }

  /**
   * Toggle debug framing visualization
   */
  toggleDebugFraming(enabled?: boolean): boolean {
    this.debugFramingEnabled = enabled ?? !this.debugFramingEnabled;
    if (!this.debugFramingEnabled) {
      this.clearDebugVisualization();
    }
    console.log(`[Camera] Debug framing: ${this.debugFramingEnabled ? 'ON' : 'OFF'}`);
    return this.debugFramingEnabled;
  }

  /**
   * Check if debug framing is enabled
   */
  isDebugFramingEnabled(): boolean {
    return this.debugFramingEnabled;
  }

  /**
   * Show debug visualization for camera framing
   * Call this after frameHqAndSpawns to see the bounding boxes
   */
  showDebugVisualization(
    hq: { lat: number; lon: number },
    spawns: { lat: number; lon: number }[],
    padding: number = 0.2
  ): void {
    if (!this.engine || !this.debugFramingEnabled) return;

    // Clear previous debug meshes
    this.clearDebugVisualization();

    const sync = this.engine.sync;
    const scene = this.engine.getScene();

    // Convert all points to local coordinates
    const hqLocal = sync.geoToLocalSimple(hq.lat, hq.lon, 0);
    const spawnLocals = spawns.map(s => sync.geoToLocalSimple(s.lat, s.lon, 0));
    const allPoints = [hqLocal, ...spawnLocals];

    // Calculate bounding box
    let minX = Infinity, maxX = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    for (const p of allPoints) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }

    // Calculate spans - keep rectangular!
    const spanX = Math.max(maxX - minX, 50);
    const spanZ = Math.max(maxZ - minZ, 50);

    // Add padding to each dimension separately (rectangular, not square)
    const paddedSpanX = spanX * (1 + padding);
    const paddedSpanZ = spanZ * (1 + padding);

    // Center
    const centerX = (minX + maxX) / 2;
    const centerZ = (minZ + maxZ) / 2;

    // Get terrain height for Y positioning
    const terrainY = this.engine.getTerrainHeightAtGeo(hq.lat, hq.lon) ?? 0;
    const boxY = terrainY + 5; // Slightly above terrain

    // === Create inner bounding box (cyan) - actual bounds ===
    const innerBoxGeometry = new THREE.BufferGeometry();
    const innerBoxVertices = new Float32Array([
      // Bottom rectangle
      minX, boxY, minZ,  maxX, boxY, minZ,
      maxX, boxY, minZ,  maxX, boxY, maxZ,
      maxX, boxY, maxZ,  minX, boxY, maxZ,
      minX, boxY, maxZ,  minX, boxY, minZ,
    ]);
    innerBoxGeometry.setAttribute('position', new THREE.BufferAttribute(innerBoxVertices, 3));
    const innerBoxMaterial = new THREE.LineBasicMaterial({ color: 0x00ffff, depthTest: false, transparent: true });
    const innerBox = new THREE.LineSegments(innerBoxGeometry, innerBoxMaterial);
    innerBox.renderOrder = 999;
    scene.add(innerBox);
    this.debugMeshes.push(innerBox);

    // === Create padded bounding box (yellow) - rectangular with padding ===
    const halfPaddedX = paddedSpanX / 2;
    const halfPaddedZ = paddedSpanZ / 2;
    const padMinX = centerX - halfPaddedX;
    const padMaxX = centerX + halfPaddedX;
    const padMinZ = centerZ - halfPaddedZ;
    const padMaxZ = centerZ + halfPaddedZ;

    const outerBoxGeometry = new THREE.BufferGeometry();
    const outerBoxVertices = new Float32Array([
      // Bottom rectangle
      padMinX, boxY, padMinZ,  padMaxX, boxY, padMinZ,
      padMaxX, boxY, padMinZ,  padMaxX, boxY, padMaxZ,
      padMaxX, boxY, padMaxZ,  padMinX, boxY, padMaxZ,
      padMinX, boxY, padMaxZ,  padMinX, boxY, padMinZ,
    ]);
    outerBoxGeometry.setAttribute('position', new THREE.BufferAttribute(outerBoxVertices, 3));
    const outerBoxMaterial = new THREE.LineBasicMaterial({ color: 0xffff00, depthTest: false, transparent: true });
    const outerBox = new THREE.LineSegments(outerBoxGeometry, outerBoxMaterial);
    outerBox.renderOrder = 999;
    scene.add(outerBox);
    this.debugMeshes.push(outerBox);

    // === Create point markers ===
    const sphereGeometry = new THREE.SphereGeometry(8, 16, 16);

    // HQ marker (green)
    const hqMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00, depthTest: false, transparent: true });
    const hqSphere = new THREE.Mesh(sphereGeometry, hqMaterial);
    hqSphere.position.set(hqLocal.x, boxY + 10, hqLocal.z);
    hqSphere.renderOrder = 999;
    scene.add(hqSphere);
    this.debugMeshes.push(hqSphere);

    // Spawn markers (red)
    const spawnMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000, depthTest: false, transparent: true });
    for (const spawn of spawnLocals) {
      const spawnSphere = new THREE.Mesh(sphereGeometry, spawnMaterial);
      spawnSphere.position.set(spawn.x, boxY + 10, spawn.z);
      spawnSphere.renderOrder = 999;
      scene.add(spawnSphere);
      this.debugMeshes.push(spawnSphere);
    }

    // === Center point (white) ===
    const centerMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true });
    const centerSphere = new THREE.Mesh(sphereGeometry, centerMaterial);
    centerSphere.position.set(centerX, boxY + 10, centerZ);
    centerSphere.renderOrder = 999;
    scene.add(centerSphere);
    this.debugMeshes.push(centerSphere);

    // === Camera position indicator (magenta) ===
    const camera = this.engine.getCamera();
    const camMarkerGeometry = new THREE.ConeGeometry(15, 30, 4);
    const camMaterial = new THREE.MeshBasicMaterial({ color: 0xff00ff, wireframe: true, depthTest: false, transparent: true });
    const camMarker = new THREE.Mesh(camMarkerGeometry, camMaterial);
    camMarker.position.copy(camera.position);
    camMarker.rotation.x = Math.PI; // Point down
    camMarker.renderOrder = 999;
    scene.add(camMarker);
    this.debugMeshes.push(camMarker);

    // === Line from camera to lookAt (magenta dashed) ===
    const lookAtLineGeometry = new THREE.BufferGeometry();
    const lookAtLineVertices = new Float32Array([
      camera.position.x, camera.position.y, camera.position.z,
      centerX, terrainY, centerZ
    ]);
    lookAtLineGeometry.setAttribute('position', new THREE.BufferAttribute(lookAtLineVertices, 3));
    const lookAtLineMaterial = new THREE.LineDashedMaterial({ color: 0xff00ff, dashSize: 20, gapSize: 10, depthTest: false, transparent: true });
    const lookAtLine = new THREE.Line(lookAtLineGeometry, lookAtLineMaterial);
    lookAtLine.computeLineDistances();
    lookAtLine.renderOrder = 999;
    scene.add(lookAtLine);
    this.debugMeshes.push(lookAtLine);

    // === HQ-to-Spawns axis line (orange) ===
    if (spawnLocals.length > 0) {
      const spawnCentroidX = spawnLocals.reduce((sum, p) => sum + p.x, 0) / spawnLocals.length;
      const spawnCentroidZ = spawnLocals.reduce((sum, p) => sum + p.z, 0) / spawnLocals.length;

      const axisLineGeometry = new THREE.BufferGeometry();
      const axisLineVertices = new Float32Array([
        hqLocal.x, boxY + 15, hqLocal.z,
        spawnCentroidX, boxY + 15, spawnCentroidZ
      ]);
      axisLineGeometry.setAttribute('position', new THREE.BufferAttribute(axisLineVertices, 3));
      const axisLineMaterial = new THREE.LineBasicMaterial({ color: 0xff8800, depthTest: false, transparent: true });
      const axisLine = new THREE.Line(axisLineGeometry, axisLineMaterial);
      axisLine.renderOrder = 999;
      scene.add(axisLine);
      this.debugMeshes.push(axisLine);

      // Spawn centroid marker (orange)
      const centroidMaterial = new THREE.MeshBasicMaterial({ color: 0xff8800, depthTest: false, transparent: true });
      const centroidSphere = new THREE.Mesh(sphereGeometry, centroidMaterial);
      centroidSphere.position.set(spawnCentroidX, boxY + 15, spawnCentroidZ);
      centroidSphere.renderOrder = 999;
      scene.add(centroidSphere);
      this.debugMeshes.push(centroidSphere);
    }

    console.log('[Camera Debug] Visualization created:', {
      innerBox: { minX: minX.toFixed(0), maxX: maxX.toFixed(0), minZ: minZ.toFixed(0), maxZ: maxZ.toFixed(0) },
      paddedBox: { minX: padMinX.toFixed(0), maxX: padMaxX.toFixed(0), minZ: padMinZ.toFixed(0), maxZ: padMaxZ.toFixed(0) },
      spans: { x: paddedSpanX.toFixed(0), z: paddedSpanZ.toFixed(0) },
      center: { x: centerX.toFixed(0), z: centerZ.toFixed(0) },
      meshCount: this.debugMeshes.length
    });
  }

  /**
   * Clear all debug visualization meshes
   */
  clearDebugVisualization(): void {
    if (!this.engine) return;

    const scene = this.engine.getScene();
    for (const mesh of this.debugMeshes) {
      scene.remove(mesh);
      if (mesh instanceof THREE.Mesh || mesh instanceof THREE.Line || mesh instanceof THREE.LineSegments) {
        mesh.geometry.dispose();
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach(m => m.dispose());
        } else {
          mesh.material.dispose();
        }
      }
    }
    this.debugMeshes = [];
  }

  /**
   * Log current camera position and rotation to console
   * Useful for debugging camera issues and determining initial positions
   */
  logCameraPosition(): void {
    if (!this.engine) return;

    const camera = this.engine.getCamera();

    const data = {
      position: {
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z,
      },
      rotation: {
        x: camera.rotation.x,
        y: camera.rotation.y,
        z: camera.rotation.z,
      },
    };

    console.log('[Camera] Current position:', JSON.stringify(data, null, 2));
  }

  // ========================================
  // CLEANUP
  // ========================================

  /**
   * Clear camera state
   */
  dispose(): void {
    this.clearDebugVisualization();
    this.engine = null;
    this.baseCoords = null;
    this.initialCameraPosition = null;
    this.debugFramingEnabled = false;
  }
}
