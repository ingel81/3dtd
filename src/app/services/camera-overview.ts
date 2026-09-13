import type { CameraControlService, CameraView } from './camera-control.service';
import type { CameraFramingService, CameraFrame, GeoPoint } from './camera-framing.service';
import type { PathAndRouteService } from './world/path-route.service';
import type { IntroCameraFlightService } from './world/intro-camera-flight.service';
import type { GlobalRouteGridService } from './world/global-route-grid.service';
import type { TowerDefenseStore } from '../store/tower-defense.store';
import type { EngineStore } from '../store/engine.store';
import type { ThreeTilesEngine } from '../three-engine';
import { CAMERA_PADDING, CAMERA_ANGLE, CAMERA_MARKER_RADIUS } from '../configs/map-constants.config';

/**
 * Cells from tiles up to this geometric error (m) count as reliable ground
 * for the overview frame, the same bound the intro flight uses
 * (IntroCameraFlightService maxSampleError).
 */
const OVERVIEW_MAX_TILE_ERROR = 20;

function frameToView(frame: CameraFrame): CameraView {
  return {
    position: { x: frame.camX, y: frame.camY, z: frame.camZ },
    target: { x: frame.lookAtX, y: frame.lookAtY, z: frame.lookAtZ },
  };
}

/** What CameraOverview needs; VisualizationFacadeService passes its services. */
export interface CameraOverviewDeps {
  store: Pick<TowerDefenseStore, 'baseCoords' | 'spawnPoints' | 'cameraFramingDebug'>;
  engineStore: Pick<EngineStore, 'cameraDebugEnabled' | 'cameraDebugInfo'>;
  cameraControl: Pick<
    CameraControlService,
    'setOverviewProvider' | 'showDebugVisualization' | 'saveInitialPosition' | 'toggleDebugFraming' | 'getCameraDebugInfo'
  >;
  cameraFraming: Pick<CameraFramingService, 'setEngine' | 'getLastFrame' | 'applyFrame' | 'computeFrameWithEngine'>;
  pathRoute: Pick<PathAndRouteService, 'getCachedPaths'>;
  introFlight: Pick<IntroCameraFlightService, 'isRunning'>;
  /** The route grid of the game state, set by the facade's initialize(); read on each call. */
  grid: () => Pick<GlobalRouteGridService, 'isInitialized' | 'getGrid'>;
}

/**
 * The overview camera: the frame around HQ, spawns and all routes on the
 * ground of the route cells, stored as the view the intro lands in and
 * Reset Camera returns to, and the camera debug toggles.
 */
export class CameraOverview {
  constructor(private readonly deps: CameraOverviewDeps) {}

  /** Hand the framing the engine and the camera the overview, once per location. */
  initialize(engine: ThreeTilesEngine): void {
    // The overview frame needs the camera's real lens and the terrain from the
    // first reframe on; without the engine it fell back to a 75° default lens
    // and could not apply the frame at all.
    this.deps.cameraFraming.setEngine(engine);
    // Reset Camera, intro cancel and the intro's landing compute the
    // overview fresh, see CameraControlService.setOverviewProvider().
    this.deps.cameraControl.setOverviewProvider(() => {
      const frame = this.computeOverviewFrame();
      return frame ? frameToView(frame) : null;
    });
  }

  /**
   * Store the last computed overview frame as the initial view (intro
   * landing, Reset Camera, intro cancel). The frame, not the live camera: by
   * now the camera may be anywhere, mid-intro or panned.
   */
  saveInitialPosition(): void {
    const hq = this.deps.store.baseCoords();
    const spawns = this.deps.store.spawnPoints();

    const routePoints = this.collectRoutePoints();

    if (spawns.length > 0) {
      const hqCoord = { lat: hq.lat, lon: hq.lon };
      const spawnCoords = spawns.map(s => ({ lat: s.lat, lon: s.lon }));
      this.deps.cameraControl.showDebugVisualization(hqCoord, spawnCoords, CAMERA_PADDING, routePoints);
    }

    // Without a frame (no ground known yet) nothing is stored: the camera's
    // start pose is no overview. Reset and intro compute one when needed.
    const frame = this.deps.cameraFraming.getLastFrame();
    if (frame) this.deps.cameraControl.saveInitialPosition(frameToView(frame));
  }

  /**
   * Toggle camera framing debug visualization.
   */
  toggleFramingDebug(): void {
    const enabled = this.deps.cameraControl.toggleDebugFraming();
    this.deps.store.cameraFramingDebug.set(enabled);

    if (enabled) {
      const hq = this.deps.store.baseCoords();
      const spawns = this.deps.store.spawnPoints();

      const routePoints = this.collectRoutePoints();

      if (spawns.length > 0) {
        this.deps.cameraControl.showDebugVisualization(
          { lat: hq.lat, lon: hq.lon },
          spawns.map(s => ({ lat: s.lat, lon: s.lon })),
          CAMERA_PADDING,
          routePoints
        );
      }
    }
  }

  /**
   * Toggle camera debug overlay.
   */
  toggleCameraDebug(): void {
    const enabled = !this.deps.engineStore.cameraDebugEnabled();
    this.deps.engineStore.cameraDebugEnabled.set(enabled);

    if (enabled) {
      this.deps.engineStore.cameraDebugInfo.set(this.deps.cameraControl.getCameraDebugInfo());
    } else {
      this.deps.engineStore.cameraDebugInfo.set(null);
    }
  }

  /**
   * Compute the overview frame around HQ, spawns and all routes and move the
   * camera there, unless the intro flight has the camera; it lands in the
   * overview anyway.
   */
  reframe(): void {
    const frame = this.computeOverviewFrame();
    if (frame && !this.deps.introFlight.isRunning()) {
      this.deps.cameraFraming.applyFrame(frame);
    }
  }

  /**
   * The overview frame around HQ, spawns and all routes, on the ground of
   * the route cells; null without routes or without any ground yet.
   */
  private computeOverviewFrame(): CameraFrame | null {
    const base = this.deps.store.baseCoords();
    const hq: GeoPoint = { lat: base.lat, lon: base.lon };

    const spawns: GeoPoint[] = this.deps.store.spawnPoints().map(sp => ({
      lat: sp.lat,
      lon: sp.lon,
    }));

    const routePoints = this.collectRoutePoints();
    if (routePoints.length === 0) return null;

    const routeGrid = this.deps.grid();
    const cells = routeGrid.isInitialized() ? routeGrid.getGrid() : null;
    return this.deps.cameraFraming.computeFrameWithEngine(hq, spawns, {
      padding: CAMERA_PADDING,
      angle: CAMERA_ANGLE,
      markerRadius: CAMERA_MARKER_RADIUS,
      routePoints,
      groundAt: cells
        ? (x, z) => {
            const sample = cells.getGroundSampleAt(x, z);
            return sample && { y: sample.y, reliable: sample.tileError <= OVERVIEW_MAX_TILE_ERROR };
          }
        : undefined,
    });
  }

  /**
   * Collect all route points from cached paths as GeoPoints.
   */
  private collectRoutePoints(): GeoPoint[] {
    const routePoints: GeoPoint[] = [];
    const cachedPaths = this.deps.pathRoute.getCachedPaths();
    cachedPaths.forEach((path) => {
      for (const pos of path) {
        routePoints.push({ lat: pos.lat, lon: pos.lon });
      }
    });
    return routePoints;
  }
}
