import { Object3D, PerspectiveCamera, Scene } from 'three';
import { GlobeControls, EnvironmentControls, type TilesRenderer } from '3d-tiles-renderer';

/**
 * CameraRig: Controls und Startposition der Engine-Kamera.
 *
 * Vorher inline in `three-tiles-engine.ts` (`setupControls`, `setupDevWorldControls`).
 * Die Kamera selbst bleibt beim Engine, weil Szene, Post-Processing, Spatial Audio und
 * die Renderer an ihr hängen; der Rig setzt die Controls darauf und stellt die
 * Startposition ein. Das eigentliche Framing setzt danach CameraFramingService über
 * `setLocalCameraPosition()`.
 *
 * - Tiles-Pfad: GlobeControls über dem Ellipsoid der TilesRenderer-Gruppe
 * - DevWorld: EnvironmentControls über der flachen devWorldGroup
 *
 * Vom Engine besessen: `update()` pro Frame vor dem Tiles-Update, `dispose()` aus dem
 * Engine-dispose().
 */
export class CameraRig {
  private controls: GlobeControls | null = null;

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly canvas: HTMLCanvasElement,
  ) {}

  /**
   * GlobeControls für den Tiles-Pfad. Wird in `initialize()` aufgerufen, nachdem die
   * TilesRenderer-Gruppe in der Szene hängt und bevor der Renderer die Kamera bekommt.
   */
  setupGlobeControls(scene: Scene, tilesRenderer: TilesRenderer): void {
    // GlobeControls for earth-like navigation
    // Don't pass tilesRenderer to constructor (deprecated), use setScene/setEllipsoid instead
    const controls = new GlobeControls(scene, this.camera, this.canvas);
    this.controls = controls;
    controls.enableDamping = true;
    // Library default since 0.5. A double click would start a zoom animation
    // that the drag handlers read as a pan.
    controls.enableDoubleTapZoom = false;
    this.preventControlsFocus();

    // Set scene and ellipsoid for controls (new API)
    controls.setScene(scene);
    controls.setEllipsoid(tilesRenderer.ellipsoid, tilesRenderer.group);

    this.applyStartPosition();
  }

  /**
   * EnvironmentControls für DevWorld.
   *
   * Uses EnvironmentControls instead of GlobeControls because:
   * - GlobeControls is designed for globe navigation at Earth-radius distances
   * - DevWorld has flat terrain at local origin
   * - EnvironmentControls raycasts against scene geometry for pivoting/panning
   *
   * Control scheme (same interaction model as GlobeControls):
   * - Left mouse drag: Pan (slide camera along terrain)
   * - Right mouse drag: Rotate (orbit around pivot point)
   * - Scroll wheel: Zoom in/out
   */
  setupEnvironmentControls(scene: Scene, devWorldGroup: Object3D): void {
    const LOG = '[DevWorld]';
    console.log(`${LOG} ========== CONTROLS SETUP ==========`);

    // EnvironmentControls - works with flat local terrain
    const envControls = new EnvironmentControls(scene, this.camera, this.canvas);

    // Configure controls
    envControls.enableDamping = true;
    envControls.enableDoubleTapZoom = false;
    this.preventControlsFocus();
    envControls.minDistance = 5;       // Minimum zoom distance
    envControls.maxDistance = 2000;    // Maximum zoom distance
    envControls.minAltitude = 0.1;     // Min camera altitude (radians from ground)
    envControls.maxAltitude = Math.PI / 2 - 0.1; // Max altitude (near vertical)

    // Set scene for raycasting (against devWorldGroup which contains terrain)
    envControls.setScene(devWorldGroup);

    // Store as GlobeControls type (EnvironmentControls is parent class)
    this.controls = envControls as unknown as GlobeControls;

    // Position camera - steep 70° view (same as real game)
    this.applyStartPosition();
    console.log(`${LOG} Camera default: pos=(0, 400, -145), lookAt=(0, 0, 0)`);

    // Update controls after camera positioning
    envControls.update();

    const pos = this.camera.position;
    console.log(`${LOG} EnvironmentControls configured`);
    console.log(`${LOG} Camera position: (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`);
    console.log(`${LOG} Controls: pan=left-drag, rotate=right-drag, zoom=scroll`);
  }

  /**
   * Steep 70° view over the origin (minimal horizon, fewer tiles).
   * 70° angle: height = tan(70°) * distance ≈ 2.75 * distance,
   * for 150m horizontal offset: height ≈ 412m.
   *
   * With ReorientationPlugin (recenter: true) and tiles.group.rotation.x = -PI/2:
   * - Origin (HQ) is at (0,0,0) in local space
   * - Y is up, -Z is South, +Z is North
   *
   * DevWorld liegt im selben lokalen Rahmen, deshalb gilt die Startposition für beide.
   */
  private applyStartPosition(): void {
    this.camera.position.set(0, 400, -145); // ~70° angle, looking north
    this.camera.lookAt(0, 0, 0);
  }

  /**
   * Since 0.5 the controls make the canvas focusable and focus it on every
   * pointerdown, then reset a running drag whenever W/A/S/D, Q/E or an arrow
   * key goes down on it. Those are our KeyboardPanService keys, so panning
   * with the keyboard while dragging would cancel the drag. The listener only
   * sees keys while the canvas has focus; without a tabindex it never does.
   * Our own key handling listens on window and is unaffected.
   */
  private preventControlsFocus(): void {
    this.canvas.removeAttribute('tabindex');
  }

  /** Per Frame vor dem Tiles-Update: Damping und Eingaben der Controls anwenden. */
  update(): void {
    if (this.controls) {
      this.controls.update();
    }
  }

  /** Kamera in lokalen Koordinaten (Meter relativ zum Origin) setzen und auf das Ziel richten. */
  setLocalPosition(x: number, y: number, z: number, targetX: number, targetY: number, targetZ: number): void {
    this.camera.position.set(x, y, z);
    this.camera.lookAt(targetX, targetY, targetZ);
  }

  /** GlobeControls im Tiles-Pfad, EnvironmentControls in DevWorld, null vor dem Setup und nach dispose(). */
  getControls(): GlobeControls | null {
    return this.controls;
  }

  /**
   * Gibt die Controls frei, damit ihre Pointer- und Wheel-Listener nicht am Canvas
   * hängen bleiben. Nur aus dem Engine-dispose(); ein Standortwechsel (setOrigin)
   * behält Rig und Controls.
   */
  dispose(): void {
    if (this.controls) {
      this.controls.dispose();
      this.controls = null;
    }
  }
}
