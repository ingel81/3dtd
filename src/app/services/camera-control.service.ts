import { Injectable } from '@angular/core';
import {
  Vector3,
  Vector2,
  PerspectiveCamera,
  Object3D,
  Mesh,
  Line,
  LineSegments,
  BufferGeometry,
  BufferAttribute,
  SphereGeometry,
  ConeGeometry,
  MeshBasicMaterial,
  LineBasicMaterial,
  LineDashedMaterial,
} from 'three';
import { ThreeTilesEngine } from '../three-engine';
import { GeoPosition } from '../models/game.types';
import { cameraTimeline } from '../utils/camera-timeline';
import type { CameraFrame } from './camera-framing.service';
import { easeInOutCubic, jumpCameraPosition } from '../utils/camera-jump';

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** A camera pose as position and look-at target, local coordinates. */
export interface CameraView {
  position: Point3;
  target: Point3;
}

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

  /** Stored initial camera position and target for reset functionality */
  private initialCameraPosition: { x: number; y: number; z: number } | null = null;
  private initialCameraTarget: { x: number; y: number; z: number } | null = null;

  /** Computes the overview fresh, see setOverviewProvider(). */
  private overviewProvider: (() => CameraView | null) | null = null;

  /** Reference to the 3D engine */
  private engine: ThreeTilesEngine | null = null;

  /** Base coordinates for fallback positioning */
  private baseCoords: GeoPosition | null = null;

  /** Debug visualization enabled */
  private debugFramingEnabled = false;

  /** Debug meshes for cleanup */
  private debugMeshes: Object3D[] = [];

  /** Wall-clock length of a quick jump (Home, N), ms */
  private static readonly JUMP_DURATION_MS = 600;
  /** Distance of the fallback view when the camera looks at the horizon, m */
  private static readonly JUMP_FALLBACK_DISTANCE_M = 300;

  /** Running quick jump: whole displacement, time run, share already applied */
  private jump: { dx: number; dy: number; dz: number; elapsedMs: number; applied: number } | null = null;
  private readonly jumpDirection = new Vector3();

  /** Stop a quick jump under way where it is (the replay puts the camera back). */
  cancelJump(): void {
    this.jump = null;
  }

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
   * Store the initial view (intro landing, Reset Camera): the overview frame.
   */
  saveInitialPosition(view: CameraView): void {
    if (!this.engine) return;

    this.initialCameraPosition = { ...view.position };
    this.initialCameraTarget = { ...view.target };
    cameraTimeline.record(
      'initialView.save',
      { position: this.initialCameraPosition, target: this.initialCameraTarget },
      true,
    );
  }

  /**
   * Computes the overview when it is needed (Reset Camera, intro cancel, the
   * intro's landing). The ground under it improves while tiles stream (with
   * a cold cache there is none at all during loading), and the window may
   * have changed since the last one.
   */
  setOverviewProvider(provider: (() => CameraView | null) | null): void {
    this.overviewProvider = provider;
  }

  /**
   * The overview (position + look-at target) in local coordinates, computed
   * fresh by the provider where possible and stored, else the stored one;
   * null while there is none. Used by scripted camera moves that need to
   * land exactly in the normal game view (intro flight outro blend).
   */
  getOverview(): CameraView | null {
    const fresh = this.overviewProvider?.() ?? null;
    if (fresh) this.saveInitialPosition(fresh);
    return this.getInitialView();
  }

  /** The stored overview, read only (state dump); see getOverview(). */
  getInitialView(): CameraView | null {
    if (!this.initialCameraPosition || !this.initialCameraTarget) return null;
    return {
      position: { ...this.initialCameraPosition },
      target: { ...this.initialCameraTarget },
    };
  }

  /**
   * Move the camera to the overview. Without one (no ground known yet) it
   * stays where it is rather than guessing a pose over a ground that is not
   * there; the start pose once stood in for it and ended up ~100 m over the
   * streets, looking at a point far below them.
   */
  resetCamera(): void {
    if (!this.engine) return;
    cameraTimeline.record('camera.reset', {}, true);
    this.jump = null;

    const view = this.getOverview();
    if (!view) {
      cameraTimeline.record('camera.reset.noOverview');
      return;
    }
    const { position: pos, target } = view;
    this.engine.setLocalCameraPosition(pos.x, pos.y, pos.z, target.x, target.y, target.z);
  }

  /**
   * Glide the camera so it shows a ground point the way it shows the ground
   * now (hotkeys Home: HQ, N: spawn points). Orientation stays, only the
   * position moves, see jumpCameraPosition. The move is added per frame on
   * top of whatever else moves the camera (keyboard pan, the controls), so
   * nothing fights over it. Looking at the horizon there is no ground point
   * to keep, the camera then cuts to a 45° view of the target along its
   * heading.
   *
   * @returns false without an engine
   */
  focusGeo(lat: number, lon: number): boolean {
    if (!this.engine) return false;

    const ground = this.engine.sync.geoToLocalSimple(lat, lon, 0);
    // The overview target sits on the cell ground near the HQ, a fair guess
    // while the tiles under the target have not streamed in
    const y = this.engine.getTerrainHeightAtGeo(lat, lon) ?? this.initialCameraTarget?.y ?? 0;
    const target = { x: ground.x, y, z: ground.z };
    cameraTimeline.record('camera.jump', { target: [target.x, target.y, target.z] }, true);

    const camera = this.engine.getCamera();
    camera.getWorldDirection(this.jumpDirection);
    const to = jumpCameraPosition(camera.position, this.jumpDirection, target);
    if (!to) {
      this.jump = null;
      const horizontal = Math.hypot(this.jumpDirection.x, this.jumpDirection.z) || 1;
      const back = CameraControlService.JUMP_FALLBACK_DISTANCE_M * Math.SQRT1_2 / horizontal;
      this.engine.setLocalCameraPosition(
        target.x - this.jumpDirection.x * back,
        target.y + CameraControlService.JUMP_FALLBACK_DISTANCE_M * Math.SQRT1_2,
        target.z - this.jumpDirection.z * back,
        target.x, target.y, target.z,
      );
      return true;
    }

    this.jump = {
      dx: to.x - camera.position.x,
      dy: to.y - camera.position.y,
      dz: to.z - camera.position.z,
      elapsedMs: 0,
      applied: 0,
    };
    return true;
  }

  /** Drop a running quick jump; a scripted shot takes the camera (boss intro). */
  stopJump(): void {
    this.jump = null;
  }

  /** Per frame from the game loop, wall-clock ms: advance a running jump. */
  update(deltaMs: number): void {
    const jump = this.jump;
    if (!jump || !this.engine) return;

    jump.elapsedMs = Math.min(CameraControlService.JUMP_DURATION_MS, jump.elapsedMs + deltaMs);
    const eased = easeInOutCubic(jump.elapsedMs / CameraControlService.JUMP_DURATION_MS);
    const share = eased - jump.applied;
    jump.applied = eased;

    const position = this.engine.getCamera().position;
    position.x += jump.dx * share;
    position.y += jump.dy * share;
    position.z += jump.dz * share;

    if (jump.elapsedMs >= CameraControlService.JUMP_DURATION_MS) this.jump = null;
  }

  /**
   * Get current camera heading (azimuth) in degrees relative to GEOGRAPHIC north
   * 0° = North, 90° = East, 180° = South, 270° = West
   */
  getCameraHeading(): number {
    if (!this.engine) return 0;

    const camera = this.engine.getCamera();

    // Get camera's forward direction (where it's looking)
    // Camera looks down -Z in its local space
    const direction = new Vector3(0, 0, -1);
    direction.applyQuaternion(camera.quaternion);

    // Project onto XZ plane (ignore Y component for heading)
    direction.y = 0;
    if (direction.lengthSq() < 0.001) {
      // Camera looking straight up or down - heading undefined
      return 0;
    }
    direction.normalize();

    // Calculate TRUE GEOGRAPHIC NORTH direction in local coordinates
    // by finding where a point slightly north of the origin maps to
    const origin = this.engine.sync.getOrigin();
    const northPoint = this.engine.sync.geoToLocalSimple(
      origin.lat + 0.001, // ~111 meters north
      origin.lon,
      0
    );

    // True north direction in local space (from origin to north point)
    const trueNorth = new Vector2(northPoint.x, northPoint.z).normalize();

    // Camera direction in XZ plane
    const camDir = new Vector2(direction.x, direction.z);

    // Calculate angle between camera direction and true north
    // Using atan2 of cross product and dot product for signed angle
    const cross = trueNorth.x * camDir.y - trueNorth.y * camDir.x;
    const dot = trueNorth.x * camDir.x + trueNorth.y * camDir.y;
    const heading = Math.atan2(cross, dot) * (180 / Math.PI);

    // Normalize to 0-360
    return (heading + 360) % 360;
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
      fov: camera instanceof PerspectiveCamera ? camera.fov : 60,
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
    return this.debugFramingEnabled;
  }

  /**
   * Check if debug framing is enabled
   */
  isDebugFramingEnabled(): boolean {
    return this.debugFramingEnabled;
  }

  /**
   * Draw the frame CameraFramingService computed: the box it fitted (cyan),
   * padded (yellow), HQ and spawns, its centre and the line to its look-at.
   * Drawn from the frame itself, so the debug view shows what the camera
   * was fitted to, raised points and marker radius included.
   * @param padding the padding the frame was computed with (CAMERA_PADDING)
   */
  showDebugVisualization(
    hq: { lat: number; lon: number },
    spawns: { lat: number; lon: number }[],
    frame: CameraFrame,
    padding: number,
  ): void {
    if (!this.engine || !this.debugFramingEnabled) return;

    // Clear previous debug meshes
    this.clearDebugVisualization();

    const sync = this.engine.sync;
    const scene = this.engine.getScene();

    const hqLocal = sync.geoToLocalSimple(hq.lat, hq.lon, 0);
    const spawnLocals = spawns.map(s => sync.geoToLocalSimple(s.lat, s.lon, 0));

    // The padded box is the frame's; the fitted one is the same without the padding
    const { minX: padMinX, maxX: padMaxX, minZ: padMinZ, maxZ: padMaxZ, centerX, centerZ, spanX, spanZ } = frame.boundingBox;
    const halfX = spanX / (1 + padding) / 2;
    const halfZ = spanZ / (1 + padding) / 2;
    const minX = centerX - halfX;
    const maxX = centerX + halfX;
    const minZ = centerZ - halfZ;
    const maxZ = centerZ + halfZ;

    // Slightly above the ground height the frame assumed
    const boxY = frame.lookAtY + 5;

    // === Create inner bounding box (cyan) - actual bounds ===
    const innerBoxGeometry = new BufferGeometry();
    const innerBoxVertices = new Float32Array([
      // Bottom rectangle
      minX, boxY, minZ,  maxX, boxY, minZ,
      maxX, boxY, minZ,  maxX, boxY, maxZ,
      maxX, boxY, maxZ,  minX, boxY, maxZ,
      minX, boxY, maxZ,  minX, boxY, minZ,
    ]);
    innerBoxGeometry.setAttribute('position', new BufferAttribute(innerBoxVertices, 3));
    const innerBoxMaterial = new LineBasicMaterial({ color: 0x00ffff, depthTest: false, transparent: true });
    const innerBox = new LineSegments(innerBoxGeometry, innerBoxMaterial);
    innerBox.renderOrder = 999;
    scene.add(innerBox);
    this.debugMeshes.push(innerBox);

    // === Create padded bounding box (yellow) ===

    const outerBoxGeometry = new BufferGeometry();
    const outerBoxVertices = new Float32Array([
      // Bottom rectangle
      padMinX, boxY, padMinZ,  padMaxX, boxY, padMinZ,
      padMaxX, boxY, padMinZ,  padMaxX, boxY, padMaxZ,
      padMaxX, boxY, padMaxZ,  padMinX, boxY, padMaxZ,
      padMinX, boxY, padMaxZ,  padMinX, boxY, padMinZ,
    ]);
    outerBoxGeometry.setAttribute('position', new BufferAttribute(outerBoxVertices, 3));
    const outerBoxMaterial = new LineBasicMaterial({ color: 0xffff00, depthTest: false, transparent: true });
    const outerBox = new LineSegments(outerBoxGeometry, outerBoxMaterial);
    outerBox.renderOrder = 999;
    scene.add(outerBox);
    this.debugMeshes.push(outerBox);

    // === Create point markers ===
    const sphereGeometry = new SphereGeometry(8, 16, 16);

    // HQ marker (green)
    const hqMaterial = new MeshBasicMaterial({ color: 0x00ff00, depthTest: false, transparent: true });
    const hqSphere = new Mesh(sphereGeometry, hqMaterial);
    hqSphere.position.set(hqLocal.x, boxY + 10, hqLocal.z);
    hqSphere.renderOrder = 999;
    scene.add(hqSphere);
    this.debugMeshes.push(hqSphere);

    // Spawn markers (red)
    const spawnMaterial = new MeshBasicMaterial({ color: 0xff0000, depthTest: false, transparent: true });
    for (const spawn of spawnLocals) {
      const spawnSphere = new Mesh(sphereGeometry, spawnMaterial);
      spawnSphere.position.set(spawn.x, boxY + 10, spawn.z);
      spawnSphere.renderOrder = 999;
      scene.add(spawnSphere);
      this.debugMeshes.push(spawnSphere);
    }

    // === Center point (white) ===
    const centerMaterial = new MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true });
    const centerSphere = new Mesh(sphereGeometry, centerMaterial);
    centerSphere.position.set(centerX, boxY + 10, centerZ);
    centerSphere.renderOrder = 999;
    scene.add(centerSphere);
    this.debugMeshes.push(centerSphere);

    // === Camera position indicator (magenta) ===
    const camera = this.engine.getCamera();
    const camMarkerGeometry = new ConeGeometry(15, 30, 4);
    const camMaterial = new MeshBasicMaterial({ color: 0xff00ff, wireframe: true, depthTest: false, transparent: true });
    const camMarker = new Mesh(camMarkerGeometry, camMaterial);
    camMarker.position.copy(camera.position);
    camMarker.rotation.x = Math.PI; // Point down
    camMarker.renderOrder = 999;
    scene.add(camMarker);
    this.debugMeshes.push(camMarker);

    // === Line from camera to lookAt (magenta dashed) ===
    const lookAtLineGeometry = new BufferGeometry();
    const lookAtLineVertices = new Float32Array([
      camera.position.x, camera.position.y, camera.position.z,
      frame.lookAtX, frame.lookAtY, frame.lookAtZ
    ]);
    lookAtLineGeometry.setAttribute('position', new BufferAttribute(lookAtLineVertices, 3));
    const lookAtLineMaterial = new LineDashedMaterial({ color: 0xff00ff, dashSize: 20, gapSize: 10, depthTest: false, transparent: true });
    const lookAtLine = new Line(lookAtLineGeometry, lookAtLineMaterial);
    lookAtLine.computeLineDistances();
    lookAtLine.renderOrder = 999;
    scene.add(lookAtLine);
    this.debugMeshes.push(lookAtLine);

    // === HQ-to-Spawns axis line (orange) ===
    if (spawnLocals.length > 0) {
      const spawnCentroidX = spawnLocals.reduce((sum, p) => sum + p.x, 0) / spawnLocals.length;
      const spawnCentroidZ = spawnLocals.reduce((sum, p) => sum + p.z, 0) / spawnLocals.length;

      const axisLineGeometry = new BufferGeometry();
      const axisLineVertices = new Float32Array([
        hqLocal.x, boxY + 15, hqLocal.z,
        spawnCentroidX, boxY + 15, spawnCentroidZ
      ]);
      axisLineGeometry.setAttribute('position', new BufferAttribute(axisLineVertices, 3));
      const axisLineMaterial = new LineBasicMaterial({ color: 0xff8800, depthTest: false, transparent: true });
      const axisLine = new Line(axisLineGeometry, axisLineMaterial);
      axisLine.renderOrder = 999;
      scene.add(axisLine);
      this.debugMeshes.push(axisLine);

      // Spawn centroid marker (orange)
      const centroidMaterial = new MeshBasicMaterial({ color: 0xff8800, depthTest: false, transparent: true });
      const centroidSphere = new Mesh(sphereGeometry, centroidMaterial);
      centroidSphere.position.set(spawnCentroidX, boxY + 15, spawnCentroidZ);
      centroidSphere.renderOrder = 999;
      scene.add(centroidSphere);
      this.debugMeshes.push(centroidSphere);
    }

  }

  /**
   * Clear all debug visualization meshes
   */
  clearDebugVisualization(): void {
    if (!this.engine) return;

    const scene = this.engine.getScene();
    for (const mesh of this.debugMeshes) {
      scene.remove(mesh);
      if (mesh instanceof Mesh || mesh instanceof Line || mesh instanceof LineSegments) {
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
    this.initialCameraTarget = null;
    this.overviewProvider = null;
    this.debugFramingEnabled = false;
    this.jump = null;
  }
}
