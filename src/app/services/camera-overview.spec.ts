import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { CameraOverview, type CameraOverviewDeps } from './camera-overview';
import { CAMERA_ANGLE, CAMERA_MARKER_RADIUS, CAMERA_PADDING } from '../configs/map-constants.config';
import type { CameraFrame } from './camera-framing.service';
import type { CameraView } from './camera-control.service';
import type { ThreeTilesEngine } from '../three-engine';

/**
 * The overview frame is computed around HQ, spawns and every route point,
 * on the ground of the route cells, and stored as the view the intro lands
 * in and Reset Camera returns to. The camera debug toggles mirror their
 * state into the stores.
 */
describe('CameraOverview', () => {
  const HQ = { lat: 48.7758, lon: 9.1829 };
  const SPAWN = { id: 'spawn-1', lat: 48.78, lon: 9.19 };
  const ROUTE = [{ ...HQ, height: 1 }, { lat: SPAWN.lat, lon: SPAWN.lon, height: 2 }];
  const ROUTE_POINTS = ROUTE.map(({ lat, lon }) => ({ lat, lon }));
  const FRAME = { camX: 1, camY: 2, camZ: 3, lookAtX: 4, lookAtY: 5, lookAtZ: 6 } as CameraFrame;
  const VIEW: CameraView = { position: { x: 1, y: 2, z: 3 }, target: { x: 4, y: 5, z: 6 } };

  let cachedPaths: Map<string, typeof ROUTE>;
  let deps: ReturnType<typeof fakeDeps>;
  let overview: CameraOverview;

  function fakeDeps() {
    return {
      store: {
        baseCoords: signal({ ...HQ }),
        spawnPoints: signal([SPAWN]),
        cameraFramingDebug: signal(false),
      },
      engineStore: { cameraDebugEnabled: signal(false), cameraDebugInfo: signal<unknown>(null) },
      cameraControl: {
        setOverviewProvider: vi.fn(),
        showDebugVisualization: vi.fn(),
        saveInitialPosition: vi.fn(),
        toggleDebugFraming: vi.fn(() => true),
        getCameraDebugInfo: vi.fn(() => ({ pitch: 45 })),
      },
      cameraFraming: {
        setEngine: vi.fn(),
        getLastFrame: vi.fn((): CameraFrame | null => null),
        applyFrame: vi.fn(),
        computeFrameWithEngine: vi.fn((_hq: unknown, _spawns: unknown, _options: unknown): CameraFrame | null => FRAME),
      },
      pathRoute: { getCachedPaths: vi.fn(() => cachedPaths) },
      introFlight: { isRunning: vi.fn(() => false) },
      routeGrid: { isInitialized: vi.fn(() => false), getGrid: vi.fn((): unknown => null) },
    };
  }

  const options = (call = 0) =>
    deps.cameraFraming.computeFrameWithEngine.mock.calls[call][2] as unknown as Record<string, unknown> & {
      groundAt?: (x: number, z: number) => unknown;
    };

  beforeEach(() => {
    cachedPaths = new Map([['spawn-1', ROUTE]]);
    deps = fakeDeps();
    overview = new CameraOverview({ ...deps, grid: () => deps.routeGrid } as unknown as CameraOverviewDeps);
  });

  describe('overview frame', () => {
    it('hands the framing the engine and the camera an overview computed fresh on each request', () => {
      const engine = { engine: true } as unknown as ThreeTilesEngine;
      overview.initialize(engine);
      expect(deps.cameraFraming.setEngine).toHaveBeenCalledWith(engine);
      const provider = deps.cameraControl.setOverviewProvider.mock.calls[0][0] as () => CameraView | null;

      expect(provider()).toEqual(VIEW);
      const [hq, spawns] = deps.cameraFraming.computeFrameWithEngine.mock.calls[0];
      expect(hq).toEqual(HQ);
      expect(spawns).toEqual([{ lat: SPAWN.lat, lon: SPAWN.lon }]);
      expect(options()).toMatchObject({
        padding: CAMERA_PADDING,
        angle: CAMERA_ANGLE,
        markerRadius: CAMERA_MARKER_RADIUS,
        routePoints: ROUTE_POINTS,
      });
      expect(options().groundAt).toBeUndefined();

      deps.cameraFraming.computeFrameWithEngine.mockReturnValueOnce(null);
      expect(provider()).toBeNull();
      cachedPaths = new Map();
      expect(provider()).toBeNull();
      expect(deps.cameraFraming.computeFrameWithEngine).toHaveBeenCalledTimes(2);
    });

    it('frames on cell ground and trusts it up to a tile error of 20 m', () => {
      deps.routeGrid.isInitialized.mockReturnValue(true);
      deps.routeGrid.getGrid.mockReturnValue({
        getGroundSampleAt: (x: number) =>
          x === 0 ? { y: 12, tileError: 20 } : x === 1 ? { y: 30, tileError: 21 } : null,
      });

      overview.reframe();

      expect(options().groundAt!(0, 0)).toEqual({ y: 12, reliable: true });
      expect(options().groundAt!(1, 0)).toEqual({ y: 30, reliable: false });
      expect(options().groundAt!(2, 0)).toBeNull();
    });

    it('moves the camera unless the intro flight has it', () => {
      overview.reframe();
      expect(deps.cameraFraming.applyFrame).toHaveBeenCalledWith(FRAME);

      deps.introFlight.isRunning.mockReturnValue(true);
      overview.reframe();
      expect(deps.cameraFraming.applyFrame).toHaveBeenCalledTimes(1);
    });

    it('neither computes nor moves without routes', () => {
      cachedPaths = new Map();
      overview.reframe();
      expect(deps.cameraFraming.computeFrameWithEngine).not.toHaveBeenCalled();
      expect(deps.cameraFraming.applyFrame).not.toHaveBeenCalled();
    });
  });

  describe('initial view', () => {
    it('stores the last frame, not the live camera, and draws the framing debug', () => {
      deps.cameraFraming.getLastFrame.mockReturnValue(FRAME);
      overview.saveInitialPosition();

      expect(deps.cameraControl.showDebugVisualization).toHaveBeenCalledWith(
        HQ, [{ lat: SPAWN.lat, lon: SPAWN.lon }], FRAME, CAMERA_PADDING,
      );
      expect(deps.cameraControl.saveInitialPosition).toHaveBeenCalledWith(VIEW);
      expect(deps.cameraFraming.computeFrameWithEngine).not.toHaveBeenCalled();
    });

    it('stores nothing before a frame exists and draws nothing without spawns', () => {
      deps.store.spawnPoints.set([]);
      overview.saveInitialPosition();
      expect(deps.cameraControl.showDebugVisualization).not.toHaveBeenCalled();
      expect(deps.cameraControl.saveInitialPosition).not.toHaveBeenCalled();
    });
  });

  describe('debug toggles', () => {
    it('mirrors the framing debug into the store and draws the last frame only when on', () => {
      deps.cameraFraming.getLastFrame.mockReturnValue(FRAME);
      overview.toggleFramingDebug();
      expect(deps.store.cameraFramingDebug()).toBe(true);
      expect(deps.cameraControl.showDebugVisualization).toHaveBeenCalledWith(
        HQ, [{ lat: SPAWN.lat, lon: SPAWN.lon }], FRAME, CAMERA_PADDING,
      );

      deps.cameraControl.toggleDebugFraming.mockReturnValue(false);
      overview.toggleFramingDebug();
      expect(deps.store.cameraFramingDebug()).toBe(false);
      expect(deps.cameraControl.showDebugVisualization).toHaveBeenCalledTimes(1);
    });

    it('draws no framing debug without spawns or before a frame exists', () => {
      overview.toggleFramingDebug();
      expect(deps.cameraControl.showDebugVisualization).not.toHaveBeenCalled();
      deps.cameraControl.toggleDebugFraming.mockReturnValue(false);
      overview.toggleFramingDebug();
      deps.cameraControl.toggleDebugFraming.mockReturnValue(true);
      deps.cameraFraming.getLastFrame.mockReturnValue(FRAME);
      deps.store.spawnPoints.set([]);
      overview.toggleFramingDebug();
      expect(deps.store.cameraFramingDebug()).toBe(true);
      expect(deps.cameraControl.showDebugVisualization).not.toHaveBeenCalled();
    });

    it('toggles the camera debug overlay with a fresh debug info', () => {
      overview.toggleCameraDebug();
      expect(deps.engineStore.cameraDebugEnabled()).toBe(true);
      expect(deps.engineStore.cameraDebugInfo()).toEqual({ pitch: 45 });

      overview.toggleCameraDebug();
      expect(deps.engineStore.cameraDebugEnabled()).toBe(false);
      expect(deps.engineStore.cameraDebugInfo()).toBeNull();
    });
  });
});
